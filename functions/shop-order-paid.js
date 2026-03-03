// Verify Stripe payment, mark order paid, send drop-ship vendor emails
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { payment_intent_id } = body;
  if (!payment_intent_id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing payment_intent_id' }) };
  }

  // Verify with Stripe that payment actually succeeded
  const pi = await stripeGet(`/payment_intents/${payment_intent_id}`);
  if (pi.error || pi.status !== 'succeeded') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment not confirmed' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch the order
  const { data: order } = await sb.from('shop_orders')
    .select('id, order_number, customer_name, customer_email, shipping_address, status')
    .eq('stripe_payment_intent_id', payment_intent_id)
    .maybeSingle();

  if (!order) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Order not found' }) };
  }

  // Mark paid (idempotent — safe to call multiple times)
  if (order.status !== 'paid') {
    await sb.from('shop_orders').update({ status: 'paid' }).eq('id', order.id);
  }

  // Fetch line items with product vendor info
  const { data: items } = await sb.from('shop_order_items')
    .select('id, product_name, product_sku, quantity, unit_price, variant_name, products(drop_ship, vendor_name, vendor_email)')
    .eq('order_id', order.id);

  // Group drop-ship items by vendor email
  const vendorGroups = {};
  for (const item of (items || [])) {
    const p = item.products;
    if (!p?.drop_ship || !p?.vendor_email) continue;
    if (!vendorGroups[p.vendor_email]) {
      vendorGroups[p.vendor_email] = { vendor_name: p.vendor_name, items: [] };
    }
    vendorGroups[p.vendor_email].items.push(item);
  }

  // Send one email per vendor
  const addr = order.shipping_address || {};
  const addrLines = [
    addr.name,
    addr.address1,
    addr.address2,
    [addr.city, addr.state, addr.zip].filter(Boolean).join(', '),
    addr.phone,
  ].filter(Boolean).join('<br>');

  for (const [vendorEmail, group] of Object.entries(vendorGroups)) {
    const itemRows = group.items.map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">
          ${i.product_name}${i.variant_name ? ` <span style="color:#6b7280;">(${i.variant_name})</span>` : ''}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;">${i.product_sku || '—'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;">${i.quantity}</td>
      </tr>`).join('');

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:600px;margin:0 auto;color:#111827;">
        <div style="background:#0f4c4c;padding:1.5rem 2rem;">
          <h1 style="color:#fff;margin:0;font-size:1.25rem;font-weight:800;">Pacific Coast Ponds</h1>
          <p style="color:rgba(255,255,255,.7);margin:.25rem 0 0;font-size:.875rem;">Drop Ship Request</p>
        </div>
        <div style="padding:2rem;">
          <h2 style="margin:0 0 .5rem;font-size:1.125rem;">Order ${order.order_number}</h2>
          <p style="color:#6b7280;margin:0 0 2rem;font-size:.875rem;">
            Please ship the items below directly to the customer as soon as possible,
            then reply with the tracking number.
          </p>

          <h3 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 .5rem;">Ship To</h3>
          <p style="line-height:1.75;margin:0 0 2rem;">${addrLines}</p>

          <h3 style="font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin:0 0 .5rem;">Items</h3>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="padding:8px 12px;text-align:left;font-size:.8125rem;color:#6b7280;">Product</th>
                <th style="padding:8px 12px;text-align:left;font-size:.8125rem;color:#6b7280;">SKU</th>
                <th style="padding:8px 12px;text-align:center;font-size:.8125rem;color:#6b7280;">Qty</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <p style="margin:2rem 0 0;font-size:.875rem;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:1.5rem;">
            Questions? Contact us at
            <a href="mailto:orders@paccoastponds.com" style="color:#1a7a6e;">orders@paccoastponds.com</a>
          </p>
        </div>
      </div>`;

    await sendEmail({
      from: 'Pacific Coast Ponds <noreply@paccoastponds.com>',
      to: [vendorEmail],
      subject: `Drop Ship Request — ${order.order_number}`,
      html,
    });
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ success: true, order_number: order.order_number }),
  };
};

function stripeGet(path) {
  return new Promise((resolve) => {
    const key = Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64');
    const opts = {
      hostname: 'api.stripe.com',
      path: '/v1' + path,
      method: 'GET',
      headers: { 'Authorization': 'Basic ' + key },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: 'parse error' }); } });
    });
    req.on('error', () => resolve({ error: 'request failed' }));
    req.end();
  });
}

function sendEmail({ from, to, subject, html }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from, to, subject, html });
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: 'parse error' }); } });
    });
    req.on('error', () => resolve({ error: 'request failed' }));
    req.write(body);
    req.end();
  });
}

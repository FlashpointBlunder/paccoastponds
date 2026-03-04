const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { invoice_id } = body;
  if (!invoice_id) return { statusCode: 400, body: JSON.stringify({ error: 'invoice_id required' }) };

  const { data: inv } = await sb.from('service_invoices')
    .select('id, status, total_amount, notes, created_at, payment_token, service_accounts(contact_name, contact_email, address), jobs(scheduled_date, job_types(name))')
    .eq('id', invoice_id).single();

  if (!inv) return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) };

  const { data: items } = await sb.from('service_invoice_line_items')
    .select('description, quantity, unit_price, notes')
    .eq('invoice_id', invoice_id)
    .order('sort_order');

  const customerEmail = inv.service_accounts?.contact_email;
  const customerName  = inv.service_accounts?.contact_name || 'Valued Customer';

  if (!customerEmail) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Customer has no email on file' }) };
  }

  const fmtMoney = n => '$' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const payUrl   = `https://paccoastponds.com/pay-invoice/?token=${inv.payment_token}`;

  const total = (items || []).reduce((s, i) => s + parseFloat(i.quantity) * parseFloat(i.unit_price), 0);
  const invoiceNum = inv.id.slice(0, 8).toUpperCase();
  const jobType  = inv.jobs?.job_types?.name || 'Service';
  const jobDate  = fmtDate(inv.jobs?.scheduled_date || inv.created_at);

  const lineItemRows = (items || []).map(i => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111827;">${i.description}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:center;color:#6b7280;">${parseFloat(i.quantity)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;color:#6b7280;">${fmtMoney(i.unit_price)}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtMoney(parseFloat(i.quantity) * parseFloat(i.unit_price))}</td>
    </tr>`).join('');

  const notesSection = inv.notes ? `
    <div style="background:#f9fafb;border-left:4px solid #1E5E37;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${inv.notes}</p>
    </div>` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice from Pacific Coast Ponds</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

    <!-- Header -->
    <div style="background:#0F1C12;padding:32px;text-align:center;">
      <img src="https://paccoastponds.com/assets/logo.webp" alt="Pacific Coast Ponds"
           style="height:52px;display:block;margin:0 auto 10px;" />
      <p style="margin:0;color:rgba(255,255,255,.5);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Custom Aquatic Design</p>
    </div>

    <!-- Body -->
    <div style="padding:36px 32px;">
      <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111827;">Hi ${customerName},</p>
      <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.7;">
        Please find your invoice below for the recent service completed at your property.
      </p>

      <!-- Invoice Banner -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #1E5E37;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;">Invoice #${invoiceNum}</p>
        <p style="margin:0 0 4px;font-size:20px;font-weight:800;color:#0F1C12;">${jobType}</p>
        <p style="margin:0;font-size:13px;color:#6b7280;">Service date: ${jobDate}</p>
      </div>

      <!-- Line Items Table -->
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Description</th>
            <th style="padding:10px 16px;text-align:center;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;width:50px;">Qty</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;width:90px;">Unit Price</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;width:90px;">Total</th>
          </tr>
        </thead>
        <tbody>${lineItemRows}</tbody>
        <tfoot>
          <tr style="background:#f9fafb;">
            <td colspan="3" style="padding:14px 16px;text-align:right;font-weight:700;font-size:14px;color:#111827;border-top:2px solid #e5e7eb;">Total Due</td>
            <td style="padding:14px 16px;text-align:right;font-weight:800;font-size:20px;color:#1E5E37;border-top:2px solid #e5e7eb;">${fmtMoney(total)}</td>
          </tr>
        </tfoot>
      </table>

      ${notesSection}

      <!-- Pay Now CTA -->
      <div style="text-align:center;padding:8px 0 20px;">
        <a href="${payUrl}"
           style="display:inline-block;background:#1E5E37;color:#ffffff;padding:16px 48px;border-radius:8px;font-weight:800;font-size:16px;text-decoration:none;letter-spacing:.5px;">
          PAY NOW &rarr;
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Secured by Stripe &bull; No account required</p>
      </div>

      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
        Questions? Reply to this email or log in at
        <a href="https://my.paccoastponds.com" style="color:#1E5E37;text-decoration:none;font-weight:600;">my.paccoastponds.com</a>
      </p>
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-weight:600;">Pacific Coast Ponds &bull; Orange County, CA</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Licensed Contractor &bull; 5-Year Warranty</p>
    </div>
  </div>
</body></html>`;

  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set — skipping email');
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: false, reason: 'RESEND_API_KEY not set in Netlify' })
    };
  }

  const sent = await sendEmail({
    from: 'Pacific Coast Ponds <noreply@paccoastponds.com>',
    to: customerEmail,
    subject: `Your invoice from Pacific Coast Ponds — ${jobType}`,
    html
  });

  if (sent) {
    await sb.from('service_invoices').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', invoice_id);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sent })
  };
};

function sendEmail({ from, to, subject, html }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from, to, subject, html });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode < 300));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

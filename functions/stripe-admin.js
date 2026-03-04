// Admin-authenticated Stripe actions
// Actions: create_customer, retry_invoice, void_invoice, send_invoice_email

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify admin
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, account_id, invoice_id } = body;

  // ── Create Stripe Customer ───────────────────────────────────────
  if (action === 'create_customer') {
    if (!account_id) return { statusCode: 400, body: JSON.stringify({ error: 'account_id required' }) };

    const { data: account } = await sb
      .from('service_accounts')
      .select('id, stripe_customer_id, contact_name, contact_email, profiles!customer_id(full_name, email)')
      .eq('id', account_id)
      .single();

    if (!account) return { statusCode: 404, body: JSON.stringify({ error: 'Account not found' }) };
    if (account.stripe_customer_id) return {
      statusCode: 200,
      body: JSON.stringify({ stripe_customer_id: account.stripe_customer_id, existing: true }),
    };

    const name     = account.profiles?.full_name  || account.contact_name  || '';
    const email    = account.profiles?.email       || account.contact_email || '';
    const customer = await stripe.customers.create({ name, email, metadata: { account_id } });

    await sb.from('service_accounts').update({ stripe_customer_id: customer.id }).eq('id', account_id);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stripe_customer_id: customer.id }),
    };
  }

  // ── Retry Failed Invoice ─────────────────────────────────────────
  if (action === 'retry_invoice') {
    if (!invoice_id) return { statusCode: 400, body: JSON.stringify({ error: 'invoice_id required' }) };

    const { data: inv } = await sb.from('monthly_invoices')
      .select('id, stripe_invoice_id, service_account_id')
      .eq('id', invoice_id).single();
    if (!inv?.stripe_invoice_id) return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) };

    try {
      const paid = await stripe.invoices.pay(inv.stripe_invoice_id, { forgive: false });
      if (paid.status === 'paid') {
        await sb.from('monthly_invoices').update({
          status: 'paid', paid_at: new Date().toISOString(),
        }).eq('id', invoice_id);
        return { statusCode: 200, body: JSON.stringify({ paid: true }) };
      }
      return { statusCode: 200, body: JSON.stringify({ paid: false, stripe_status: paid.status }) };
    } catch (e) {
      return { statusCode: 200, body: JSON.stringify({ paid: false, error: e.message }) };
    }
  }

  // ── Void Invoice ─────────────────────────────────────────────────
  if (action === 'void_invoice') {
    if (!invoice_id) return { statusCode: 400, body: JSON.stringify({ error: 'invoice_id required' }) };

    const { data: inv } = await sb.from('monthly_invoices')
      .select('id, stripe_invoice_id')
      .eq('id', invoice_id).single();
    if (!inv) return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) };

    if (inv.stripe_invoice_id) {
      try {
        const stripeInv = await stripe.invoices.retrieve(inv.stripe_invoice_id);
        // Stripe only allows voiding 'open' invoices; paid ones must be credited separately
        if (stripeInv.status === 'open') {
          await stripe.invoices.voidInvoice(inv.stripe_invoice_id);
        }
      } catch(e) { console.warn('Stripe void failed:', e.message); }
    }

    await sb.from('monthly_invoices').update({ status: 'void' }).eq('id', invoice_id);

    return { statusCode: 200, body: JSON.stringify({ voided: true }) };
  }

  // ── Send Invoice Email (failed/open) ─────────────────────────────
  if (action === 'send_invoice_email') {
    if (!invoice_id) return { statusCode: 400, body: JSON.stringify({ error: 'invoice_id required' }) };

    const { data: inv } = await sb.from('monthly_invoices')
      .select('id, stripe_invoice_id, total_amount, period_start, period_end, service_accounts(contact_name, contact_email)')
      .eq('id', invoice_id).single();
    if (!inv) return { statusCode: 404, body: JSON.stringify({ error: 'Invoice not found' }) };

    const customerEmail = inv.service_accounts?.contact_email;
    const customerName  = inv.service_accounts?.contact_name || 'Valued Customer';
    if (!customerEmail) return { statusCode: 400, body: JSON.stringify({ error: 'Customer has no email on file' }) };

    // Get the Stripe hosted invoice URL for the Pay Now button
    let payUrl = 'https://my.paccoastponds.com';
    if (inv.stripe_invoice_id) {
      try {
        const stripeInv = await stripe.invoices.retrieve(inv.stripe_invoice_id);
        if (stripeInv.hosted_invoice_url) payUrl = stripeInv.hosted_invoice_url;
      } catch(e) { console.warn('Could not retrieve Stripe invoice:', e.message); }
    }

    const fmtMoney = n => '$' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const fmtDate  = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
    const period   = `${fmtDate(inv.period_start)} – ${fmtDate(inv.period_end)}`;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice from Pacific Coast Ponds</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#0F1C12;padding:32px;text-align:center;">
      <img src="https://paccoastponds.com/assets/logo.webp" alt="Pacific Coast Ponds" style="height:52px;display:block;margin:0 auto 10px;" />
      <p style="margin:0;color:rgba(255,255,255,.5);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Custom Aquatic Design</p>
    </div>
    <div style="padding:36px 32px;">
      <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111827;">Hi ${customerName},</p>
      <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.7;">
        Your monthly service invoice is ready. Please use the button below to pay securely.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #1E5E37;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;">Monthly Service Invoice</p>
        <p style="margin:0 0 4px;font-size:20px;font-weight:800;color:#0F1C12;">${fmtMoney(inv.total_amount)}</p>
        <p style="margin:0;font-size:13px;color:#6b7280;">Period: ${period}</p>
      </div>
      <div style="text-align:center;padding:8px 0 20px;">
        <a href="${payUrl}" style="display:inline-block;background:#1E5E37;color:#ffffff;padding:16px 48px;border-radius:8px;font-weight:800;font-size:16px;text-decoration:none;letter-spacing:.5px;">
          PAY NOW &rarr;
        </a>
        <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Secured by Stripe</p>
      </div>
      <p style="margin:24px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
        Questions? Log in at <a href="https://my.paccoastponds.com" style="color:#1E5E37;text-decoration:none;font-weight:600;">my.paccoastponds.com</a>
      </p>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 32px;text-align:center;">
      <p style="margin:0;font-size:12px;color:#9ca3af;font-weight:600;">Pacific Coast Ponds &bull; Orange County, CA</p>
    </div>
  </div>
</body></html>`;

    if (!process.env.RESEND_API_KEY) {
      return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'RESEND_API_KEY not set' }) };
    }

    const sent = await sendEmail({
      from: 'Pacific Coast Ponds <noreply@paccoastponds.com>',
      to: customerEmail,
      subject: `Your Pacific Coast Ponds invoice — ${period}`,
      html,
    });

    return { statusCode: 200, body: JSON.stringify({ sent }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};

function sendEmail({ from, to, subject, html }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from, to, subject, html });
    const options = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode < 300)); });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

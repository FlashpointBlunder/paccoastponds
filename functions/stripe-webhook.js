// Stripe webhook handler
// Events: invoice.payment_succeeded, invoice.payment_failed
// Register endpoint in Stripe Dashboard → Developers → Webhooks
// URL: https://paccoastponds.com/.netlify/functions/stripe-webhook

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Verify Stripe signature
  const sig     = event.headers['stripe-signature'];
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, body: `Webhook Error: ${err.message}` };
  }

  const { type, data } = stripeEvent;

  if (type === 'invoice.payment_succeeded') {
    const { id: stripeInvoiceId } = data.object;
    await sb
      .from('monthly_invoices')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('stripe_invoice_id', stripeInvoiceId);
  }

  if (type === 'invoice.payment_failed') {
    const { id: stripeInvoiceId, customer: stripeCustomerId } = data.object;
    await sb
      .from('monthly_invoices')
      .update({ status: 'failed' })
      .eq('stripe_invoice_id', stripeInvoiceId);

    if (process.env.RESEND_API_KEY) {
      const { data: account } = await sb
        .from('service_accounts')
        .select('contact_name, contact_email, profiles!customer_id(full_name, email)')
        .eq('stripe_customer_id', stripeCustomerId)
        .maybeSingle();
      if (account) {
        const email = account.profiles?.email || account.contact_email;
        const name  = account.profiles?.full_name || account.contact_name || 'Valued Customer';
        if (email) await sendFailureEmail(email, name);
      }
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

function sendFailureEmail(email, name) {
  const body = JSON.stringify({
    from:    'Pacific Coast Ponds <billing@paccoastponds.com>',
    to:      email,
    subject: 'Action Required: Your payment could not be processed',
    html: `
      <p>Hi ${name},</p>
      <p>We were unable to process your monthly payment for Pacific Coast Ponds.</p>
      <p>Please <a href="https://my.paccoastponds.com">log in to your account</a> and update your payment method to avoid any interruption to your service.</p>
      <p>— Pacific Coast Ponds</p>`,
  });
  return new Promise(resolve => {
    const req = require('https').request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

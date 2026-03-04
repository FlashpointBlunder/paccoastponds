const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  const headers = { 'Content-Type': 'application/json' };
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { payment_token } = body;
  if (!payment_token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'payment_token required' }) };

  const { data: inv } = await sb.from('service_invoices')
    .select('id, total_amount, status, stripe_payment_intent_id, service_accounts(contact_email)')
    .eq('payment_token', payment_token)
    .single();

  if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invoice not found' }) };
  if (inv.status === 'paid') return { statusCode: 400, headers, body: JSON.stringify({ error: 'already_paid' }) };

  // Reuse existing PaymentIntent if one exists
  if (inv.stripe_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(inv.stripe_payment_intent_id);
    if (pi.status === 'succeeded') {
      await sb.from('service_invoices').update({
        status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).eq('id', inv.id);
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'already_paid' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ client_secret: pi.client_secret }) };
  }

  const amountCents = Math.round(parseFloat(inv.total_amount) * 100);
  const pi = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    description: 'Pacific Coast Ponds — Service Invoice',
    receipt_email: inv.service_accounts?.contact_email || undefined,
    metadata: { invoice_id: inv.id, payment_token },
  });

  await sb.from('service_invoices').update({
    stripe_payment_intent_id: pi.id, updated_at: new Date().toISOString()
  }).eq('id', inv.id);

  return { statusCode: 200, headers, body: JSON.stringify({ client_secret: pi.client_secret }) };
};

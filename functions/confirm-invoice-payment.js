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

  const { payment_intent_id, payment_token } = body;
  if (!payment_intent_id || !payment_token) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'payment_intent_id and payment_token required' }) };
  }

  // Verify with Stripe server-side — never trust the client
  const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
  if (pi.status !== 'succeeded') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment not confirmed' }) };
  }

  await sb.from('service_invoices').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('payment_token', payment_token).eq('stripe_payment_intent_id', payment_intent_id);

  return { statusCode: 200, headers, body: JSON.stringify({ paid: true }) };
};

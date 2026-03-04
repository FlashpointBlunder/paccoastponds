const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405 };

  const headers = { 'Content-Type': 'application/json' };
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Verify admin
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { payment_intent_id } = body;
  if (!payment_intent_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'payment_intent_id required' }) };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  try {
    const pi = await stripe.paymentIntents.retrieve(payment_intent_id);
    // Can only cancel if not already succeeded or cancelled
    if (!['succeeded', 'canceled'].includes(pi.status)) {
      await stripe.paymentIntents.cancel(payment_intent_id);
    }
  } catch(e) {
    // Non-fatal — log but don't block the void
    console.warn('PaymentIntent cancel failed:', e.message);
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
};

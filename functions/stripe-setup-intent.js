// Creates a Stripe SetupIntent for the authenticated customer so they can save a card
// directly in the portal (no redirect). Also returns the current card on file (brand + last4).

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: account } = await sb
    .from('service_accounts')
    .select('stripe_customer_id')
    .eq('customer_id', user.id)
    .single();

  if (!account?.stripe_customer_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No billing account set up. Contact Pacific Coast Ponds.' }) };
  }

  // Fetch current default payment method
  let card = null;
  try {
    const customer = await stripe.customers.retrieve(account.stripe_customer_id, {
      expand: ['invoice_settings.default_payment_method'],
    });
    const pm = customer.invoice_settings?.default_payment_method;
    if (pm?.card) card = { brand: pm.card.brand, last4: pm.card.last4 };
  } catch {}

  const setupIntent = await stripe.setupIntents.create({
    customer: account.stripe_customer_id,
    usage: 'off_session',
    payment_method_types: ['card'],
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientSecret: setupIntent.client_secret, card }),
  };
};

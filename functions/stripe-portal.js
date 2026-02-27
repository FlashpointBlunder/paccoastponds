// Creates a Stripe Customer Portal session for the authenticated customer.
// The portal lets customers add/update/remove their card on file.
// Requires: Customer Portal enabled in Stripe Dashboard (with Payment methods section on).

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

  // Verify authenticated user
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: account } = await sb
    .from('service_accounts')
    .select('stripe_customer_id')
    .eq('customer_id', user.id)
    .single();

  if (!account?.stripe_customer_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No payment account set up yet. Contact Pacific Coast Ponds to get started.' }) };
  }

  const session = await stripe.billingPortal.sessions.create({
    customer:   account.stripe_customer_id,
    return_url: 'https://my.paccoastponds.com',
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: session.url }),
  };
};

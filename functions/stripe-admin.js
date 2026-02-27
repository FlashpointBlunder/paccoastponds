// Admin-authenticated Stripe actions
// Actions: create_customer

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

  // Verify admin
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action, account_id } = body;

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

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};

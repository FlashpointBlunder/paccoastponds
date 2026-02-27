// After the client confirms a SetupIntent, this sets the resulting payment method
// as the default for future invoices on the Stripe customer.

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

  const { payment_method_id } = JSON.parse(event.body || '{}');
  if (!payment_method_id) return { statusCode: 400, body: JSON.stringify({ error: 'Missing payment_method_id' }) };

  const { data: account } = await sb
    .from('service_accounts')
    .select('stripe_customer_id')
    .eq('customer_id', user.id)
    .single();

  if (!account?.stripe_customer_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No billing account.' }) };
  }

  await stripe.customers.update(account.stripe_customer_id, {
    invoice_settings: { default_payment_method: payment_method_id },
  });

  const pm = await stripe.paymentMethods.retrieve(payment_method_id);
  const card = pm.card ? { brand: pm.card.brand, last4: pm.card.last4 } : null;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ card }),
  };
};

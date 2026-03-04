// Sales contract: create draft record + Stripe PaymentIntent for initiation fee
const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers, body: 'Method not allowed' };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Verify JWT and salesperson role
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: profile } = await sb.from('profiles').select('role, full_name').eq('id', user.id).single();
  if (profile?.role !== 'salesperson' && profile?.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden — salesperson role required' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const {
    customer_name, customer_email, customer_phone, customer_address,
    frequency, monthly_price, total_monthly,
    initiation_fee, initiation_fee_waived, initiation_fee_note,
    selected_addons, // [{ addon_id, monthly_price }]
  } = body;

  if (!customer_name || !customer_email || !customer_address || !frequency || !monthly_price) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  // Generate contract number
  const { count } = await sb.from('contracts').select('*', { count: 'exact', head: true });
  const seq = (count ?? 0) + 1;
  const contract_number = 'CON-' + String(seq).padStart(5, '0');

  // Insert draft contract
  const { data: contract, error: contractErr } = await sb.from('contracts').insert({
    contract_number,
    salesperson_id:       user.id,
    customer_name,
    customer_email,
    customer_phone:       customer_phone || null,
    customer_address,
    frequency,
    monthly_price:        parseFloat(monthly_price),
    total_monthly:        parseFloat(total_monthly || monthly_price),
    initiation_fee:       parseFloat(initiation_fee),
    initiation_fee_waived: !!initiation_fee_waived,
    initiation_fee_note:  initiation_fee_note || null,
    status:               'draft',
  }).select().single();

  if (contractErr || !contract) {
    console.error('Contract insert error:', contractErr);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create contract' }) };
  }

  // Insert selected add-ons
  if (selected_addons?.length) {
    await sb.from('contract_selected_addons').insert(
      selected_addons.map(a => ({
        contract_id:   contract.id,
        addon_id:      a.addon_id,
        monthly_price: parseFloat(a.monthly_price),
      }))
    );
  }

  let client_secret = null;

  // Create Stripe PaymentIntent if initiation fee is not waived
  if (!initiation_fee_waived && parseFloat(initiation_fee) > 0) {
    const amountCents = Math.round(parseFloat(initiation_fee) * 100);
    const pi = await stripeRequest('POST', '/payment_intents', {
      amount:        amountCents,
      currency:      'usd',
      metadata:      { contract_id: contract.id, contract_number },
      receipt_email: customer_email,
      description:   `Pacific Coast Ponds — Service Agreement Initiation Fee (${contract_number})`,
    });

    if (pi.error) {
      await sb.from('contracts').delete().eq('id', contract.id);
      return { statusCode: 500, headers, body: JSON.stringify({ error: pi.error.message }) };
    }

    await sb.from('contracts').update({ stripe_payment_intent_id: pi.id }).eq('id', contract.id);
    client_secret = pi.client_secret;
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      contract_id:     contract.id,
      contract_number,
      client_secret,
    }),
  };
};

function stripeRequest(method, path, params) {
  return new Promise((resolve) => {
    const body = Object.entries(params)
      .flatMap(([k, v]) => typeof v === 'object'
        ? Object.entries(v).map(([k2, v2]) => `${encodeURIComponent(k)}[${encodeURIComponent(k2)}]=${encodeURIComponent(v2)}`)
        : [`${encodeURIComponent(k)}=${encodeURIComponent(v)}`]
      ).join('&');
    const key  = Buffer.from(process.env.STRIPE_SECRET_KEY + ':').toString('base64');
    const opts = {
      hostname: 'api.stripe.com',
      path:     '/v1' + path,
      method,
      headers: {
        'Authorization':  'Basic ' + key,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: { message: 'Stripe parse error' } }); } });
    });
    req.on('error', () => resolve({ error: { message: 'Stripe request failed' } }));
    req.write(body);
    req.end();
  });
}

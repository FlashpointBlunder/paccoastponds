const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: caller } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (caller?.role !== 'admin') return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { service_account_id, user_id } = body;

  // Delete service account — cascades to visits, messages, basket_items, invoices
  const { error: delErr } = await sb.from('service_accounts').delete().eq('id', service_account_id);
  if (delErr) return { statusCode: 400, body: JSON.stringify({ error: delErr.message }) };

  // Delete auth user if they have one
  if (user_id) {
    await sb.auth.admin.deleteUser(user_id);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true })
  };
};

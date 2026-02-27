const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfigured' }) };
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Verify caller is an admin
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: caller } = await sb.from('profiles').select('role').eq('id', user.id).single();
  if (caller?.role !== 'admin') return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };

  // Parse body
  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email, full_name, phone, role, service_account_id } = body;

  if (!email || !['customer', 'tech'].includes(role)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email and role are required' }) };
  }

  // Send Supabase invite email — redirect to the correct portal based on role
  const redirectTo = role === 'tech' ? 'https://tech.paccoastponds.com' : 'https://my.paccoastponds.com';
  const { data: invited, error: inviteErr } = await sb.auth.admin.inviteUserByEmail(email, {
    data: { role, full_name: full_name || email },
    redirectTo,
  });

  if (inviteErr) {
    return { statusCode: 400, body: JSON.stringify({ error: inviteErr.message }) };
  }

  const userId = invited.user.id;

  // Update profile with phone if provided
  if (phone) {
    await sb.from('profiles').update({ phone }).eq('id', userId);
  }

  // Customer: link to service account + record invite timestamp
  if (role === 'customer' && service_account_id) {
    await sb.from('service_accounts').update({
      customer_id:     userId,
      invite_sent_at:  new Date().toISOString()
    }).eq('id', service_account_id);
  }

  // Tech: create technicians record
  if (role === 'tech') {
    await sb.from('technicians').insert({ user_id: userId });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, user_id: userId })
  };
};

// Sends an SMS via Twilio. Called by the tech app when marking a job "on the way".
// Only authenticated techs can trigger this endpoint.

const twilio = require('twilio');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const { data: tech } = await sb.from('technicians').select('id').eq('user_id', user.id).single();
  if (!tech) return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden — techs only' }) };

  const { to, message } = JSON.parse(event.body || '{}');
  if (!to || !message) return { statusCode: 400, body: JSON.stringify({ error: 'Missing to or message' }) };

  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({ body: message, from: process.env.TWILIO_PHONE_NUMBER, to });
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

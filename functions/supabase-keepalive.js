// Scheduled (daily, see netlify.toml) — free-tier Supabase pauses after ~7 days without activity,
// which takes down every form and the whole backend. A tiny read once a day keeps it awake.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const { error } = await sb.from('service_requests').select('id').limit(1);
  if (error) {
    console.error('supabase keepalive failed:', error.message);
    return { statusCode: 500, body: error.message };
  }
  return { statusCode: 200, body: 'ok' };
};

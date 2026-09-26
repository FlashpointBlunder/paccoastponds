// Public endpoint — no auth required.
// Accepts service requests from the public website and saves them to service_requests.

const { createClient } = require('@supabase/supabase-js');

// Orange County, CA zip code ranges
function isOrangeCountyZip(zip) {
  const z = parseInt(zip, 10);
  if (isNaN(z)) return false;
  return (z >= 90620 && z <= 90631) || (z >= 92602 && z <= 92899);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { type, full_name, email, phone, address, city, zip, message, service_frequency, project_type } = body;

  if (!type || !full_name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type and full_name are required' }) };
  }

  if (!['routine_maintenance', 'one_time_cleaning', 'install', 'other'].includes(type)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request type' }) };
  }

  // Maintenance and cleaning are OC-only
  if (['routine_maintenance', 'one_time_cleaning'].includes(type)) {
    if (!zip || !isOrangeCountyZip(zip)) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: 'This service is currently only available in Orange County, CA. Please call us to discuss options in your area.' }),
      };
    }
  }

  const { data: inserted, error } = await sb.from('service_requests').insert({
    type,
    full_name,
    email:             email    || null,
    phone:             phone    || null,
    address:           address  || null,
    city:              city     || null,
    zip:               zip      || null,
    message:           message  || null,
    service_frequency: service_frequency || null,
    project_type:      project_type      || null,
  }).select('id').single();

  if (error) {
    console.error('service_requests insert error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }

  try {
    await sendLeadEmail({ type, full_name, email, phone, address, city, zip, message, service_frequency, project_type, id: inserted && inserted.id });
  } catch (e) {
    console.error('lead email failed:', e);
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};

const TYPE_LABEL = { routine_maintenance: 'Routine Maintenance', one_time_cleaning: 'One-Time Cleaning', install: 'Install / Build', other: 'Other' };

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function sendLeadEmail(r) {
  const to = process.env.LEAD_EMAIL || process.env.ADMIN_EMAIL;
  if (!process.env.RESEND_API_KEY || !to) {
    console.log('RESEND_API_KEY or ADMIN_EMAIL not set — skipping lead email');
    return;
  }
  const label = r.project_type || TYPE_LABEL[r.type] || r.type;
  const rows = [
    ['Name', r.full_name],
    ['Phone', r.phone && `<a href="tel:${esc(r.phone)}">${esc(r.phone)}</a>`],
    ['Email', r.email && `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>`],
    ['ZIP', r.zip],
    ['Address', [r.address, r.city].filter(Boolean).join(', ')],
    ['Request', TYPE_LABEL[r.type]],
    ['Frequency', r.service_frequency],
    ['Project Type', r.project_type],
    ['Description', r.message],
  ].filter(([, v]) => v)
   .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#666;vertical-align:top;white-space:nowrap">${k}</td><td style="padding:6px 0">${k === 'Phone' || k === 'Email' ? v : esc(v).replace(/\n/g, '<br>')}</td></tr>`)
   .join('');

  const html = `<div style="font-family:Arial,sans-serif;max-width:560px">
    <h2 style="color:#1E5E37;margin:0 0 12px">New Lead — ${esc(label)}</h2>
    <table style="border-collapse:collapse;font-size:15px">${rows}</table>
    <p style="margin-top:20px"><a href="https://admin.paccoastponds.com" style="background:#1E5E37;color:#fff;padding:10px 18px;text-decoration:none;font-weight:bold">Open in Admin → Requests</a></p>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Pacific Coast Ponds <noreply@paccoastponds.com>',
      to,
      reply_to: r.email || undefined,
      subject: `New Lead: ${r.full_name}${r.zip ? ' (' + r.zip + ')' : ''} — ${label}`,
      html,
    }),
  });
  if (!res.ok) console.error('Resend error:', res.status, await res.text());
}

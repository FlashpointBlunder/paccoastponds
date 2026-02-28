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

  const { error } = await sb.from('service_requests').insert({
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
  });

  if (error) {
    console.error('service_requests insert error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
};

const { createClient } = require('@supabase/supabase-js');
const https = require('https');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const token = (event.headers.authorization || '').replace('Bearer ', '');
  const { data: { user }, error: authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { job_id } = body;
  if (!job_id) return { statusCode: 400, body: JSON.stringify({ error: 'job_id required' }) };

  const [{ data: job }, { data: wr }] = await Promise.all([
    sb.from('jobs')
      .select('id, scheduled_date, address, service_accounts(contact_name, contact_email), job_types(name)')
      .eq('id', job_id).single(),
    sb.from('water_readings').select('*').eq('job_id', job_id).maybeSingle(),
  ]);

  if (!job) return { statusCode: 404, body: JSON.stringify({ error: 'Job not found' }) };

  const customerEmail = job.service_accounts?.contact_email;
  const customerName  = job.service_accounts?.contact_name || 'Valued Customer';
  if (!customerEmail) return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'No customer email' }) };

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';
  const fmtVal  = (v, unit) => (v != null && v !== '') ? `${parseFloat(v)}${unit ? ' ' + unit : ''}` : '—';
  const jobType = job.job_types?.name || 'Routine Service';
  const serviceDate = fmtDate(job.scheduled_date);
  const address = job.address || job.service_accounts?.address || '';

  // Water parameters table (only if any value was recorded)
  const hasParams = wr && [wr.ph, wr.kh, wr.nitrite, wr.ammonia, wr.salt].some(v => v != null);
  const paramsSection = hasParams ? `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#111827;text-transform:uppercase;letter-spacing:.6px;">Water Parameters</p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="padding:10px 16px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Parameter</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Reading</th>
            <th style="padding:10px 16px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Ideal Range</th>
          </tr>
        </thead>
        <tbody>
          ${wr.ph != null ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#374151;">pH</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtVal(wr.ph,'')}</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;color:#9ca3af;">7.0 – 8.5</td></tr>` : ''}
          ${wr.kh != null ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#374151;">KH</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtVal(wr.kh,'ppm')}</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;color:#9ca3af;">100 – 200 ppm</td></tr>` : ''}
          ${wr.nitrite != null ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#374151;">Nitrite</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtVal(wr.nitrite,'ppm')}</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;color:#9ca3af;">0 ppm</td></tr>` : ''}
          ${wr.ammonia != null ? `<tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#374151;">Ammonia</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtVal(wr.ammonia,'ppm')}</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;text-align:right;color:#9ca3af;">0 ppm</td></tr>` : ''}
          ${wr.salt != null ? `<tr><td style="padding:10px 16px;font-size:14px;color:#374151;">Salt</td><td style="padding:10px 16px;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtVal(wr.salt,'%')}</td><td style="padding:10px 16px;font-size:13px;text-align:right;color:#9ca3af;">0.10 – 0.30%</td></tr>` : ''}
        </tbody>
      </table>
    </div>` : '';

  const notesSection = wr?.notes ? `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #1E5E37;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;">Technician Notes</p>
      <p style="margin:0;font-size:14px;color:#374151;line-height:1.6;">${wr.notes}</p>
    </div>` : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visit Summary — Pacific Coast Ponds</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">

    <div style="background:#0F1C12;padding:32px;text-align:center;">
      <img src="https://paccoastponds.com/assets/logo.webp" alt="Pacific Coast Ponds"
           style="height:52px;display:block;margin:0 auto 10px;" />
      <p style="margin:0;color:rgba(255,255,255,.5);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Custom Aquatic Design</p>
    </div>

    <div style="padding:36px 32px;">
      <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111827;">Hi ${customerName},</p>
      <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.7;">
        Your pond service is complete. Here's a summary of today's visit.
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #1E5E37;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:28px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;">Service Visit</p>
        <p style="margin:0 0 4px;font-size:18px;font-weight:800;color:#0F1C12;">${jobType}</p>
        <p style="margin:0;font-size:13px;color:#6b7280;">${serviceDate}${address ? ' &bull; ' + address : ''}</p>
      </div>

      ${paramsSection}
      ${notesSection}

      <div style="text-align:center;padding:8px 0 20px;">
        <a href="https://my.paccoastponds.com"
           style="display:inline-block;background:#1E5E37;color:#ffffff;padding:14px 36px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;letter-spacing:.3px;">
          View Your Portal &rarr;
        </a>
      </div>

      <p style="margin:16px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;text-align:center;">
        Questions? Reply to this email or log in at
        <a href="https://my.paccoastponds.com" style="color:#1E5E37;text-decoration:none;font-weight:600;">my.paccoastponds.com</a>
      </p>
    </div>

    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-weight:600;">Pacific Coast Ponds &bull; Orange County, CA</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Licensed Contractor &bull; 5-Year Warranty</p>
    </div>
  </div>
</body></html>`;

  if (!process.env.RESEND_API_KEY) {
    return { statusCode: 200, body: JSON.stringify({ sent: false, reason: 'RESEND_API_KEY not set' }) };
  }

  const sent = await sendEmail({
    from: 'Pacific Coast Ponds <noreply@paccoastponds.com>',
    to: customerEmail,
    subject: `Your pond service is complete — ${serviceDate}`,
    html,
  });

  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent }) };
};

function sendEmail({ from, to, subject, html }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from, to, subject, html });
    const options = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode < 300)); });
    req.on('error', () => resolve(false));
    req.write(body); req.end();
  });
}

const { createClient } = require('@supabase/supabase-js');
const https = require('https');

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

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { ticket_id } = body;
  if (!ticket_id) return { statusCode: 400, body: JSON.stringify({ error: 'ticket_id required' }) };

  const { data: ticket } = await sb.from('tickets')
    .select('category, subject, service_accounts(contact_name, profiles(full_name))')
    .eq('id', ticket_id).single();

  if (!ticket) return { statusCode: 404, body: JSON.stringify({ error: 'Ticket not found' }) };

  const senderName = ticket.service_accounts?.contact_name
    || ticket.service_accounts?.profiles?.full_name
    || 'A customer';

  const catLabel = {
    upcoming_visit: 'Upcoming Visit',
    product_inquiry: 'Product Inquiry',
    billing_issue: 'Billing Issue',
    ask_tech: 'Ask Tech',
    pond_emergency: '🚨 Pond Emergency'
  };

  const isUrgent = ticket.category === 'pond_emergency';
  const emailSubject = `${isUrgent ? '🚨 URGENT — ' : ''}New ticket: ${ticket.subject}`;
  const html = `
    <p>You have a new support ticket from <strong>${senderName}</strong>.</p>
    <p><strong>Category:</strong> ${catLabel[ticket.category] || ticket.category}</p>
    <p><strong>Subject:</strong> ${ticket.subject}</p>
    <br>
    <p><a href="https://admin.paccoastponds.com" style="background:#1E5E37;color:#fff;padding:10px 20px;text-decoration:none;border-radius:6px;font-weight:bold;">View in Admin Portal →</a></p>
  `;

  if (!process.env.RESEND_API_KEY || !process.env.ADMIN_EMAIL) {
    console.log('RESEND_API_KEY or ADMIN_EMAIL not set — skipping email');
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent: false, reason: 'env vars not set' }) };
  }

  const sent = await sendEmail({
    from: 'Pacific Coast Ponds <noreply@paccoastponds.com>',
    to: process.env.ADMIN_EMAIL,
    subject: emailSubject,
    html
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sent })
  };
};

function sendEmail({ from, to, subject, html }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from, to, subject, html });
    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode < 300));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// Sales contract complete: finalize signed contract, provision customer, send invite + email
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
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { contract_id, signature_data_url, payment_intent_id } = body;
  if (!contract_id || !signature_data_url) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'contract_id and signature_data_url required' }) };
  }

  // Load contract
  const { data: contract, error: loadErr } = await sb.from('contracts')
    .select('*, contract_selected_addons(addon_id, monthly_price, contract_addons(name))')
    .eq('id', contract_id).single();

  if (loadErr || !contract) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Contract not found' }) };
  }

  if (contract.status === 'active') {
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, contract_number: contract.contract_number, already_complete: true }) };
  }

  // Verify Stripe payment if required
  let initiation_paid = contract.initiation_fee_waived;
  if (!contract.initiation_fee_waived && parseFloat(contract.initiation_fee) > 0) {
    if (!payment_intent_id) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'payment_intent_id required' }) };
    }
    const pi = await stripeRequest('GET', `/payment_intents/${payment_intent_id}`, {});
    if (pi.status !== 'succeeded') {
      return { statusCode: 402, headers, body: JSON.stringify({ error: 'Payment not confirmed' }) };
    }
    initiation_paid = true;
  }

  // Mark contract as active/signed
  await sb.from('contracts').update({
    signature_data_url,
    signed_at:                new Date().toISOString(),
    initiation_paid,
    initiation_paid_at:       initiation_paid ? new Date().toISOString() : null,
    stripe_payment_intent_id: payment_intent_id || contract.stripe_payment_intent_id || null,
    status:                   'active',
  }).eq('id', contract_id);

  // Create service_account
  const { data: account, error: acctErr } = await sb.from('service_accounts').insert({
    contact_name:        contract.customer_name,
    contact_email:       contract.customer_email,
    contact_phone:       contract.customer_phone || null,
    address:             contract.customer_address,
    monthly_service_fee: parseFloat(contract.total_monthly),
    is_subscription:     true,
  }).select().single();

  if (acctErr || !account) {
    console.error('service_account insert error:', acctErr);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create customer account' }) };
  }

  // Link service_account to contract
  await sb.from('contracts').update({ service_account_id: account.id }).eq('id', contract_id);

  // Invite customer to portal
  try {
    await sb.auth.admin.inviteUserByEmail(contract.customer_email, {
      redirectTo: 'https://my.paccoastponds.com',
      data: { role: 'customer', full_name: contract.customer_name },
    });
  } catch (inviteErr) {
    console.error('Invite error (non-fatal):', inviteErr);
  }

  // Build frequency label
  const freqLabel = { weekly: 'Weekly', biweekly: 'Bi-Weekly', monthly: 'Monthly' }[contract.frequency] || contract.frequency;

  // Create accepted proposal for admin to schedule
  const { data: proposal } = await sb.from('proposals').insert({
    service_account_id: account.id,
    title:              `${freqLabel} Pond Service Contract`,
    status:             'accepted',
    proposal_type:      'service',
    notes:              `Contract ${contract.contract_number} signed ${new Date().toLocaleDateString('en-US')}. Monthly rate: $${parseFloat(contract.total_monthly).toFixed(2)}.`,
  }).select().single();

  if (proposal) {
    // Base service line item
    const lineItems = [{
      proposal_id:  proposal.id,
      description:  `${freqLabel} Pond Service`,
      quantity:     1,
      unit_price:   parseFloat(contract.monthly_price),
      sort_order:   0,
    }];

    // Add-on line items
    const addons = contract.contract_selected_addons || [];
    addons.forEach((a, i) => {
      lineItems.push({
        proposal_id:  proposal.id,
        description:  a.contract_addons?.name || 'Add-on',
        quantity:     1,
        unit_price:   parseFloat(a.monthly_price),
        sort_order:   i + 1,
      });
    });

    await sb.from('proposal_line_items').insert(lineItems);
  }

  // Send contract summary email
  const addons = contract.contract_selected_addons || [];
  const fmtMoney = n => '$' + parseFloat(n || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  const addonRows = addons.map(a => `
    <tr>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111827;">${a.contract_addons?.name || 'Add-on'}</td>
      <td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;text-align:right;font-weight:600;color:#111827;">${fmtMoney(a.monthly_price)}/mo</td>
    </tr>`).join('');

  const sigSection = `
    <div style="margin-bottom:28px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#9ca3af;">Customer Signature</p>
      <div style="border:1px solid #e5e7eb;border-radius:8px;background:#f9fafb;padding:8px;display:inline-block;">
        <img src="${signature_data_url}" alt="Signature" style="height:60px;display:block;" />
      </div>
      <p style="margin:6px 0 0;font-size:12px;color:#9ca3af;">Signed on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
    </div>`;

  const htmlEmail = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Pacific Coast Ponds Service Agreement</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">
    <div style="background:#0F1C12;padding:32px;text-align:center;">
      <img src="https://paccoastponds.com/assets/logo.webp" alt="Pacific Coast Ponds" style="height:52px;display:block;margin:0 auto 10px;" />
      <p style="margin:0;color:rgba(255,255,255,.5);font-size:12px;letter-spacing:1px;text-transform:uppercase;">Service Agreement</p>
    </div>
    <div style="padding:36px 32px;">
      <p style="margin:0 0 6px;font-size:16px;font-weight:600;color:#111827;">Welcome aboard, ${contract.customer_name}!</p>
      <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.7;">
        Your Pacific Coast Ponds service agreement has been signed and is now active. Here's a summary of your plan.
      </p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-left:4px solid #1E5E37;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;">Contract Number</p>
        <p style="margin:0;font-size:22px;font-weight:800;color:#0F1C12;">${contract.contract_number}</p>
      </div>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:24px;">
        <tbody>
          <tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#6b7280;">Service Address</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#111827;">${contract.customer_address}</td></tr>
          <tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#6b7280;">Service Frequency</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#111827;">${freqLabel}</td></tr>
          <tr><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;color:#6b7280;">Base Monthly Rate</td><td style="padding:10px 16px;border-bottom:1px solid #f0f0f0;font-size:14px;font-weight:600;color:#111827;">${fmtMoney(contract.monthly_price)}/mo</td></tr>
          ${addonRows}
          <tr style="background:#f0fdf4;"><td style="padding:14px 16px;font-size:14px;font-weight:700;color:#0F1C12;border-top:2px solid #bbf7d0;">Total Monthly</td><td style="padding:14px 16px;font-size:20px;font-weight:800;color:#1E5E37;border-top:2px solid #bbf7d0;">${fmtMoney(contract.total_monthly)}/mo</td></tr>
        </tbody>
      </table>

      <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
        <tbody>
          <tr><td style="padding:12px 16px;font-size:14px;color:#6b7280;">Initiation Fee</td><td style="padding:12px 16px;font-size:14px;font-weight:600;text-align:right;color:#111827;">${contract.initiation_fee_waived ? 'Waived' : fmtMoney(contract.initiation_fee) + ' (paid)'}</td></tr>
        </tbody>
      </table>

      ${sigSection}

      <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#111827;">What happens next?</p>
        <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.7;">You'll receive a separate email to set up your customer portal account at <strong>my.paccoastponds.com</strong>, where you can view your scheduled visits, request products, and send messages to our team.</p>
      </div>
    </div>
    <div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:22px 32px;text-align:center;">
      <p style="margin:0 0 4px;font-size:12px;color:#9ca3af;font-weight:600;">Pacific Coast Ponds &bull; Orange County, CA</p>
      <p style="margin:0;font-size:12px;color:#9ca3af;">Questions? Call us or log in at <a href="https://my.paccoastponds.com" style="color:#1E5E37;text-decoration:none;font-weight:600;">my.paccoastponds.com</a></p>
    </div>
  </div>
</body></html>`;

  if (process.env.RESEND_API_KEY) {
    await sendEmail({
      from:    'Pacific Coast Ponds <noreply@paccoastponds.com>',
      to:      contract.customer_email,
      subject: `Your Pacific Coast Ponds Service Agreement — ${contract.contract_number}`,
      html:    htmlEmail,
    });
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      success:            true,
      contract_number:    contract.contract_number,
      service_account_id: account.id,
    }),
  };
};

function stripeRequest(method, path, params) {
  return new Promise((resolve) => {
    const body = method === 'GET' ? '' : Object.entries(params)
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
        'Authorization': 'Basic ' + key,
        ...(method !== 'GET' ? {
          'Content-Type':   'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: { message: 'Stripe parse error' } }); } });
    });
    req.on('error', () => resolve({ error: { message: 'Stripe request failed' } }));
    if (method !== 'GET') req.write(body);
    req.end();
  });
}

function sendEmail({ from, to, subject, html }) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ from, to, subject, html });
    const opts = {
      hostname: 'api.resend.com',
      path:     '/emails',
      method:   'POST',
      headers: {
        'Authorization':  `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode < 300));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

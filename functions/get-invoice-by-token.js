const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  const token = event.queryStringParameters?.token;
  if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'token required' }) };

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  const { data: inv } = await sb.from('service_invoices')
    .select('id, status, total_amount, created_at, service_accounts(contact_name, address), jobs(scheduled_date, job_types(name))')
    .eq('payment_token', token)
    .single();

  if (!inv) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Invoice not found' }) };

  const { data: items } = await sb.from('service_invoice_line_items')
    .select('description, quantity, unit_price')
    .eq('invoice_id', inv.id)
    .order('sort_order');

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ invoice: inv, items: items || [] })
  };
};

// Netlify Scheduled Function — runs 1st of every month at 8:00 AM UTC
// Generates and charges monthly invoices for all active subscription accounts.

const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
  const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Prior-month period
  const now = new Date();
  const y   = now.getFullYear();
  const m   = now.getMonth(); // 0-indexed current month
  const periodStart    = new Date(y, m - 1, 1);
  const periodEnd      = new Date(y, m, 0);              // last day of prior month
  const periodStartStr = periodStart.toISOString().split('T')[0];
  const periodEndStr   = periodEnd.toISOString().split('T')[0];
  const periodLabel    = periodStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const { data: accounts, error } = await sb
    .from('service_accounts')
    .select('id, stripe_customer_id, monthly_service_fee, contact_name, contact_email, profiles!customer_id(full_name, email)')
    .eq('active', true)
    .eq('is_subscription', true)
    .not('stripe_customer_id', 'is', null);

  if (error) {
    console.error('Error fetching accounts:', error);
    return { statusCode: 500, body: error.message };
  }

  const results = [];
  for (const account of (accounts || [])) {
    try {
      const result = await billAccount(stripe, sb, account, periodStartStr, periodEndStr, periodLabel);
      results.push({ account_id: account.id, ...result });
    } catch (err) {
      console.error(`Error billing account ${account.id}:`, err.message);
      results.push({ account_id: account.id, error: err.message });
    }
  }

  console.log('Monthly billing complete:', JSON.stringify(results));
  return { statusCode: 200, body: JSON.stringify({ results }) };
};

async function billAccount(stripe, sb, account, periodStart, periodEnd, periodLabel) {
  // Idempotency: skip if invoice already exists for this period
  const { data: existing } = await sb
    .from('monthly_invoices')
    .select('id')
    .eq('service_account_id', account.id)
    .eq('period_start', periodStart)
    .maybeSingle();
  if (existing) return { skipped: true, reason: 'Invoice already exists for this period' };

  // Unbilled basket items
  const { data: basket } = await sb
    .from('basket_items')
    .select('id, product_id, quantity, products(name, price)')
    .eq('service_account_id', account.id)
    .eq('billed', false);

  // Create Stripe invoice draft
  const stripeInvoice = await stripe.invoices.create({
    customer:          account.stripe_customer_id,
    collection_method: 'charge_automatically',
    auto_advance:      false,
    description:       `Pacific Coast Ponds — ${periodLabel}`,
  });

  let totalAmount = 0;
  const lineItemsForDb = [];

  // Service fee
  if (Number(account.monthly_service_fee) > 0) {
    await stripe.invoiceItems.create({
      customer:    account.stripe_customer_id,
      invoice:     stripeInvoice.id,
      amount:      Math.round(account.monthly_service_fee * 100),
      currency:    'usd',
      description: `Monthly Pond Service — ${periodLabel}`,
    });
    totalAmount += Number(account.monthly_service_fee);
    lineItemsForDb.push({ description: `Monthly Pond Service — ${periodLabel}`, amount: Number(account.monthly_service_fee), type: 'service' });
  }

  // Product line items
  for (const item of (basket || [])) {
    if (!item.products) continue;
    const lineAmount = Number(item.products.price) * item.quantity;
    await stripe.invoiceItems.create({
      customer:    account.stripe_customer_id,
      invoice:     stripeInvoice.id,
      amount:      Math.round(lineAmount * 100),
      currency:    'usd',
      description: `${item.products.name} × ${item.quantity}`,
    });
    totalAmount += lineAmount;
    lineItemsForDb.push({ description: `${item.products.name} × ${item.quantity}`, amount: lineAmount, type: 'product', product_id: item.product_id, quantity: item.quantity });
  }

  // Finalize, then charge immediately
  await stripe.invoices.finalizeInvoice(stripeInvoice.id);

  let finalStatus = 'pending_charge';
  let paidAt = null;
  try {
    const paid = await stripe.invoices.pay(stripeInvoice.id);
    if (paid.status === 'paid') { finalStatus = 'paid'; paidAt = new Date().toISOString(); }
  } catch {
    finalStatus = 'failed';
    await notifyCustomerFailure(account, periodLabel);
  }

  // Save invoice record
  const { data: inv } = await sb.from('monthly_invoices').insert({
    service_account_id: account.id,
    period_start:       periodStart,
    period_end:         periodEnd,
    status:             finalStatus,
    total_amount:       totalAmount,
    stripe_invoice_id:  stripeInvoice.id,
    sent_at:            new Date().toISOString(),
    paid_at:            paidAt,
  }).select().single();

  if (inv && lineItemsForDb.length) {
    await sb.from('invoice_line_items').insert(lineItemsForDb.map(li => ({ invoice_id: inv.id, ...li })));
  }

  if (basket?.length) {
    await sb.from('basket_items').update({ billed: true }).in('id', basket.map(b => b.id));
  }

  return { success: true, stripe_invoice_id: stripeInvoice.id, total: totalAmount, status: finalStatus };
}

async function notifyCustomerFailure(account, periodLabel) {
  if (!process.env.RESEND_API_KEY) return;
  const email = account.profiles?.email || account.contact_email;
  if (!email) return;
  const name  = account.profiles?.full_name || account.contact_name || 'Valued Customer';
  const body  = JSON.stringify({
    from:    'Pacific Coast Ponds <billing@paccoastponds.com>',
    to:      email,
    subject: `Action Required: Payment failed for ${periodLabel}`,
    html: `
      <p>Hi ${name},</p>
      <p>We were unable to process your payment for <strong>${periodLabel}</strong>.</p>
      <p>Please <a href="https://my.paccoastponds.com">log in to your account</a> and update your payment method to avoid any interruption in service.</p>
      <p>— Pacific Coast Ponds</p>`,
  });
  await new Promise(resolve => {
    const req = require('https').request({
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, res => { res.resume(); res.on('end', resolve); });
    req.on('error', resolve);
    req.write(body); req.end();
  });
}

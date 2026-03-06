// Shop checkout: verify subscriber discount, create Stripe PaymentIntent, save order
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

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { items, shipping_address, shipping_rate, customer_email, customer_name, auth_token } = body;
  if (!items?.length || !shipping_address || !customer_email || !customer_name) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
  }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  // Check if user is a subscriber (for Subscribe & Save discount)
  let isSubscriber = false;
  let customerId = null;
  if (auth_token) {
    const { data: { user } } = await sb.auth.getUser(auth_token);
    if (user) {
      customerId = user.id;
      const { data: sub } = await sb.from('shop_subscribers').select('id').eq('user_id', user.id).single();
      isSubscriber = !!sub;
    }
  }

  // Fetch product data to verify prices
  const productIds = items.map(i => i.product_id).filter(Boolean);
  const { data: products } = await sb.from('products')
    .select('id, name, sku, price, subscribe_save_eligible, is_freight')
    .in('id', productIds);
  const productMap = Object.fromEntries((products || []).map(p => [p.id, p]));

  // Fetch variant data for price verification
  const variantIds = items.map(i => i.variant_id).filter(Boolean);
  let variantMap = {};
  if (variantIds.length) {
    const { data: variants } = await sb.from('product_variants')
      .select('id, sku, price').in('id', variantIds);
    variantMap = Object.fromEntries((variants || []).map(v => [v.id, v]));
  }

  // Calculate totals
  let subtotal = 0;
  let discountAmount = 0;
  const lineItems = items.map(item => {
    const product   = productMap[item.product_id];
    const variant   = item.variant_id ? variantMap[item.variant_id] : null;
    const unitPrice = variant ? parseFloat(variant.price)
                    : product ? parseFloat(product.price)
                    : parseFloat(item.unit_price);
    const eligible  = isSubscriber && product?.subscribe_save_eligible;
    const finalPrice = eligible ? +(unitPrice * 0.95).toFixed(2) : unitPrice;
    subtotal        += unitPrice * item.quantity;
    if (eligible) discountAmount += (unitPrice - finalPrice) * item.quantity;
    return {
      product_id:             item.product_id,
      product_name:           product?.name || item.product_name,
      product_sku:            variant?.sku || product?.sku || item.sku || null,
      quantity:               item.quantity,
      unit_price:             finalPrice,
      subscribe_save_applied: eligible,
      variant_id:             item.variant_id   || null,
      variant_name:           item.variant_name || null,
    };
  });

  // Server-side free shipping / freight validation
  const hasFreight = items.some(i => {
    const prod = productMap[i.product_id];
    return prod?.is_freight;
  });
  const freeShip = !hasFreight && subtotal >= 99;
  const shippingCost = (hasFreight || freeShip) ? 0 : parseFloat(shipping_rate?.rate || 0);
  const total = +(subtotal - discountAmount + shippingCost).toFixed(2);
  const totalCents = Math.round(total * 100);

  // Generate order number
  const { data: orderCount } = await sb.from('shop_orders').select('id', { count: 'exact', head: true });
  const seq = (orderCount ?? 0) + 1;
  const orderNumber = 'PCP-' + String(seq).padStart(5, '0');

  // Save order (pending)
  const { data: order, error: orderErr } = await sb.from('shop_orders').insert({
    order_number:    orderNumber,
    customer_id:     customerId,
    customer_email:  customer_email,
    customer_name:   customer_name,
    shipping_address: shipping_address,
    subtotal:        +subtotal.toFixed(2),
    shipping_cost:   shippingCost,
    discount_amount: +discountAmount.toFixed(2),
    total,
    status:          'pending',
  }).select().single();

  if (orderErr || !order) {
    console.error('Order insert error:', orderErr);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Failed to create order' }) };
  }

  // Save line items
  await sb.from('shop_order_items').insert(lineItems.map(li => ({ ...li, order_id: order.id })));

  // Create Stripe PaymentIntent
  const pi = await stripeRequest('POST', '/payment_intents', {
    amount:   totalCents,
    currency: 'usd',
    metadata: { order_id: order.id, order_number: orderNumber },
    receipt_email: customer_email,
  });

  if (pi.error) {
    await sb.from('shop_orders').delete().eq('id', order.id);
    return { statusCode: 500, headers, body: JSON.stringify({ error: pi.error.message }) };
  }

  // Save PaymentIntent ID on order
  await sb.from('shop_orders').update({ stripe_payment_intent_id: pi.id }).eq('id', order.id);

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      client_secret: pi.client_secret,
      order_number:  orderNumber,
      order_id:      order.id,
      total,
      subtotal:      +subtotal.toFixed(2),
      discount:      +discountAmount.toFixed(2),
      shipping:      shippingCost,
    }),
  };
};

function stripeRequest(method, path, params) {
  return new Promise((resolve) => {
    const body = Object.entries(params)
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
        'Authorization':  'Basic ' + key,
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ error: { message: 'Stripe parse error' } }); } });
    });
    req.on('error', () => resolve({ error: { message: 'Stripe request failed' } }));
    req.write(body);
    req.end();
  });
}

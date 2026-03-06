// EasyPost USPS shipping rate lookup
const https = require('https');

const ORIGIN = {
  name:    'Pacific Coast Ponds',
  street1: process.env.SHOP_ORIGIN_STREET || '2600 Michelson Dr',
  city:    process.env.SHOP_ORIGIN_CITY   || 'Irvine',
  state:   process.env.SHOP_ORIGIN_STATE  || 'CA',
  zip:     process.env.SHOP_ORIGIN_ZIP    || '92612',
  country: 'US',
  phone:   process.env.SHOP_ORIGIN_PHONE  || '9495551234',
};

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: 'Method not allowed' };

  let body;
  try { body = JSON.parse(event.body); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { to_address, weight_oz, length_in, width_in, height_in, has_freight } = body;

  // Freight items: skip rate lookup entirely
  if (has_freight) {
    return { statusCode: 200, headers, body: JSON.stringify({ freight: true, rates: [] }) };
  }

  if (!to_address || !to_address.zip) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'to_address.zip required' }) };
  }

  if (!process.env.EASYPOST_API_KEY) {
    // Return flat-rate fallback when no API key configured
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ rates: [
        { id: 'flat_ground', carrier: 'USPS', service: 'Ground Advantage', rate: '8.99', delivery_days: 3 },
        { id: 'flat_priority', carrier: 'USPS', service: 'Priority Mail', rate: '14.99', delivery_days: 2 },
      ]})
    };
  }

  const shipmentPayload = {
    shipment: {
      from_address: ORIGIN,
      to_address: {
        name:    to_address.name    || 'Customer',
        street1: to_address.street1 || '',
        city:    to_address.city    || '',
        state:   to_address.state   || '',
        zip:     to_address.zip,
        country: 'US',
        phone:   to_address.phone   || '',
      },
      parcel: {
        weight: parseFloat(weight_oz) || 16,
        length: parseFloat(length_in) || 9,
        width:  parseFloat(width_in)  || 6,
        height: parseFloat(height_in) || 4,
      },
      carrier_accounts: [],
    }
  };

  try {
    const rates = await easypostRequest('POST', '/shipments', shipmentPayload);
    const uspsRates = (rates.rates || [])
      .filter(r => r.carrier === 'USPS')
      .map(r => ({
        id:            r.id,
        carrier:       r.carrier,
        service:       r.service,
        rate:          r.rate,
        delivery_days: r.delivery_days,
      }))
      .sort((a, b) => parseFloat(a.rate) - parseFloat(b.rate));

    return { statusCode: 200, headers, body: JSON.stringify({ rates: uspsRates, shipment_id: rates.id }) };
  } catch (err) {
    console.error('EasyPost error:', err);
    return { statusCode: 200, headers, body: JSON.stringify({ rates: [
      { id: 'flat_ground',    carrier: 'USPS', service: 'Ground Advantage', rate: '8.99',  delivery_days: 3 },
      { id: 'flat_priority',  carrier: 'USPS', service: 'Priority Mail',    rate: '14.99', delivery_days: 2 },
    ]})};
  }
};

function easypostRequest(method, path, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const key  = Buffer.from(process.env.EASYPOST_API_KEY + ':').toString('base64');
    const opts = {
      hostname: 'api.easypost.com',
      path:     '/v2' + path,
      method,
      headers: {
        'Authorization':  'Basic ' + key,
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON from EasyPost')); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

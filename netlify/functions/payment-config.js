const { jsonResponse, paymentsReady } = require('./lib/shared');

exports.handler = async function handler(event) {
  const origin = event.headers?.origin || '';
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true }, origin);
  }
  if (event.httpMethod !== 'GET') {
    return jsonResponse(405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, origin);
  }
  return jsonResponse(200, {
    ok: true,
    payments_enabled: paymentsReady(),
    provider: 'mercado-pago',
    mode: String(process.env.MP_MODE || 'production').toLowerCase(),
  }, origin);
};

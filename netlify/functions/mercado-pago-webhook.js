const {
  jsonResponse,
  parseJsonBody,
  webhookSignatureValid,
  mpRequest,
} = require('./lib/shared');

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let body = {};
  try {
    body = parseJsonBody(event);
  } catch {
    return jsonResponse(400, { ok: false, error: 'JSON_INVALIDO' });
  }

  const query = event.queryStringParameters || {};
  const dataId = query['data.id'] || query.data_id || body?.data?.id || '';
  try {
    if (!webhookSignatureValid(event, dataId)) {
      return jsonResponse(401, { ok: false, error: 'WEBHOOK_SIGNATURE_INVALID' });
    }
  } catch (error) {
    console.error('Webhook ainda sem segredo configurado:', error.message);
    return jsonResponse(503, { ok: false, error: 'WEBHOOK_NOT_CONFIGURED' });
  }

  if (body.type === 'order' && dataId) {
    try {
      const order = await mpRequest(`/v1/orders/${encodeURIComponent(String(dataId))}`, { method: 'GET' });
      console.log('Webhook Mercado Pago validado:', {
        event_id: body.id,
        action: body.action,
        order_id: order.id,
        external_reference: order.external_reference,
        status: order.status,
        status_detail: order.status_detail,
        total_amount: order.total_amount,
        total_paid_amount: order.total_paid_amount,
      });
    } catch (error) {
      console.error('Webhook válido, mas falhou ao consultar a order:', error.status || '', error.data || error.message);
    }
  }

  return jsonResponse(200, { ok: true });
};

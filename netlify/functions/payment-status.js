const {
  jsonResponse,
  parseJsonBody,
  verifyPurchaseToken,
  mpRequest,
  buildSignedLicense,
} = require('./lib/shared');

function centsFromAmount(value) {
  const number = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

exports.handler = async function handler(event) {
  const origin = event.headers?.origin || '';
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true }, origin);
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, origin);
  }

  let raw;
  let purchase;
  try {
    raw = parseJsonBody(event);
    purchase = verifyPurchaseToken(raw.purchase_token);
  } catch {
    return jsonResponse(400, {
      ok: false,
      error: 'PURCHASE_TOKEN_INVALID',
      message: 'Não foi possível confirmar os dados originais desta compra.',
    }, origin);
  }

  const orderId = String(raw.order_id || '').trim();
  if (!/^ORD[A-Za-z0-9_-]+$/.test(orderId)) {
    return jsonResponse(400, { ok: false, error: 'ORDER_ID_INVALID' }, origin);
  }

  try {
    const order = await mpRequest(`/v1/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    const expectedReference = `GEQ-${purchase.request_id}`;
    const expectedCents = Number(purchase.price_cents || 0);
    const orderCents = centsFromAmount(order.total_amount);
    const paidCents = centsFromAmount(order.total_paid_amount);

    if (order.external_reference !== expectedReference || orderCents !== expectedCents) {
      console.error('Order não corresponde ao pedido assinado.', {
        order_id: order.id,
        external_reference: order.external_reference,
        expected_reference: expectedReference,
        order_cents: orderCents,
        expected_cents: expectedCents,
      });
      return jsonResponse(409, {
        ok: false,
        error: 'ORDER_MISMATCH',
        message: 'O pagamento encontrado não corresponde a este pedido de licença.',
      }, origin);
    }

    const approved = order.status === 'processed'
      && order.status_detail === 'accredited'
      && paidCents >= expectedCents;

    if (!approved) {
      const terminalFailure = ['failed', 'canceled', 'refunded', 'expired'].includes(order.status)
        || ['refunded', 'partially_refunded'].includes(order.status_detail);
      return jsonResponse(200, {
        ok: true,
        approved: false,
        terminal: terminalFailure,
        status: order.status || 'unknown',
        status_detail: order.status_detail || '',
        request_id: purchase.request_id,
        message: terminalFailure
          ? 'O pagamento não foi concluído como aprovado.'
          : 'O pagamento ainda está aguardando confirmação do Mercado Pago.',
      }, origin);
    }

    const license = buildSignedLicense({ order, purchase });
    if (!license) {
      return jsonResponse(200, {
        ok: true,
        approved: true,
        license_ready: false,
        manual_required: true,
        status: order.status,
        status_detail: order.status_detail,
        request_id: purchase.request_id,
        message: 'Pagamento aprovado. A emissão automática da licença ainda não foi ativada; o atendimento pode emitir usando este pedido.',
      }, origin);
    }

    const safeCompany = String(purchase.company || 'Cliente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50) || 'Cliente';

    return jsonResponse(200, {
      ok: true,
      approved: true,
      license_ready: true,
      status: order.status,
      status_detail: order.status_detail,
      request_id: purchase.request_id,
      license_filename: `Licenca_${safeCompany}_${license.payload.license_id}.gelicense`,
      license,
      message: 'Pagamento confirmado. Sua licença está pronta para download.',
    }, origin);
  } catch (error) {
    console.error('Falha ao consultar order Mercado Pago:', error.status || '', error.data || error.message);
    return jsonResponse(502, {
      ok: false,
      error: 'ORDER_STATUS_FAILED',
      message: 'Não foi possível confirmar o pagamento agora. Tente novamente em instantes.',
    }, origin);
  }
};

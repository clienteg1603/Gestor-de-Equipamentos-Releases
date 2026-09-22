const crypto = require('crypto');
const {
  PLAN_LABELS,
  PERIOD_LABELS,
  jsonResponse,
  parseJsonBody,
  normalizePurchase,
  moneyBrlFromCents,
  publicSiteUrl,
  paymentsReady,
  signPurchaseToken,
  mpRequest,
} = require('./lib/shared');

exports.handler = async function handler(event) {
  const origin = event.headers?.origin || '';
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(200, { ok: true }, origin);
  }
  if (event.httpMethod !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'METHOD_NOT_ALLOWED' }, origin);
  }
  if (!paymentsReady()) {
    return jsonResponse(503, {
      ok: false,
      error: 'PAYMENT_NOT_CONFIGURED',
      message: 'O pagamento online ainda está sendo configurado. Use a solicitação manual por enquanto.',
    }, origin);
  }

  let purchase;
  try {
    purchase = normalizePurchase(parseJsonBody(event));
  } catch (error) {
    return jsonResponse(400, {
      ok: false,
      error: error.message || 'PURCHASE_INVALID',
      message: 'Confira os dados do pedido antes de continuar.',
    }, origin);
  }

  const requestId = crypto.randomUUID().toUpperCase();
  const createdAt = new Date().toISOString();
  const purchaseTokenPayload = {
    v: 1,
    request_id: requestId,
    created_at: createdAt,
    ...purchase,
  };
  const purchaseToken = signPurchaseToken(purchaseTokenPayload);
  const amount = moneyBrlFromCents(purchase.price_cents);
  const title = `Gestor de Equipamentos ${PLAN_LABELS[purchase.plan]} — ${PERIOD_LABELS[purchase.period]}`;
  const site = publicSiteUrl();
  const externalReference = `GEQ-${requestId}`;

  const body = {
    type: 'online',
    processing_mode: 'manual',
    total_amount: amount,
    external_reference: externalReference,
    description: title,
    payer: {
      email: purchase.email,
    },
    items: [
      {
        title,
        unit_price: amount,
        quantity: 1,
        unit_measure: 'unit',
        total_amount: amount,
      },
    ],
    config: {
      online: {
        success_url: `${site}/pagamento.html?result=success`,
        failure_url: `${site}/pagamento.html?result=failure`,
        pending_url: `${site}/pagamento.html?result=pending`,
        auto_return: 'all',
      },
    },
  };

  try {
    const order = await mpRequest('/v1/orders', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    });
    if (!order.id || !order.checkout_url) {
      throw new Error('MERCADO_PAGO_RESPOSTA_INVALIDA');
    }
    return jsonResponse(201, {
      ok: true,
      order_id: order.id,
      checkout_url: order.checkout_url,
      purchase_token: purchaseToken,
      request_id: requestId,
      amount_brl: amount,
    }, origin);
  } catch (error) {
    console.error('Falha ao criar checkout Mercado Pago:', error.status || '', error.data || error.message);
    return jsonResponse(502, {
      ok: false,
      error: 'CHECKOUT_CREATE_FAILED',
      message: 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes ou gere um pedido manual.',
    }, origin);
  }
};

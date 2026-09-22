import crypto from 'node:crypto';
import {
  jsonResponse,
  moneyBrlFromCents,
  mpRequest,
  normalizePurchase,
  optionsResponse,
  paymentOrderKey,
  paymentStore,
  paymentsReady,
  periodLabel,
  planLabel,
  publicSiteUrl,
  readJson,
  signPurchaseToken,
} from './lib/shared.mts';

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  if (!paymentsReady()) {
    return jsonResponse(request, 503, {
      ok: false,
      error: 'PAYMENT_NOT_CONFIGURED',
      message: 'O pagamento online ainda está sendo configurado. Use a solicitação manual por enquanto.',
    });
  }

  let purchase;
  try {
    purchase = normalizePurchase(await readJson(request));
  } catch (error: any) {
    return jsonResponse(request, 400, {
      ok: false,
      error: error?.message || 'PURCHASE_INVALID',
      message: 'Confira os dados do pedido antes de continuar.',
    });
  }

  const requestId = crypto.randomUUID().toUpperCase();
  const createdAt = new Date().toISOString();
  const purchaseToken = signPurchaseToken({
    v: 1,
    request_id: requestId,
    created_at: createdAt,
    ...purchase,
  });
  const amount = moneyBrlFromCents(purchase.price_cents);
  const title = `Gestor de Equipamentos ${planLabel(purchase.plan)} — ${periodLabel(purchase.period)}`;
  const site = publicSiteUrl();
  const externalReference = `GEQ-${requestId}`;

  const body = {
    type: 'online',
    processing_mode: 'manual',
    total_amount: amount,
    external_reference: externalReference,
    description: title,
    payer: { email: purchase.email },
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
      headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
    if (!order.id || !order.checkout_url) throw new Error('MERCADO_PAGO_RESPOSTA_INVALIDA');

    const store = paymentStore();
    await store.setJSON(paymentOrderKey(order.id), {
      format_version: 1,
      order_id: String(order.id),
      request_id: requestId,
      external_reference: externalReference,
      created_at: createdAt,
      mercado_pago_created_at: order.created_date || '',
      purchase,
      expected_price_cents: purchase.price_cents,
      status: order.status || 'created',
      status_detail: order.status_detail || '',
      paid_price_cents: 0,
      webhook_confirmed: false,
      webhook_confirmed_at: '',
      license: null,
      license_created_at: '',
    });

    return jsonResponse(request, 201, {
      ok: true,
      order_id: order.id,
      checkout_url: order.checkout_url,
      purchase_token: purchaseToken,
      request_id: requestId,
      amount_brl: amount,
    });
  } catch (error: any) {
    console.error('Falha ao criar/registrar checkout Mercado Pago:', error?.status || '', error?.data || error?.message);
    return jsonResponse(request, 502, {
      ok: false,
      error: 'CHECKOUT_CREATE_FAILED',
      message: 'Não foi possível iniciar o pagamento agora. Tente novamente em instantes ou gere um pedido manual.',
    });
  }
};

export const config = {
  path: '/api/create-checkout',
};

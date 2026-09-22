import {
  buildSignedLicense,
  jsonResponse,
  mpRequest,
  optionsResponse,
  paymentOrderKey,
  paymentStore,
  readJson,
  verifyPurchaseToken,
} from './lib/shared.mts';

function centsFromAmount(value: unknown): number {
  const number = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

function terminalFailure(order: any): boolean {
  return ['failed', 'canceled', 'cancelled', 'refunded', 'expired'].includes(String(order.status || '').toLowerCase())
    || ['refunded', 'partially_refunded'].includes(String(order.status_detail || '').toLowerCase());
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let raw: Record<string, unknown>;
  let tokenPurchase: Record<string, any>;
  try {
    raw = await readJson(request);
    tokenPurchase = verifyPurchaseToken(raw.purchase_token);
  } catch {
    return jsonResponse(request, 400, {
      ok: false,
      error: 'PURCHASE_TOKEN_INVALID',
      message: 'Não foi possível confirmar os dados originais desta compra.',
    });
  }

  const orderId = String(raw.order_id || '').trim();
  if (!/^ORD[A-Za-z0-9_-]+$/.test(orderId)) {
    return jsonResponse(request, 400, { ok: false, error: 'ORDER_ID_INVALID' });
  }

  try {
    const store = paymentStore();
    const key = paymentOrderKey(orderId);
    const stored = await store.get(key, { type: 'json' });
    if (!stored) {
      return jsonResponse(request, 404, {
        ok: false,
        error: 'ORDER_NOT_REGISTERED',
        message: 'Este pedido não foi encontrado no checkout oficial do Gestor.',
      });
    }

    const purchase = stored.purchase || {};
    const tokenMatchesStored = stored.request_id === tokenPurchase.request_id
      && String(purchase.plan || '') === String(tokenPurchase.plan || '')
      && String(purchase.period || '') === String(tokenPurchase.period || '')
      && String(purchase.machine_id || '') === String(tokenPurchase.machine_id || '')
      && Number(stored.expected_price_cents || 0) === Number(tokenPurchase.price_cents || 0);

    if (!tokenMatchesStored) {
      return jsonResponse(request, 409, {
        ok: false,
        error: 'ORDER_TOKEN_MISMATCH',
        message: 'Os dados protegidos desta compra não correspondem ao pedido registrado.',
      });
    }

    const order = await mpRequest(`/v1/orders/${encodeURIComponent(orderId)}`, { method: 'GET' });
    const expectedReference = String(stored.external_reference || '');
    const expectedCents = Number(stored.expected_price_cents || 0);
    const orderCents = centsFromAmount(order.total_amount);
    const paidCents = centsFromAmount(order.total_paid_amount);

    if (order.external_reference !== expectedReference || orderCents !== expectedCents) {
      console.error('Order não corresponde ao registro interno.', {
        order_id: order.id,
        external_reference: order.external_reference,
        expected_reference: expectedReference,
        order_cents: orderCents,
        expected_cents: expectedCents,
      });
      return jsonResponse(request, 409, {
        ok: false,
        error: 'ORDER_MISMATCH',
        message: 'O pagamento encontrado não corresponde a este pedido de licença.',
      });
    }

    const liveApproved = order.status === 'processed'
      && order.status_detail === 'accredited'
      && paidCents >= expectedCents;

    if (!liveApproved) {
      const failed = terminalFailure(order);
      return jsonResponse(request, 200, {
        ok: true,
        approved: false,
        terminal: failed,
        status: order.status || 'unknown',
        status_detail: order.status_detail || '',
        request_id: stored.request_id,
        message: failed
          ? 'O pagamento não foi concluído como aprovado.'
          : 'O pagamento ainda está aguardando confirmação do Mercado Pago.',
      });
    }

    const webhookApproved = stored.webhook_confirmed === true
      && stored.webhook_mismatch !== true
      && stored.status === 'processed'
      && stored.status_detail === 'accredited'
      && Number(stored.paid_price_cents || 0) >= expectedCents;

    if (!webhookApproved) {
      return jsonResponse(request, 200, {
        ok: true,
        approved: false,
        terminal: false,
        status: order.status,
        status_detail: order.status_detail,
        request_id: stored.request_id,
        message: 'O pagamento aparece aprovado e estamos aguardando a confirmação assinada do Mercado Pago. Verifique novamente em alguns instantes.',
      });
    }

    let license = stored.license || null;
    if (!license) {
      license = buildSignedLicense({ order, purchase });
      if (license) {
        await store.setJSON(key, {
          ...stored,
          status: order.status,
          status_detail: order.status_detail,
          paid_price_cents: paidCents,
          license,
          license_created_at: new Date().toISOString(),
        });
      }
    }

    if (!license) {
      return jsonResponse(request, 200, {
        ok: true,
        approved: true,
        license_ready: false,
        manual_required: true,
        status: order.status,
        status_detail: order.status_detail,
        request_id: stored.request_id,
        message: 'Pagamento confirmado. A emissão automática da licença ainda não foi ativada; o atendimento pode emitir usando este pedido.',
      });
    }

    const safeCompany = String(purchase.company || 'Cliente')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 50) || 'Cliente';

    return jsonResponse(request, 200, {
      ok: true,
      approved: true,
      license_ready: true,
      status: order.status,
      status_detail: order.status_detail,
      request_id: stored.request_id,
      license_filename: `Licenca_${safeCompany}_${license.payload.license_id}.gelicense`,
      license,
      message: 'Pagamento confirmado. Sua licença está pronta para download.',
    });
  } catch (error: any) {
    console.error('Falha ao confirmar order Mercado Pago:', error?.status || '', error?.data || error?.message);
    return jsonResponse(request, 502, {
      ok: false,
      error: 'ORDER_STATUS_FAILED',
      message: 'Não foi possível confirmar o pagamento agora. Tente novamente em instantes.',
    });
  }
};

export const config = {
  path: '/api/payment-status',
};

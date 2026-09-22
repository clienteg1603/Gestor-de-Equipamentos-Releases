import {
  buildSignedLicense,
  jsonResponse,
  mpRequest,
  optionsResponse,
  readJson,
  verifyPurchaseToken,
} from './lib/shared.mts';

function centsFromAmount(value: unknown): number {
  const number = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let raw: Record<string, unknown>;
  let purchase: Record<string, any>;
  try {
    raw = await readJson(request);
    purchase = verifyPurchaseToken(raw.purchase_token);
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
      return jsonResponse(request, 409, {
        ok: false,
        error: 'ORDER_MISMATCH',
        message: 'O pagamento encontrado não corresponde a este pedido de licença.',
      });
    }

    const approved = order.status === 'processed'
      && order.status_detail === 'accredited'
      && paidCents >= expectedCents;

    if (!approved) {
      const terminalFailure = ['failed', 'canceled', 'refunded', 'expired'].includes(order.status)
        || ['refunded', 'partially_refunded'].includes(order.status_detail);
      return jsonResponse(request, 200, {
        ok: true,
        approved: false,
        terminal: terminalFailure,
        status: order.status || 'unknown',
        status_detail: order.status_detail || '',
        request_id: purchase.request_id,
        message: terminalFailure
          ? 'O pagamento não foi concluído como aprovado.'
          : 'O pagamento ainda está aguardando confirmação do Mercado Pago.',
      });
    }

    const license = buildSignedLicense({ order, purchase });
    if (!license) {
      return jsonResponse(request, 200, {
        ok: true,
        approved: true,
        license_ready: false,
        manual_required: true,
        status: order.status,
        status_detail: order.status_detail,
        request_id: purchase.request_id,
        message: 'Pagamento aprovado. A emissão automática da licença ainda não foi ativada; o atendimento pode emitir usando este pedido.',
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
      request_id: purchase.request_id,
      license_filename: `Licenca_${safeCompany}_${license.payload.license_id}.gelicense`,
      license,
      message: 'Pagamento confirmado. Sua licença está pronta para download.',
    });
  } catch (error: any) {
    console.error('Falha ao consultar order Mercado Pago:', error?.status || '', error?.data || error?.message);
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

import {
  jsonResponse,
  mpRequest,
  paymentOrderKey,
  paymentStore,
  readJson,
  webhookSignatureValid,
} from './lib/shared.mts';

function centsFromAmount(value: unknown): number {
  const number = Number.parseFloat(String(value ?? '0'));
  return Number.isFinite(number) ? Math.round(number * 100) : 0;
}

export default async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse(request, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  let body: Record<string, any>;
  try {
    body = await readJson(request);
  } catch {
    return jsonResponse(request, 400, { ok: false, error: 'JSON_INVALIDO' });
  }

  const url = new URL(request.url);
  const dataId = url.searchParams.get('data.id') || url.searchParams.get('data_id') || body?.data?.id || '';
  try {
    if (!webhookSignatureValid(request, dataId)) {
      return jsonResponse(request, 401, { ok: false, error: 'WEBHOOK_SIGNATURE_INVALID' });
    }
  } catch (error: any) {
    console.error('Webhook ainda sem segredo configurado:', error?.message);
    return jsonResponse(request, 503, { ok: false, error: 'WEBHOOK_NOT_CONFIGURED' });
  }

  if (body.type === 'order' && dataId) {
    try {
      const order = await mpRequest(`/v1/orders/${encodeURIComponent(String(dataId))}`, { method: 'GET' });
      const store = paymentStore();
      const key = paymentOrderKey(String(order.id || dataId));
      const stored = await store.get(key, { type: 'json' });

      if (!stored) {
        console.warn('Webhook de order não criada pelo checkout do Gestor:', order.id || dataId);
        return jsonResponse(request, 200, { ok: true, ignored: true });
      }

      const orderCents = centsFromAmount(order.total_amount);
      const paidCents = centsFromAmount(order.total_paid_amount);
      const referenceMatches = order.external_reference === stored.external_reference;
      const amountMatches = orderCents === Number(stored.expected_price_cents || 0);

      if (!referenceMatches || !amountMatches) {
        await store.setJSON(key, {
          ...stored,
          webhook_mismatch: true,
          last_webhook_at: new Date().toISOString(),
          last_event_id: body.id || '',
        });
        console.error('Webhook rejeitado por divergência de pedido/valor:', {
          order_id: order.id,
          referenceMatches,
          amountMatches,
        });
        return jsonResponse(request, 200, { ok: true, ignored: true });
      }

      const now = new Date().toISOString();
      await store.setJSON(key, {
        ...stored,
        status: order.status || '',
        status_detail: order.status_detail || '',
        paid_price_cents: paidCents,
        mercado_pago_updated_at: order.last_updated_date || '',
        webhook_confirmed: true,
        webhook_confirmed_at: now,
        webhook_mismatch: false,
        last_webhook_at: now,
        last_event_id: body.id || '',
        last_action: body.action || '',
      });

      console.log('Webhook Mercado Pago validado e persistido:', {
        event_id: body.id,
        action: body.action,
        order_id: order.id,
        status: order.status,
        status_detail: order.status_detail,
        paid_price_cents: paidCents,
      });
    } catch (error: any) {
      console.error('Webhook válido, mas falhou ao consultar/persistir a order:', error?.status || '', error?.data || error?.message);
      return jsonResponse(request, 500, { ok: false, error: 'WEBHOOK_PROCESSING_FAILED' });
    }
  }

  return jsonResponse(request, 200, { ok: true });
};

export const config = {
  path: '/api/mercado-pago-webhook',
};

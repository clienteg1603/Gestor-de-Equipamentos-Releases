import {
  jsonResponse,
  mpRequest,
  readJson,
  webhookSignatureValid,
} from './lib/shared.mts';

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
    } catch (error: any) {
      console.error('Webhook válido, mas falhou ao consultar a order:', error?.status || '', error?.data || error?.message);
    }
  }

  return jsonResponse(request, 200, { ok: true });
};

export const config = {
  path: '/api/mercado-pago-webhook',
};

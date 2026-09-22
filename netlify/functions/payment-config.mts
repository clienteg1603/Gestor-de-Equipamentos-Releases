import { jsonResponse, optionsResponse, paymentsReady } from './lib/shared.mts';

export default async (request: Request) => {
  if (request.method === 'OPTIONS') return optionsResponse(request);
  if (request.method !== 'GET') {
    return jsonResponse(request, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  return jsonResponse(request, 200, {
    ok: true,
    payments_enabled: paymentsReady(),
    provider: 'mercado-pago',
    mode: (Netlify.env.get('MP_MODE') || 'production').toLowerCase(),
  });
};

export const config = {
  path: '/api/payment-config',
};

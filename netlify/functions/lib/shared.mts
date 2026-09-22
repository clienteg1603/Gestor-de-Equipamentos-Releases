import crypto from 'node:crypto';
import { getDeployStore, getStore } from '@netlify/blobs';

const PRICES = {
  basic: { '1m': 2990, '6m': 14990, '1y': 26990, permanent: 69990 },
  pro: { '1m': 5990, '6m': 29990, '1y': 53990, permanent: 139990 },
} as const;

const PLAN_LABELS = { basic: 'Básico', pro: 'Pro' } as const;
const PERIOD_LABELS = {
  '1m': '1 mês',
  '6m': '6 meses',
  '1y': '1 ano',
  permanent: 'Permanente',
} as const;
const PERIOD_MONTHS = { '1m': 1, '6m': 6, '1y': 12 } as const;
const MACHINE_RE = /^GE(?:-[A-F0-9]{4}){6}$/;
const PAYMENT_STORE = 'geq-payments';

function env(name: string): string {
  return (Netlify.env.get(name) || '').trim();
}

export function isProductionDeploy(): boolean {
  return String(Netlify.context?.deploy?.context || '').toLowerCase() === 'production';
}

export function paymentStore() {
  if (isProductionDeploy()) {
    return getStore(PAYMENT_STORE, { consistency: 'strong' });
  }
  return getDeployStore(PAYMENT_STORE);
}

export function paymentOrderKey(orderId: string): string {
  return `orders/${String(orderId).trim()}`;
}

export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('origin') || '';
  const allowed = env('GEQ_ALLOWED_ORIGINS')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const selected = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': selected,
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

export function jsonResponse(request: Request, status: number, payload: unknown): Response {
  return Response.json(payload, {
    status,
    headers: corsHeaders(request),
  });
}

export function optionsResponse(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error('JSON_INVALIDO');
  }
}

export function normalizeMachineId(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function normalizePurchase(raw: Record<string, unknown>) {
  const plan = String(raw.plan || '').trim().toLowerCase() as keyof typeof PRICES;
  const period = String(raw.period || '').trim().toLowerCase();
  const company = String(raw.company || '').trim().slice(0, 120);
  const contactName = String(raw.contact_name || '').trim().slice(0, 100);
  const email = String(raw.email || '').trim().toLowerCase().slice(0, 160);
  const whatsapp = String(raw.whatsapp || '').trim().slice(0, 30);
  const machineId = normalizeMachineId(raw.machine_id);

  if (!Object.prototype.hasOwnProperty.call(PRICES, plan)) throw new Error('PLANO_INVALIDO');
  const planPrices = PRICES[plan] as Record<string, number>;
  if (!Object.prototype.hasOwnProperty.call(planPrices, period)) throw new Error('PERIODO_INVALIDO');
  if (!company) throw new Error('EMPRESA_OBRIGATORIA');
  if (!contactName) throw new Error('RESPONSAVEL_OBRIGATORIO');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('EMAIL_INVALIDO');
  if (!MACHINE_RE.test(machineId)) throw new Error('MAQUINA_INVALIDA');

  return {
    plan,
    period,
    company,
    contact_name: contactName,
    email,
    whatsapp,
    machine_id: machineId,
    price_cents: planPrices[period],
  };
}

export function planLabel(plan: string): string {
  return PLAN_LABELS[plan as keyof typeof PLAN_LABELS] || plan;
}

export function periodLabel(period: string): string {
  return PERIOD_LABELS[period as keyof typeof PERIOD_LABELS] || period;
}

export function moneyBrlFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function publicSiteUrl(): string {
  return (env('GEQ_PUBLIC_SITE_URL') || 'https://clienteg1603.github.io/Gestor-de-Equipamentos-Releases').replace(/\/$/, '');
}

export function paymentsReady(): boolean {
  return env('GEQ_PAYMENTS_ENABLED').toLowerCase() === 'true'
    && Boolean(env('MP_ACCESS_TOKEN'))
    && Boolean(env('MP_WEBHOOK_SECRET'))
    && Boolean(env('GEQ_ORDER_TOKEN_SECRET'));
}

function encodePart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function signPurchaseToken(payload: Record<string, unknown>): string {
  const secret = env('GEQ_ORDER_TOKEN_SECRET');
  if (!secret) throw new Error('SEGREDO_PEDIDO_AUSENTE');
  const body = encodePart(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

export function verifyPurchaseToken(token: unknown): Record<string, any> {
  const secret = env('GEQ_ORDER_TOKEN_SECRET');
  if (!secret) throw new Error('SEGREDO_PEDIDO_AUSENTE');
  const [body, received] = String(token || '').split('.');
  if (!body || !received) throw new Error('TOKEN_PEDIDO_INVALIDO');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('TOKEN_PEDIDO_INVALIDO');
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || payload.v !== 1 || !payload.request_id) throw new Error();
    return payload;
  } catch {
    throw new Error('TOKEN_PEDIDO_INVALIDO');
  }
}

export async function mpRequest(path: string, options: RequestInit = {}) {
  const accessToken = env('MP_ACCESS_TOKEN');
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN_AUSENTE');
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`https://api.mercadopago.com${path}`, { ...options, headers });
  const text = await response.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error: any = new Error('MERCADO_PAGO_ERRO');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function stableJson(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function addMonthsUtc(date: Date, months: number): Date {
  const targetIndex = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = targetIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCFullYear(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay));
  return result;
}

function expirationForPeriod(period: string, issuedAt: Date): string {
  if (period === 'permanent') return '';
  const months = PERIOD_MONTHS[period as keyof typeof PERIOD_MONTHS];
  if (!months) throw new Error('PERIODO_INVALIDO');
  return addMonthsUtc(issuedAt, months).toISOString();
}

export function buildSignedLicense({ order, purchase }: { order: any; purchase: Record<string, any> }) {
  const privateKeyB64 = env('GEQ_LICENSE_PRIVATE_KEY_B64');
  const keyId = env('GEQ_LICENSE_KEY_ID');
  if (!privateKeyB64 || !keyId) return null;

  const pem = Buffer.from(privateKeyB64, 'base64').toString('utf8');
  const issuedAt = new Date(order.last_updated_date || order.created_date || Date.now());
  if (Number.isNaN(issuedAt.getTime())) throw new Error('DATA_PAGAMENTO_INVALIDA');
  const compactOrderId = String(order.id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const licenseId = `LIC-MP-${compactOrderId.slice(-24) || String(purchase.request_id).slice(-24).toUpperCase()}`;
  const payload = {
    schema_version: 1,
    license_id: licenseId,
    company_name: purchase.company,
    plan: purchase.plan,
    issued_at: issuedAt.toISOString(),
    expires_at: expirationForPeriod(purchase.period, issuedAt),
    machine_id: purchase.machine_id,
    notes: `Pagamento Mercado Pago • Pedido ${purchase.request_id} • Order ${order.id}`,
  };
  const content = { format_version: 1, key_id: keyId, payload };
  const privateKey = crypto.createPrivateKey(pem);
  const signature = crypto.sign(null, Buffer.from(stableJson(content), 'utf8'), privateKey).toString('base64');
  return { ...content, signature };
}

export function webhookSignatureValid(request: Request, dataId: string): boolean {
  const secret = env('MP_WEBHOOK_SECRET');
  if (!secret) throw new Error('MP_WEBHOOK_SECRET_AUSENTE');
  const xSignature = request.headers.get('x-signature') || '';
  const requestId = request.headers.get('x-request-id') || '';
  const parts = Object.fromEntries(
    xSignature.split(',').map(piece => piece.trim().split('=', 2)).filter(pair => pair.length === 2)
  );
  const ts = parts.ts || '';
  const received = parts.v1 || '';
  if (!ts || !received) return false;
  const manifest = [
    dataId ? `id:${String(dataId).toLowerCase()};` : '',
    requestId ? `request-id:${requestId};` : '',
    `ts:${ts};`,
  ].join('');
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const crypto = require('crypto');

const PRICES = Object.freeze({
  basic: Object.freeze({
    '1m': 2990,
    '6m': 14990,
    '1y': 26990,
    permanent: 69990,
  }),
  pro: Object.freeze({
    '1m': 5990,
    '6m': 29990,
    '1y': 53990,
    permanent: 139990,
  }),
});

const PLAN_LABELS = Object.freeze({ basic: 'Básico', pro: 'Pro' });
const PERIOD_LABELS = Object.freeze({
  '1m': '1 mês',
  '6m': '6 meses',
  '1y': '1 ano',
  permanent: 'Permanente',
});
const PERIOD_MONTHS = Object.freeze({ '1m': 1, '6m': 6, '1y': 12 });
const MACHINE_RE = /^GE(?:-[A-F0-9]{4}){6}$/;

function allowedOrigins() {
  return (process.env.GEQ_ALLOWED_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function corsHeaders(origin = '') {
  const allowed = allowedOrigins();
  const selected = allowed.includes(origin) ? origin : (allowed[0] || '*');
  return {
    'Access-Control-Allow-Origin': selected,
    'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function jsonResponse(statusCode, payload, origin = '') {
  return {
    statusCode,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  };
}

function parseJsonBody(event) {
  if (!event.body) return {};
  try {
    return JSON.parse(event.body);
  } catch {
    throw new Error('JSON_INVALIDO');
  }
}

function normalizeMachineId(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizePurchase(raw) {
  const plan = String(raw.plan || '').trim().toLowerCase();
  const period = String(raw.period || '').trim().toLowerCase();
  const company = String(raw.company || '').trim().slice(0, 120);
  const contactName = String(raw.contact_name || '').trim().slice(0, 100);
  const email = String(raw.email || '').trim().toLowerCase().slice(0, 160);
  const whatsapp = String(raw.whatsapp || '').trim().slice(0, 30);
  const machineId = normalizeMachineId(raw.machine_id);

  if (!Object.prototype.hasOwnProperty.call(PRICES, plan)) {
    throw new Error('PLANO_INVALIDO');
  }
  if (!Object.prototype.hasOwnProperty.call(PRICES[plan], period)) {
    throw new Error('PERIODO_INVALIDO');
  }
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
    price_cents: PRICES[plan][period],
  };
}

function moneyBrlFromCents(cents) {
  return (cents / 100).toFixed(2);
}

function publicSiteUrl() {
  return (process.env.GEQ_PUBLIC_SITE_URL || 'https://clienteg1603.github.io/Gestor-de-Equipamentos-Releases').replace(/\/$/, '');
}

function paymentsReady() {
  return String(process.env.GEQ_PAYMENTS_ENABLED || '').toLowerCase() === 'true'
    && Boolean((process.env.MP_ACCESS_TOKEN || '').trim())
    && Boolean((process.env.GEQ_ORDER_TOKEN_SECRET || '').trim());
}

function encodePart(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPurchaseToken(payload) {
  const secret = (process.env.GEQ_ORDER_TOKEN_SECRET || '').trim();
  if (!secret) throw new Error('SEGREDO_PEDIDO_AUSENTE');
  const body = encodePart(payload);
  const signature = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyPurchaseToken(token) {
  const secret = (process.env.GEQ_ORDER_TOKEN_SECRET || '').trim();
  if (!secret) throw new Error('SEGREDO_PEDIDO_AUSENTE');
  const [body, received] = String(token || '').split('.');
  if (!body || !received) throw new Error('TOKEN_PEDIDO_INVALIDO');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new Error('TOKEN_PEDIDO_INVALIDO');
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw new Error('TOKEN_PEDIDO_INVALIDO');
  }
  if (!payload || payload.v !== 1 || !payload.request_id) throw new Error('TOKEN_PEDIDO_INVALIDO');
  return payload;
}

async function mpRequest(path, options = {}) {
  const accessToken = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!accessToken) throw new Error('MP_ACCESS_TOKEN_AUSENTE');
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    ...(options.headers || {}),
  };
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...options,
    headers,
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) {
    const error = new Error('MERCADO_PAGO_ERRO');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
}

function addMonthsUtc(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetIndex = year * 12 + month + months;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = targetIndex % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(date.getTime());
  result.setUTCFullYear(targetYear, targetMonth, Math.min(day, lastDay));
  return result;
}

function expirationForPeriod(period, issuedAt) {
  if (period === 'permanent') return '';
  const months = PERIOD_MONTHS[period];
  if (!months) throw new Error('PERIODO_INVALIDO');
  return addMonthsUtc(issuedAt, months).toISOString();
}

function buildSignedLicense({ order, purchase }) {
  const privateKeyB64 = (process.env.GEQ_LICENSE_PRIVATE_KEY_B64 || '').trim();
  const keyId = (process.env.GEQ_LICENSE_KEY_ID || '').trim();
  if (!privateKeyB64 || !keyId) return null;

  const pem = Buffer.from(privateKeyB64, 'base64').toString('utf8');
  const issuedAt = new Date(order.last_updated_date || order.created_date || Date.now());
  if (Number.isNaN(issuedAt.getTime())) throw new Error('DATA_PAGAMENTO_INVALIDA');
  const issuedAtIso = issuedAt.toISOString();
  const expiresAt = expirationForPeriod(purchase.period, issuedAt);
  const compactOrderId = String(order.id || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const licenseId = `LIC-MP-${compactOrderId.slice(-24) || purchase.request_id.slice(-24).toUpperCase()}`;

  const payload = {
    schema_version: 1,
    license_id: licenseId,
    company_name: purchase.company,
    plan: purchase.plan,
    issued_at: issuedAtIso,
    expires_at: expiresAt,
    machine_id: purchase.machine_id,
    notes: `Pagamento Mercado Pago • Pedido ${purchase.request_id} • Order ${order.id}`,
  };
  const content = {
    format_version: 1,
    key_id: keyId,
    payload,
  };
  const privateKey = crypto.createPrivateKey(pem);
  const signature = crypto.sign(null, Buffer.from(stableJson(content), 'utf8'), privateKey).toString('base64');
  return {
    ...content,
    signature,
  };
}

function webhookSignatureValid(event, dataId) {
  const secret = (process.env.MP_WEBHOOK_SECRET || '').trim();
  if (!secret) throw new Error('MP_WEBHOOK_SECRET_AUSENTE');
  const xSignature = String(event.headers['x-signature'] || event.headers['X-Signature'] || '');
  const requestId = String(event.headers['x-request-id'] || event.headers['X-Request-Id'] || '');
  const parts = Object.fromEntries(
    xSignature.split(',').map(piece => piece.trim().split('=', 2)).filter(pair => pair.length === 2)
  );
  const ts = parts.ts || '';
  const received = parts.v1 || '';
  if (!ts || !received) return false;

  const manifestParts = [];
  if (dataId) manifestParts.push(`id:${String(dataId).toLowerCase()};`);
  if (requestId) manifestParts.push(`request-id:${requestId};`);
  if (ts) manifestParts.push(`ts:${ts};`);
  const expected = crypto.createHmac('sha256', secret).update(manifestParts.join('')).digest('hex');
  const a = Buffer.from(received, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  PRICES,
  PLAN_LABELS,
  PERIOD_LABELS,
  corsHeaders,
  jsonResponse,
  parseJsonBody,
  normalizePurchase,
  moneyBrlFromCents,
  publicSiteUrl,
  paymentsReady,
  signPurchaseToken,
  verifyPurchaseToken,
  mpRequest,
  buildSignedLicense,
  webhookSignatureValid,
};

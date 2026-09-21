const planLabels = {
  basic: 'Básico',
  pro: 'Pro'
};

const periodLabels = {
  '1m': '1 mês',
  '6m': '6 meses',
  '1y': '1 ano',
  permanent: 'Permanente'
};

const form = document.getElementById('license-request-form');
const plan = document.getElementById('plan');
const period = document.getElementById('period');
const company = document.getElementById('company');
const contactName = document.getElementById('contact-name');
const email = document.getElementById('email');
const whatsapp = document.getElementById('whatsapp');
const machineId = document.getElementById('machine-id');
const errorBox = document.getElementById('form-error');
const copyButton = document.getElementById('copy-request');
const requestState = document.getElementById('request-state');
const summaryTitle = document.getElementById('summary-title');
const summaryPlan = document.getElementById('summary-plan');
const summaryPeriod = document.getElementById('summary-period');

let lastRequest = null;

function readInitialSelection() {
  const params = new URLSearchParams(window.location.search);
  const requestedPlan = (params.get('plan') || '').toLowerCase();
  const requestedPeriod = (params.get('period') || '').toLowerCase();
  if (Object.prototype.hasOwnProperty.call(planLabels, requestedPlan)) {
    plan.value = requestedPlan;
  }
  if (Object.prototype.hasOwnProperty.call(periodLabels, requestedPeriod)) {
    period.value = requestedPeriod;
  }
}

function updateSummary() {
  const planText = planLabels[plan.value] || 'Básico';
  const periodText = periodLabels[period.value] || '1 mês';
  summaryTitle.textContent = `${planText} • ${periodText}`;
  summaryPlan.textContent = planText;
  summaryPeriod.textContent = periodText;
  lastRequest = null;
  copyButton.disabled = true;
  requestState.textContent = 'Não gerado';
  requestState.classList.remove('ready');
}

function normalizeMachineId(value) {
  return value.trim().toUpperCase().replace(/\s+/g, '');
}

function validate() {
  const errors = [];
  const machine = normalizeMachineId(machineId.value);
  const machinePattern = /^GE(?:-[A-F0-9]{4}){6}$/;

  if (!company.value.trim()) errors.push('Informe a empresa ou o nome do titular.');
  if (!contactName.value.trim()) errors.push('Informe o responsável.');
  if (!email.value.trim() || !email.checkValidity()) errors.push('Informe um e-mail válido.');
  if (!machinePattern.test(machine)) {
    errors.push('O código do computador deve ter o formato GE-0000-0000-0000-0000-0000-0000.');
  }

  errorBox.textContent = errors.join(' ');
  return errors.length === 0;
}

function makeRequestId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `REQ-${window.crypto.randomUUID().toUpperCase()}`;
  }
  const random = Math.random().toString(16).slice(2, 10).toUpperCase();
  return `REQ-${Date.now()}-${random}`;
}

function buildRequest() {
  return {
    format: 'gestor-license-request',
    format_version: 1,
    request_id: makeRequestId(),
    created_at: new Date().toISOString(),
    product: 'Gestor de Equipamentos',
    plan: plan.value,
    period: period.value,
    company: company.value.trim(),
    contact_name: contactName.value.trim(),
    email: email.value.trim(),
    whatsapp: whatsapp.value.trim(),
    machine_id: normalizeMachineId(machineId.value),
    source: 'site-oficial'
  };
}

function safeFilename(value) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return normalized || 'Cliente';
}

function downloadRequest(request) {
  const json = JSON.stringify(request, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `Pedido_Licenca_${safeFilename(request.company)}.gerequest`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function requestAsText(request) {
  return [
    'PEDIDO DE LICENÇA — GESTOR DE EQUIPAMENTOS',
    `Pedido: ${request.request_id}`,
    `Plano: ${planLabels[request.plan]}`,
    `Período: ${periodLabels[request.period]}`,
    `Empresa/Titular: ${request.company}`,
    `Responsável: ${request.contact_name}`,
    `E-mail: ${request.email}`,
    `WhatsApp: ${request.whatsapp || 'não informado'}`,
    `Código do computador: ${request.machine_id}`,
    `Criado em: ${request.created_at}`
  ].join('\n');
}

async function copyRequest() {
  if (!lastRequest) return;
  const text = requestAsText(lastRequest);
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = 'Pedido copiado';
    setTimeout(() => { copyButton.textContent = 'Copiar pedido'; }, 1800);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    copyButton.textContent = 'Pedido copiado';
    setTimeout(() => { copyButton.textContent = 'Copiar pedido'; }, 1800);
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  machineId.value = normalizeMachineId(machineId.value);
  if (!validate()) return;

  lastRequest = buildRequest();
  downloadRequest(lastRequest);
  copyButton.disabled = false;
  requestState.textContent = 'Pedido gerado';
  requestState.classList.add('ready');
  errorBox.textContent = '';
});

copyButton.addEventListener('click', copyRequest);
plan.addEventListener('change', updateSummary);
period.addEventListener('change', updateSummary);

readInitialSelection();
updateSummary();

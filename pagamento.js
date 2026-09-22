const API_BASE = 'https://gestor-de-equipamentos.netlify.app/api';
const CHECKOUT_STORAGE_KEY = 'geq-checkout-v1';

const title = document.getElementById('payment-title');
const message = document.getElementById('payment-message');
const requestBox = document.getElementById('payment-order');
const requestId = document.getElementById('payment-request-id');
const downloadButton = document.getElementById('download-license');
const checkAgainButton = document.getElementById('check-again');
const backToBuy = document.getElementById('back-to-buy');
const help = document.getElementById('payment-help');

let licensePayload = null;
let licenseFilename = 'Licenca_Gestor.gelicense';

function readStoredCheckout() {
  try {
    return JSON.parse(localStorage.getItem(CHECKOUT_STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function currentOrderId(stored) {
  const params = new URLSearchParams(window.location.search);
  return (params.get('order_id') || stored?.order_id || '').trim();
}

function setRequest(value) {
  if (!value) return;
  requestBox.hidden = false;
  requestId.textContent = value;
}

function showPending(text) {
  title.textContent = 'Pagamento aguardando confirmação';
  message.textContent = text || 'O Mercado Pago ainda não confirmou o pagamento. Você pode verificar novamente em alguns instantes.';
  checkAgainButton.hidden = false;
  backToBuy.hidden = true;
  downloadButton.hidden = true;
}

function showFailure(text) {
  title.textContent = 'Pagamento não concluído';
  message.textContent = text || 'O pagamento não foi concluído como aprovado. Você pode voltar e iniciar uma nova tentativa.';
  checkAgainButton.hidden = true;
  backToBuy.hidden = false;
  downloadButton.hidden = true;
}

function showApprovedManual(text) {
  title.textContent = 'Pagamento confirmado';
  message.textContent = text || 'O pagamento foi aprovado. A licença será emitida pelo atendimento usando os dados deste pedido.';
  checkAgainButton.hidden = true;
  backToBuy.hidden = true;
  downloadButton.hidden = true;
  help.textContent = 'Guarde o número do pedido exibido nesta página até receber sua licença.';
}

function showLicenseReady(text) {
  title.textContent = 'Pagamento confirmado e licença pronta';
  message.textContent = text || 'Sua licença foi emitida para o computador informado. Baixe o arquivo e importe no Gestor.';
  checkAgainButton.hidden = true;
  backToBuy.hidden = true;
  downloadButton.hidden = false;
  help.textContent = 'Depois de baixar: Gestor → Configurações → Licença → Licença e ativação → Importar licença.';
}

function downloadLicense() {
  if (!licensePayload) return;
  const blob = new Blob([JSON.stringify(licensePayload, null, 2)], {
    type: 'application/json;charset=utf-8'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = licenseFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function checkStatus() {
  const stored = readStoredCheckout();
  const orderId = currentOrderId(stored);
  if (!stored?.purchase_token || !orderId) {
    title.textContent = 'Não conseguimos localizar este pedido';
    message.textContent = 'Os dados necessários para confirmar a compra não estão neste navegador. Se você já pagou, entre em contato com o suporte e informe o número da order do Mercado Pago.';
    backToBuy.hidden = false;
    checkAgainButton.hidden = true;
    help.textContent = 'Por segurança, a licença não é emitida apenas com os parâmetros visíveis na URL.';
    return;
  }

  setRequest(stored.request_id || orderId);
  title.textContent = 'Confirmando seu pagamento…';
  message.textContent = 'Estamos consultando o status diretamente no Mercado Pago.';
  checkAgainButton.disabled = true;
  downloadButton.hidden = true;

  try {
    const response = await fetch(`${API_BASE}/payment-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: orderId,
        purchase_token: stored.purchase_token
      })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || 'Não foi possível confirmar o pagamento agora.');
    }

    setRequest(data.request_id || stored.request_id || orderId);
    if (!data.approved) {
      if (data.terminal) showFailure(data.message);
      else showPending(data.message);
      return;
    }

    if (!data.license_ready) {
      showApprovedManual(data.message);
      return;
    }

    licensePayload = data.license;
    licenseFilename = data.license_filename || licenseFilename;
    showLicenseReady(data.message);
  } catch (error) {
    title.textContent = 'Não foi possível confirmar agora';
    message.textContent = error.message || 'Tente novamente em alguns instantes.';
    checkAgainButton.hidden = false;
    backToBuy.hidden = true;
  } finally {
    checkAgainButton.disabled = false;
  }
}

downloadButton.addEventListener('click', downloadLicense);
checkAgainButton.addEventListener('click', checkStatus);
checkStatus();

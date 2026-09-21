const owner = 'clienteg1603';
const repo = 'Gestor-de-Equipamentos-Releases';
const api = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
const fallback = `https://github.com/${owner}/${repo}/releases/latest`;

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    }).format(new Date(value));
  } catch {
    return '';
  }
}

async function loadLatestRelease() {
  const status = document.getElementById('release-status');
  const date = document.getElementById('release-date');
  const buttons = document.querySelectorAll('.js-download');

  try {
    const response = await fetch(api, {
      headers: { 'Accept': 'application/vnd.github+json' },
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('release unavailable');

    const release = await response.json();
    const zip = (release.assets || []).find(asset =>
      asset.name.toLowerCase().endsWith('.zip') &&
      !asset.name.toLowerCase().endsWith('.zip.sha256')
    );

    const target = zip?.browser_download_url || release.html_url || fallback;
    buttons.forEach(button => button.href = target);

    if (status) status.textContent = release.name || release.tag_name || 'Versão atual disponível';
    if (date) {
      const formatted = formatDate(release.published_at || release.created_at);
      date.textContent = formatted ? `Publicada em ${formatted}` : '';
    }
  } catch {
    buttons.forEach(button => button.href = fallback);
    if (status) status.textContent = 'Versão atual disponível';
    if (date) date.textContent = '';
  }
}

loadLatestRelease();

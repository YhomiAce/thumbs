import type { ImageSummary, VariantSummary } from '../images/repository.js';
import { formatBytes, savingsPercent } from '../images/variants.js';
import type { QueueCounts } from '../jobs/queue.js';
import { escapeHtml, layout } from './html.js';

function statusLabel(image: ImageSummary): string {
  if (image.status === 'processing' && image.error) return `retrying (attempt ${image.attempts})`;
  return image.status;
}

function card(image: ImageSummary): string {
  const ready = image.status === 'ready';
  const thumb = ready
    ? `<img src="/i/${image.id}/480.webp" alt="${escapeHtml(image.originalName)}" loading="lazy">`
    : image.status === 'failed'
      ? '<span class="error">failed</span>'
      : '<div class="spinner"></div>';
  return `<a class="card" href="/images/${image.id}" data-id="${image.id}" data-status="${image.status}">
  <div class="thumb" style="${image.dominantColor ? `background:${escapeHtml(image.dominantColor)}` : ''}">${thumb}</div>
  <div class="meta"><div class="name">${escapeHtml(image.originalName)}</div>
  <span class="badge ${image.status}">${escapeHtml(statusLabel(image))}</span> <span class="muted">${formatBytes(image.originalBytes)}</span></div>
</a>`;
}

const GALLERY_SCRIPT = `
const grid = document.getElementById('grid');
const form = document.getElementById('upload');
const input = document.getElementById('file');
const drop = document.getElementById('drop');
const msg = document.getElementById('msg');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
function render(img) {
  const label = img.status === 'processing' && img.error ? 'retrying (attempt ' + img.attempts + ')' : img.status;
  const thumb = img.status === 'ready' ? '<img src="/i/' + img.id + '/480.webp" alt="' + esc(img.originalName) + '">'
    : img.status === 'failed' ? '<span class="error">failed</span>' : '<div class="spinner"></div>';
  const bg = img.dominantColor ? 'background:' + esc(img.dominantColor) : '';
  return '<a class="card" href="/images/' + img.id + '" data-id="' + img.id + '" data-status="' + img.status + '">' +
    '<div class="thumb" style="' + bg + '">' + thumb + '</div><div class="meta"><div class="name">' + esc(img.originalName) + '</div>' +
    '<span class="badge ' + img.status + '">' + esc(label) + '</span> <span class="muted">' + fmt(img.originalBytes) + '</span></div></a>';
}
function upsert(img) {
  const existing = grid.querySelector('[data-id="' + img.id + '"]');
  const tmp = document.createElement('div'); tmp.innerHTML = render(img);
  if (existing) existing.replaceWith(tmp.firstChild); else grid.prepend(tmp.firstChild);
  document.getElementById('empty')?.remove();
}
async function poll() {
  const pending = [...grid.querySelectorAll('[data-status="queued"],[data-status="processing"]')].map((el) => el.dataset.id);
  if (pending.length) {
    try {
      const res = await fetch('/api/images/status?ids=' + pending.join(','));
      if (res.ok) (await res.json()).images.forEach(upsert);
    } catch {}
  }
  setTimeout(poll, 2000);
}
async function upload(files) {
  for (const file of files) {
    const body = new FormData(); body.append('image', file);
    msg.textContent = 'Uploading ' + file.name + '…'; msg.className = 'muted';
    try {
      const res = await fetch('/api/images', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok) { msg.textContent = file.name + ': ' + (data.error?.message ?? 'upload failed'); msg.className = 'error'; continue; }
      upsert(data.image); msg.textContent = 'Queued ' + file.name;
    } catch { msg.textContent = 'Network error'; msg.className = 'error'; }
  }
}
form.addEventListener('submit', (e) => { e.preventDefault(); if (input.files.length) upload(input.files); form.reset(); });
drop.addEventListener('click', () => input.click());
input.addEventListener('change', () => { if (input.files.length) upload(input.files); form.reset(); });
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); });
poll();
`;

/**
 * Gallery page with the upload form; pending cards are polled every 2 s.
 *
 * @param images - Recent images, newest first
 * @returns HTML document
 */
export function galleryPage(images: ImageSummary[]): string {
  const cards = images.length
    ? images.map(card).join('')
    : '<p id="empty" class="muted">No images yet. Upload one above.</p>';
  return layout(
    'Gallery',
    `<h1>Gallery</h1>
<div class="panel">
  <form id="upload" enctype="multipart/form-data" method="post" action="/api/images">
    <div id="drop" class="drop"><strong>Drop images here</strong> or click to choose<br><span class="muted">JPEG, PNG, WebP or AVIF · up to 8 MB</span></div>
    <input id="file" type="file" name="image" accept="image/jpeg,image/png,image/webp,image/avif" multiple hidden>
  </form>
  <p id="msg" class="muted" aria-live="polite"></p>
</div>
<div id="grid" class="grid">${cards}</div>`,
    GALLERY_SCRIPT,
  );
}

/**
 * Detail page: every variant with its byte size and savings versus the original.
 *
 * @param image - Image metadata
 * @param variants - Its variants (empty until processed)
 * @returns HTML document
 */
export function detailPage(image: ImageSummary, variants: VariantSummary[]): string {
  const pending = image.status === 'queued' || image.status === 'processing';
  const rows = variants
    .map((v) => {
      const saved = savingsPercent(image.originalBytes, v.bytes);
      return `<div class="panel variant">
  <strong>${v.size} px</strong> <span class="muted">${v.width}×${v.height} · ${formatBytes(v.bytes)} · ${
    saved >= 0 ? `${saved}% smaller` : `${-saved}% larger`
  } than the original</span>
  <a href="/i/${image.id}/${v.size}.webp"><img src="/i/${image.id}/${v.size}.webp" width="${v.width}" height="${v.height}" alt="${v.size}px variant" loading="lazy"></a>
</div>`;
    })
    .join('');
  const body = `<p><a href="/">← Gallery</a></p>
<h1>${escapeHtml(image.originalName)}</h1>
<div class="panel"><table>
<tr><th>Status</th><td><span class="badge ${image.status}">${escapeHtml(statusLabel(image))}</span></td></tr>
<tr><th>Original</th><td>${escapeHtml(image.mimeType)} · ${formatBytes(image.originalBytes)}${
    image.width ? ` · ${image.width}×${image.height}` : ''
  }</td></tr>
${image.dominantColor ? `<tr><th>Dominant colour</th><td><span class="swatch" style="background:${escapeHtml(image.dominantColor)}"></span> <code>${escapeHtml(image.dominantColor)}</code></td></tr>` : ''}
<tr><th>Uploaded</th><td>${image.createdAt.toISOString()}</td></tr>
<tr><th>Attempts</th><td>${image.attempts}</td></tr>
${image.error ? `<tr><th>${image.status === 'failed' ? 'Error' : 'Last error'}</th><td class="error">${escapeHtml(image.error)}</td></tr>` : ''}
</table><p class="muted">The original is kept privately and never served: it may contain EXIF/GPS data. Variants are auto-rotated and stripped of all metadata.</p></div>
${pending ? '<div class="panel"><div class="spinner"></div> Processing…</div>' : rows}`;
  const script = pending
    ? `const id=${JSON.stringify(image.id)};(async function poll(){try{const r=await fetch('/api/images/status?ids='+id);const d=await r.json();const s=d.images[0]?.status;if(s&&s!=='queued'&&s!=='processing'){location.reload();return;}}catch{}setTimeout(poll,2000);})();`
    : '';
  return layout(image.originalName, body, script);
}

/**
 * Queue statistics page (auto-refreshes every 5 s).
 *
 * @param counts - Current job counts
 * @param totals - Storage totals
 * @returns HTML document
 */
export function statusPage(
  counts: QueueCounts,
  totals: { images: number; originalBytes: number; variantBytes: number },
): string {
  const stat = (label: string, value: number | string) => `<div class="stat"><span class="muted">${label}</span><b>${value}</b></div>`;
  return layout(
    'Queue status',
    `<h1>Queue status</h1>
<div class="stats">${stat('Waiting', counts.waiting)}${stat('Active', counts.active)}${stat('Completed', counts.completed)}${stat('Failed', counts.failed)}${stat('Delayed (retries, scheduled)', counts.delayed)}</div>
<h1 style="margin-top:2rem">Storage</h1>
<div class="stats">${stat('Images', totals.images)}${stat('Originals', formatBytes(totals.originalBytes))}${stat('Variants', formatBytes(totals.variantBytes))}</div>
<p class="muted">Refreshes every 5 seconds. JSON: <a href="/api/status">/api/status</a></p>`,
    'setTimeout(() => location.reload(), 5000);',
  );
}

/**
 * Plain error page (never includes stack traces).
 *
 * @param status - HTTP status code
 * @param message - Human-readable message
 * @returns HTML document
 */
export function errorPage(status: number, message: string): string {
  return layout(`Error ${status}`, `<h1>${status}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back to the gallery</a></p>`);
}

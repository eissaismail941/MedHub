// MedHub Reader — custom UI on top of the stock PDF.js engine (build/pdf.mjs + build/pdf.worker.mjs).
const CFG = window.MEDHUB_READER_CONFIG || {};
const CSS_UNITS = 96 / 72, MIN_Z = 0.25, MAX_Z = 4, STEP = 0.1, FIT_MAX_PX = 1100, MAX_CANVAS_PX = 16e6;
const ROOT = new URL('../', import.meta.url);
const $ = (id) => document.getElementById(id);
const el = Object.fromEntries(['title','download','progress','viewer','pages','state','spinner','state-title','state-text','open','retry','toolbar','prev','next','page','count','zout','zin','fit','file','window','menubtn','menu','m-open','m-outline','m-outline-label','m-full','sidebar','side-title','side-list','scrim'].map(k => [k, $(k)]));

let srcUrl = null, pdfjs, doc, pdfBytesSource, pages = [], zoom = 1, fitMode = true, curPage = 1, token = 0, io, rerenderTimer, pumping = false, fileName = 'lecture.pdf', blobUrl;

// ---------- helpers ----------
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const showState = (title, text, { spinner = false, open = false, retry = false } = {}) => {
  el['state-title'].textContent = title; el['state-text'].textContent = text;
  el.spinner.hidden = !spinner; el.open.hidden = !open; el.retry.hidden = !retry; el.state.hidden = false;
};
const hideState = () => (el.state.hidden = true);
const setProgress = (f) => { el.progress.hidden = f == null; if (f != null) el.progress.firstElementChild.style.width = Math.round(f * 100) + '%'; };
const friendlyName = (s) => { try { s = decodeURIComponent(s); } catch {} return s.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim() || 'Lecture'; };

function resolveUrl(raw) {
  const u = new URL(raw, location.href); // handles relative paths, spaces and encoded characters
  if (!/^https?:$/.test(u.protocol) && u.protocol !== 'blob:') throw new Error('unsupported');
  const ok = u.origin === location.origin || u.protocol === 'blob:' || (CFG.allowedOrigins || []).includes(u.origin);
  if (!ok) throw new Error('origin');
  return u;
}

// ---------- loading ----------
async function boot() {
  showState('Preparing your reader…', '', { spinner: true });
  try { pdfjs = await import(new URL('build/pdf.mjs', ROOT).href); }
  catch { return showState("The reader couldn't start", 'The PDF.js engine files were not found. Check that medhub-reader.html sits next to the build/ folder.'); }
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('build/pdf.worker.mjs', ROOT).href;
  const q = new URLSearchParams(location.search);
  if (q.get('file')) return openUrl(q.get('file'), q.get('title'));
  showState('Open a lecture', 'Choose a PDF from your device, or drop one here.', { open: true });
}

async function openUrl(raw, title) {
  const my = ++token; reset();
  showState('Opening lecture…', '', { spinner: true }); setProgress(0.04);
  el.retry.onclick = () => openUrl(raw, title);
  let url;
  try { url = resolveUrl(raw); } catch (e) {
    setProgress(null);
    return showState("We can't open that link", e.message === 'origin' ? 'This file lives on a different site that the reader is not allowed to load from.' : 'The file address looks invalid.', { open: true });
  }
  srcUrl = url.href;
  fileName = decodeURIComponent(url.pathname.split('/').pop() || 'lecture.pdf');
  el.title.textContent = title || friendlyName(fileName);
  document.title = el.title.textContent + ' · MedHub';
  let headers; try { headers = CFG.getHeaders ? await CFG.getHeaders() : undefined; } catch { headers = undefined; }
  load({ url: url.href, httpHeaders: headers, withCredentials: !!CFG.withCredentials }, my, true);
}

async function openLocal(file) {
  if (!file) return;
  const my = ++token; reset();
  if (file.type && file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) return showState('That is not a PDF', 'Please choose a file ending in .pdf.', { open: true });
  srcUrl = null; fileName = file.name; el.title.textContent = friendlyName(file.name); document.title = el.title.textContent + ' · MedHub';
  showState('Opening lecture…', '', { spinner: true }); setProgress(0.04);
  load({ data: new Uint8Array(await file.arrayBuffer()) }, my, false);
}

async function load(src, my, retryable) {
  const base = { cMapUrl: new URL('web/cmaps/', ROOT).href, cMapPacked: true, standardFontDataUrl: new URL('web/standard_fonts/', ROOT).href, wasmUrl: new URL('web/wasm/', ROOT).href, iccUrl: new URL('web/iccs/', ROOT).href, enableXfa: false, isEvalSupported: false };
  const task = pdfjs.getDocument({ ...base, ...src });
  task.onProgress = ({ loaded, total }) => { if (my === token && total) setProgress(0.04 + 0.9 * loaded / total); };
  try {
    const d = await task.promise; if (my !== token) return d.destroy();
    doc = d; await build(); hideState(); setProgress(null);
  } catch (e) {
    if (my !== token) return; setProgress(null);
    const n = e?.name || '';
    const msg = n === 'PasswordException' ? 'This lecture is password-protected, which the reader cannot open.'
      : n === 'InvalidPDFException' ? 'This file does not look like a valid PDF.'
      : n === 'MissingPDFException' ? 'We could not find this lecture. It may have been moved or removed.'
      : (n === 'UnexpectedResponseException' && (e.status === 401 || e.status === 403)) ? 'You do not have access to this lecture. Please sign in again.'
      : 'Something went wrong while loading. Check your connection and try again.';
    showState("This lecture couldn't open", msg, { open: true, retry: retryable });
  }
}

function reset() {
  clearTimeout(rerenderTimer); io?.disconnect(); pages.forEach(p => p.task?.cancel()); pages = []; el.pages.replaceChildren();
  doc?.destroy(); doc = null; el['side-list'].replaceChildren(); setSide(false); el.toolbar.hidden = true; el.download.disabled = true; curPage = 1; hideState();
}

// ---------- layout ----------
async function build() {
  const first = await doc.getPage(1), v = first.getViewport({ scale: 1 });
  const frag = document.createDocumentFragment();
  io = new IntersectionObserver(onIntersect, { root: el.viewer, rootMargin: '150% 0px' });
  for (let n = 1; n <= doc.numPages; n++) {
    const d = document.createElement('div'); d.className = 'page'; d.dataset.n = n;
    d.style.setProperty('--w', v.width); d.style.setProperty('--h', v.height);
    const p = { n, el: d, w: v.width, h: v.height, want: false, scale: 0, task: null, busy: false };
    pages.push(p); frag.appendChild(d); io.observe(d);
  }
  el.pages.appendChild(frag);
  el.count.textContent = doc.numPages; el.page.value = 1; el.toolbar.hidden = false; el.download.disabled = false;
  fitMode = true; setZoom(fitZoom(), true); buildSidebar();
}

const fitZoom = () => {
  const cs = getComputedStyle(el.viewer), avail = el.viewer.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  return clamp(Math.min(avail, FIT_MAX_PX) / (pages[0].w * CSS_UNITS), MIN_Z, MAX_Z);
};

function setZoom(z, instant) {
  z = clamp(z, MIN_Z, MAX_Z);
  const p = pages[curPage - 1], r = p ? (el.viewer.scrollTop - p.el.offsetTop) / p.el.offsetHeight : 0;
  zoom = z; el.pages.style.setProperty('--s', z * CSS_UNITS);
  if (p && !instant) el.viewer.scrollTop = p.el.offsetTop + r * p.el.offsetHeight;
  clearTimeout(rerenderTimer); rerenderTimer = setTimeout(pump, instant ? 0 : 140);
}

const zoomBy = (d) => { fitMode = false; setZoom(Math.round((zoom + d) * 10) / 10); };
const fitWidth = () => { fitMode = true; setZoom(fitZoom()); };

// ---------- virtualized rendering ----------
function onIntersect(entries) {
  for (const e of entries) {
    const p = pages[e.target.dataset.n - 1];
    p.want = e.isIntersecting;
    if (!e.isIntersecting && p.scale) release(p);
  }
  pump();
}

function release(p) {
  p.task?.cancel(); p.task = null;
  p.el.querySelectorAll('canvas').forEach(c => { c.width = c.height = 0; }); // free GPU/RAM immediately
  p.el.replaceChildren(); p.scale = 0;
}

async function pump() {
  if (pumping || !doc) return; pumping = true; const my = token;
  try {
    for (;;) {
      const next = pages.filter(p => p.want && p.scale !== zoom).sort((a, b) => Math.abs(a.n - curPage) - Math.abs(b.n - curPage))[0];
      if (!next || my !== token) break;
      await renderPage(next, my);
    }
  } finally { pumping = false; }
}

async function renderPage(p, my) {
  const scaleAtStart = zoom; p.busy = true;
  try {
    const page = await doc.getPage(p.n), v1 = page.getViewport({ scale: 1 });
    if (Math.abs(v1.width - p.w) > 1 || Math.abs(v1.height - p.h) > 1) { p.w = v1.width; p.h = v1.height; p.el.style.setProperty('--w', p.w); p.el.style.setProperty('--h', p.h); }
    const css = scaleAtStart * CSS_UNITS;
    let out = css * Math.min(window.devicePixelRatio || 1, 3);
    const px = v1.width * v1.height * out * out; if (px > MAX_CANVAS_PX) out *= Math.sqrt(MAX_CANVAS_PX / px);
    const vp = page.getViewport({ scale: out });
    const canvas = document.createElement('canvas'); canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
    p.task = page.render({ canvas, viewport: vp });
    await p.task.promise;
    const text = document.createElement('div'); text.className = 'textLayer'; text.style.setProperty('--total-scale-factor', css);
    p.el.replaceChildren(canvas, text); p.scale = scaleAtStart;
    try { await new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport: page.getViewport({ scale: css }) }).render(); } catch {}
    page.cleanup();
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException' && my === token) p.scale = scaleAtStart; // avoid retry loops on a broken page
  } finally { p.task = null; p.busy = false; }
}

// ---------- navigation ----------
function updateCurrent() {
  if (!pages.length) return;
  const y = el.viewer.scrollTop + el.viewer.clientHeight * 0.3; let lo = 0, hi = pages.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; pages[m].el.offsetTop <= y ? lo = m : hi = m - 1; }
  if (lo + 1 !== curPage) { curPage = lo + 1; if (document.activeElement !== el.page) el.page.value = curPage; }
  const on = el['side-list'].querySelector('.item.on'); if (on) on.classList.remove('on');
  el['side-list'].querySelector(`[data-n="${curPage}"]`)?.classList.add('on');
  el.prev.disabled = curPage <= 1; el.next.disabled = curPage >= pages.length;
}
const goTo = (n, smooth = true) => {
  n = clamp(Math.round(n) || 1, 1, pages.length); const p = pages[n - 1]; if (!p) return;
  el.viewer.scrollTo({ top: p.el.offsetTop - parseFloat(getComputedStyle(el.viewer).paddingTop) + 12, behavior: smooth && !matchMedia('(prefers-reduced-motion:reduce)').matches ? 'smooth' : 'auto' });
  el.page.value = n;
};
let ticking = false;
el.viewer.addEventListener('scroll', () => { if (ticking) return; ticking = true; requestAnimationFrame(() => { ticking = false; updateCurrent(); }); }, { passive: true });

// ---------- controls ----------
el.prev.onclick = () => goTo(curPage - 1); el.next.onclick = () => goTo(curPage + 1);
el.zin.onclick = () => zoomBy(STEP); el.zout.onclick = () => zoomBy(-STEP);
el.fit.onclick = fitWidth;
el.page.addEventListener('focus', () => el.page.select());
el.page.addEventListener('keydown', (e) => { if (e.key === 'Enter') { goTo(+el.page.value, false); el.page.blur(); } if (e.key === 'Escape') { el.page.value = curPage; el.page.blur(); } });
el.page.addEventListener('blur', () => { el.page.value = curPage; });
el.open.onclick = () => el.file.click();
el.file.onchange = () => { openLocal(el.file.files[0]); el.file.value = ''; };

el.download.onclick = async () => {
  if (!doc) return;
  try {
    const data = await doc.getData(); // original, unmodified bytes
    const url = URL.createObjectURL(new Blob([data], { type: 'application/pdf' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: /\.pdf$/i.test(fileName) ? fileName : fileName + '.pdf' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { /* ignore: the doc may have been replaced mid-click */ }
};

const small = () => matchMedia('(max-width:820px)').matches;
const setSide = (on) => { el.window.classList.toggle('side-open', on); el['m-outline-label'].textContent = on ? 'Hide outline' : 'Show outline'; };
const closeMenu = () => { el.menu.hidden = true; el.menubtn.setAttribute('aria-expanded', 'false'); };
el.menubtn.onclick = (e) => { e.stopPropagation(); const open = el.menu.hidden; el.menu.hidden = !open; el.menubtn.setAttribute('aria-expanded', open); };
addEventListener('click', (e) => { if (!el.menu.contains(e.target)) closeMenu(); });
el.scrim.onclick = () => setSide(false);
el['m-outline'].onclick = () => { closeMenu(); setSide(!el.window.classList.contains('side-open')); };

async function buildSidebar() {
  const list = el['side-list'], my = token; list.replaceChildren();
  let outline = null; try { outline = await doc.getOutline(); } catch {}
  if (my !== token) return;
  const mk = (label, depth, go) => { const b = document.createElement('button'); b.className = 'item'; b.style.setProperty('--d', depth); b.textContent = label; if (go) b.onclick = () => { go(); if (small()) setSide(false); }; else b.disabled = true; list.appendChild(b); return b; };
  const hasOutline = !!outline?.length;
  el['side-title'].textContent = hasOutline ? 'Outline' : 'Pages';
  if (hasOutline) {
    const walk = (items, d) => items.forEach(it => { mk(it.title || 'Untitled', Math.min(d, 3), it.dest ? () => goDest(it.dest) : null); if (it.items?.length) walk(it.items, d + 1); });
    walk(outline, 0);
  } else pages.forEach(p => { mk('Page ' + p.n, 0, () => goTo(p.n)).dataset.n = p.n; });
  setSide(hasOutline && !small());
  updateCurrent();
}
async function goDest(dest) {
  try {
    const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest; if (!d) return;
    goTo((typeof d[0] === 'object' ? await doc.getPageIndex(d[0]) : d[0]) + 1);
  } catch {}
}

el['m-open'].onclick = async () => {
  closeMenu(); if (!doc) return;
  if (srcUrl && !CFG.getHeaders) return void window.open(srcUrl, '_blank', 'noopener'); // original URL, native browser viewer
  const w = window.open('about:blank', '_blank'); // local or token-protected file: open the loaded bytes, not a bare URL
  try { const u = URL.createObjectURL(new Blob([await doc.getData()], { type: 'application/pdf' })); if (w) w.location = u; setTimeout(() => URL.revokeObjectURL(u), 120000); } catch { w?.close(); }
};

const fsEl = document.documentElement, canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
el['m-full'].hidden = !canFs; // iPhone Safari has no element fullscreen
el['m-full'].onclick = () => {
  closeMenu(); const on = document.fullscreenElement || document.webkitFullscreenElement;
  if (on) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
};

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeMenu(); if (small()) setSide(false); }
  if (!doc || e.target === el.page || e.metaKey || e.altKey) return;
  const k = e.key;
  if (e.ctrlKey && (k === '+' || k === '=')) { e.preventDefault(); zoomBy(STEP); }
  else if (e.ctrlKey && k === '-') { e.preventDefault(); zoomBy(-STEP); }
  else if (e.ctrlKey && k === '0') { e.preventDefault(); fitWidth(); }
  else if (!e.ctrlKey && (k === 'ArrowRight' || k === 'PageDown')) { if (k === 'PageDown') return; goTo(curPage + 1); }
  else if (!e.ctrlKey && k === 'ArrowLeft') goTo(curPage - 1);
  else if (k === 'Home') { e.preventDefault(); goTo(1); } else if (k === 'End') { e.preventDefault(); goTo(pages.length); }
});
el.viewer.addEventListener('wheel', (e) => { if (e.ctrlKey && doc) { e.preventDefault(); zoomBy(e.deltaY < 0 ? STEP / 2 : -STEP / 2); } }, { passive: false });

let rw = innerWidth;
new ResizeObserver(() => { if (doc && fitMode && Math.abs(el.viewer.clientWidth - rw) > 1) setZoom(fitZoom()); rw = el.viewer.clientWidth; }).observe(el.viewer);

// drag & drop a local PDF
['dragenter', 'dragover'].forEach(t => addEventListener(t, (e) => { e.preventDefault(); document.body.classList.add('drag'); }));
['dragleave', 'drop'].forEach(t => addEventListener(t, (e) => { e.preventDefault(); document.body.classList.remove('drag'); }));
addEventListener('drop', (e) => openLocal(e.dataTransfer.files[0]));

boot();

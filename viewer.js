/* MedHub PDF viewer — renders lectures inside viewer.html with PDF.js.
   Lecture ids:  f.<path-without-.pdf>   repo PDF   (e.g. f.terminology-01)
                 u.<record id>           admin upload, looked up in Supabase (stable across replacements)
                 s.<base64url(url)>      admin upload whose record id was not available (fallback) */
const cfg = window.MEDHUB_VIEWER_CONFIG || {};
const SB = cfg.supabase || {};
const $ = id => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const BASE = new URL('./', location.href);           // works in a GitHub Pages subfolder and on a custom domain
const MAXPX = 12e6;                                  // stays under the iOS canvas limit (16.7M)
const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

class ViewerError extends Error {
  constructor(title, message, opts = {}) { super(message); this.title = title; this.canOpenOriginal = !!opts.orig; this.noRetry = !!opts.noRetry; }
}

/* ───────── helpers ───────── */
const cleanText = s => String(s || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
const prettify = p => { let n = p.split('/').pop(); try { n = decodeURIComponent(n); } catch {} return cleanText(n.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' ')) || 'Lecture'; };
const fileSafe = s => (cleanText(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'lecture') + '.pdf';
const b64urlDecode = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0))); };

/* Only same-origin PDFs and storage URLs on YOUR configured Supabase project are accepted. */
function validate(raw) {
  let u; try { u = new URL(raw, BASE); } catch { return null; }
  const local = ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.origin === location.origin) return /\.pdf$/i.test(u.pathname) ? u.href : null;
  let sb = null; try { sb = SB.url ? new URL(SB.url) : null; } catch {}
  if (sb && u.host === sb.host && u.pathname.startsWith('/storage/v1/object/')) return u.href;
  return null;
}
const readCache = id => { try { return JSON.parse(sessionStorage.getItem('medhub:lec:' + id)) || null; } catch { return null; } };

/* ───────── resolve lecture id → { url, title, kind, dl } ───────── */
async function resolve() {
  const id = qs.get('lecture') || '';
  if (!id) throw new ViewerError('No lecture selected', 'This link is missing its lecture. Go back to the lecture list and open the PDF again.', { noRetry: true });
  const cache = readCache(id) || {};
  const kind = id.slice(0, 2), body = id.slice(2);
  const bad = () => new ViewerError('This link isn’t valid', 'The lecture link looks damaged or points to a file MedHub doesn’t host. Open the lecture again from the list.', { noRetry: true });

  if (kind === 'f.') {
    if (!body || body.startsWith('/') || /[\\:?#]/.test(body) || body.split('/').some(s => !s || s === '.' || s === '..')) throw bad();
    const url = validate(new URL(body.split('/').map(encodeURIComponent).join('/') + '.pdf', BASE).href);
    if (!url) throw bad();
    const title = cleanText(qs.get('t')) || cleanText(cache.title) || prettify(body);
    return { id, url, title, kind: 'repo', dl: cache.dl || fileSafe(title) };
  }

  if (kind === 'u.') {
    let row = null;
    if (SB.url && SB.anonKey && SB.table) {
      try {
        const cols = [SB.idColumn || 'id', SB.titleColumn, SB.urlColumn, SB.pathColumn, SB.versionColumn].filter(Boolean).join(',');
        const r = await fetch(`${SB.url.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(SB.table)}?select=${encodeURIComponent(cols)}&${encodeURIComponent(SB.idColumn || 'id')}=eq.${encodeURIComponent(body)}&limit=1`,
          {
  headers: {
    apikey: SB.anonKey,
    Accept: "application/json"
  }
});
        if (r.ok) { row = (await r.json())[0] || null; if (!row) throw new ViewerError('Lecture not found', 'This lecture was removed or the link is outdated. Go back to the list to find the current version.', { noRetry: true }); }
        else if (!cache.url) throw new ViewerError('Couldn’t look up this lecture', `The lecture database answered with status ${r.status}. Try again in a moment.`);
      } catch (e) { if (e instanceof ViewerError) throw e; if (!cache.url) throw e; }
    }
    let raw = '';
    if (row) {
      if (SB.urlColumn && row[SB.urlColumn]) raw = row[SB.urlColumn];
      else if (SB.pathColumn && SB.bucket && row[SB.pathColumn]) raw = `${SB.url.replace(/\/$/, '')}/storage/v1/object/public/${encodeURIComponent(SB.bucket)}/${String(row[SB.pathColumn]).split('/').map(encodeURIComponent).join('/')}`;
      if (raw && SB.versionColumn && row[SB.versionColumn]) { const v = new URL(raw); v.searchParams.set('v', String(row[SB.versionColumn]).slice(0, 40)); raw = v.href; }
    } else raw = cache.url || '';
    if (!raw) throw new ViewerError('Viewer isn’t connected to storage yet', 'Uploaded lectures need the Supabase values in viewer-config.js. Ask the site admin to finish the setup.', { noRetry: true });
    const url = validate(raw); if (!url) throw bad();
    const title = cleanText(row && row[SB.titleColumn]) || cleanText(cache.title) || cleanText(qs.get('t')) || 'Lecture';
    return { id, url, title, kind: 'supabase', dl: cache.dl || fileSafe(title) };
  }

  if (kind === 's.') {
    let raw = ''; try { raw = b64urlDecode(body); } catch {}
    const url = validate(raw); if (!url) throw bad();
    const title = cleanText(cache.title) || cleanText(qs.get('t')) || prettify(new URL(url).pathname);
    return { id, url, title, kind: 'supabase', dl: cache.dl || fileSafe(title) };
  }
  throw bad();
}

/* ───────── UI state ───────── */
let meta = null, lib = null, task = null, doc = null, pwUpdate = null;
let n = 0, W = [], H = [], els = [], S = [], offs = [], cur = 0, zoom = 1, lastW = 0, ts = 1;
let textMode = false, textBuilt = false, textBusy = false, busy = false, raf = 0;
const main = $('main'), pagesEl = $('pages'), textEl = $('text');

function show(which) { ['stLoad', 'stErr', 'stPw'].forEach(k => $(k).hidden = k !== which); }
function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }
function announce(msg) { $('live').textContent = ''; setTimeout(() => $('live').textContent = msg, 30); }
function progress(pct, msg) { const p = $('prog'); p.classList.toggle('indet', pct == null); p.firstElementChild.style.width = pct == null ? '' : pct + '%'; if (msg) $('loadMsg').textContent = msg; }

function showError(e) {
  const c = classify(e);
  $('errTitle').textContent = c.title; $('errMsg').textContent = c.msg;
  $('btnRetry').hidden = c.noRetry;
  const o = $('errOrig'); o.hidden = !(c.orig && meta); if (meta) o.href = meta.url;
  show('stErr');
}
function classify(e) {
  if (e instanceof ViewerError) return { title: e.title, msg: e.message, orig: e.canOpenOriginal, noRetry: e.noRetry };
  const name = e && e.name, st = e && e.status;
  if (navigator.onLine === false) return { title: 'You’re offline', msg: 'Connect to the internet and try again.', orig: false };
  if (name === 'MissingPDFException' || st === 404) return { title: 'Lecture file not found', msg: 'The PDF is missing from the server. It may have been moved or removed. Go back and open it again, or tell your course admin if it keeps happening.', orig: true };
  if (name === 'InvalidPDFException') return { title: 'This file can’t be read', msg: 'The file isn’t a valid PDF or is damaged. Try downloading it instead.', orig: true };
  if (st === 401 || st === 403) return { title: 'Access was refused', msg: 'The server refused to share this file. The link may have expired or the lecture may be private.', orig: true };
  if (name === 'UnexpectedResponseException') return { title: 'The server had a problem', msg: `The server answered with status ${st || 'unknown'}. Try again in a moment.`, orig: true };
  return { title: 'Couldn’t open this lecture', msg: 'The connection may have dropped, or the file is too large for this device. Check your connection and try again.', orig: true };
}

/* ───────── load ───────── */
async function loadEngine() {
  if (lib) return lib;
  const base = new URL(cfg.pdfjsBase || 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/build/', location.href).href;
  try {
    lib = await import(base + 'pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  } catch (e) { throw new ViewerError('Couldn’t load the PDF engine', 'Check your connection and try again.'); }
  return lib;
}

async function start() {
  teardown(); show('stLoad'); progress(null, 'Preparing the viewer…');
  try {
    meta = await resolve();
    $('title').textContent = meta.title; document.title = meta.title + ' | MedHub';
    $('origLink').href = $('errOrig').href = meta.url;
    $('btnCopy').disabled = $('btnDownload').disabled = false;
    await loadEngine();
    progress(null, 'Downloading lecture…');
    task = lib.getDocument({ url: meta.url, isEvalSupported: false, withCredentials: false });
    task.onProgress = ({ loaded, total }) => {
      if (total > 0) progress(Math.min(99, Math.round(loaded / total * 100)), `Downloading lecture… ${Math.round(loaded / total * 100)}% (${(loaded / 1048576).toFixed(1)} of ${(total / 1048576).toFixed(1)} MB)`);
      else progress(null, `Downloading lecture… ${(loaded / 1048576).toFixed(1)} MB`);
    };
    task.onPassword = (update, reason) => { pwUpdate = update; $('pwErr').hidden = reason !== 2; $('pwIn').value = ''; show('stPw'); $('pwIn').focus(); };
    doc = await task.promise;
    await buildPages();
    show(null);
    $('stLoad').hidden = $('stErr').hidden = $('stPw').hidden = true;
    announce(`Lecture loaded, ${n} pages.`);
  } catch (e) { console.error('[MedHub viewer]', e); showError(e); }
}

function teardown() {
  for (let i = 0; i < S.length; i++) release(i);
  try { task && task.destroy(); } catch {}
  task = doc = null; pagesEl.textContent = ''; textEl.textContent = ''; textBuilt = false; textBusy = false;
  n = 0; W = []; H = []; els = []; S = []; offs = [];
}

async function buildPages() {
  n = doc.numPages;
  const p1 = await doc.getPage(1), vp = p1.getViewport({ scale: 1 }); p1.cleanup();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    W[i] = vp.width; H[i] = vp.height; S[i] = null;
    const d = document.createElement('div'); d.className = 'page'; d.dataset.page = i + 1;
    d.innerHTML = '<span class="num" aria-hidden="true"></span>'; d.firstChild.textContent = i + 1;
    els.push(d); frag.append(d);
  }
  pagesEl.append(frag);
  $('total').textContent = n; $('pageIn').max = n; $('pageIn').disabled = false;
  lastW = main.clientWidth; relayout(); main.scrollTop = 0; update();
}

/* ───────── layout & windowed rendering ───────── */
const fitW = () => Math.max(200, Math.min(main.clientWidth - (innerWidth < 720 ? 32 : 64), 1100));
const pscale = i => fitW() / W[i] * zoom;
function find(y) { let lo = 0, hi = n - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (offs[m] <= y) lo = m; else hi = m - 1; } return lo; }
function measure() { for (let i = 0; i < n; i++) offs[i] = els[i].offsetTop; }

function relayout() {
  if (!n) return;
  const a = cur, frac = offs[a] != null && H[a] ? (main.scrollTop - offs[a]) / (H[a] * pscale(a)) : 0;
  for (let i = 0; i < n; i++) { release(i); els[i].style.width = Math.round(W[i] * pscale(i)) + 'px'; els[i].style.height = Math.round(H[i] * pscale(i)) + 'px'; }
  measure();
  main.scrollTop = offs[a] + frac * H[a] * pscale(a);
  $('zVal').textContent = Math.round(zoom * 100) + '%';
  update();
}

function release(i) {
  const e = S[i]; if (!e) return;
  try { e.task && e.task.cancel(); } catch {}
  if (e.canvas) { e.canvas.width = e.canvas.height = 0; e.canvas.remove(); }
  S[i] = null; if (els[i]) els[i].classList.remove('ready');
}

function update() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    if (!n) return;
    if (textMode) {
      const secs = textEl.children, y = main.scrollTop + main.clientHeight * 0.3; let c = 0;
      for (let i = 0; i < secs.length; i++) { if (secs[i].offsetTop <= y) c = i; else break; }
      if (secs.length) setCur(c); return;
    }
    const st = main.scrollTop, vh = main.clientHeight, m = vh * (innerWidth < 720 ? 0.75 : 1);
    setCur(find(st + vh * 0.3));
    const lo = find(st - m), hi = find(st + vh + m);
    for (let i = 0; i < n; i++) if ((i < lo - 2 || i > hi + 2) && S[i]) release(i);
    win = [lo, hi]; pump();
  });
}
let win = [0, 0];
function setCur(i) { if (i === cur && $('pageIn').value) { if (document.activeElement !== $('pageIn')) $('pageIn').value = i + 1; } cur = i; if (document.activeElement !== $('pageIn')) $('pageIn').value = i + 1; $('prev').disabled = i <= 0; $('next').disabled = i >= n - 1; }

async function pump() {
  if (busy) return; busy = true;
  try {
    for (;;) {
      let next = -1, best = 1e9;
      for (let i = win[0]; i <= win[1]; i++) if (!S[i] && Math.abs(i - cur) < best) { best = Math.abs(i - cur); next = i; }
      if (next < 0) break;
      await renderPage(next);
    }
  } finally { busy = false; }
}

async function renderPage(i) {
  const entry = S[i] = { canvas: null, task: null };
  try {
    const p = await doc.getPage(i + 1);
    if (S[i] !== entry) return;
    const v1 = p.getViewport({ scale: 1 });
    if (Math.abs(v1.width - W[i]) > 0.5 || Math.abs(v1.height - H[i]) > 0.5) fixSize(i, v1.width, v1.height);
    const vp = p.getViewport({ scale: pscale(i) });
    let ratio = Math.min(devicePixelRatio || 1, 2.5);
    if (vp.width * vp.height * ratio * ratio > MAXPX) ratio = Math.sqrt(MAXPX / (vp.width * vp.height));
    const c = document.createElement('canvas');
    c.width = Math.floor(vp.width * ratio); c.height = Math.floor(vp.height * ratio);
    c.setAttribute('role', 'img'); c.setAttribute('aria-label', `Page ${i + 1} of ${n}`);
    entry.canvas = c;
    entry.task = p.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : null });
    await entry.task.promise;
    if (S[i] !== entry) return;
    els[i].append(c); els[i].classList.add('ready'); p.cleanup();
  } catch (e) {
    if (e && e.name === 'RenderingCancelledException') return;
    console.warn('[MedHub viewer] page', i + 1, e);
    if (S[i] === entry) S[i] = { failed: true };           // not retried until the next zoom/resize
  }
}

function fixSize(i, w, h) {
  const oldH = parseFloat(els[i].style.height) || 0; W[i] = w; H[i] = h;
  els[i].style.width = Math.round(w * pscale(i)) + 'px'; els[i].style.height = Math.round(h * pscale(i)) + 'px';
  const d = parseFloat(els[i].style.height) - oldH; measure();
  if (i < cur && d) main.scrollTop += d;
}

/* ───────── controls ───────── */
function setZoom(z) {
  if (textMode) { ts = Math.min(2, Math.max(0.8, Math.round(z * 10) / 10)); textEl.style.setProperty('--ts', ts); $('zVal').textContent = Math.round(ts * 100) + '%'; return; }
  zoom = Math.min(4, Math.max(0.5, z)); relayout();
}
const stepZoom = dir => { if (textMode) return setZoom(ts + dir * 0.1); const z = dir > 0 ? STEPS.find(s => s > zoom + 0.01) : [...STEPS].reverse().find(s => s < zoom - 0.01); if (z) setZoom(z); };

function goTo(p) {
  if (!n) return; p = Math.min(n, Math.max(1, Math.round(p) || 1));
  if (textMode) { const s = $('tp-' + p); if (s) s.scrollIntoView({ block: 'start' }); }
  else main.scrollTo({ top: offs[p - 1] - 8, behavior: reduceMotion || Math.abs(p - 1 - cur) > 12 ? 'auto' : 'smooth' });
  announce(`Page ${p} of ${n}`);
}

async function buildText() {
  if (textBuilt || textBusy) return; textBusy = true;
  const prog = document.createElement('div'); prog.id = 'textprog'; textEl.after(prog);
  try {
    for (let i = 1; i <= n && doc; i++) {
      prog.textContent = `Preparing text… ${i} of ${n}`;
      const p = await doc.getPage(i), tc = await p.getTextContent(); p.cleanup();
      const paras = []; let buf = '', lastY = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const y = it.transform[5], h = it.height || 10;
        if (lastY !== null && Math.abs(lastY - y) > h * 1.9 && buf.trim()) { paras.push(buf.trim()); buf = ''; }
        buf += it.str + (it.hasEOL ? ' ' : ''); if (it.str.trim()) lastY = y;
      }
      if (buf.trim()) paras.push(buf.trim());
      const s = document.createElement('section'); s.id = 'tp-' + i; s.setAttribute('aria-label', 'Page ' + i);
      const h2 = document.createElement('h2'); h2.textContent = 'Page ' + i; s.append(h2);
      if (!paras.length) { const q = document.createElement('p'); q.className = 'empty'; q.textContent = 'No selectable text on this page. It may contain only an image. Switch back to the page view to read it.'; s.append(q); }
      paras.forEach(t => { const q = document.createElement('p'); q.dir = 'auto'; q.textContent = t; s.append(q); });
      textEl.append(s);
      if (i % 4 === 0) await new Promise(r => setTimeout(r));
    }
    textBuilt = true;
  } catch (e) { console.warn('[MedHub viewer] text view', e); }
  prog.remove(); textBusy = false;
}

function toggleText() {
  if (!n) return; const page = cur + 1; textMode = !textMode;
  $('btnText').setAttribute('aria-pressed', textMode); $('btnText').querySelector('.lbl').textContent = textMode ? 'Page view' : 'Text view';
  $('btnText').setAttribute('aria-label', textMode ? 'Switch to page view' : 'Switch to text reading view');
  $('zIn').setAttribute('aria-label', textMode ? 'Larger text' : 'Zoom in'); $('zOut').setAttribute('aria-label', textMode ? 'Smaller text' : 'Zoom out');
  $('zFit').hidden = textMode; pagesEl.hidden = textMode; textEl.hidden = !textMode;
  $('zVal').textContent = Math.round((textMode ? ts : zoom) * 100) + '%';
  if (textMode) { buildText(); setTimeout(() => goTo(page), 60); } else { measure(); setTimeout(() => { goTo(page); update(); }, 0); }
}

function download() {
  let href = meta.url; const a = document.createElement('a');
  if (meta.kind === 'supabase') { const u = new URL(href); u.searchParams.set('download', meta.dl); href = u.href; } else a.download = meta.dl;
  a.href = href; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove(); toast('Download started');
}

async function copyLink() {
  const u = new URL(location.href); u.search = ''; u.hash = ''; u.searchParams.set('lecture', meta.id);
  if (meta.kind === 'repo') u.searchParams.set('t', meta.title);
  const text = u.href;
  try { await navigator.clipboard.writeText(text); toast('Lecture link copied'); }
  catch {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.append(t); t.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch {} t.remove();
    if (ok) toast('Lecture link copied'); else window.prompt('Copy this lecture link:', text);
  }
}

function back() {
  let ref = null; try { ref = document.referrer ? new URL(document.referrer) : null; } catch {}
  if (ref && ref.origin === location.origin && !/viewer\.html$/i.test(ref.pathname) && history.length > 1) { history.back(); return; }
  const u = new URL('./', location.href); if (qs.get('from')) u.searchParams.set('subject', qs.get('from'));
  location.href = u.href;
}

/* ───────── wiring ───────── */
$('btnBack').onclick = $('errBack').onclick = back;
$('btnRetry').onclick = () => { meta = null; start(); };
$('btnCopy').onclick = copyLink; $('btnDownload').onclick = download;
$('prev').onclick = () => goTo(cur); $('next').onclick = () => goTo(cur + 2);
$('zIn').onclick = () => stepZoom(1); $('zOut').onclick = () => stepZoom(-1); $('zFit').onclick = () => setZoom(1);
$('btnText').onclick = toggleText;
$('pageIn').addEventListener('change', e => goTo(e.target.value));
$('pageIn').addEventListener('focus', e => e.target.select());
$('pwForm').addEventListener('submit', e => { e.preventDefault(); if (pwUpdate) { show('stLoad'); progress(null, 'Unlocking…'); pwUpdate($('pwIn').value); } });
main.addEventListener('scroll', update, { passive: true });

const info = $('info'), btnInfo = $('btnInfo');
const setInfo = open => { info.hidden = !open; btnInfo.setAttribute('aria-expanded', open); };
btnInfo.onclick = e => { e.stopPropagation(); setInfo(info.hidden); };
document.addEventListener('click', e => { if (!info.hidden && !info.contains(e.target)) setInfo(false); });

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey || (e.target.matches && e.target.matches('input,textarea,select'))) return;
  const k = e.key, zoomed = !textMode && zoom > 1.01;
  if (k === 'Escape') { setInfo(false); return; }
  if (!n) return;
  if (k === 'ArrowRight' && !zoomed) { e.preventDefault(); goTo(cur + 2); }
  else if (k === 'ArrowLeft' && !zoomed) { e.preventDefault(); goTo(cur); }
  else if (k === '+' || k === '=') { e.preventDefault(); stepZoom(1); }
  else if (k === '-') { e.preventDefault(); stepZoom(-1); }
  else if (k === '0') { e.preventDefault(); textMode ? setZoom(1) : setZoom(1); }
  else if (k === 'Home' && e.target === document.body) { e.preventDefault(); goTo(1); }
  else if (k === 'End' && e.target === document.body) { e.preventDefault(); goTo(n); }
});

let rt; new ResizeObserver(() => {
  clearTimeout(rt); rt = setTimeout(() => { if (!n) return; const w = main.clientWidth; if (Math.abs(w - lastW) > 1) { lastW = w; relayout(); } else update(); }, 150);
}).observe(main);

addEventListener("pagehide", event => {
  if (!event.persisted) {
    teardown();
  }
});
start();

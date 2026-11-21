

const $ = id => document.getElementById(id);
const state = {
  pdfBytes: null,      // ArrayBuffer of original pdf
  pdfDoc: null,        // pdf.js doc
  pageNum: 1,
  numPages: 0,
  sigs: [],            // {id, name, orig(canvas), canvas(processed), url}
  activeSig: null,     // id of selected signature
  nextSigId: 1,
  selected: null,
  placements: [],      // {page, fx, fy, fw, fh} fractions, top-left origin
  renderTask: null
};

window.addEventListener('load', () => {
  if (typeof pdfjsLib === 'undefined' || typeof PDFLib === 'undefined')
    setStatus('The PDF engine failed to load. Check your connection and reload the page.', 'err');
});
function setStatus(msg, cls) { const s = $('status'); s.textContent = msg || ''; s.className = cls || ''; }

function refreshUI() {
  $('dlBtn').disabled = !(state.pdfBytes && state.placements.length);
  $('undoBtn').disabled = $('clearBtn').disabled = !state.placements.length;
  $('smallerBtn').disabled = $('biggerBtn').disabled = !(state.selected && state.placements.includes(state.selected));
  $('countInfo').textContent = state.placements.length ? `${state.placements.length} signature(s) placed.` : '';
}

/* ---------- PDF load & render ---------- */
$('pdfInput').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    setStatus('');
    state.pdfBytes = await f.arrayBuffer();
    // pdf.js transfers/detaches buffers, so give it a copy
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice(0) }).promise;
    state.numPages = state.pdfDoc.numPages;
    state.pageNum = 1;
    state.placements = [];
    $('empty').style.display = 'none';
    $('pagewrap').style.display = 'inline-block';
    $('pager').style.display = 'flex';
    await renderPage();
  } catch (err) {
    console.error(err);
    setStatus('Could not open this PDF: ' + err.message, 'err');
  }
  refreshUI();
});

async function renderPage() {
  const page = await state.pdfDoc.getPage(state.pageNum);
  const stageW = $('stage').clientWidth - 32;
  const base = page.getViewport({ scale: 1 });
  const cssScale = Math.min(Math.max(stageW, 300) / base.width, 1.6);
  const dpr = window.devicePixelRatio || 1;
  const vp = page.getViewport({ scale: cssScale * dpr });
  const canvas = $('pdfCanvas');
  canvas.width = vp.width; canvas.height = vp.height;
  canvas.style.width = (vp.width / dpr) + 'px';
  canvas.style.height = (vp.height / dpr) + 'px';
  if (state.renderTask) { try { state.renderTask.cancel(); } catch (_) {} }
  state.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
  try { await state.renderTask.promise; } catch (_) { /* cancelled */ }
  $('pageInfo').textContent = `Page ${state.pageNum} / ${state.numPages}`;
  $('prevBtn').disabled = state.pageNum <= 1;
  $('nextBtn').disabled = state.pageNum >= state.numPages;
  drawBoxes();
}

$('prevBtn').onclick = () => { if (state.pageNum > 1) { state.pageNum--; renderPage(); } };
$('nextBtn').onclick = () => { if (state.pageNum < state.numPages) { state.pageNum++; renderPage(); } };
window.addEventListener('resize', () => { if (state.pdfDoc) renderPage(); });

/* ---------- Signature library ---------- */
const getSig = id => state.sigs.find(x => x.id === id);

$('sigInput').addEventListener('change', async e => {
  const files = Array.from(e.target.files);
  $('sigMsg').textContent = '';
  for (const f of files) {
    try {
      const orig = await fileToCanvas(f);
      const sig = { id: state.nextSigId++, name: f.name, orig };
      processSig(sig);
      state.sigs.push(sig);
      state.activeSig = sig.id;
    } catch (err) { console.error(err); $('sigMsg').textContent = 'Could not load ' + f.name + ' (' + (f.type || 'unknown type') + ', ' + Math.round(f.size/1024) + ' KB): ' + (err && err.message ? err.message : err); }
  }
  e.target.value = '';   // allow re-adding same file / adding more later
  renderSigList(); drawBoxes(); refreshUI();
});

$('removeBg').addEventListener('change', () => {
  state.sigs.forEach(processSig);
  renderSigList(); drawBoxes(); refreshUI();
});

async function fileToCanvas(f) {
  // Decode + downscale (huge phone/scan images otherwise blow canvas limits)
  const MAX = 1600;
  let bmp;
  try { bmp = await createImageBitmap(f); }
  catch (_) {
    bmp = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => rej(new Error('Image decode failed'));
      img.src = URL.createObjectURL(f);
    });
  }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, MAX / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

function processSig(sig) {
  // work on a copy so toggling the checkbox is reversible
  const copy = document.createElement('canvas');
  copy.width = sig.orig.width; copy.height = sig.orig.height;
  copy.getContext('2d').drawImage(sig.orig, 0, 0);
  sig.canvas = $('removeBg').checked ? removeWhiteAndCrop(copy) : copy;
  sig.url = sig.canvas.toDataURL('image/png');
}

function renderSigList() {
  const L = $('sigList'); L.innerHTML = '';
  state.sigs.forEach((sig, i) => {
    const d = document.createElement('div');
    d.className = 'sigItem' + (sig.id === state.activeSig ? ' active' : '');
    d.title = sig.name;
    const im = document.createElement('img'); im.src = sig.url; d.appendChild(im);
    const rm = document.createElement('div'); rm.className = 'rm'; rm.textContent = '×'; rm.title = 'Remove this signature';
    rm.onclick = ev => {
      ev.stopPropagation();
      state.sigs = state.sigs.filter(x => x.id !== sig.id);
      state.placements = state.placements.filter(p => p.sigId !== sig.id);
      if (state.activeSig === sig.id) state.activeSig = state.sigs.length ? state.sigs[state.sigs.length - 1].id : null;
      renderSigList(); drawBoxes(); refreshUI();
    };
    d.appendChild(rm);
    d.onclick = () => { state.activeSig = sig.id; renderSigList(); };
    L.appendChild(d);
  });
}

// Whiteish pixels -> transparent (soft edge), then crop to ink bounding box.
function removeWhiteAndCrop(src) {
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d');
  const d = ctx.getImageData(0, 0, w, h), px = d.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (px[i + 3] === 0) continue;
    const m = Math.min(px[i], px[i + 1], px[i + 2]);       // 255 = pure white
    let a = m >= 240 ? 0 : m <= 190 ? 255 : Math.round(255 * (240 - m) / 50);
    a = Math.min(a, px[i + 3]);
    px[i + 3] = a;
    if (a > 20) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  if (maxX < 0) return src; // nothing detected, keep original
  ctx.putImageData(d, 0, 0);
  const pad = 4;
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad); maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = document.createElement('canvas'); out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(src, minX, minY, cw, ch, 0, 0, cw, ch);
  return out;
}

/* ---------- Area selection ---------- */
const overlay = $('overlay');
let drag = null, draftEl = null;

function relPos(e) {
  const r = overlay.getBoundingClientRect();
  return { x: Math.min(Math.max(e.clientX - r.left, 0), r.width), y: Math.min(Math.max(e.clientY - r.top, 0), r.height), w: r.width, h: r.height };
}

overlay.addEventListener('pointerdown', e => {
  if (e.target !== overlay) return;
  if (!getSig(state.activeSig)) { setStatus('Upload and select a signature first.', 'err'); return; }
  setStatus('');
  overlay.setPointerCapture(e.pointerId);
  const p = relPos(e);
  drag = { x0: p.x, y0: p.y };
  draftEl = document.createElement('div');
  draftEl.className = 'box draft';
  overlay.appendChild(draftEl);
});

overlay.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = relPos(e);
  const x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y);
  Object.assign(draftEl.style, { left: x + 'px', top: y + 'px', width: Math.abs(p.x - drag.x0) + 'px', height: Math.abs(p.y - drag.y0) + 'px' });
});

overlay.addEventListener('pointerup', e => {
  if (!drag) return;
  const p = relPos(e);
  const x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y);
  const w = Math.abs(p.x - drag.x0), h = Math.abs(p.y - drag.y0);
  drag = null; draftEl.remove(); draftEl = null;
  if (w < 12 || h < 12) return; // ignore accidental clicks
  const sg = getSig(state.activeSig), asp = sg.canvas.width / sg.canvas.height;
  let bw = w, bh = h;
  if (w / h > asp) bw = h * asp; else bh = w / asp;          // fit signature inside drawn area
  const bx = x + (w - bw) / 2, by = y + (h - bh) / 2;
  const np = { sigId: state.activeSig, page: state.pageNum, fx: bx / p.w, fy: by / p.h, fw: bw / p.w, fh: bh / p.h };
  state.placements.push(np); state.selected = np;
  drawBoxes(); refreshUI();
});

overlay.addEventListener('pointercancel', () => { drag = null; if (draftEl) draftEl.remove(); draftEl = null; });

function selectPl(pl) {
  state.selected = pl;
  overlay.querySelectorAll('.box').forEach(el => el.classList.toggle('selected', el._pl === pl));
  refreshUI();
}

function scaleSelected(f) {
  const pl = state.selected; if (!pl) return;
  const r = overlay.getBoundingClientRect();
  const cx = pl.fx + pl.fw / 2, cy = pl.fy + pl.fh / 2;
  let w = pl.fw * f, h = pl.fh * f;
  const k = Math.min(1, 1 / w, 1 / h);                 // keep inside page
  w *= k; h *= k;
  if ((w * r.width) < 20) return;
  pl.fw = w; pl.fh = h;
  pl.fx = Math.min(Math.max(cx - w / 2, 0), 1 - w);
  pl.fy = Math.min(Math.max(cy - h / 2, 0), 1 - h);
  drawBoxes();
}
$('biggerBtn').onclick = () => scaleSelected(1.15);
$('smallerBtn').onclick = () => scaleSelected(1 / 1.15);

function drawBoxes() {
  overlay.innerHTML = '';
  state.placements.forEach((pl, idx) => {
    if (pl.page !== state.pageNum) return;
    const sg = getSig(pl.sigId);
    const b = document.createElement('div');
    b.className = 'box' + (pl === state.selected ? ' selected' : '');
    b._pl = pl;
    const place = () => Object.assign(b.style, { left: pl.fx * 100 + '%', top: pl.fy * 100 + '%', width: pl.fw * 100 + '%', height: pl.fh * 100 + '%' });
    place();
    if (sg) { const im = document.createElement('img'); im.src = sg.url; im.style.cssText = 'width:100%;height:100%;object-fit:contain'; b.appendChild(im); }

    const x = document.createElement('div'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove';
    x.addEventListener('pointerdown', ev => ev.stopPropagation());
    x.addEventListener('click', ev => { ev.stopPropagation(); state.placements.splice(idx, 1); if (state.selected === pl) state.selected = null; drawBoxes(); refreshUI(); });
    b.appendChild(x);

    // MOVE (drag the box body)
    b.addEventListener('pointerdown', ev => {
      if (ev.target !== b && ev.target.tagName !== 'IMG') return;
      ev.stopPropagation(); ev.preventDefault();
      selectPl(pl);
      b.setPointerCapture(ev.pointerId);
      const r = overlay.getBoundingClientRect();
      const sx = ev.clientX, sy = ev.clientY, ox = pl.fx, oy = pl.fy;
      const mv = e2 => {
        pl.fx = Math.min(Math.max(ox + (e2.clientX - sx) / r.width, 0), 1 - pl.fw);
        pl.fy = Math.min(Math.max(oy + (e2.clientY - sy) / r.height, 0), 1 - pl.fh);
        place();
      };
      const up = () => { b.removeEventListener('pointermove', mv); b.removeEventListener('pointerup', up); b.removeEventListener('pointercancel', up); };
      b.addEventListener('pointermove', mv); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    });

    // RESIZE: 4 corner handles, aspect locked, opposite corner stays fixed
    ['tl', 'tr', 'bl', 'br'].forEach(c => {
      const hnd = document.createElement('div'); hnd.className = 'handle ' + c;
      hnd.addEventListener('pointerdown', ev => {
        ev.stopPropagation(); ev.preventDefault();
        selectPl(pl);
        hnd.setPointerCapture(ev.pointerId);
        const r = overlay.getBoundingClientRect();
        const asp = (pl.fw * r.width) / (pl.fh * r.height);
        const right = c[1] === 'r', bottom = c[0] === 'b';
        const ax = (right ? pl.fx : pl.fx + pl.fw) * r.width;      // fixed anchor = opposite corner
        const ay = (bottom ? pl.fy : pl.fy + pl.fh) * r.height;
        const mv = e2 => {
          const px = e2.clientX - r.left;
          let w = (right ? px - ax : ax - px);
          const maxW = right ? r.width - ax : ax, maxH = bottom ? r.height - ay : ay;
          w = Math.max(20, Math.min(w, maxW, maxH * asp));
          const h = w / asp;
          pl.fw = w / r.width; pl.fh = h / r.height;
          pl.fx = (right ? ax : ax - w) / r.width;
          pl.fy = (bottom ? ay : ay - h) / r.height;
          place();
        };
        const up = () => { hnd.removeEventListener('pointermove', mv); hnd.removeEventListener('pointerup', up); hnd.removeEventListener('pointercancel', up); };
        hnd.addEventListener('pointermove', mv); hnd.addEventListener('pointerup', up); hnd.addEventListener('pointercancel', up);
      });
      b.appendChild(hnd);
    });

    overlay.appendChild(b);
  });
  refreshUI();
}

$('undoBtn').onclick = () => { const g = state.placements.pop(); if (g === state.selected) state.selected = null; drawBoxes(); refreshUI(); };
$('clearBtn').onclick = () => { state.placements = []; state.selected = null; drawBoxes(); refreshUI(); };

/* ---------- Export ---------- */
$('dlBtn').onclick = async () => {
  try {
    setStatus('Building your PDF…');
    const { PDFDocument } = PDFLib;
    const pdf = await PDFDocument.load(state.pdfBytes.slice(0), { ignoreEncryption: true });
    const embedded = {};   // sigId -> embedded image (each embedded once)
    for (const id of new Set(state.placements.map(p => p.sigId))) {
      const sg = getSig(id); if (!sg) continue;
      const png = await new Promise(r => sg.canvas.toBlob(r, 'image/png')).then(b => b.arrayBuffer());
      embedded[id] = await pdf.embedPng(png);
    }
    const pages = pdf.getPages();

    for (const pl of state.placements) {
      const img = embedded[pl.sigId]; if (!img) continue;
      const aspect = img.width / img.height;
      const page = pages[pl.page - 1];
      const rot = ((page.getRotation().angle % 360) + 360) % 360;
      const { width: W, height: H } = page.getSize();           // unrotated page space
      // Convert the on-screen (rotated) fractional box into unrotated PDF space
      let ux, uy, uw, uh;   // top-left based fractions in unrotated space
      if (rot === 0)        { ux = pl.fx;            uy = pl.fy;            uw = pl.fw; uh = pl.fh; }
      else if (rot === 180) { ux = 1 - pl.fx - pl.fw; uy = 1 - pl.fy - pl.fh; uw = pl.fw; uh = pl.fh; }
      else if (rot === 90)  { ux = pl.fy;            uy = 1 - pl.fx - pl.fw; uw = pl.fh; uh = pl.fw; }
      else                  { ux = 1 - pl.fy - pl.fh; uy = pl.fx;            uw = pl.fh; uh = pl.fw; }

      const bx = ux * W, bw = uw * W, bh = uh * H;
      const by = H - (uy * H) - bh;                              // bottom-left origin
      // Fit signature inside the box (contain), keeping aspect, in on-screen orientation
      const onW = (rot % 180 === 0) ? bw : bh, onH = (rot % 180 === 0) ? bh : bw;
      let dw = onW, dh = dw / aspect;
      if (dh > onH) { dh = onH; dw = dh * aspect; }
      // centre in box (unrotated space)
      const cx = bx + bw / 2, cy = by + bh / 2;
      const { degrees } = PDFLib;
      // pdf-lib rotates around the (x,y) origin of the image, so compute origin from centre
      const rad = rot * Math.PI / 180;
      const ox = cx - (dw / 2) * Math.cos(rad) + (dh / 2) * Math.sin(rad);
      const oy = cy - (dw / 2) * Math.sin(rad) - (dh / 2) * Math.cos(rad);
      page.drawImage(img, { x: ox, y: oy, width: dw, height: dh, rotate: degrees(rot) });
    }

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    const orig = ($('pdfInput').files[0]?.name || 'document.pdf').replace(/\.pdf$/i, '');
    a.href = URL.createObjectURL(blob);
    a.download = orig + '-signed.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    setStatus('Done — your download has started.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'err');
  }
};

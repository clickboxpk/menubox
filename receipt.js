/* Receipt.js - draws receipts and reports as pictures (JPG), shared by menu.html and index.html.
   Receipt.draw(doc) -> canvas. doc = { brand, accent, title, subtitle, meta:[[label,value]], sections:[{title, rows:[{a,b,sub}]}], totals:[[label,value,strong]], footer } */
(function () {
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const W = 720, M = 28, P = 36, SCALE = 2;

  const onColor = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170 ? '#14211F' : '#FFFFFF'; };
  function wrap(ctx, text, maxW) {
    const out = []; let cur = '';
    for (const w of String(text ?? '').split(/\s+/)) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
    }
    out.push(cur); return out;
  }
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  // One layout routine used twice: first to measure the height, then to draw.
  function run(c, d, draw, H) {
    const X0 = M + P, X1 = W - M - P, IW = X1 - X0, accent = d.accent || '#0F766E', ink = '#1B2524', mute = '#6B7775';
    const f = (w, s) => `${w} ${s}px ${FONT}`;
    const put = (t, x, y, font, color, align) => { if (!draw) return; c.font = font; c.fillStyle = color; c.textAlign = align || 'left'; c.fillText(t, x, y); };
    let y = M;
    if (draw) {
      c.fillStyle = '#F1EFE8'; c.fillRect(0, 0, W, H);
      c.save(); rr(c, M, M, W - 2 * M, H - 2 * M, 22); c.clip(); c.fillStyle = '#fff'; c.fillRect(M, M, W - 2 * M, H - 2 * M);
      c.fillStyle = accent; c.fillRect(M, M, W - 2 * M, 158); c.restore();
    }
    // header band
    const hc = onColor(accent); c.textBaseline = 'alphabetic';
    let fs = 36; c.font = f('700', fs); while (c.measureText(d.brand || '').width > IW && fs > 18) { fs -= 2; c.font = f('700', fs); }
    put(d.brand || '', W / 2, M + 62, f('700', fs), hc, 'center');
    put(String(d.title || '').toUpperCase(), W / 2, M + 100, f('600', 19), hc, 'center');
    if (d.subtitle) put(d.subtitle, W / 2, M + 132, f('500', 21), hc, 'center');
    y = M + 158 + 34;

    const pair = (l, v, font, color, strong) => {
      c.font = f(strong ? '700' : '500', font); const vl = wrap(c, v, IW * 0.62); c.font = f('500', font);
      if (draw) { put(l, X0, y, f('500', font), mute); vl.forEach((t, i) => put(t, X1, y + i * (font + 8), f(strong ? '700' : '600', font), color, 'right')); }
      y += vl.length * (font + 8) + 6;
    };
    const dash = () => { y += 6; if (draw) { c.strokeStyle = '#CFCABB'; c.lineWidth = 1.5; c.setLineDash([6, 6]); c.beginPath(); c.moveTo(X0, y); c.lineTo(X1, y); c.stroke(); c.setLineDash([]); } y += 28; };

    (d.meta || []).forEach(([l, v]) => { if (v !== '' && v != null) pair(l, v, 20, ink); });
    (d.sections || []).forEach((sec) => {
      dash();
      if (sec.title) { put(String(sec.title).toUpperCase(), X0, y, f('700', 16), accent); y += 28; }
      const rows = sec.rows || [];
      c.font = f('700', 22); const rw = Math.min(210, Math.max(0, ...rows.map((r) => c.measureText(r.b || '').width)) + 8);
      rows.forEach((r) => {
        c.font = f('600', 22); const lines = wrap(c, r.a, IW - rw - 18);
        lines.forEach((t, i) => put(t, X0, y + i * 29, f('600', 22), ink));
        put(r.b || '', X1, y, f('700', 22), ink, 'right');
        y += lines.length * 29;
        if (r.sub) { c.font = f('400', 18); wrap(c, r.sub, IW - rw - 18).forEach((t) => { put(t, X0, y, f('400', 18), mute); y += 24; }); }
        y += 12;
      });
    });
    if ((d.totals || []).length) {
      dash();
      d.totals.forEach(([l, v, strong]) => {
        if (strong) { if (draw) { c.fillStyle = '#F5F3EC'; rr(c, X0 - 12, y - 30, IW + 24, 52, 12); c.fill(); } put(l, X0, y + 4, f('700', 26), ink); put(v, X1, y + 4, f('700', 28), accent, 'right'); y += 50; }
        else pair(l, v, 21, ink);
      });
    }
    if (d.footer) { y += 14; c.font = f('400', 17); wrap(c, d.footer, IW).forEach((t) => { put(t, W / 2, y, f('400', 17), mute, 'center'); y += 24; }); }
    return y + 30 + M;
  }

  function draw(doc) {
    const m = document.createElement('canvas').getContext('2d');
    const H = Math.ceil(run(m, doc, false, 0));
    const cv = document.createElement('canvas'); cv.width = W * SCALE; cv.height = H * SCALE;
    const c = cv.getContext('2d'); c.scale(SCALE, SCALE); run(c, doc, true, H);
    return cv;
  }

  function saveJpg(canvas, name) {
    canvas.toBlob((b) => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name + '.jpg';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/jpeg', 0.92);
  }
  function canShareFiles() { try { return !!(navigator.canShare && navigator.canShare({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] })); } catch (e) { return false; } }
  function share(canvas, name) {
    canvas.toBlob((b) => { const file = new File([b], name + '.jpg', { type: 'image/jpeg' }); navigator.share({ files: [file], title: name }).catch(() => {}); }, 'image/jpeg', 0.92);
  }
  function print(canvases) {
    let area = document.getElementById('rcptPrint');
    if (!area) {
      area = document.createElement('div'); area.id = 'rcptPrint'; document.body.appendChild(area);
      const st = document.createElement('style');
      st.textContent = '#rcptPrint{display:none}@media print{body>*:not(#rcptPrint){display:none!important}#rcptPrint{display:block!important}#rcptPrint img{display:block;width:100%;max-width:520px;margin:0 auto 12px;break-inside:avoid}}';
      document.head.appendChild(st);
    }
    const qr = document.getElementById('printArea'); if (qr) qr.innerHTML = '';
    area.innerHTML = canvases.map((c) => `<img alt="" src="${c.toDataURL('image/jpeg', 0.92)}">`).join('');
    setTimeout(() => window.print(), 200);
  }

  // "2026-10-26 14:45:00" (UTC from the server) -> "26 Oct 2026, 7:45 PM" (Pakistan time)
  function when(utc) {
    const d = new Date(new Date(String(utc).replace(' ', 'T') + 'Z').getTime() + 5 * 3600e3);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) + ', ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  }
  const num = (n) => Number(n).toLocaleString('en-US');
  window.Receipt = { draw, saveJpg, share, print, canShareFiles, when, num };
})();

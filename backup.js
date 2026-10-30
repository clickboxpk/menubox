/* backup.js - PDF reports, the Backup Center ZIP, and the admin site backup / restore.
   Everything is made in the browser (the server only sends data), so it does not use the Worker's CPU.
   PDF pages are drawn on a canvas (the same way as receipts), so Urdu names come out right, then packed into a PDF file. */
(function () {
  const enc = new TextEncoder();
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Nastaliq Urdu", "Noto Naskh Arabic", Arial, sans-serif';
  const pkDay = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const num = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const safe = (s) => String(s || 'file').toLowerCase().replace(/[^a-z0-9\u0600-\u06ff]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
  const jp = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };
  const TYPEN = { dinein: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };
  const pkTime = (utc) => {
    const d = new Date(new Date(String(utc).replace(' ', 'T') + 'Z').getTime() + 5 * 3600e3);
    return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16);
  };

  /* ---------- ZIP (no compression, which is fine for JPG and PDF files) ---------- */
  const CT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const bytes = (x) => (typeof x === 'string' ? enc.encode(x) : x);
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const d = new Date(), dt = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), tm = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    files.forEach((f) => {
      const name = enc.encode(f.name), data = bytes(f.data), crc = crc32(data), size = data.length;
      const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, tm, true); lh.setUint16(12, dt, true); lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, tm, true); ch.setUint16(14, dt, true); ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      parts.push(lh.buffer, name, data); central.push(ch.buffer, name);
      off += 30 + name.length + size;
    });
    let csize = 0; central.forEach((c) => { csize += c.byteLength !== undefined ? c.byteLength : c.length; });
    const end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  /* ---------- PDF (one JPEG per A4 page) ---------- */
  function pdf(pages) {
    const PW = 595.28, PH = 841.89, chunks = [], offsets = []; let pos = 0;
    const push = (x) => { const b = bytes(x); chunks.push(b); pos += b.length; };
    push(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    const obj = (n, fn) => { offsets[n] = pos; push(n + ' 0 obj\n'); fn(); push('\nendobj\n'); };
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    obj(2, () => push('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (3 + i * 3) + ' 0 R').join(' ') + '] >>'));
    pages.forEach((p, i) => {
      const pn = 3 + i * 3, cn = pn + 1, im = pn + 2, content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
      obj(pn, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${cn} 0 R >>`));
      obj(cn, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
      obj(im, () => { push(`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`); push(p.jpeg); push('\nendstream'); });
    });
    const total = 3 + pages.length * 3, xref = pos;
    push('xref\n0 ' + total + '\n0000000000 65535 f \n');
    for (let n = 1; n < total; n++) push(String(offsets[n]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  }

  /* ---------- page layout (canvas -> JPEG pages) ---------- */
  const onColor = (hex) => { const n = parseInt(String(hex || '#0F766E').slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 170 ? '#14211F' : '#FFFFFF'; };
  class Doc {
    constructor(o) {
      this.o = o; this.W = 1240; this.H = 1754; this.M = 84; this.IW = this.W - 2 * this.M; this.accent = /^#[0-9a-f]{6}$/i.test(o.accent || '') ? o.accent : '#0F766E';
      this.cv = document.createElement('canvas'); this.cv.width = this.W; this.cv.height = this.H; this.c = this.cv.getContext('2d');
      this.pages = []; this.n = 0; this.newPage();
    }
    f(w, s) { return `${w} ${s}px ${FONT}`; }
    get limit() { return this.H - 130; }
    newPage() {
      if (this.n) this.endPage();
      this.n++; const c = this.c, W = this.W, M = this.M;
      c.fillStyle = '#fff'; c.fillRect(0, 0, W, this.H); c.textBaseline = 'alphabetic';
      if (this.n === 1) {
        c.fillStyle = this.accent; c.fillRect(0, 0, W, 210);
        const hc = onColor(this.accent); let x = M;
        if (this.o.logo) { try { c.fillStyle = '#fff'; c.beginPath(); c.roundRect ? c.roundRect(M, 45, 120, 120, 22) : c.rect(M, 45, 120, 120); c.fill();
          const r = Math.min(104 / this.o.logo.width, 104 / this.o.logo.height); const w = this.o.logo.width * r, h = this.o.logo.height * r; c.drawImage(this.o.logo, M + 60 - w / 2, 105 - h / 2, w, h); x = M + 150; } catch (e) {} }
        c.fillStyle = hc; c.textAlign = 'left';
        let fs = 56; c.font = this.f('700', fs); while (c.measureText(this.o.brand || '').width > W - x - M && fs > 26) { fs -= 2; c.font = this.f('700', fs); }
        c.fillText(this.o.brand || '', x, 100);
        c.font = this.f('600', 28); c.fillText(String(this.o.title || '').toUpperCase(), x, 146);
        if (this.o.subtitle) { c.font = this.f('500', 26); c.fillText(this.o.subtitle, x, 184); }
        this.y = 210 + 50;
      } else {
        c.fillStyle = this.accent; c.fillRect(0, 0, W, 14);
        c.fillStyle = '#6B7775'; c.font = this.f('600', 22); c.textAlign = 'left'; c.fillText((this.o.brand || '') + '  -  ' + (this.o.title || ''), M, 58);
        this.y = 100;
      }
    }
    endPage() {
      const c = this.c; c.fillStyle = '#8A9492'; c.font = this.f('500', 20); c.textAlign = 'center';
      c.fillText((this.o.footer ? this.o.footer + '   |   ' : '') + 'Page ' + this.n, this.W / 2, this.H - 50);
      const b64 = this.cv.toDataURL('image/jpeg', 0.85).split(',')[1], bin = atob(b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      this.pages.push({ jpeg: u, w: this.W, h: this.H });
    }
    ensure(h) { if (this.y + h > this.limit) this.newPage(); }
    wrap(text, font, maxW) {
      this.c.font = font; const out = [];
      String(text == null ? '' : text).split('\n').forEach((para) => {
        let cur = ''; para.split(/\s+/).forEach((w) => {
          const t = cur ? cur + ' ' + w : w;
          if (this.c.measureText(t).width > maxW && cur) { out.push(cur); cur = w; } else cur = t;
        }); out.push(cur);
      }); return out;
    }
    gap(n) { this.y += n; }
    h2(text) {
      this.ensure(110); this.y += 26; const c = this.c; c.fillStyle = this.accent; c.font = this.f('700', 32); c.textAlign = 'left'; c.fillText(String(text), this.M, this.y);
      this.y += 14; c.fillStyle = '#E3E0D6'; c.fillRect(this.M, this.y, this.IW, 3); this.y += 34;
    }
    para(text, o = {}) {
      const size = o.size || 24, font = this.f(o.bold ? '700' : '400', size), lines = this.wrap(text, font, this.IW);
      lines.forEach((t) => { this.ensure(size + 14); this.c.font = font; this.c.fillStyle = o.color || '#4A5654'; this.c.textAlign = o.center ? 'center' : 'left'; this.c.fillText(t, o.center ? this.W / 2 : this.M, this.y); this.y += size + 12; });
    }
    stats(list) {
      this.ensure(150); const n = list.length, gapW = 24, w = (this.IW - gapW * (n - 1)) / n, c = this.c;
      list.forEach(([label, value], i) => {
        const x = this.M + i * (w + gapW); c.fillStyle = '#F5F3EC'; c.beginPath(); c.roundRect ? c.roundRect(x, this.y, w, 120, 18) : c.rect(x, this.y, w, 120); c.fill();
        c.fillStyle = this.accent; c.textAlign = 'center'; let fs = 40; c.font = this.f('700', fs); while (c.measureText(value).width > w - 30 && fs > 20) { fs -= 2; c.font = this.f('700', fs); }
        c.fillText(String(value), x + w / 2, this.y + 60); c.fillStyle = '#6B7775'; c.font = this.f('500', 22); c.fillText(label, x + w / 2, this.y + 98);
      }); this.y += 120 + 30;
    }
    // cols: [{label, w: share, align}] rows: array of arrays; opts.total: last row is bold
    table(cols, rows, opts = {}) {
      const pad = 12, size = 22, tw = cols.reduce((a, b) => a + b.w, 0), ws = cols.map((x) => (x.w / tw) * this.IW);
      const head = () => {
        const hl = cols.map((col, i) => this.wrap(col.label, this.f('700', 21), ws[i] - 2 * pad)), n = Math.max(1, ...hl.map((l) => l.length)), hh = n * 28 + 20;
        this.ensure(hh + 10); const c = this.c; c.fillStyle = this.accent; c.fillRect(this.M, this.y - 6, this.IW, hh); c.fillStyle = onColor(this.accent); c.font = this.f('700', 21);
        let x = this.M; cols.forEach((col, i) => { c.textAlign = col.align === 'right' ? 'right' : 'left'; hl[i].forEach((t, k) => c.fillText(t, col.align === 'right' ? x + ws[i] - pad : x + pad, this.y + 24 + k * 28)); x += ws[i]; }); this.y += hh + 6;
      };
      head();
      rows.forEach((row, ri) => {
        const bold = opts.total && ri === rows.length - 1, font = this.f(bold ? '700' : '500', size);
        const cells = row.map((v, i) => this.wrap(v, font, ws[i] - 2 * pad)), lines = Math.max(1, ...cells.map((l) => l.length)), h = lines * (size + 9) + 16;
        if (this.y + h > this.limit) { this.newPage(); head(); }
        const c = this.c; if (bold) { c.fillStyle = '#EDEAE0'; c.fillRect(this.M, this.y - 6, this.IW, h); } else if (ri % 2) { c.fillStyle = '#FAF9F5'; c.fillRect(this.M, this.y - 6, this.IW, h); }
        c.fillStyle = '#1B2524'; c.font = font; let x = this.M;
        cells.forEach((ls, i) => { c.textAlign = cols[i].align === 'right' ? 'right' : 'left'; ls.forEach((t, k) => c.fillText(t, cols[i].align === 'right' ? x + ws[i] - pad : x + pad, this.y + 22 + k * (size + 9))); x += ws[i]; });
        this.y += h;
      });
      this.y += 20;
    }
    finish() { this.endPage(); return pdf(this.pages); }
  }

  const moneyOf = (info) => (v) => (info.currency || 'Rs') + ' ' + num(v);
  function loadLogo(info) {
    return new Promise((res) => { if (!info.logo_url) return res(null); const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = info.logo_url; });
  }
  async function newDoc(info, title, subtitle) { return new Doc({ brand: info.name, accent: info.theme_primary, title, subtitle, logo: await loadLogo(info), footer: 'Made with MenuQR' }); }

  /* ---------- the documents ---------- */
  async function menuPdf(core, info) {
    const d = await newDoc(info, 'Menu', pkDay()), $$ = moneyOf(info);
    const cats = core.categories.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id), by = {};
    core.items.slice().sort((a, b) => a.sort_order - b.sort_order || a.id - b.id).forEach((i) => { (by[i.category_id || 0] = by[i.category_id || 0] || []).push(i); });
    const groups = cats.map((c) => [c.name, by[c.id] || []]); if (by[0]) groups.push(['Other', by[0]]);
    groups.forEach(([name, list]) => {
      if (!list.length) return; d.h2(name);
      list.forEach((it) => {
        const sizes = jp(it.sizes, []), addons = jp(it.addons, []), tags = jp(it.tags, []);
        const lines = [];
        if (it.description) lines.push([it.description, '#5B6664', 22]);
        if (sizes.length) lines.push([sizes.map((s) => s.name + ' ' + $$(s.price)).join('   |   '), '#1B2524', 22]);
        if (addons.length) lines.push(['Extras: ' + addons.map((a) => a.name + (a.price ? ' +' + $$(a.price) : '')).join(', '), '#5B6664', 21]);
        const meta = tags.map((t) => ({ spicy: 'Spicy', veg: 'Veg', halal: 'Halal', special: 'Special' }[t] || t)); if (!it.is_available) meta.push('Sold out right now');
        if (meta.length) lines.push([meta.join('  .  '), d.accent, 20]);
        const wrapped = lines.map(([t, col, s]) => [d.wrap(t, d.f('400', s), d.IW), col, s]);
        const h = 40 + wrapped.reduce((a, [ls, , s]) => a + ls.length * (s + 8), 0) + 18; d.ensure(h);
        const c = d.c; c.textAlign = 'left'; c.fillStyle = '#1B2524'; c.font = d.f('700', 28);
        const price = sizes.length ? 'from ' + $$(Math.min(...sizes.map((s) => Number(s.price) || 0))) : $$(it.price), pw = c.measureText(price).width;
        let nm = it.name; while (c.measureText(nm).width > d.IW - pw - 30 && nm.length > 4) nm = nm.slice(0, -2);
        c.fillText(nm === it.name ? nm : nm + '...', d.M, d.y); c.textAlign = 'right'; c.fillText(price, d.M + d.IW, d.y); d.y += 12;
        if (it.old_price && !sizes.length) { c.font = d.f('400', 20); c.fillStyle = '#8A9492'; c.fillText('was ' + $$(it.old_price), d.M + d.IW, d.y + 20); }
        wrapped.forEach(([ls, col, s]) => ls.forEach((t) => { d.y += s + 8; c.textAlign = 'left'; c.font = d.f('400', s); c.fillStyle = col; c.fillText(t, d.M, d.y); }));
        d.y += 44;
      });
    });
    if (!core.items.length) d.para('This menu has no items yet.');
    return d.finish();
  }
  function ordersTable(d, orders, info) {
    const $$ = moneyOf(info), total = orders.reduce((a, o) => a + Number(o.total || 0), 0);
    d.stats([['Orders', num(orders.length)], ['Total sales', $$(total)], ['Average order', orders.length ? $$(total / orders.length) : '-']]);
    const rows = orders.map((o) => {
      const items = jp(o.items, []).map((i) => i.qty + ' x ' + i.name + (i.label ? ' (' + i.label + ')' : '')).join(', ');
      return [pkTime(o.created_at), o.code, TYPEN[o.order_type] || o.order_type, [o.table_label && 'Table ' + o.table_label, o.customer_name, o.phone].filter(Boolean).join(', '), items, $$(o.total)];
    });
    rows.push(['', '', '', '', 'Total (' + orders.length + ' orders)', $$(total)]);
    d.table([{ label: 'Date', w: 15 }, { label: 'Order', w: 9 }, { label: 'Type', w: 11 }, { label: 'Customer', w: 20 }, { label: 'Items', w: 32 }, { label: 'Total', w: 13, align: 'right' }], rows, { total: true });
  }
  async function ordersPdf(orders, info, from, to, note) {
    const d = await newDoc(info, 'Orders report', from === to ? from : from + ' to ' + to);
    if (!orders.length) d.para('There are no orders in this period.'); else ordersTable(d, orders, info);
    if (note) d.para(note, { size: 20 });
    return d.finish();
  }
  async function salesPdf(r, info) {
    const d = await newDoc(info, 'Sales report', r.from === r.to ? r.from : r.from + ' to ' + r.to), $$ = moneyOf(info);
    d.stats([['Orders', num(r.orders)], ['Sales', $$(r.sales)], ['Average order', r.orders ? $$(r.sales / r.orders) : '-']]);
    if (r.types.length) { d.h2('By order type'); d.table([{ label: 'Type', w: 40 }, { label: 'Orders', w: 20, align: 'right' }, { label: 'Sales', w: 40, align: 'right' }], r.types.map((t) => [TYPEN[t.type] || t.type, num(t.n), $$(t.sales)])); }
    if (r.daily.length) { d.h2('Sales by day'); d.table([{ label: 'Day', w: 40 }, { label: 'Orders', w: 20, align: 'right' }, { label: 'Sales', w: 40, align: 'right' }], r.daily.map((x) => [x.day, num(x.n), $$(x.sales)])); }
    if (r.top.length) { d.h2('Most ordered dishes'); d.table([{ label: 'Dish', w: 55 }, { label: 'Sold', w: 15, align: 'right' }, { label: 'Sales', w: 30, align: 'right' }], r.top.map((t, i) => [(i + 1) + '. ' + t.name, num(t.qty), $$(t.sales)])); }
    d.para('Based on the orders customers sent through your menu. Orders that were never sent on WhatsApp may be included.', { size: 20 });
    return d.finish();
  }
  async function monthlyPdf(r, info) {
    const d = await newDoc(info, 'Monthly accounts', r.from === r.to ? r.from : r.from + ' to ' + r.to), $$ = moneyOf(info);
    d.stats([['Orders', num(r.orders)], ['Total sales', $$(r.sales)], ['Months', num(r.monthly.length)]]);
    const sum = { n: 0, subtotal: 0, delivery: 0, extra: 0, total: 0 };
    const rows = r.monthly.map((m) => { const extra = m.total - m.subtotal - m.delivery; sum.n += m.n; sum.subtotal += m.subtotal; sum.delivery += m.delivery; sum.extra += extra; sum.total += m.total; return [m.month, num(m.n), $$(m.subtotal), $$(m.delivery), $$(extra), $$(m.total)]; });
    rows.push(['Total', num(sum.n), $$(sum.subtotal), $$(sum.delivery), $$(sum.extra), $$(sum.total)]);
    d.h2('Month by month');
    d.table([{ label: 'Month', w: 14 }, { label: 'Orders', w: 12, align: 'right' }, { label: 'Menu items', w: 20, align: 'right' }, { label: 'Delivery', w: 18, align: 'right' }, { label: 'Taxes and charges', w: 18, align: 'right' }, { label: 'Total', w: 18, align: 'right' }], rows, { total: true });
    if (r.charges && r.charges.length) { d.h2('Taxes and charges collected'); d.table([{ label: 'Charge', w: 60 }, { label: 'Amount', w: 40, align: 'right' }], r.charges.map((c) => [c.name || 'Charge', $$(c.amount)])); }
    d.para('Taxes and charges are added on top of the menu prices. This report is a summary of customer orders, not an official tax document.', { size: 20 });
    return d.finish();
  }

  /* ---------- CSV ---------- */
  const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(s) && !/^\+?\d[\d\s-]*$/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = (head, rows) => '\uFEFF' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  function ordersCsv(orders) {
    return csv(['Order code', 'Date and time (Pakistan)', 'Type', 'Table', 'Customer', 'Phone', 'Address', 'Note', 'Items', 'Menu total', 'Delivery fee', 'Taxes and charges', 'Total'],
      orders.map((o) => [o.code, pkTime(o.created_at), TYPEN[o.order_type] || o.order_type, o.table_label, o.customer_name, o.phone, o.address, o.note,
        jp(o.items, []).map((i) => i.qty + ' x ' + i.name + (i.label ? ' (' + i.label + ')' : '')).join(' | '), o.subtotal, o.delivery_fee,
        jp(o.charges, []).map((c) => (c.label || c.name) + ': ' + c.amount).join(' | '), o.total]));
  }
  const feedbackCsv = (rows) => csv(['Date and time (Pakistan)', 'Rating', 'Comment', 'Table'], rows.map((f) => [pkTime(f.created_at), f.rating, f.comment, f.table_label]));

  /* ---------- fetching in pages ---------- */
  async function pull(api, url, onPage) {
    const out = []; let after = 0;
    for (let guard = 0; guard < 2000; guard++) {
      const d = await api(url + (url.includes('?') ? '&' : '?') + 'after=' + after);
      out.push(...d.rows); if (onPage) onPage(out.length);
      if (!d.next) break; after = d.next;
    }
    return out;
  }
  function save(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }
  const b64bytes = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

  /* ---------- reports (PDF) used by the Orders tab ---------- */
  async function reportOrders(api, from, to) { return pull(api, '/api/r/backup/orders?for=report&from=' + from + '&to=' + to); }

  /* ---------- Backup Center: one-click ZIP ---------- */
  async function restaurantZip({ api, info, premium, progress }) {
    const say = (t) => progress && progress(t), today = pkDay();
    say('Reading your menu and settings...');
    const core = await api('/api/r/backup/core');
    say('Reading orders...'); const orders = await pull(api, '/api/r/backup/orders', (n) => say('Reading orders (' + n + ')...'));
    say('Reading feedback...'); const feedback = await pull(api, '/api/r/backup/feedback');
    say('Reading pictures...'); const images = await pull(api, '/api/r/backup/images', (n) => say('Reading pictures (' + n + ')...'));
    const slug = info.slug || 'restaurant', files = [];
    const backup = { format: 'menuqr-backup', version: 1, scope: 'restaurant', created_at: new Date().toISOString(), generator: 'MenuQR', history: premium ? 'full history' : 'last 31 days of orders and feedback',
      restaurants: [{ restaurant: core.restaurant, categories: core.categories, items: core.items, tables: core.tables, orders, feedback, images }] };
    say('Making the menu PDF...'); files.push({ name: 'menu.pdf', data: new Uint8Array(await (await menuPdf(core, info)).arrayBuffer()) });
    say('Making the orders PDF...');
    const cap = orders.slice(-5000), capped = orders.length > cap.length;
    const from = cap.length ? pkTime(cap[0].created_at).slice(0, 10) : today, to = cap.length ? pkTime(cap[cap.length - 1].created_at).slice(0, 10) : today;
    files.push({ name: 'orders.pdf', data: new Uint8Array(await (await ordersPdf(cap, info, from, to, capped ? 'This PDF shows the latest 5,000 orders. The CSV file and the backup file have all of them.' : '')).arrayBuffer()) });
    files.push({ name: 'orders.csv', data: ordersCsv(orders) }, { name: 'feedback.csv', data: feedbackCsv(feedback) });
    const jsonName = 'menuqr-backup-' + slug + '-' + today + '.json';
    files.push({ name: jsonName, data: JSON.stringify(backup) });
    const names = {}; core.items.forEach((i) => { const m = String(i.image_url || '').match(/\/api\/img\/(\d+)$/); if (m) names[m[1]] = i.name; });
    say('Packing pictures...'); images.forEach((im) => files.push({ name: 'pictures/' + safe(names[im.id] || 'picture') + '-' + im.id + '.' + (EXT[im.mime] || 'jpg'), data: b64bytes(im.data) }));
    files.unshift({ name: 'README.txt', data: [
      'MenuQR backup for ' + info.name + ' - made on ' + today, '',
      'menu.pdf        Your menu, ready to print.',
      jsonName + '   The full backup file. Keep it safe. If something is lost, send this file to the site admin and ask for a restore.',
      'orders.pdf / orders.csv   Your orders (' + (premium ? 'full history' : 'the last 31 days') + '). The CSV opens in Excel.',
      'feedback.csv    Customer feedback.',
      'pictures/       Your dish pictures.', '',
      premium ? 'Your plan keeps the full history.' : 'Free plan: orders and feedback cover the last 31 days. Premium keeps the full history.',
      'Backups are your own responsibility. Download one regularly and keep it somewhere safe that you control.'].join('\r\n') });
    say('Creating the ZIP file...');
    return { blob: zip(files), filename: 'menuqr-backup-' + slug + '-' + today + '.zip', counts: { items: core.items.length, orders: orders.length, feedback: feedback.length, images: images.length } };
  }

  /* ---------- Admin: whole-site backup file ---------- */
  async function siteBackup({ api, withImages, progress }) {
    const say = (t) => progress && progress(t), site = await api('/api/admin/backup/site');
    const parts = ['{"format":"menuqr-backup","version":1,"scope":"site","created_at":' + JSON.stringify(new Date().toISOString()) + ',"includes_images":' + !!withImages +
      ',"plans":' + JSON.stringify(site.plans) + ',"payments":' + JSON.stringify(site.payments) + ',"admins":' + JSON.stringify(site.admins) + ',"restaurants":['];
    let k = 0;
    for (const r of site.restaurants) {
      say('Reading ' + r.name + ' (' + (++k) + ' of ' + site.restaurants.length + ')...');
      const q = (p) => '/api/admin/backup/part?id=' + r.id + '&part=' + p, core = await api(q('core'));
      const orders = await pull(api, q('orders')), feedback = await pull(api, q('feedback')), images = withImages ? await pull(api, q('images')) : [];
      parts.push((k > 1 ? ',' : '') + JSON.stringify({ restaurant: core.restaurant, categories: core.categories, items: core.items, tables: core.tables, users: site.users.filter((u) => u.restaurant_id === r.id), orders, feedback, images }));
    }
    parts.push(']}');
    return { blob: new Blob(parts, { type: 'application/json' }), filename: 'menuqr-site-backup-' + pkDay() + (withImages ? '' : '-no-pictures') + '.json', restaurants: site.restaurants.length };
  }

  /* ---------- Admin: restore from a file (sent to the server in small steps) ---------- */
  function readBackup(text) {
    let j; try { j = JSON.parse(text); } catch (e) { throw new Error('This file is not a valid backup file.'); }
    if (!j || j.format !== 'menuqr-backup' || !Array.isArray(j.restaurants)) throw new Error('This is not a MenuQR backup file.');
    return j;
  }
  const rowsOf = (r, o) => 1 + (r.categories || []).length + (r.items || []).length + (r.tables || []).length + (o.images ? (r.images || []).length : 0) + (o.orders ? (r.orders || []).length + (r.feedback || []).length : 0) + (o.users ? (r.users || []).length : 0);
  function estimate(j, o) { return (o.site ? j.restaurants : j.restaurants.filter((r) => r.restaurant.slug === o.slug)).reduce((a, r) => a + rowsOf(r, o), 0) + (o.site ? (j.payments || []).length + (j.plans || []).length + (j.admins || []).length : 0); }
  function chunk(rows, max, maxChars) {
    const out = []; let cur = [], size = 0;
    rows.forEach((r) => { const s = JSON.stringify(r).length; if (cur.length && (cur.length >= max || size + s > maxChars)) { out.push(cur); cur = []; size = 0; } cur.push(r); size += s; });
    if (cur.length) out.push(cur); return out;
  }
  // o: { site: bool, slug, orders, images, users, skip: Set of slugs already done, onDone(slug), log(text) }
  async function restore({ api, json, o }) {
    const say = o.log || (() => {}), call = (b) => api('/api/admin/restore', 'POST', b);
    const list = json.restaurants.filter((r) => o.site || r.restaurant.slug === o.slug);
    if (!list.length) throw new Error('That restaurant is not in this file.');
    if (o.site) {
      if ((json.plans || []).length) { say('Restoring plans...'); await call({ step: 'plans', plans: json.plans }); }
      if ((json.admins || []).length) { say('Restoring admin accounts...'); await call({ step: 'admins', rows: json.admins }); }
    }
    for (const r of list) {
      const slug = r.restaurant.slug;
      if (o.skip && o.skip.has(slug)) { say('Skipping ' + slug + ' (already restored earlier).'); continue; }
      say('Restoring ' + r.restaurant.name + '...');
      const res = await call({ step: 'restaurant', mode: o.site ? 'site' : 'one', restaurant: r.restaurant }), rid = res.id;
      const go = async (step, rows, max, chars) => { for (const c of chunk(rows || [], max, chars || 600000)) await call({ step, rid, rows: c }); };
      await go('categories', r.categories, 300); if (o.images) await go('images', r.images, 8, 420000);
      await go('items', r.items, 150); await go('tables', r.tables, 300);
      if (o.users) await go('users', r.users, 50);
      if (o.orders) { say('  orders and feedback...'); await go('orders', r.orders, 150); await go('feedback', r.feedback, 300); }
      await call({ step: 'finish', rid, detail: (o.site ? 'Whole-site restore' : 'Single restaurant restore') + ' from a file made ' + String(json.created_at || '').slice(0, 10) });
      if (o.onDone) o.onDone(slug);
    }
    if (o.site && (json.payments || []).length) { say('Restoring payments...'); for (const c of chunk(json.payments, 300, 600000)) await call({ step: 'payments', rows: c }); }
    say('Done.');
  }

  window.BK = { zip, pdf, save, restaurantZip, siteBackup, readBackup, estimate, restore, reportOrders, ordersPdf, salesPdf, monthlyPdf, menuPdf, pkDay, pull };
})();

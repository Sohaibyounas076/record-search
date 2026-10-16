/* ایپ کا مرکزی کوڈ: پاس ورڈ سے ڈیٹا کھولنا، سرچ، نتائج کی فہرست اور تصویر میں محفوظ کرنا */
(function () {
  'use strict';

  var PS = window.PoliceSearch;
  var INDEX = [];
  var RESULTS = [];
  var SHOWN = 0;
  var PAGE = 100;
  var timer = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- پاس ورڈ اور ڈیٹا کھولنا ---------- */
  function b64ToBytes(b64) {
    var bin = atob(b64), n = bin.length, out = new Uint8Array(n);
    for (var i = 0; i < n; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function decryptData(password) {
    var d = window.ENC_DATA;
    if (!d) throw new Error('data.enc.js نہیں ملی');
    var raw = b64ToBytes(d.blob);
    var salt = raw.slice(0, 16), iv = raw.slice(16, 28), ct = raw.slice(28);
    var km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    var key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt, iterations: d.iter, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
    if (d.gz) {
      var stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
      buf = await new Response(stream).arrayBuffer();
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }

  async function doLogin() {
    var pw = $('pw').value;
    var err = $('loginErr'), btn = $('loginBtn');
    err.textContent = '';
    if (!pw) { err.textContent = 'پاس ورڈ لکھیں۔'; return; }
    if (!window.crypto || !crypto.subtle) { err.textContent = 'یہ براؤزر محفوظ کھولنے کی سہولت نہیں دیتا۔ Chrome یا Edge استعمال کریں۔'; return; }
    btn.disabled = true; btn.textContent = 'کھل رہا ہے...';
    try {
      var data = await decryptData(pw);
      INDEX = PS.buildIndex(data);
      window.ENC_DATA = null;
      $('login').hidden = true;
      $('app').hidden = false;
      $('dbInfo').textContent = 'کل ریکارڈ: ' + INDEX.length;
      $('qCnic').focus();
    } catch (e) {
      err.textContent = (e && e.name === 'OperationError') ? 'پاس ورڈ غلط ہے۔' : 'ڈیٹا کھولنے میں مسئلہ آیا: ' + (e && e.message ? e.message : e);
      btn.disabled = false; btn.textContent = 'کھولیں';
    }
  }

  /* ---------- سرچ اور نتائج ---------- */
  function currentQuery() {
    return { cnic: $('qCnic').value, name: $('qName').value, father: $('qFather').value, fir: $('qFir').value };
  }

  function cnicCell(rec) {
    if (!rec.cnic) return '';
    var d = PS.digitsOnly(rec.cnic);
    var txt = PS.formatCnic(rec.cnic);
    if (/^0+$/.test(d)) return '<span class="ltr faint" title="سسٹم میں خالی نشان">' + esc(txt) + '</span>';
    return '<span class="ltr">' + esc(txt) + '</span>';
  }

  function rowHtml(item) {
    var r = item.rec;
    return '<tr>' +
      '<td class="num"><span class="ltr">' + esc(r.sno) + '</span></td>' +
      '<td class="name">' + esc(r.name) + '</td>' +
      '<td>' + esc(r.father) + '</td>' +
      '<td>' + cnicCell(r) + (item.fuzzy ? '<span class="tag">ملتا جلتا</span>' : '') + '</td>' +
      '<td><span class="ltr">' + esc(r.fir) + '</span></td>' +
      '<td><span class="ltr">' + esc(r.date) + '</span></td>' +
      '<td><span class="ltr" style="max-width:320px">' + esc(r.sections) + '</span></td>' +
      '<td>' + esc(r.caseStatus) + '</td>' +
      '<td>' + esc(r.accusedStatus) + '</td>' +
      '<td class="src"><span class="ltr">' + esc(r.src) + '</span></td>' +
      '</tr>';
  }

  function renderMore() {
    var tb = $('rows');
    var end = Math.min(SHOWN + PAGE, RESULTS.length), html = '';
    for (var i = SHOWN; i < end; i++) html += rowHtml(RESULTS[i]);
    tb.insertAdjacentHTML('beforeend', html);
    SHOWN = end;
    $('more').hidden = SHOWN >= RESULTS.length;
  }

  function runSearch() {
    var q = currentQuery();
    RESULTS = PS.search(INDEX, q);
    SHOWN = 0;
    $('rows').innerHTML = '';
    var any = q.cnic.trim() || q.name.trim() || q.father.trim() || q.fir.trim();
    var empty = $('empty');
    if (!any) {
      empty.hidden = false; empty.textContent = 'اوپر کسی بھی خانے میں لکھیں، نتیجہ فوراً نیچے آ جائے گا۔';
      $('info').innerHTML = ''; $('more').hidden = true; $('saveBtn').disabled = true;
      return;
    }
    if (!RESULTS.length) {
      empty.hidden = false; empty.textContent = 'کوئی ریکارڈ نہیں ملا۔';
      $('info').innerHTML = '<span>کل نتائج: <b>0</b></span>'; $('more').hidden = true; $('saveBtn').disabled = true;
      return;
    }
    empty.hidden = true;
    renderMore();
    var fuzzy = RESULTS.filter(function (x) { return x.fuzzy; }).length;
    $('info').innerHTML = '<span>کل نتائج: <b>' + RESULTS.length + '</b></span>' +
      (fuzzy ? '<span>ملتے جلتے شناختی کارڈ: <b>' + fuzzy + '</b></span>' : '') +
      (RESULTS.length > SHOWN ? '<span>اس وقت دکھائے گئے: <b id="shownCount">' + SHOWN + '</b></span>' : '');
    $('saveBtn').disabled = false;
  }

  function showMore() {
    renderMore();
    var sc = $('shownCount'); if (sc) sc.textContent = SHOWN;
  }

  function scheduleSearch() { clearTimeout(timer); timer = setTimeout(runSearch, 250); }

  function clearAll() {
    ['qCnic', 'qName', 'qFather', 'qFir'].forEach(function (id) { $(id).value = ''; });
    runSearch(); $('qCnic').focus();
  }

  /* ---------- نتیجہ تصویر میں محفوظ کرنا ---------- */
  var COLS = [
    { t: 'نمبر', w: 66, k: 'sno', ltr: true },
    { t: 'نام ملزم', w: 200, k: 'name', bold: true },
    { t: 'ولدیت / زوجہ', w: 200, k: 'father' },
    { t: 'شناختی کارڈ', w: 190, k: 'cnic', ltr: true },
    { t: 'ایف آئی آر نمبر', w: 120, k: 'fir', ltr: true },
    { t: 'تاریخ مقدمہ', w: 160, k: 'date', ltr: true },
    { t: 'زیر دفعہ', w: 300, k: 'sections', ltr: true },
    { t: 'پوزیشن مقدمہ', w: 170, k: 'caseStatus' },
    { t: 'پوزیشن ملزم', w: 160, k: 'accusedStatus' },
    { t: 'ماخذ', w: 80, k: 'src', ltr: true }
  ];
  var URDU_FONT = '"NastaliqApp","Noto Nastaliq Urdu","Jameel Noori Nastaleeq","Urdu Typesetting",Tahoma,Arial,sans-serif';
  var LATIN_FONT = 'Arial,"Segoe UI",sans-serif';

  function fontFor(col, header) {
    if (col.ltr) return (header ? 'bold ' : '') + '15px ' + LATIN_FONT;
    return (header || col.bold ? 'bold ' : '') + (header ? '16px ' : '17px ') + URDU_FONT;
  }

  function wrapText(ctx, text, maxW) {
    text = String(text || '');
    if (!text) return [''];
    var words = text.split(' '), lines = [], cur = '';
    function pushLong(w) {
      var part = '';
      for (var i = 0; i < w.length; i++) {
        if (ctx.measureText(part + w[i]).width > maxW && part) { lines.push(part); part = w[i]; }
        else part += w[i];
      }
      return part;
    }
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var test = cur ? cur + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) { cur = test; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      if (ctx.measureText(w).width > maxW) cur = pushLong(w); else cur = w;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }

  function cellText(item, col) {
    var r = item.rec;
    if (col.k === 'cnic') {
      var t = PS.formatCnic(r.cnic);
      return item.fuzzy ? t + ' (ملتا جلتا)' : t;
    }
    return String(r[col.k] == null ? '' : r[col.k]);
  }

  function criteriaText() {
    var q = currentQuery(), parts = [];
    if (q.cnic.trim()) parts.push('شناختی کارڈ: ' + q.cnic.trim());
    if (q.name.trim()) parts.push('نام: ' + q.name.trim());
    if (q.father.trim()) parts.push('ولدیت: ' + q.father.trim());
    if (q.fir.trim()) parts.push('ایف آئی آر: ' + q.fir.trim());
    return parts.join('   |   ');
  }

  function renderPart(items, partNo, parts, total) {
    var MARGIN = 20, PADX = 10, PADY = 8;
    var W = COLS.reduce(function (s, c) { return s + c.w; }, 0) + MARGIN * 2;
    var meas = document.createElement('canvas').getContext('2d');

    // قطاروں کی اونچائی
    var rowInfo = items.map(function (it) {
      var maxLines = 1, cells = COLS.map(function (c) {
        meas.font = fontFor(c, false);
        var lines = wrapText(meas, cellText(it, c), c.w - PADX * 2);
        if (lines.length > maxLines) maxLines = lines.length;
        return lines;
      });
      var lh = 38;
      return { cells: cells, h: Math.max(54, maxLines * (lh) + PADY), lh: lh };
    });

    var TITLE_H = 150, HEAD_H = 56;
    var H = TITLE_H + HEAD_H + rowInfo.reduce(function (s, r) { return s + r.h; }, 0) + 40;
    var S = 2;
    var cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    var ctx = cv.getContext('2d');
    ctx.scale(S, S);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);

    // عنوان
    ctx.direction = 'rtl'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#0b3d6e'; ctx.font = 'bold 28px ' + URDU_FONT;
    ctx.fillText('تھانہ اربن ایریا، ملزمان ریکارڈ سرچ', W - MARGIN, 38);
    ctx.fillStyle = '#14213d'; ctx.font = '17px ' + URDU_FONT;
    ctx.fillText('تلاش: ' + (criteriaText() || '-'), W - MARGIN, 80);
    var now = new Date();
    var stamp = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    ctx.fillText('کل نتائج: ' + total + '   |   حصہ ' + partNo + ' از ' + parts + '   |   تاریخ: ' + stamp, W - MARGIN, 118);

    // ٹیبل ہیڈر
    var y = TITLE_H, xr = W - MARGIN, x;
    ctx.fillStyle = '#e8eef7'; ctx.fillRect(MARGIN, y, W - MARGIN * 2, HEAD_H);
    ctx.fillStyle = '#0b3d6e';
    x = xr;
    COLS.forEach(function (c) {
      ctx.font = 'bold 16px ' + URDU_FONT; ctx.direction = 'rtl'; ctx.textAlign = 'right';
      ctx.fillText(c.t, x - PADX, y + HEAD_H / 2);
      x -= c.w;
    });
    y += HEAD_H;

    // قطاریں
    var topBody = y;
    rowInfo.forEach(function (ri, idx) {
      if (idx % 2 === 1) { ctx.fillStyle = '#f6f8fc'; ctx.fillRect(MARGIN, y, W - MARGIN * 2, ri.h); }
      x = xr;
      COLS.forEach(function (c, ci) {
        ctx.font = fontFor(c, false);
        ctx.fillStyle = (c.k === 'sno' || c.k === 'src') ? '#5f6b7a' : '#14213d';
        if (c.k === 'cnic' && /^0+$/.test(PS.digitsOnly(items[idx].rec.cnic))) ctx.fillStyle = '#9aa5b4';
        ctx.direction = c.ltr ? 'ltr' : 'rtl'; ctx.textAlign = 'right';
        var lines = ri.cells[ci];
        var totalH = lines.length * ri.lh, startY = y + (ri.h - totalH) / 2 + ri.lh / 2;
        for (var li = 0; li < lines.length; li++) ctx.fillText(lines[li], x - PADX, startY + li * ri.lh);
        x -= c.w;
      });
      y += ri.h;
      ctx.strokeStyle = '#d9e0ea'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(MARGIN, y); ctx.lineTo(W - MARGIN, y); ctx.stroke();
    });

    // عمودی لائنیں اور باہر کا فریم
    ctx.strokeStyle = '#d9e0ea';
    x = xr;
    for (var i = 0; i <= COLS.length; i++) {
      ctx.beginPath(); ctx.moveTo(x, TITLE_H); ctx.lineTo(x, y); ctx.stroke();
      if (i < COLS.length) x -= COLS[i].w;
    }
    ctx.strokeStyle = '#0b3d6e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(MARGIN, TITLE_H + HEAD_H); ctx.lineTo(W - MARGIN, TITLE_H + HEAD_H); ctx.stroke();
    return cv;
  }

  function downloadCanvas(cv, name) {
    return new Promise(function (resolve) {
      cv.toBlob(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); resolve(); }, 500);
      }, 'image/png');
    });
  }

  async function saveImages() {
    if (!RESULTS.length) return;
    var PER = 40, parts = Math.ceil(RESULTS.length / PER);
    if (parts > 5 && !confirm('نتائج ' + RESULTS.length + ' ہیں۔ ' + parts + ' تصاویر بنیں گی۔ جاری رکھیں؟')) return;
    var btn = $('saveBtn'), prog = $('progress');
    btn.disabled = true;
    try {
      await document.fonts.load('17px NastaliqApp', 'ابپ');
      await document.fonts.load('bold 17px NastaliqApp', 'ابپ');
      var stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      for (var p = 0; p < parts; p++) {
        prog.textContent = 'تصویر بن رہی ہے: ' + (p + 1) + ' / ' + parts;
        var slice = RESULTS.slice(p * PER, (p + 1) * PER);
        var cv = renderPart(slice, p + 1, parts, RESULTS.length);
        await downloadCanvas(cv, 'search-result-' + stamp + (parts > 1 ? '-part' + (p + 1) : '') + '.png');
        cv.width = cv.height = 1;
      }
      prog.textContent = 'تصویر محفوظ ہو گئی۔';
      setTimeout(function () { prog.textContent = ''; }, 4000);
    } catch (e) {
      prog.textContent = 'تصویر بنانے میں مسئلہ آیا۔';
    }
    btn.disabled = false;
  }

  /* ---------- شروع ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    $('loginBtn').addEventListener('click', doLogin);
    $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    ['qCnic', 'qName', 'qFather', 'qFir'].forEach(function (id) {
      $(id).addEventListener('input', scheduleSearch);
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(timer); runSearch(); } });
    });
    $('goBtn').addEventListener('click', function () { clearTimeout(timer); runSearch(); });
    $('clearBtn').addEventListener('click', clearAll);
    $('moreBtn').addEventListener('click', showMore);
    $('saveBtn').addEventListener('click', saveImages);
    $('pw').focus();
  });
})();

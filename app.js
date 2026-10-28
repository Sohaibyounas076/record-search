/* ایپ کا مرکزی کوڈ: لاگ ان، ڈیٹا کھولنا، سرچ، نتائج کی فہرست اور تصویر میں محفوظ کرنا */
(function () {
  'use strict';

  var PS = window.PoliceSearch;
  var INDEX = [];
  var BY_SNO = null;
  var RESULTS = [];
  var SHOWN = 0;
  var PAGE = window.innerWidth < 760 ? 30 : 100;
  var timer = null, logTimer = null, lastLogKey = '';
  var pingTimer = null, idleTimer = null;
  var IDLE_MS = 30 * 60 * 1000;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ایڈمن پینل کو لاگ کے نمبروں سے ریکارڈ دکھانے کے لیے
  window.RS = {
    lookup: function (sno) {
      if (!BY_SNO) { BY_SNO = {}; for (var i = 0; i < INDEX.length; i++) BY_SNO[INDEX[i].sno] = INDEX[i]; }
      return BY_SNO[sno] || null;
    }
  };

  /* ---------- لاگ ان ---------- */
  var LOGIN_ERR = {
    invalid: 'پاس ورڈ غلط ہے۔',
    locked: 'کئی غلط کوششیں ہوئیں۔ کچھ دیر بعد دوبارہ کوشش کریں۔',
    disabled: 'یہ اکاؤنٹ بند ہے۔ ایڈمن سے رابطہ کریں۔',
    badkey: 'اس اکاؤنٹ کی کنجی خراب ہے۔ ایڈمن سے پاس ورڈ دوبارہ سیٹ کروائیں۔'
  };

  function stopTimers() { clearInterval(pingTimer); clearTimeout(idleTimer); clearTimeout(timer); clearTimeout(logTimer); }

  function showLoginScreen(msg) {
    stopTimers();
    INDEX = []; BY_SNO = null; RESULTS = []; SHOWN = 0; lastLogKey = ''; pending = null;
    $('rows').innerHTML = '';
    ['qCnic', 'qName', 'qFather', 'qFir'].forEach(function (id) { $(id).value = ''; });
    $('hintName').hidden = $('hintFather').hidden = true;
    $('info').innerHTML = ''; $('saveBtn').disabled = true;
    $('empty').hidden = false; $('more').hidden = true;
    $('pwDialog').hidden = true; $('entDialog').hidden = true;
    AdminUI.reset();
    $('app').hidden = true;
    $('login').hidden = false;
    $('pw').value = ''; $('pw').type = 'password'; $('pwToggle').textContent = 'دکھائیں';
    $('loginErr').textContent = msg || '';
    var btn = $('loginBtn'); btn.disabled = false; btn.textContent = 'لاگ ان';
    $('pw').focus();
  }

  function forceLogout(msg) {
    Auth.logout();
    showLoginScreen(msg || 'سیشن ختم ہو گیا۔ دوبارہ لاگ ان کریں۔');
  }

  function resetIdle() {
    if (!Auth.state.token) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { forceLogout('کافی دیر کام نہ ہونے پر لاگ آؤٹ ہو گئے۔'); }, IDLE_MS);
  }
  function startTimers() {
    stopTimers();
    pingTimer = setInterval(function () {
      Auth.ping().catch(function (e) {
        if (e && e.code === 'unauthorized') forceLogout('آپ کا لاگ ان ختم ہو گیا۔ دوبارہ لاگ ان کریں۔');
      });
    }, 3 * 60 * 1000);
    resetIdle();
  }

  function showSearchView() {
    $('adminView').hidden = true; $('searchView').hidden = false;
    $('navSearch').hidden = true; $('navAdmin').hidden = Auth.state.role !== 'admin';
  }
  function showAdminView() {
    flushPending();
    $('searchView').hidden = true; $('adminView').hidden = false;
    $('navAdmin').hidden = true; $('navSearch').hidden = false;
    AdminUI.open();
  }

  async function doLogin() {
    var btn = $('loginBtn'), err = $('loginErr');
    if (btn.disabled) return;
    var pw = $('pw').value.trim();
    err.textContent = '';
    if (!Auth.configured()) { err.textContent = 'config.js میں Supabase کی معلومات درج نہیں ہیں۔'; return; }
    if (!pw) { err.textContent = 'پاس ورڈ لکھیں۔'; return; }
    if (!window.crypto || !crypto.subtle) { err.textContent = 'یہ براؤزر محفوظ کھولنے کی سہولت نہیں دیتا۔ Chrome یا Edge استعمال کریں۔'; return; }
    btn.disabled = true; btn.textContent = 'کھل رہا ہے...';
    try {
      var r = await Auth.login(pw);
      if (!r.ok) {
        var m = LOGIN_ERR[r.error] || LOGIN_ERR.invalid;
        if (r.error === 'invalid' && /[^\x20-\x7E]/.test(pw)) m += ' کی بورڈ انگریزی پر کر کے لکھیں۔';
        err.textContent = m; btn.disabled = false; btn.textContent = 'لاگ ان'; return;
      }
      var data = await Auth.decryptData();
      INDEX = PS.buildIndex(data); BY_SNO = null;
      lastLogKey = '';
      $('login').hidden = true;
      $('app').hidden = false;
      $('pw').value = '';
      $('dbInfo').textContent = 'کل ریکارڈ: ' + INDEX.length;
      $('whoami').textContent = Auth.state.name + (Auth.state.role === 'admin' ? ' (ایڈمن)' : '');
      showSearchView();
      startTimers();
      $('qCnic').focus();
    } catch (e) {
      Auth.logout();
      err.textContent = (e && e.code === 'network') ? 'انٹرنیٹ یا سرور سے رابطہ نہیں ہوا۔'
        : (e && e.name === 'OperationError') ? 'ڈیٹا کھل نہیں سکا۔ ایڈمن سے رابطہ کریں۔'
        : 'مسئلہ آیا: ' + (e && e.message ? e.message : e);
      btn.disabled = false; btn.textContent = 'لاگ ان';
    }
  }

  /* ---------- سرچ لاگ (ایڈمن کو دکھانے کے لیے) ---------- */
  function currentQuery() {
    return { cnic: $('qCnic').value, name: $('qName').value, father: $('qFather').value, fir: $('qFir').value };
  }

  var pending = null;
  function sendLog(p) {
    if (p.key === lastLogKey) return;
    lastLogKey = p.key;
    Auth.logEvent('search', p.t, p.count, p.snos).catch(function (e) { if (e && e.code === 'unauthorized') forceLogout(); });
  }
  function flushPending() {
    clearTimeout(logTimer);
    var p = pending; pending = null;
    if (p) sendLog(p);
  }
  // نتیجہ کچھ دیر دیکھا گیا ہو تو لاگ ہوتا ہے۔ ٹائپ کرتے ہوئے ادھورے الفاظ لاگ نہیں ہوتے۔
  function queueLog(immediate) {
    var q = currentQuery();
    var t = { cnic: q.cnic.trim(), name: q.name.trim(), father: q.father.trim(), fir: q.fir.trim() };
    if (!(t.cnic || t.name || t.father || t.fir)) return;
    var key = [t.cnic, t.name, t.father, t.fir].join('|');
    if (pending && pending.key !== key && Date.now() - pending.shownAt >= 1500) flushPending();
    else { clearTimeout(logTimer); pending = null; }
    var p = {
      t: t, key: key, count: RESULTS.length, shownAt: Date.now(),
      snos: RESULTS.slice(0, 60).map(function (x) { return x.rec.sno; })
    };
    if (immediate) sendLog(p);
    else { pending = p; logTimer = setTimeout(flushPending, 2000); }
  }

  /* ---------- سرچ اور نتائج ---------- */
  var LATIN = /[A-Za-z]/;
  var HINT_TXT = 'ڈیٹا اردو میں ہے۔ نام اردو میں لکھیں (کی بورڈ اردو پر کریں)۔';
  function updateHints() {
    [['qName', 'hintName'], ['qFather', 'hintFather']].forEach(function (p) {
      var has = LATIN.test($(p[0]).value), h = $(p[1]);
      h.hidden = !has; if (has) h.textContent = HINT_TXT;
    });
  }

  function cnicCell(rec) {
    if (!rec.cnic) return '';
    var d = PS.digitsOnly(rec.cnic);
    var txt = PS.formatCnic(rec.cnic);
    if (/^0+$/.test(d)) return '<span class="ltr faint" title="سسٹم میں خالی نشان">' + esc(txt) + '</span>';
    return '<span class="ltr">' + esc(txt) + '</span>';
  }

  function ltr(v) { return v == null || v === '' ? '' : '<span class="ltr">' + esc(v) + '</span>'; }
  function cell(label, inner, cls) {
    return '<td' + (cls ? ' class="' + cls + '"' : '') + ' data-label="' + label + '">' + inner + '</td>';
  }

  function rowHtml(item) {
    var r = item.rec;
    return '<tr>' +
      cell('نمبر', ltr(r.sno), 'num') +
      cell('نام ملزم', esc(r.name), 'name') +
      cell('ولدیت / زوجہ', esc(r.father)) +
      cell('شناختی کارڈ', cnicCell(r) + (item.fuzzy ? '<span class="tag">ملتا جلتا</span>' : '')) +
      cell('ایف آئی آر نمبر', ltr(r.fir)) +
      cell('تاریخ مقدمہ', ltr(r.date)) +
      cell('زیر دفعہ', r.sections ? '<span class="ltr" style="max-width:320px">' + esc(r.sections) + '</span>' : '') +
      cell('پوزیشن مقدمہ', esc(r.caseStatus)) +
      cell('پوزیشن ملزم', esc(r.accusedStatus)) +
      cell('ماخذ', ltr(r.src), 'src') +
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

  function runSearch(immediate) {
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
      var latin = LATIN.test(q.name) || LATIN.test(q.father);
      empty.hidden = false; empty.textContent = latin ? 'کوئی ریکارڈ نہیں ملا۔ نام اردو میں لکھیں، انگریزی میں نتیجہ نہیں آتا۔' : 'کوئی ریکارڈ نہیں ملا۔';
      $('info').innerHTML = '<span>کل نتائج: <b>0</b></span>'; $('more').hidden = true; $('saveBtn').disabled = true;
      queueLog(immediate === true);
      return;
    }
    empty.hidden = true;
    renderMore();
    var fuzzy = RESULTS.filter(function (x) { return x.fuzzy; }).length;
    $('info').innerHTML = '<span>کل نتائج: <b>' + RESULTS.length + '</b></span>' +
      (fuzzy ? '<span>ملتے جلتے شناختی کارڈ: <b>' + fuzzy + '</b></span>' : '') +
      (RESULTS.length > SHOWN ? '<span>اس وقت دکھائے گئے: <b id="shownCount">' + SHOWN + '</b></span>' : '');
    $('saveBtn').disabled = false;
    queueLog(immediate === true);
  }

  function showMore() {
    renderMore();
    var sc = $('shownCount'); if (sc) sc.textContent = SHOWN;
  }

  function scheduleSearch() { clearTimeout(timer); timer = setTimeout(runSearch, 300); }

  function clearAll() {
    ['qCnic', 'qName', 'qFather', 'qFir'].forEach(function (id) { $(id).value = ''; });
    updateHints();
    lastLogKey = ''; runSearch(); $('qCnic').focus();
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

  function loadFont(spec) {
    try { return document.fonts.load(spec, 'ابپ').catch(function () {}); } catch (e) { return Promise.resolve(); }
  }

  async function saveImages() {
    if (!RESULTS.length) return;
    var PER = 40, parts = Math.ceil(RESULTS.length / PER);
    if (parts > 5 && !confirm('نتائج ' + RESULTS.length + ' ہیں۔ ' + parts + ' تصاویر بنیں گی۔ جاری رکھیں؟')) return;
    var btn = $('saveBtn'), prog = $('progress');
    var qe = currentQuery();
    Auth.logEvent('export', { cnic: qe.cnic.trim(), name: qe.name.trim(), father: qe.father.trim(), fir: qe.fir.trim() }, RESULTS.length,
      RESULTS.slice(0, 60).map(function (x) { return x.rec.sno; }))
      .catch(function (e) { if (e && e.code === 'unauthorized') forceLogout(); });
    btn.disabled = true;
    try {
      // فونٹ نہ بھی ملے تو تصویر عام فونٹ سے بن جائے گی
      await Promise.all([loadFont('17px NastaliqApp'), loadFont('bold 17px NastaliqApp')]);
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
    $('pw').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) doLogin(); });
    $('pwToggle').addEventListener('click', function () {
      var show = $('pw').type === 'password';
      $('pw').type = show ? 'text' : 'password';
      $('pwToggle').textContent = show ? 'چھپائیں' : 'دکھائیں';
    });
    $('logoutBtn').addEventListener('click', function () { flushPending(); forceLogout('آپ لاگ آؤٹ ہو گئے۔'); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) flushPending(); });
    $('navAdmin').addEventListener('click', showAdminView);
    $('navSearch').addEventListener('click', showSearchView);
    AdminUI.init(function () { forceLogout('سیشن ختم ہو گیا۔ دوبارہ لاگ ان کریں۔'); });

    ['qCnic', 'qName', 'qFather', 'qFir'].forEach(function (id) {
      $(id).addEventListener('input', function () { updateHints(); scheduleSearch(); });
      $(id).addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) { clearTimeout(timer); runSearch(true); } });
    });
    $('goBtn').addEventListener('click', function () { clearTimeout(timer); runSearch(true); });
    $('clearBtn').addEventListener('click', clearAll);
    $('moreBtn').addEventListener('click', showMore);
    $('saveBtn').addEventListener('click', saveImages);
    ['click', 'keydown', 'touchstart', 'input'].forEach(function (ev) { document.addEventListener(ev, resetIdle, { passive: true }); });

    if (!Auth.configured()) $('loginErr').textContent = 'config.js میں Supabase کی معلومات درج نہیں ہیں۔';
    $('pw').focus();
  });
})();

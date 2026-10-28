/* ایڈمن پینل: صارفین بنانا، پاس ورڈ بدلنا، بند/کھولنا، سرچ ریکارڈ دیکھنا اور ڈیٹا اپ ڈیٹ کرنا */
(function () {
  'use strict';

  var A = window.Auth;
  var onExpired = function () {};
  var USERS = [];
  var LOG = { page: 0, size: 50, total: 0 };
  var pwTarget = null;
  var autoPw = '';          // آخری خود بنایا ہوا پاس ورڈ
  var lastRows = [];        // موجودہ صفحے کی لاگ قطاریں

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(ts) {
    if (!ts) return '-';
    return new Date(ts).toLocaleString('en-GB', {
      timeZone: 'Asia/Karachi', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });
  }
  function say(el, msg, ok) {
    el.textContent = msg || '';
    el.className = 'msg ' + (ok ? 'okmsg' : 'badmsg');
  }
  function ltr(v) { return v == null || v === '' ? '' : '<span class="ltr">' + esc(v) + '</span>'; }
  function td(label, html, cls) {
    return '<td' + (cls ? ' class="' + cls + '"' : '') + ' data-label="' + esc(label) + '">' + html + '</td>';
  }
  var ERR = {
    exists: 'یہ پاس ورڈ پہلے سے کسی اور صارف کے پاس ہے۔ دوسرا پاس ورڈ چنیں۔',
    bad_name: 'نام لکھیں۔',
    weak_password: 'پاس ورڈ کم از کم 8 حروف کا ہو۔',
    bad_role: 'کردار درست نہیں۔',
    bad_data: 'معلومات درست نہیں۔',
    not_found: 'صارف نہیں ملا۔',
    self: 'اپنے ہی اکاؤنٹ پر یہ عمل نہیں ہو سکتا۔'
  };
  function failMsg(e) {
    if (e && e.code === 'unauthorized') { onExpired(); return ''; }
    if (e && e.code === 'forbidden') return 'اس کام کی اجازت نہیں۔';
    if (e && e.code === 'network') return 'انٹرنیٹ یا سرور سے رابطہ نہیں ہوا۔';
    return 'مسئلہ آیا: ' + (e && e.message ? e.message : e);
  }
  function siteUrl() { return location.origin + location.pathname; }
  function credMessage(name, pw) {
    return 'ریکارڈ سرچ\nنام: ' + name + '\nپاس ورڈ: ' + pw + '\nلنک: ' + siteUrl();
  }

  /* ---------- ٹیبز ---------- */
  var TABS = ['users', 'logs', 'data'];
  function showTab(name, noLoad) {
    TABS.forEach(function (t) {
      $('tab-' + t).classList.toggle('active', t === name);
      $('pane-' + t).hidden = t !== name;
    });
    if (name === 'users') loadUsers();
    if (name === 'logs') { fillUserFilter(); if (!noLoad) loadLogs(0); }
  }

  /* ---------- صارفین ---------- */
  async function loadUsers() {
    var box = $('usersMsg');
    try {
      USERS = (await A.adminUsers()) || [];
      renderUsers();
      say(box, '', true);
    } catch (e) { var m = failMsg(e); if (m) say(box, m, false); }
  }

  function renderUsers() {
    var totalS = 0, totalR = 0, totalE = 0;
    USERS.forEach(function (u) { totalS += u.searches; totalR += u.results; totalE += u.exports; });
    $('sumUsers').textContent = USERS.length;
    $('sumSearches').textContent = totalS;
    $('sumResults').textContent = totalR;
    $('sumExports').textContent = totalE;
    var html = '';
    USERS.forEach(function (u) {
      var me = u.id === A.state.id, sid = String(u.id);
      html += '<tr>' +
        td('نام', esc(u.name) + (me ? ' <span class="badge">آپ</span>' : ''), 'name') +
        td('کردار', u.role === 'admin' ? '<span class="badge adm">ایڈمن</span>' : '<span class="badge">صارف</span>') +
        td('حالت', u.active ? '<span class="badge on">فعال</span>' : '<span class="badge off">بند</span>') +
        td('سرچ', '<b>' + u.searches + '</b>') +
        td('نتائج دیکھے', u.results) +
        td('تصویر', u.exports) +
        td('آخری لاگ ان', ltr(fmt(u.last_login))) +
        td('آخری سرچ', '<span class="ltr">' + fmt(u.last_search) + '</span>') +
        td('عمل',
          '<button class="mini" data-act="logs" data-id="' + sid + '">ریکارڈ</button>' +
          '<button class="mini" data-act="pw" data-id="' + sid + '">پاس ورڈ بدلیں</button>' +
          '<button class="mini" data-act="rename" data-id="' + sid + '">نام بدلیں</button>' +
          (me ? '' :
            '<button class="mini" data-act="toggle" data-id="' + sid + '" data-a="' + (u.active ? '0' : '1') + '">' + (u.active ? 'بند کریں' : 'کھولیں') + '</button>' +
            '<button class="mini danger" data-act="del" data-id="' + sid + '">حذف</button>'),
          'acts') +
        '</tr>';
    });
    $('usersBody').innerHTML = html || '<tr><td colspan="9" class="empty">کوئی صارف نہیں۔</td></tr>';
  }

  function userById(id) {
    for (var i = 0; i < USERS.length; i++) if (String(USERS[i].id) === String(id)) return USERS[i];
    return null;
  }

  function newAutoPw() { autoPw = A.randomPassword(); return autoPw; }

  async function createUser() {
    var m = $('createMsg'), btn = $('createBtn');
    var name = $('nuName').value.trim(), role = $('nuRole').value, pw = $('nuPass').value.trim();
    if (!name) return say(m, ERR.bad_name, false);
    if (pw.length < 8) return say(m, ERR.weak_password, false);
    btn.disabled = true; say(m, 'بن رہا ہے...', true);
    try {
      var r = null, tries = 0;
      while (true) {
        r = await A.adminAddUser(name, role, pw);
        // خود بنایا ہوا پاس ورڈ پہلے سے کسی کے پاس نکلا تو نیا بنا کر دوبارہ کوشش
        if (r && !r.ok && r.error === 'exists' && pw === autoPw && tries < 5) { tries++; pw = newAutoPw(); continue; }
        break;
      }
      if (r && r.ok) {
        say(m, '', true);
        $('credBox').hidden = false;
        $('credText').textContent = 'نام: ' + name + '\nپاس ورڈ: ' + pw + '\nلنک: ' + siteUrl();
        $('credBox').setAttribute('data-name', name); $('credBox').setAttribute('data-pw', pw);
        $('nuName').value = ''; $('nuPass').value = newAutoPw();
        loadUsers();
      } else {
        if (r && r.error === 'exists') $('nuPass').value = newAutoPw();
        say(m, ERR[r && r.error] || 'صارف نہیں بن سکا۔', false);
      }
    } catch (e) { var x = failMsg(e); if (x) say(m, x, false); }
    btn.disabled = false;
  }

  function copyText(text, btn) {
    var done = function () { var o = btn.textContent; btn.textContent = 'کاپی ہو گیا'; setTimeout(function () { btn.textContent = o; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () {});
    else { var t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) {} t.remove(); }
  }
  function openWhatsApp(text) {
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  /* ---------- پاس ورڈ بدلنے کا ڈائیلاگ ---------- */
  function openPw(id) {
    var u = userById(id); if (!u) return;
    pwTarget = u;
    $('pwTitle').textContent = 'پاس ورڈ بدلیں: ' + u.name;
    $('pwNew').value = newAutoPw();
    say($('pwMsg'), '', true);
    $('pwCopy').hidden = true;
    $('pwDialog').hidden = false;
    $('pwNew').focus();
  }
  async function savePw() {
    var pw = $('pwNew').value.trim(), m = $('pwMsg'), btn = $('pwSave');
    if (pw.length < 8) return say(m, ERR.weak_password, false);
    btn.disabled = true;
    try {
      var r = await A.adminSetPassword(pwTarget.id, pw);
      if (r && r.ok) {
        say(m, 'پاس ورڈ بدل گیا۔ اس صارف کے پرانے لاگ ان ختم ہو گئے۔ نیا پاس ورڈ اسے بتا دیں۔', true);
        $('pwCopy').hidden = false;
      } else say(m, ERR[r && r.error] || 'پاس ورڈ نہیں بدلا۔', false);
    } catch (e) { var x = failMsg(e); if (x) say(m, x, false); }
    btn.disabled = false;
  }

  async function userAction(act, id, extra) {
    var box = $('usersMsg'), u = userById(id);
    if (!u) return;
    try {
      if (act === 'logs') { showTab('logs', true); $('lfUser').value = String(u.id); loadLogs(0); return; }
      if (act === 'pw') return openPw(id);
      if (act === 'rename') {
        var nn = prompt('نیا نام لکھیں', u.name);
        if (nn === null) return;
        nn = nn.trim();
        if (!nn) return say(box, ERR.bad_name, false);
        var r0 = await A.adminRename(u.id, nn);
        if (!r0.ok) return say(box, ERR[r0.error] || 'نام نہیں بدلا۔', false);
      }
      if (act === 'toggle') {
        var on = extra === '1';
        if (!on && !confirm(u.name + ' کو بند کریں؟ اس کا لاگ ان فوراً ختم ہو جائے گا۔')) return;
        var r1 = await A.adminSetActive(u.id, on);
        if (!r1.ok) return say(box, ERR[r1.error] || 'عمل نہیں ہوا۔', false);
      }
      if (act === 'del') {
        if (!confirm(u.name + ' کو مستقل حذف کریں؟ اس کا سرچ ریکارڈ لاگ میں باقی رہے گا۔')) return;
        var r2 = await A.adminDeleteUser(u.id);
        if (!r2.ok) return say(box, ERR[r2.error] || 'عمل نہیں ہوا۔', false);
      }
      loadUsers();
    } catch (e) { var x = failMsg(e); if (x) say(box, x, false); }
  }

  /* ---------- سرچ ریکارڈ ---------- */
  function fillUserFilter() {
    var sel = $('lfUser'), cur = sel.value;
    var h = '<option value="">سب صارفین</option>';
    USERS.forEach(function (u) { h += '<option value="' + u.id + '">' + esc(u.name) + '</option>'; });
    sel.innerHTML = h; sel.value = cur;
  }

  function dayStart(d) { return d ? d + 'T00:00:00+05:00' : null; }
  function dayEnd(d) {
    if (!d) return null;
    var t = new Date(d + 'T00:00:00+05:00'); t.setDate(t.getDate() + 1);
    return t.toISOString();
  }
  function actionBadge(a) {
    return a === 'export' ? '<span class="badge adm">تصویر محفوظ</span>'
      : a === 'login' ? '<span class="badge">لاگ ان</span>' : '<span class="badge on">سرچ</span>';
  }
  function filterArgs() {
    return [Number($('lfUser').value) || 0, dayStart($('lfFrom').value), dayEnd($('lfTo').value), $('lfAction').value];
  }

  async function loadLogs(page) {
    var box = $('logsMsg');
    LOG.page = Math.max(0, page || 0);
    try {
      if (!USERS.length) { USERS = (await A.adminUsers()) || []; fillUserFilter(); }
      var f = filterArgs();
      var r = await A.adminLogs(f[0], f[1], f[2], f[3], LOG.size, LOG.page * LOG.size);
      LOG.total = r.total;
      lastRows = r.rows || [];
      var html = '';
      lastRows.forEach(function (l, i) {
        var n = l.result_snos ? l.result_snos.length : 0;
        html += '<tr>' +
          td('وقت', '<span class="ltr">' + fmt(l.created_at) + '</span>') +
          td('صارف', esc(l.user_name), 'name') +
          td('قسم', actionBadge(l.action)) +
          td('شناختی کارڈ', ltr(l.q_cnic)) +
          td('نام', esc(l.q_name)) +
          td('ولدیت', esc(l.q_father)) +
          td('ایف آئی آر', ltr(l.q_fir)) +
          td('نتائج', '<b>' + (l.result_count == null ? '-' : l.result_count) + '</b>') +
          td('ریکارڈ', n ? '<button class="mini" data-ent="' + i + '">دیکھیں (' + n + ')</button>' : '-') +
          '</tr>';
      });
      $('logsBody').innerHTML = html || '<tr><td colspan="9" class="empty">کوئی ریکارڈ نہیں۔</td></tr>';
      var pages = Math.max(1, Math.ceil(LOG.total / LOG.size));
      $('logInfo').textContent = 'کل اندراجات: ' + LOG.total + '   |   صفحہ ' + (LOG.page + 1) + ' از ' + pages;
      $('logPrev').disabled = LOG.page <= 0;
      $('logNext').disabled = LOG.page + 1 >= pages;
      say(box, '', true);
    } catch (e) { var m = failMsg(e); if (m) say(box, m, false); }
  }

  function showEntries(i) {
    var l = lastRows[i]; if (!l) return;
    var lookup = (window.RS && window.RS.lookup) || function () { return null; };
    var html = '', shown = 0;
    (l.result_snos || []).forEach(function (s) {
      var r = lookup(s); if (!r) return;
      shown++;
      html += '<tr>' +
        td('نمبر', '<span class="ltr">' + esc(r.sno) + '</span>') +
        td('نام ملزم', esc(r.name), 'name') +
        td('ولدیت', esc(r.father)) +
        td('شناختی کارڈ', ltr(r.cnic ? window.PoliceSearch.formatCnic(r.cnic) : '')) +
        td('ایف آئی آر', ltr(r.fir)) +
        '</tr>';
    });
    $('entTitle').textContent = l.user_name + ': ' + (l.result_count == null ? shown : l.result_count) + ' نتائج' +
      (l.result_snos && l.result_count > l.result_snos.length ? ' (پہلے ' + l.result_snos.length + ' دکھائے گئے)' : '');
    $('entBody').innerHTML = html || '<tr><td colspan="5" class="empty">ریکارڈ نہیں ملے۔</td></tr>';
    $('entDialog').hidden = false;
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  async function exportCsv() {
    var box = $('logsMsg'), btn = $('lfCsv');
    btn.disabled = true; say(box, 'فائل بن رہی ہے...', true);
    try {
      var f = filterArgs(), rows = [], total = 0, p = 0;
      do {
        var r = await A.adminLogs(f[0], f[1], f[2], f[3], 200, p * 200);
        total = r.total; rows = rows.concat(r.rows || []); p++;
      } while (rows.length < total && p < 50);
      var out = ['وقت,صارف,قسم,شناختی کارڈ,نام,ولدیت,ایف آئی آر,نتائج,ریکارڈ نمبر'];
      rows.forEach(function (l) {
        out.push([fmt(l.created_at), l.user_name, l.action, l.q_cnic, l.q_name, l.q_father, l.q_fir, l.result_count,
          (l.result_snos || []).join(' ')].map(csvCell).join(','));
      });
      var blob = new Blob(['\uFEFF' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'search-log-' + new Date().toISOString().slice(0, 10) + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      say(box, rows.length + ' اندراجات محفوظ ہو گئے' + (rows.length < total ? ' (کل ' + total + ' میں سے، تاریخ کا فلٹر لگا کر باقی لیں)' : '') + '۔', true);
    } catch (e) { var m = failMsg(e); if (m) say(box, m, false); }
    btn.disabled = false;
  }

  /* ---------- ڈیٹا اپ ڈیٹ (records.json سے نئی data.enc.js) ---------- */
  var FIELDS = ['sno', 'name', 'father', 'cnic', 'fir', 'date', 'sections', 'caseStatus', 'accusedStatus', 'statusDate', 'nominee', 'phone', 'src'];
  function g(r, k) { return Object.prototype.hasOwnProperty.call(r, k) ? r[k] : ''; }
  function cleanDate(s) { return String(s || '').trim().replace(/-\s+/g, '-'); }
  function cleanCnic(s) { return String(s || '').trim().replace(/\s+/g, ''); }
  function cleanSections(s) {
    var parts = String(s || '').trim().split(/,(?=[A-Za-z]{3})/), seen = [];
    parts.forEach(function (p) { p = p.trim(); if (p && seen.indexOf(p) === -1) seen.push(p); });
    return seen.join(',');
  }
  function compact(rows) {
    return rows.map(function (r) {
      var sno = Math.trunc(Number(r.sno));
      if (!isFinite(sno)) throw new Error('sno درست نہیں');
      return [sno, g(r, 'name'), g(r, 'father'), cleanCnic(g(r, 'cnic')), g(r, 'fir'),
        cleanDate(g(r, 'date')), cleanSections(g(r, 'sections')), g(r, 'case_status'),
        g(r, 'accused_status'), cleanDate(g(r, 'cur_status_date')), g(r, 'nominee_type'),
        String(g(r, 'phone') || '').replace(/\s+/g, ''), g(r, 'file') + '-' + g(r, 'page')];
    });
  }
  async function buildData() {
    var m = $('dataMsg'), btn = $('dataBuild'), f = $('dataFile').files[0];
    if (!f) return say(m, 'پہلے records.json فائل چنیں۔', false);
    btn.disabled = true; say(m, 'فائل پڑھی جا رہی ہے...', true);
    try {
      var rows = JSON.parse(await f.text());
      if (!Array.isArray(rows) || !rows.length) throw new Error('فائل میں ریکارڈ نہیں ہیں');
      var payload = JSON.stringify({ fields: FIELDS, rows: compact(rows) });
      say(m, 'انکرپٹ ہو رہا ہے...', true);
      var text = await A.buildDataFile(new TextEncoder().encode(payload));
      var check = await A.verifyDataText(text);
      if (check !== rows.length) throw new Error('جانچ ناکام: ریکارڈ کی تعداد نہیں ملی');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' })); a.download = 'data.enc.js';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      say(m, 'data.enc.js بن گئی (' + rows.length + ' ریکارڈ)۔ اسے GitHub پر پرانی فائل کی جگہ اپ لوڈ کریں۔', true);
    } catch (e) { say(m, 'مسئلہ آیا: ' + (e && e.message ? e.message : e), false); }
    btn.disabled = false;
  }

  /* ---------- شروع ---------- */
  function init(expiredCb) {
    onExpired = expiredCb || onExpired;
    TABS.forEach(function (t) { $('tab-' + t).addEventListener('click', function () { showTab(t); }); });
    $('createBtn').addEventListener('click', createUser);
    $('genPass').addEventListener('click', function () { $('nuPass').value = newAutoPw(); });
    $('credCopy').addEventListener('click', function () { copyText($('credText').textContent, $('credCopy')); });
    $('credWa').addEventListener('click', function () {
      var b = $('credBox'); openWhatsApp(credMessage(b.getAttribute('data-name') || '', b.getAttribute('data-pw') || ''));
    });
    $('usersBody').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-act]'); if (!b) return;
      userAction(b.getAttribute('data-act'), b.getAttribute('data-id'), b.getAttribute('data-a'));
    });
    $('pwSave').addEventListener('click', savePw);
    $('pwGen').addEventListener('click', function () { $('pwNew').value = newAutoPw(); $('pwCopy').hidden = true; });
    $('pwCopy').addEventListener('click', function () { copyText(credMessage(pwTarget ? pwTarget.name : '', $('pwNew').value), $('pwCopy')); });
    $('pwClose').addEventListener('click', function () { $('pwDialog').hidden = true; loadUsers(); });
    $('lfGo').addEventListener('click', function () { loadLogs(0); });
    $('lfClear').addEventListener('click', function () { $('lfUser').value = ''; $('lfAction').value = ''; $('lfFrom').value = ''; $('lfTo').value = ''; loadLogs(0); });
    $('lfCsv').addEventListener('click', exportCsv);
    $('logPrev').addEventListener('click', function () { loadLogs(LOG.page - 1); });
    $('logNext').addEventListener('click', function () { loadLogs(LOG.page + 1); });
    $('logsBody').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-ent]'); if (b) showEntries(Number(b.getAttribute('data-ent')));
    });
    $('entClose').addEventListener('click', function () { $('entDialog').hidden = true; });
    $('dataBuild').addEventListener('click', buildData);
  }

  function open() {
    $('nuPass').value = newAutoPw();
    $('credBox').hidden = true;
    $('dataMsg').textContent = '';
    showTab('users');
  }

  // لاگ آؤٹ پر ایڈمن کی ساری معلومات صفحے سے ہٹا دیتا ہے
  function reset() {
    USERS = []; lastRows = []; pwTarget = null; autoPw = '';
    ['usersBody', 'logsBody', 'entBody'].forEach(function (id) { $(id).innerHTML = ''; });
    ['sumUsers', 'sumSearches', 'sumResults', 'sumExports'].forEach(function (id) { $(id).textContent = '0'; });
    ['usersMsg', 'createMsg', 'logsMsg', 'dataMsg', 'pwMsg', 'logInfo'].forEach(function (id) { $(id).textContent = ''; });
    $('credText').textContent = ''; $('credBox').hidden = true;
    $('credBox').removeAttribute('data-pw'); $('credBox').removeAttribute('data-name');
    $('nuName').value = ''; $('nuPass').value = ''; $('pwNew').value = '';
    $('lfUser').innerHTML = '<option value="">سب صارفین</option>';
    $('lfAction').value = ''; $('lfFrom').value = ''; $('lfTo').value = '';
    $('dataFile').value = '';
    LOG.page = 0; LOG.total = 0;
  }

  window.AdminUI = { init: init, open: open, reset: reset };
})();

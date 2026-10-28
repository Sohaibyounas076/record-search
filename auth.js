/* لاگ ان کا نظام: صرف پاس ورڈ سے شناخت، ڈیٹا کی کنجی کھولنا، لاگ اور ایڈمن کے کام */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var state = { token: null, role: null, id: null, name: null, masterKey: null, masterRaw: null };

  function meta() {
    var d = window.ENC_DATA;
    if (!d || !d.salt || !d.iter) throw new Error('data.enc.js نہیں ملی');
    return d;
  }

  function configured() {
    return !!(CFG.SUPABASE_URL && CFG.SUPABASE_KEY &&
      CFG.SUPABASE_URL.indexOf('YOUR-PROJECT') === -1 && CFG.SUPABASE_KEY.indexOf('YOUR-') === -1);
  }

  /* ---------- سرور کال ---------- */
  async function rpc(fn, args) {
    var headers = { 'Content-Type': 'application/json', 'apikey': CFG.SUPABASE_KEY };
    if (String(CFG.SUPABASE_KEY).indexOf('eyJ') === 0) headers['Authorization'] = 'Bearer ' + CFG.SUPABASE_KEY;
    var res;
    try {
      res = await fetch(CFG.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/rpc/' + fn, {
        method: 'POST', headers: headers, body: JSON.stringify(args || {})
      });
    } catch (e) {
      var ne = new Error('network'); ne.code = 'network'; throw ne;
    }
    var text = await res.text(), body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
    if (!res.ok) {
      var msg = body && body.message ? String(body.message) : 'server';
      var er = new Error(msg);
      er.code = /unauthorized/.test(msg) ? 'unauthorized' : /forbidden/.test(msg) ? 'forbidden' : 'server';
      throw er;
    }
    return body;
  }

  /* ---------- مدد گار ---------- */
  function b64(bytes) {
    var s = '', a = new Uint8Array(bytes), CH = 0x8000;
    for (var i = 0; i < a.length; i += CH) s += String.fromCharCode.apply(null, a.subarray(i, i + CH));
    return btoa(s);
  }
  function unb64(str) {
    var bin = atob(str), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function hex(bytes) {
    var a = new Uint8Array(bytes), s = '';
    for (var i = 0; i < a.length; i++) s += (a[i] < 16 ? '0' : '') + a[i].toString(16);
    return s;
  }

  /* ---------- پاس ورڈ سے دو چیزیں: tag (پہچان) اور wrapKey (کنجی کھولنے کا تالا) ---------- */
  async function deriveCreds(password) {
    var d = meta(), enc = new TextEncoder();
    var base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    var bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(d.salt), iterations: d.iter }, base, 256);
    var hk = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
    var zero = new Uint8Array(0);
    var tagBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: enc.encode('rs-tag') }, hk, 256);
    var wrapBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: zero, info: enc.encode('rs-wrap') }, hk, 256);
    var wrapKey = await crypto.subtle.importKey('raw', wrapBits, 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { tag: hex(tagBits), wrapKey: wrapKey };
  }

  async function unwrapMaster(blob, wrapKey) {
    if (String(blob).indexOf('w1:') !== 0) throw new Error('bad blob');
    var raw = unb64(String(blob).slice(3));
    var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, wrapKey, raw.slice(12));
    return new Uint8Array(pt);
  }

  async function wrapMaster(masterRaw, wrapKey) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, wrapKey, masterRaw));
    var all = new Uint8Array(12 + ct.length);
    all.set(iv, 0); all.set(ct, 12);
    return 'w1:' + b64(all);
  }

  /* ---------- لاگ ان ---------- */
  // نتیجہ: { ok:true, role } یا { ok:false, error:'invalid'|'locked'|'disabled'|'badkey' }
  async function login(password) {
    var c = await deriveCreds(password);
    var r = await rpc('rs_login', { p_tag: c.tag });
    if (!r || !r.ok) return r || { ok: false, error: 'invalid' };
    var raw;
    try { raw = await unwrapMaster(r.wrapped_key, c.wrapKey); }
    catch (e) {
      try { await rpc('rs_logout', { p_token: r.token }); } catch (e2) { /* نظر انداز */ }
      return { ok: false, error: 'badkey' };
    }
    state.masterKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    if (r.role === 'admin') state.masterRaw = raw; else raw.fill(0);
    state.token = r.token; state.role = r.role; state.id = r.id; state.name = r.name;
    return { ok: true, role: r.role };
  }

  async function logout() {
    var t = state.token;
    if (state.masterRaw) state.masterRaw.fill(0);
    state.token = state.role = state.id = state.name = state.masterKey = state.masterRaw = null;
    if (t) { try { await rpc('rs_logout', { p_token: t }); } catch (e) { /* نظر انداز */ } }
  }

  function ping() { return rpc('rs_ping', { p_token: state.token }); }

  /* ---------- ڈیٹا کھولنا اور بنانا ---------- */
  async function streamBytes(bytes, stream) {
    var s = new Blob([bytes]).stream().pipeThrough(stream);
    return new Response(s).arrayBuffer();
  }

  async function decryptWith(d) {
    if (!d || !d.blob) throw new Error('data.enc.js خراب ہے');
    var raw = unb64(d.blob);
    var buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(0, 12) }, state.masterKey, raw.slice(12));
    if (d.gz) {
      if (typeof DecompressionStream === 'undefined') throw new Error('براؤزر پرانا ہے۔ Chrome یا Edge اپ ڈیٹ کریں۔');
      buf = await streamBytes(buf, new DecompressionStream('gzip'));
    }
    return JSON.parse(new TextDecoder().decode(buf));
  }
  function decryptData() { return decryptWith(meta()); }

  // نئی بنی ہوئی فائل کو واپس کھول کر ریکارڈ گنتا ہے (جانچ کے لیے)
  async function verifyDataText(text) {
    var a = text.indexOf('{'), b = text.lastIndexOf('}');
    var obj = JSON.parse(text.slice(a, b + 1));
    var data = await decryptWith(obj);
    return data.rows.length;
  }

  // ایڈمن کے لیے: نئی ڈیٹا فائل کا متن بناتا ہے (وہی نمک اور کنجی، تاکہ سب پاس ورڈ چلتے رہیں)
  async function buildDataFile(plainBytes) {
    var d = meta();
    if (!state.masterKey) throw new Error('کنجی موجود نہیں');
    if (typeof CompressionStream === 'undefined') throw new Error('براؤزر پرانا ہے۔ Chrome یا Edge اپ ڈیٹ کریں۔');
    var gz = await streamBytes(plainBytes, new CompressionStream('gzip'));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, state.masterKey, gz));
    var all = new Uint8Array(12 + ct.length);
    all.set(iv, 0); all.set(ct, 12);
    var out = { v: 2, iter: d.iter, salt: d.salt, gz: true, blob: b64(all) };
    return 'window.ENC_DATA=' + JSON.stringify(out) + ';\n';
  }

  /* ---------- لاگ اور ایڈمن ---------- */
  function logEvent(action, q, count, snos) {
    if (!state.token) return Promise.resolve();
    return rpc('rs_log', {
      p_token: state.token, p_action: action, p_cnic: q.cnic || '', p_name: q.name || '',
      p_father: q.father || '', p_fir: q.fir || '', p_count: count, p_snos: snos || []
    });
  }

  function adminUsers() { return rpc('rs_admin_users', { p_token: state.token }); }

  async function adminAddUser(name, role, password) {
    var c = await deriveCreds(password);
    var wrapped = await wrapMaster(state.masterRaw, c.wrapKey);
    return rpc('rs_admin_add_user', { p_token: state.token, p_name: name, p_role: role, p_tag: c.tag, p_wrapped: wrapped });
  }
  async function adminSetPassword(id, password) {
    var c = await deriveCreds(password);
    var wrapped = await wrapMaster(state.masterRaw, c.wrapKey);
    return rpc('rs_admin_set_password', { p_token: state.token, p_id: id, p_tag: c.tag, p_wrapped: wrapped });
  }
  function adminRename(id, name) { return rpc('rs_admin_rename', { p_token: state.token, p_id: id, p_name: name }); }
  function adminSetActive(id, active) { return rpc('rs_admin_set_active', { p_token: state.token, p_id: id, p_active: active }); }
  function adminDeleteUser(id) { return rpc('rs_admin_delete_user', { p_token: state.token, p_id: id }); }
  function adminLogs(userId, fromTs, toTs, action, limit, offset) {
    return rpc('rs_admin_logs', {
      p_token: state.token, p_user_id: userId || 0, p_from: fromTs || null, p_to: toTs || null,
      p_action: action || '', p_limit: limit, p_offset: offset
    });
  }

  // 55 حروف: ملتے جلتے حروف (0 O 1 l I) نہیں۔ شکل: abcd-efgh-jkmn
  function randomPassword() {
    var al = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789', out = '', n = 0;
    while (n < 12) {
      var r = crypto.getRandomValues(new Uint8Array(24));
      for (var i = 0; i < r.length && n < 12; i++) {
        if (r[i] >= 220) continue; // 220 = 55 * 4، ترچھا پن روکنے کے لیے
        out += al[r[i] % al.length]; n++;
        if (n === 4 || n === 8) out += '-';
      }
    }
    return out;
  }

  window.Auth = {
    state: state, configured: configured, login: login, logout: logout, ping: ping,
    decryptData: decryptData, verifyDataText: verifyDataText, buildDataFile: buildDataFile, logEvent: logEvent,
    adminUsers: adminUsers, adminAddUser: adminAddUser, adminSetPassword: adminSetPassword, adminRename: adminRename,
    adminSetActive: adminSetActive, adminDeleteUser: adminDeleteUser, adminLogs: adminLogs, randomPassword: randomPassword,
    _deriveCreds: deriveCreds, _unwrapMaster: unwrapMaster
  };
})();

/* سرچ کا لاجک: اردو حروف کی نارملائزیشن، نام، ولدیت، شناختی کارڈ اور ایف آئی آر نمبر سے تلاش */
(function (root) {
  'use strict';

  var DIAC = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u200C\u200D\u200E\u200F\u0640]/g;

  function normDigits(s) {
    return s
      .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x660); })
      .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x6F0); });
  }

  // اردو متن کو ایک جیسی شکل میں لاتا ہے تاکہ ی/ي، ک/ك، ہ/ھ جیسے فرق سرچ نہ روکیں
  function normText(s) {
    s = normDigits(String(s == null ? '' : s)).replace(DIAC, '');
    s = s
      .replace(/[يىۓے]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[ۃةۂۀ]/g, 'ہ')
      .replace(/ھ/g, 'ہ')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ی')
      .replace(/[ںݨ]/g, 'ن');
    s = s.replace(/[^\u0600-\u06FFa-zA-Z0-9]+/g, ' ').toLowerCase().trim().replace(/\s+/g, ' ');
    return s;
  }

  function noSpace(s) { return s.replace(/ /g, ''); }

  // ایف آئی آر نمبر کو ایک شکل میں لاتا ہے: 300/25، 300-25، 300 25، اردو ہندسے اور مختلف سلیش سب چلتے ہیں
  function normFir(s) {
    s = normDigits(String(s == null ? '' : s)).trim();
    s = s.replace(/^(\d+)\s+(\d+)$/, '$1/$2');
    s = s.replace(/[\\\-\u2010-\u2015\u2212\u2044\u2215\uFF0F]/g, '/');
    return s.replace(/\s+/g, '');
  }

  function digitsOnly(s) { return normDigits(String(s == null ? '' : s)).replace(/\D/g, ''); }

  // ڈیٹا کو سرچ کے لیے تیار کرتا ہے
  function buildIndex(data) {
    var f = data.fields, idx = {};
    for (var i = 0; i < f.length; i++) idx[f[i]] = i;
    var out = new Array(data.rows.length);
    for (var r = 0; r < data.rows.length; r++) {
      var row = data.rows[r];
      var rec = {};
      for (var k in idx) rec[k] = row[idx[k]];
      rec.nameNS = noSpace(normText(rec.name));
      rec.fatherNS = noSpace(normText(rec.father));
      rec.firN = normFir(rec.fir);
      rec.firNum = rec.firN.split('/')[0];
      var d = digitsOnly(rec.cnic);
      rec.cnicD = /^0+$/.test(d) ? '' : d; // 00000-0000000-0 سسٹم کا خالی نشان ہے
      out[r] = rec;
    }
    return out;
  }

  function tokens(q) {
    var n = normText(q);
    return n ? n.split(' ') : [];
  }

  function hamming(a, b) {
    var c = 0;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) c++;
    return c;
  }

  // text فیلڈ (نام یا ولدیت): ہر لفظ ریکارڈ میں کہیں نہ کہیں ملنا چاہیے
  function textScore(recNS, q) {
    var t = tokens(q);
    if (!t.length) return null;           // فیلڈ خالی ہے
    var joined = t.join('');
    var score = 0;
    for (var i = 0; i < t.length; i++) {
      if (recNS.indexOf(t[i]) === -1) return -1;
    }
    if (recNS === joined) score = 3;
    else if (recNS.indexOf(joined) === 0) score = 2;
    else score = 1;
    return score;
  }

  function search(index, q) {
    q = q || {};
    var cn = digitsOnly(q.cnic);
    var fq = normFir(q.fir);
    var hasName = tokens(q.name).length > 0;
    var hasFather = tokens(q.father).length > 0;
    var hasAny = cn.length > 0 || fq.length > 0 || hasName || hasFather;
    if (!hasAny) return [];

    var res = [];
    for (var i = 0; i < index.length; i++) {
      var rec = index[i];
      var score = 0, fuzzy = false, ok = true;

      if (hasName) {
        var s1 = textScore(rec.nameNS, q.name);
        if (s1 < 0) continue;
        score += s1;
      }
      if (hasFather) {
        var s2 = textScore(rec.fatherNS, q.father);
        if (s2 < 0) continue;
        score += s2;
      }
      if (fq) {
        if (fq.indexOf('/') !== -1) {
          if (rec.firN.indexOf(fq) !== 0) continue;
          score += rec.firN === fq ? 3 : 2;
        } else {
          if (rec.firNum === fq) score += 3;
          else if (rec.firNum.indexOf(fq) === 0) score += 1;
          else continue;
        }
      }
      if (cn) {
        if (!rec.cnicD) continue;
        var pos = rec.cnicD.indexOf(cn);
        if (pos !== -1) {
          score += (rec.cnicD === cn) ? 4 : (pos === 0 ? 2 : 1);
        } else if (cn.length === 13 && rec.cnicD.length === 13 && hamming(cn, rec.cnicD) <= 2) {
          fuzzy = true; score += 0.5; // ملتا جلتا شناختی کارڈ
        } else {
          continue;
        }
      }
      res.push({ rec: rec, score: score, fuzzy: fuzzy });
    }
    res.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.rec.sno - b.rec.sno;
    });
    return res;
  }

  function formatCnic(c) {
    var d = digitsOnly(c);
    if (d.length === 13) return d.slice(0, 5) + '-' + d.slice(5, 12) + '-' + d.slice(12);
    return c || '';
  }

  var api = { normText: normText, digitsOnly: digitsOnly, buildIndex: buildIndex, search: search, formatCnic: formatCnic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoliceSearch = api;
})(typeof self !== 'undefined' ? self : this);

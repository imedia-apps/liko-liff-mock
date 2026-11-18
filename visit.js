/* ============================================================
 * Liko 体験アプリ：来店記録の追加部品（visit.js）
 *   本体（liko_prototype.html）には手を入れず、この1ファイルを読み込むだけで動く
 *   読み込み位置：<head> の中。LIFF SDK より前（URLの ?store= を書き換えられる前に控えるため）
 *   設定：window.LIKO_VISIT = { api: '記録先のURL' }  ※ api が空なら記録は送らない（QRでの店舗確定だけ動く）
 *
 * やること
 *   1. 店頭QR（?store=店舗コード）から開いたら、その店舗に確定して体験選択画面から始める
 *      前回の途中データが残っていても、QRの店舗を優先する
 *   2. 入店・体験の選択・退店（完了画面）を記録先へ送る
 *      送りっぱなし。応答は見ない。失敗しても画面には何も出さない
 * ============================================================ */
(function () {
  'use strict';
  var CFG = window.LIKO_VISIT || {};
  var API = CFG.api || '';
  var QR_VALID_MS = 4 * 60 * 60 * 1000;   // QRで確定した店舗を覚えておく時間（自動退店の上限240分に合わせる）
  var K_CID = 'liko_visit_cid_v1';
  var K_QR = 'liko_visit_qr_v1';
  var K_SENT = 'liko_visit_sent_v1';

  /* 店舗名（本体の STORES.name）→ 店舗コード（店舗マスタ・QRと同じ） */
  var CODES = {
    '中崎町': 'nakazakicho', '大阪天満': 'osaka-tenma', 'コリアンタウン鶴橋': 'tsuruhashi',
    '大阪心斎橋': 'shinsaibashi', '心斎橋アメ村': 'amemura', '南堀江': 'minamihorie', '奈良': 'nara',
    '神戸元町': 'kobe-motomachi', '京都': 'kyoto', '祇園': 'gion', '渋谷本店': 'shibuya-honten', '渋谷': 'shibuya', '渋谷2号': 'shibuya2',
    '名古屋栄': 'nagoya-sakae', '名古屋駅前': 'nagoya-ekimae', '池袋': 'ikebukuro', '浅草': 'asakusa', '浅草2号': 'asakusa2',
    '表参道原宿': 'omotesando', '横浜1号店（中華街）': 'yokohama-1', '横浜2号店': 'yokohama-2', '福岡天神': 'fukuoka-tenjin',
    '広島本通': 'hiroshima-hondori'
  };   // 本体（imedia-apps/liko-liff-mock の index.html）の店舗名と一致させる。2026-11-13 本番に合わせて更新（西天満閉店・渋谷本店／広島本通追加・横浜2店改名）
  var NAMES = {};
  Object.keys(CODES).forEach(function (n) { NAMES[CODES[n]] = n; });

  /* ---------- 保存（使えない端末でも止まらない） ---------- */
  var mem = {};
  function lsGet(k) { try { var v = localStorage.getItem(k); return v == null ? (mem[k] || null) : v; } catch (e) { return mem[k] || null; } }
  function lsSet(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) {} }
  function uid() {
    try { if (window.crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function clientId() {
    var c = lsGet(K_CID);
    if (!c) { c = 'c-' + uid(); lsSet(K_CID, c); }
    return c;
  }

  /* ---------- 1. URLから店舗コードを控える（読み込んだ瞬間に実行） ---------- */
  function storeFromUrl() {
    try {
      var q = new URLSearchParams(location.search);
      var s = q.get('store');
      if (!s && q.get('liff.state')) {
        var st = q.get('liff.state');
        var m = /[?&]store=([^&#]+)/.exec(st.charAt(0) === '?' || st.charAt(0) === '/' ? st : '?' + st);
        if (m) s = decodeURIComponent(m[1]);
      }
      s = s ? String(s).trim().toLowerCase() : '';
      return NAMES[s] ? s : '';
    } catch (e) { return ''; }
  }
  var urlStore = storeFromUrl();
  if (urlStore) lsSet(K_QR, JSON.stringify({ code: urlStore, at: Date.now() }));

  function qrStore() {   // QRで確定済みの店舗コード（有効時間内）
    try {
      var o = JSON.parse(lsGet(K_QR) || 'null');
      if (o && o.code && NAMES[o.code] && Date.now() - o.at < QR_VALID_MS) return o.code;
    } catch (e) {}
    return '';
  }

  /* ---------- 2. 送信（送りっぱなし） ---------- */
  var profile = { userId: '', displayName: '' };
  function loadProfile() {
    try {
      if (!window.liff || !liff.ready) return;
      liff.ready.then(function () {
        if (liff.isLoggedIn && liff.isLoggedIn()) {
          return liff.getProfile().then(function (p) { profile.userId = p.userId || ''; profile.displayName = p.displayName || ''; });
        }
      }).catch(function () {});
    } catch (e) {}
  }
  function send(type, code, extra) {
    if (!API || !code) return;
    var body = { action: type, store: code, clientId: clientId(), userId: profile.userId, displayName: profile.displayName, eventId: uid(), source: (qrStore() === code ? 'qr' : 'select') };
    if (extra) for (var k in extra) body[k] = extra[k];
    try {
      fetch(API, { method: 'POST', mode: 'no-cors', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) }).catch(function () {});
    } catch (e) {}
    try { (window.__likoVisitLog = window.__likoVisitLog || []).push(body); } catch (e) {}   // 動作確認用の控え
  }
  function sentKey(kind, code, extra) { return [kind, code, extra || '', new Date().toDateString()].join('|'); }
  function once(kind, code, extra, fn) {   // 同じ内容を同じ日に何度も送らない（再読み込み対策。最終的な重複排除は記録先でも行う）
    var key = sentKey(kind, code, extra), list = [];
    try { list = JSON.parse(lsGet(K_SENT) || '[]'); } catch (e) {}
    if (list.indexOf(key) >= 0 && kind !== 'enter') return;
    fn();
    if (list.indexOf(key) < 0) { list.push(key); lsSet(K_SENT, JSON.stringify(list.slice(-30))); }
  }
  function minutesOf(text) { var m = /(\d+)\s*分/.exec(String(text || '')); return m ? Number(m[1]) : ''; }

  /* ---------- 3. 本体に組み込む（本体の読み込みが終わってから） ---------- */
  function currentCode() {
    try { return (typeof state !== 'undefined' && state.store && CODES[state.store.name]) || ''; } catch (e) { return ''; }
  }
  function fixBackButton() {   // QRで確定した店舗では、体験選択画面の「戻る」を隠す（店舗一覧に戻さない）
    try {
      var el = document.querySelector('.screen[data-scr="welcome"] .hdr .back');
      if (!el) return;
      var fixed = qrStore() && currentCode() === qrStore() && history.length <= 1;
      el.classList.toggle('hide', !!fixed);
    } catch (e) {}
  }
  function inLine() { try { return !!(window.liff && liff.isInClient && liff.isInClient()); } catch (e) { return false; } }
  function enterWhenReady(code) {   // LINEの中ではLINEの名前が取れるのを少し待つ（最大2.4秒）。LINEの外ではすぐ送る
    // 入店のたびに「送信済み」の控えを消す。同じ日の2回目の来店でも、体験の記録を送り直すため
    // （実機 2026-11-18：2回目の来店に体験が付かなかった。重複は記録先が同じ来店への上書きとして処理する）
    lsSet(K_SENT, '[]');
    if (!inLine()) { send('enter', code); return; }
    var waited = 0;
    (function tick() {
      if (profile.userId || waited >= 2400) { send('enter', code); return; }
      waited += 300; setTimeout(tick, 300);
    })();
  }

  function boot() {
    if (typeof STORES === 'undefined' || typeof state === 'undefined' || typeof go !== 'function') return;   // 本体が無ければ何もしない
    loadProfile();

    // 画面遷移に合わせて記録を送る
    var _go = go;
    window.go = go = function (id) {
      _go(id);
      try {
        var code = currentCode();
        if (id === 'welcome' && code) enterWhenReady(code);   // 店舗が決まった（一覧から選択・完了後のやり直しを含む。二重の記録は記録先で防ぐ）
        if ((id === 'fee' || id === 'guide' || id === 'staffcall') && code && state.activity) {
          var min = minutesOf(state.plan && state.plan.time) || minutesOf(state.activity.time);
          once('activity', code, state.activity.id + ':' + min, function () { send('activity', code, { activity: state.activity.id, expectedMin: min }); });
        }
        if (id === 'done' && code) send('exit', code);
        fixBackButton();
      } catch (e) {}
    };
    var _back = back;
    window.back = back = function () { _back(); fixBackButton(); };

    // 店頭QRから開いた：その店舗に確定する
    var code = urlStore;
    if (code) {
      var target = STORES.filter(function (s) { return s.name === NAMES[code]; })[0];
      if (target) {
        var resumedSame = state.store && state.store.name === target.name && history.length > 0 && history[history.length - 1] !== 'store';
        if (!resumedSame) {
          state.store = target; state.activity = null; state.plan = null; state.guideStep = 0; state.reviewed = false;
          history = ['welcome'];
          onEnter('welcome'); show('welcome');
        }
        enterWhenReady(code);
        fixBackButton();
      }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

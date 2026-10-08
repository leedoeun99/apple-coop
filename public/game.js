(function () {
  const COLS = 17, ROWS = 10, N = COLS * ROWS, DURATION = 120000;
  const AX = 85, AY = 88, GAP = 33;   // 원작 사과 배치 (스테이지 좌표)
  const BAR_H = 300;

  const $ = (id) => document.getElementById(id);
  const wrap = $('wrap'), stage = $('stage'), boardEl = $('board');
  const scoreEl = $('score'), tfill = $('tfill');
  const lobby = $('lobby'), startLayer = $('startLayer'), resultLayer = $('resultLayer');
  const nameIn = $('nameIn'), codeIn = $('codeIn'), lobbyCap = $('lobbyCap');
  const playersEl = $('players'), statusEl = $('status'), recordsEl = $('records');
  const resetBtn = $('resetBtn');

  // ---------- 화면 배율 ----------
  const ro = new ResizeObserver(() => { stage.style.setProperty('--s', wrap.clientWidth / 720); });
  ro.observe(wrap);
  stage.style.setProperty('--s', wrap.clientWidth / 720);

  // ---------- 상태 ----------
  let ws = null, connected = false, myId = null, clockOffset = 0;
  let me = { name: '', color: pickColor() };
  let code = null;
  let game = null, renderedGameId = null, best = null;
  let peers = [];           // [{id,name,color,sel}]
  let confirmTimer = null;
  const prefs = { light: false, sound: true, vol: 0.6 };

  function pickColor() { const p = ['#3b82f6', '#8b5cf6', '#0ea5e9', '#f97316', '#ec4899', '#14b8a6']; return p[Math.floor(Math.random() * p.length)]; }
  function now() { return Date.now() + clockOffset; }
  function scoreOf(g) { return g ? Object.keys(g.cleared || {}).length : 0; }
  function playing() { return !!game && game.status === 'playing' && now() < game.endsAt; }
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function setStatus(t) { statusEl.textContent = t; }
  function normCode(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); }
  function randCode() { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function sendMsg(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  // ---------- 사과 ----------
  const cells = [], texts = [];
  const SVG = 'http://www.w3.org/2000/svg', XL = 'http://www.w3.org/1999/xlink';
  function useOf(id, cls) { const u = document.createElementNS(SVG, 'use'); u.setAttribute('href', id); u.setAttributeNS(XL, 'xlink:href', id); u.setAttribute('class', cls); return u; }
  for (let i = 0; i < N; i++) {
    const a = document.createElementNS(SVG, 'svg');
    a.setAttribute('class', 'apple gone');
    a.setAttribute('viewBox', '-18 -16 36 36');
    a.style.left = (AX + GAP * (i % COLS) - 18) + 'px';
    a.style.top = (AY + GAP * Math.floor(i / COLS) - 16) + 'px';
    a.appendChild(useOf('#ap-selo', 'selo'));
    a.appendChild(useOf('#ap-body', 'body'));
    a.appendChild(useOf('#ap-stem', 'stem'));
    const t = document.createElementNS(SVG, 'text');
    t.setAttribute('x', '0'); t.setAttribute('y', '7.2'); t.setAttribute('text-anchor', 'middle');
    a.appendChild(t);
    boardEl.appendChild(a);
    cells.push(a); texts.push(t);
  }
  const selEl = document.createElement('div');
  selEl.className = 'sel'; selEl.hidden = true;
  selEl.innerHTML = '<span class="sum">0</span>';
  boardEl.appendChild(selEl);
  const peerLayer = document.createElement('div');
  peerLayer.style.left = '0'; peerLayer.style.top = '0';
  boardEl.appendChild(peerLayer);

  // ---------- 효과음 ----------
  let actx = null;
  function pop(n) {
    if (prefs.vol <= 0) return;
    try {
      actxGet();
      const t = actx.currentTime;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.setValueAtTime(520 + n * 40, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.12);
      g.gain.setValueAtTime(0.25 * prefs.vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.15);
    } catch (e) {}
  }


  // ---------- 합산 점수 / 개인별 점수 ----------
  function tally(g) {
    const t = {}; if (!g) return t;
    Object.values(g.cleared || {}).forEach((v) => { const k = typeof v === 'string' && v ? v : '?'; t[k] = (t[k] || 0) + 1; });
    return t;
  }
  function renderScores() {
    const el = $('scores'); if (!el) return;
    el.innerHTML = '';
    const total = document.createElement('div'); total.className = 'total';
    const lab = document.createElement('small'); lab.textContent = '팀 점수';
    total.append(lab, document.createTextNode(String(scoreOf(game)) + '점'));
    const each = document.createElement('div'); each.className = 'each';
    const t = tally(game); const list = peerList(); const seen = new Set();
    const row = (name, color, n, isMe) => {
      const s = document.createElement('span');
      const d = document.createElement('i'); d.className = 'dot'; d.style.background = color;
      const nm = document.createElement('span'); nm.textContent = name + (isMe ? ' (나)' : '');
      const b = document.createElement('b'); b.textContent = n + '점';
      s.append(d, nm, b); each.appendChild(s);
    };
    list.forEach((p) => { if (seen.has(p.name)) return; seen.add(p.name); row(p.name, p.color, t[p.name] || 0, p.isMe); });
    Object.keys(t).forEach((k) => { if (!seen.has(k) && k !== '?') { seen.add(k); row(k, '#999999', t[k], false); } });
    el.append(total, each);
  }

  // ---------- BGM: 직접 만든 8비트 풍 루프 (원작 음악은 저작물이라 넣지 않음) ----------
  const MEL = [76,79,81,79,76,79,84,0, 86,84,81,79,81,0,79,0, 76,79,81,79,76,79,84,0, 86,88,86,84,81,0,79,0];
  const BASS = [48,48,43,43, 45,45,41,41, 48,48,43,43, 41,43,48,48];
  const bgm = { on: false, step: 0, next: 0, timer: null, gain: null };
  function midi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function actxGet() {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function tone(ctx, dest, f, t, dur, type, g) {
    const o = ctx.createOscillator(), e = ctx.createGain();
    o.type = type; o.frequency.value = f;
    e.gain.setValueAtTime(0.0001, t); e.gain.exponentialRampToValueAtTime(g, t + 0.01); e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(e).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  function bgmTick() {
    if (!bgm.on || !actx) return;
    const EIGHTH = 60 / 140 / 2;
    while (bgm.next < actx.currentTime + 0.35) {
      const s = bgm.step, m = MEL[s % 32];
      if (m) tone(actx, bgm.gain, midi(m), bgm.next, EIGHTH * 0.9, 'square', 0.07);
      if (s % 2 === 0) tone(actx, bgm.gain, midi(BASS[(s / 2) % 16]), bgm.next, EIGHTH * 1.6, 'triangle', 0.16);
      bgm.step++; bgm.next += EIGHTH;
    }
  }
  function bgmStart() {
    if (bgm.on) return;
    try {
      const ctx = actxGet();
      bgm.gain = ctx.createGain(); bgm.gain.gain.value = prefs.vol * 0.5; bgm.gain.connect(ctx.destination);
      bgm.step = 0; bgm.next = ctx.currentTime + 0.05; bgm.on = true;
      bgm.timer = setInterval(bgmTick, 120); bgmTick();
    } catch (e) {}
  }
  function bgmStop() {
    if (!bgm.on) return;
    bgm.on = false; clearInterval(bgm.timer);
    try { const g = bgm.gain; g.gain.setTargetAtTime(0.0001, actx.currentTime, 0.05); setTimeout(() => { try { g.disconnect(); } catch (e) {} }, 300); } catch (e) {}
  }
  function bgmSync() {
    if (playing() && prefs.sound) bgmStart(); else bgmStop();
    if (bgm.on && bgm.gain) bgm.gain.gain.value = prefs.vol * 0.5;
  }
  function peerList() { const l = peers.length ? peers : [{ id: myId, name: me.name, color: me.color }]; return l.map((p) => ({ name: p.name, color: p.color, isMe: p.id === myId })); }

  // ---------- 렌더 ----------
  function render() {
    if (game && game.id !== renderedGameId) {
      renderedGameId = game.id;
      for (let i = 0; i < N; i++) { texts[i].textContent = game.board[i]; cells[i].setAttribute('class', 'apple'); }
    }
    if (game) {
      const cl = game.cleared || {};
      for (let i = 0; i < N; i++) {
        if (cl[i] && !cells[i].classList.contains('gone') && !cells[i].classList.contains('pop')) {
          const el = cells[i];
          el.classList.remove('hl'); el.classList.add('pop');
          setTimeout(() => { el.classList.add('gone'); el.classList.remove('pop'); }, 180);
        }
      }
    } else {
      for (let i = 0; i < N; i++) { cells[i].setAttribute('class', 'apple gone'); }
      renderedGameId = null;
    }
    scoreEl.textContent = scoreOf(game);
    renderTimer();
    renderLayers();
    renderScores();
    bgmSync();
  }
  function renderTimer() {
    const rem = game ? Math.max(0, Math.min(DURATION, game.endsAt - now())) : DURATION;
    tfill.style.height = (BAR_H * rem / DURATION) + 'px';
  }
  function renderLayers() {
    const inLobby = !code;
    lobby.hidden = !inLobby;
    stage.classList.toggle('inlobby', inLobby);
    startLayer.hidden = inLobby || !!game;
    resultLayer.hidden = inLobby || !game || playing();
    $('roomBar').hidden = inLobby;
    $('scores').hidden = inLobby;
    $('recordsBox').hidden = inLobby;
    $('startBtn').disabled = !connected;
    $('againBtn').disabled = !connected;
    resetBtn.disabled = inLobby || !connected;
    $('startMsg').textContent = connected ? 'Start를 누르면 2분 동안 같이 사과를 지웁니다.' : '서버에 다시 연결하는 중…';
    if (!resultLayer.hidden) {
      $('finalScore').textContent = scoreOf(game);
      const b = best ? best.score : 0;
      const t = tally(game); const parts = Object.keys(t).sort((x, y) => t[y] - t[x]).map((k) => k + ' ' + t[k]);
      $('resultMsg').textContent = (scoreOf(game) > 0 && scoreOf(game) >= b ? '이 방 최고 기록!' : '최고 기록 ' + b + '점') + (parts.length > 1 ? '  ·  ' + parts.join(' · ') : '');
    }
  }
  function renderRecords(list) {
    recordsEl.innerHTML = '';
    if (!list.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '아직 끝난 판이 없어요.'; recordsEl.appendChild(li); return; }
    list.forEach((r, i) => {
      const li = document.createElement('li');
      const l = document.createElement('span'); const d = new Date(r.at);
      l.textContent = (i + 1) + '위 · ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' · ' + (r.players || 1) + '명' + (r.by && Object.keys(r.by).length > 1 ? ' · ' + Object.keys(r.by).map((k) => k + ' ' + r.by[k]).join(' · ') : '');
      const s = document.createElement('span'); s.className = 's'; s.textContent = r.score + '점';
      li.append(l, s); recordsEl.appendChild(li);
    });
  }
  setInterval(() => { if (code) { renderTimer(); if (game && game.status === 'playing' && now() >= game.endsAt) { renderLayers(); bgmSync(); } } }, 200);

  // ---------- 조작 ----------
  function startGame() { if (connected) sendMsg({ t: 'start' }); }
  function resetReset() { clearTimeout(confirmTimer); confirmTimer = null; resetBtn.textContent = 'Reset'; resetBtn.classList.remove('warn'); }
  resetBtn.addEventListener('click', () => {
    if (!connected) return;
    if (playing() && !confirmTimer) { resetBtn.textContent = 'Sure?'; resetBtn.classList.add('warn'); confirmTimer = setTimeout(resetReset, 3000); return; }
    resetReset(); startGame();
  });
  $('startBtn').addEventListener('click', startGame);
  $('againBtn').addEventListener('click', startGame);
  $('lobbyBtn').addEventListener('click', leaveRoom);

  const chkLight = $('chkLight'), chkSound = $('chkSound'), vol = $('vol');
  function applyPrefs() {
    stage.classList.toggle('light', prefs.light);
    chkLight.classList.toggle('on', prefs.light);
    chkSound.classList.toggle('on', prefs.sound);
    vol.value = Math.round(prefs.vol * 100);
    ls('fb-prefs', JSON.stringify(prefs));
  }
  try { Object.assign(prefs, JSON.parse(ls('fb-prefs') || '{}')); } catch (e) {}
  applyPrefs();
  chkLight.addEventListener('click', () => { prefs.light = !prefs.light; applyPrefs(); });
  chkSound.addEventListener('click', () => { prefs.sound = !prefs.sound; applyPrefs(); bgmSync(); });
  vol.addEventListener('input', () => { prefs.vol = vol.value / 100; ls('fb-prefs', JSON.stringify(prefs)); bgmSync(); });
  vol.addEventListener('change', () => pop(1));

  // ---------- 드래그 선택 ----------
  let drag = null, hl = [], lastSelSent = 0;
  function stagePoint(e) {
    const r = boardEl.getBoundingClientRect(); const s = r.width / 720;
    return { x: Math.min(720, Math.max(0, (e.clientX - r.left) / s)), y: Math.min(470, Math.max(0, (e.clientY - r.top) / s)) };
  }
  function cellsInRect(x0, y0, x1, y1) {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1), out = [];
    for (let i = 0; i < N; i++) {
      if (game.cleared[i]) continue;
      const cx = AX + GAP * (i % COLS), cy = AY + GAP * Math.floor(i / COLS) + 2;
      if (cx >= minx && cx <= maxx && cy >= miny && cy <= maxy) out.push(i);
    }
    return out;
  }
  function updateSelection() {
    const { sx, sy, cx, cy } = drag;
    const x = Math.min(sx, cx), y = Math.min(sy, cy), w = Math.abs(cx - sx), h = Math.abs(cy - sy);
    selEl.hidden = false;
    selEl.style.left = x + 'px'; selEl.style.top = y + 'px'; selEl.style.width = w + 'px'; selEl.style.height = h + 'px';
    const inside = cellsInRect(sx, sy, cx, cy);
    let sum = 0; inside.forEach((i) => { sum += game.board[i]; });
    hl.forEach((i) => cells[i].classList.remove('hl'));
    inside.forEach((i) => cells[i].classList.add('hl'));
    hl = inside;
    selEl.querySelector('.sum').textContent = sum;
    selEl.classList.toggle('ten', sum === 10);
    const t = Date.now();
    if (t - lastSelSent > 40) { lastSelSent = t; sendMsg({ t: 'sel', sel: { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) } }); }
    return { inside, sum };
  }
  function endSelection() {
    selEl.hidden = true;
    hl.forEach((i) => cells[i].classList.remove('hl')); hl = [];
    sendMsg({ t: 'sel', sel: null });
  }
  boardEl.addEventListener('pointerdown', (e) => {
    if (!playing() || !connected || e.button > 0) return;
    e.preventDefault();
    boardEl.setPointerCapture(e.pointerId);
    const p = stagePoint(e);
    drag = { sx: p.x, sy: p.y, cx: p.x, cy: p.y, id: e.pointerId };
    updateSelection();
  });
  boardEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = stagePoint(e); drag.cx = p.x; drag.cy = p.y; updateSelection();
  });
  function pointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const r = playing() ? updateSelection() : { inside: [], sum: 0 };
    drag = null; endSelection();
    if (r.sum === 10 && r.inside.length) {
      // 먼저 화면에서 지우고(즉시 반응), 서버가 확정한 판으로 다시 맞춤
      r.inside.forEach((i) => { game.cleared[i] = me.name; });
      pop(r.inside.length); render();
      sendMsg({ t: 'clear', idxs: r.inside });
    }
  }
  boardEl.addEventListener('pointerup', pointerUp);
  boardEl.addEventListener('pointercancel', pointerUp);

  // ---------- 참가자 ----------
  function renderPeers() {
    renderScores();
    playersEl.innerHTML = ''; peerLayer.innerHTML = '';
    const list = peers.length ? peers : [{ id: myId, name: me.name, color: me.color }];
    list.forEach((p) => {
      const isMe = p.id === myId;
      const chip = document.createElement('span'); chip.className = 'chip'; chip.style.color = p.color;
      const dot = document.createElement('span'); dot.className = 'dot';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (isMe ? ' (나)' : '');
      chip.append(dot, nm); playersEl.appendChild(chip);
      const s = p.sel;
      if (!isMe && s && typeof s.x === 'number') {
        const d = document.createElement('div'); d.className = 'peer-sel'; d.style.color = p.color;
        d.style.left = s.x + 'px'; d.style.top = s.y + 'px'; d.style.width = Math.max(0, s.w) + 'px'; d.style.height = Math.max(0, s.h) + 'px';
        const who = document.createElement('span'); who.className = 'who';
        const t = document.createElement('span'); t.textContent = p.name; who.appendChild(t); d.appendChild(who);
        peerLayer.appendChild(d);
      }
    });
    const others = peers.filter((p) => p.id !== myId).length;
    if (!connected) setStatus('서버에 다시 연결하는 중…');
    else setStatus(others ? '친구 ' + others + '명과 같은 방이에요. 지운 사과는 한 점수로 합산돼요.' : '아직 혼자예요. 친구에게 이 주소와 방 코드를 알려 주세요.');
  }

  // ---------- 서버 연결 ----------
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    ws = new WebSocket(proto + location.host);
    ws.onopen = () => {
      connected = true;
      lobbyCap.textContent = '같은 방 코드로 들어온 친구와 같은 판을 함께 지웁니다.';
      if (code) sendMsg({ t: 'join', room: code, name: me.name, color: me.color });
      render(); renderPeers();
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'hello') { myId = m.id; clockOffset = m.now - Date.now(); }
      else if (m.t === 'joined') { clockOffset = m.now - Date.now(); }
      else if (m.t === 'state') {
        game = m.game ? m.game : null;
        if (game && !game.cleared) game.cleared = {};
        const list = Array.isArray(m.records) ? m.records : [];
        best = list[0] || null; renderRecords(list);
        render();
      }
      else if (m.t === 'peers') { peers = Array.isArray(m.peers) ? m.peers : []; renderPeers(); }
      else if (m.t === 'sel') { const p = peers.find((x) => x.id === m.id); if (p) { p.sel = m.sel; renderPeers(); } }
      else if (m.t === 'error') { lobbyCap.textContent = m.msg || '오류'; }
    };
    ws.onclose = () => { connected = false; render(); renderPeers(); setTimeout(connect, 1500); };
    ws.onerror = () => { try { ws.close(); } catch (e) {} };
  }

  function enterRoom() {
    const name = nameIn.value.trim().slice(0, 12);
    const c = normCode(codeIn.value);
    if (!name) { nameIn.focus(); lobbyCap.textContent = '이름을 입력해 주세요.'; return; }
    if (c.length < 2) { codeIn.focus(); lobbyCap.textContent = '방 코드는 영문·숫자 2~8자예요.'; return; }
    if (!connected) { lobbyCap.textContent = '서버에 연결되지 않았어요. 잠시 후 다시 눌러 주세요.'; return; }
    me.name = name; code = c;
    ls('fb-name', name); ls('fb-code', c);
    try { history.replaceState(null, '', '#' + c); } catch (e) {}
    $('codeOut').textContent = c.toUpperCase();
    game = null; renderedGameId = null; best = null; peers = [];
    renderRecords([]);
    sendMsg({ t: 'join', room: c, name: me.name, color: me.color });
    render(); renderPeers();
  }
  function leaveRoom() {
    sendMsg({ t: 'leave' });
    code = null; game = null; renderedGameId = null; peers = [];
    bgmStop();
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
    resetReset(); endSelection();
    render();
  }
  $('playBtn').addEventListener('click', enterRoom);
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') codeIn.focus(); });
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') enterRoom(); });
  codeIn.addEventListener('input', () => { codeIn.value = normCode(codeIn.value); });
  $('newCode').addEventListener('click', () => { codeIn.value = randCode(); codeIn.focus(); });
  $('copyCode').addEventListener('click', () => {
    const b = $('copyCode');
    const link = location.origin + location.pathname + '#' + code;
    const done = () => { b.textContent = '링크 복사됨'; setTimeout(() => { b.textContent = '초대 링크 복사'; }, 1500); };
    try { navigator.clipboard.writeText(link).then(done, () => { b.textContent = link; }); } catch (e) { b.textContent = link; }
  });
  $('copyCode').textContent = '초대 링크 복사';

  // ---------- 시작 ----------
  nameIn.value = ls('fb-name') || '';
  const hashCode = normCode((location.hash || '').slice(1));
  codeIn.value = hashCode || ls('fb-code') || randCode();
  render();
  connect();
})();

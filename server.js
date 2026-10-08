// 사과게임 협동전 서버
// - HTTP: public/ 폴더의 게임 페이지를 서빙
// - WebSocket: 방(room) 단위로 판·점수·상대 드래그 영역을 실시간 동기화
// 실행: npm install && npm start   (기본 포트 3000, PORT 환경변수로 변경)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const COLS = 17, ROWS = 10, N = COLS * ROWS, DURATION = 120000;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data', 'records.json');

// ---------- 기록 저장 ----------
let records = {};
try { records = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (e) { records = {}; }
function saveRecords() {
  try { fs.mkdirSync(path.dirname(DATA), { recursive: true }); fs.writeFileSync(DATA, JSON.stringify(records)); } catch (e) { console.warn('records save failed', e.message); }
}

// ---------- 방 ----------
const rooms = new Map(); // code -> { game, clients:Set<ws>, timer }
function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { game: null, clients: new Set(), timer: null });
  return rooms.get(code);
}
function normCode(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8); }
function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 12) || '친구'; }
function cleanColor(s) { return /^#[0-9a-f]{6}$/i.test(String(s)) ? String(s) : '#888888'; }

// 원작 규칙: 판 전체 합이 10의 배수가 되도록 마지막 사과를 정함
function newBoard() {
  for (;;) {
    const b = []; let sum = 0;
    for (let i = 0; i < N - 1; i++) { const v = 1 + Math.floor(Math.random() * 9); b.push(v); sum += v; }
    const last = 10 - (sum % 10);
    if (last === 10) continue;
    b.push(last); return b;
  }
}
function scoreOf(g) { return g ? Object.keys(g.cleared).length : 0; }

function send(ws, msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }
function broadcast(room, msg, except) { const s = JSON.stringify(msg); for (const c of room.clients) if (c !== except && c.readyState === 1) c.send(s); }
function peersOf(room) { return [...room.clients].map((c) => ({ id: c.meta.id, name: c.meta.name, color: c.meta.color, sel: c.meta.sel || null })); }
function stateMsg(code, room) { return { t: 'state', game: room.game, records: (records[code] || []).slice(0, 5) }; }
function sendState(code, room) { broadcast(room, stateMsg(code, room)); }
function sendPeers(room) { broadcast(room, { t: 'peers', peers: peersOf(room) }); }

function finishGame(code, room) {
  const g = room.game;
  if (!g || g.status !== 'playing') return;
  g.status = 'ended';
  clearTimeout(room.timer); room.timer = null;
  const list = records[code] || [];
  list.push({ score: scoreOf(g), at: g.endsAt, players: Math.max(1, room.clients.size) });
  list.sort((a, b) => b.score - a.score);
  records[code] = list.slice(0, 20);
  saveRecords();
  sendState(code, room);
}

function startGame(code, room, by) {
  clearTimeout(room.timer);
  const now = Date.now();
  room.game = { id: crypto.randomBytes(4).toString('hex'), board: newBoard(), cleared: {}, status: 'playing', startedAt: now, endsAt: now + DURATION, startedBy: by };
  room.timer = setTimeout(() => finishGame(code, room), DURATION + 50);
  sendState(code, room);
}

function clearCells(code, room, idxs) {
  const g = room.game;
  if (!g || g.status !== 'playing' || Date.now() > g.endsAt) return;
  if (!Array.isArray(idxs) || !idxs.length || idxs.length > N) return;
  const uniq = [...new Set(idxs.map((i) => Number(i)))];
  if (uniq.some((i) => !Number.isInteger(i) || i < 0 || i >= N || g.cleared[i])) return;
  let sum = 0; uniq.forEach((i) => { sum += g.board[i]; });
  if (sum !== 10) return;
  uniq.forEach((i) => { g.cleared[i] = 1; });
  sendState(code, room);
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.meta = { id: crypto.randomBytes(6).toString('hex'), name: '', color: '#888888', room: null, sel: null };
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  send(ws, { t: 'hello', id: ws.meta.id, now: Date.now() });

  function leave() {
    const code = ws.meta.room; if (!code) return;
    const room = rooms.get(code); ws.meta.room = null; ws.meta.sel = null;
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size) sendPeers(room);
    else if (!room.game || room.game.status !== 'playing') rooms.delete(code); // 비어 있고 진행 중 판이 없으면 정리
  }

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'join') {
      leave();
      const code = normCode(m.room); if (code.length < 2) return send(ws, { t: 'error', msg: '방 코드는 영문·숫자 2~8자예요.' });
      ws.meta.name = cleanName(m.name); ws.meta.color = cleanColor(m.color); ws.meta.room = code;
      const room = getRoom(code); room.clients.add(ws);
      send(ws, { t: 'joined', room: code, now: Date.now() });
      send(ws, stateMsg(code, room));
      sendPeers(room);
      return;
    }
    const code = ws.meta.room; const room = code && rooms.get(code); if (!room) return;
    if (m.t === 'start') startGame(code, room, ws.meta.name);
    else if (m.t === 'clear') clearCells(code, room, m.idxs);
    else if (m.t === 'sel') {
      const s = m.sel && typeof m.sel === 'object' ? { x: +m.sel.x || 0, y: +m.sel.y || 0, w: Math.max(0, +m.sel.w || 0), h: Math.max(0, +m.sel.h || 0) } : null;
      ws.meta.sel = s;
      broadcast(room, { t: 'sel', id: ws.meta.id, sel: s }, ws);
    }
    else if (m.t === 'leave') leave();
  });
  ws.on('close', leave);
});
// 끊긴 연결 정리
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 30000);

server.listen(PORT, () => {
  console.log('사과게임 협동전 서버 실행 중: http://localhost:' + PORT);
});

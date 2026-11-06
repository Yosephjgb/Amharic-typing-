'use strict';
/* Fidel Race PvP server
   - serves the game (public/index.html, public/core.js)
   - WebSocket rooms: quick match, create room, join by code
   - the SERVER decides the race: it picks the items, owns the clock, validates progress and ranks players */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const core = require('./public/core.js');

const PORT = process.env.PORT || 3000;
const MAX_KPS = 14;          // fastest believable typing speed, keystrokes/second (~168 WPM)
const MAX_PLAYERS = 4;
const START_DELAY = 4000;    // ms between "start" message and GO
const STATE_MS = 150;        // how often live positions are broadcast

/* ---------- optional accounts (file storage) ----------
   Players can use everything without an account. An account only saves their progress
   (speed-test history, practice, online record) so it follows them to other devices.
   Passwords are hashed with scrypt; the server never stores them in plain text. */
const crypto = require('crypto');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_DATA_BYTES = 80 * 1024;
let db = { users: {}, sessions: {} };
try { db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (e) { /* first run */ }
db.users = db.users && typeof db.users === 'object' ? db.users : {};
db.sessions = db.sessions && typeof db.sessions === 'object' ? db.sessions : {};
let dbTimer = null;
function flushDb() {
  clearTimeout(dbTimer); dbTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE);                       // atomic: a crash never leaves a half-written file
  } catch (e) { console.error('Could not save accounts:', e.message); }
}
function persistDb() { if (!dbTimer) dbTimer = setTimeout(flushDb, 300); }
['SIGINT', 'SIGTERM'].forEach(sig => process.on(sig, () => { flushDb(); process.exit(0); }));

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const getUser = lower => own(db.users, lower) ? db.users[lower] : null;   // never reads inherited keys like "constructor"
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => e ? rej(e) : res(k)));
const USER_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const hits = new Map();                                // ip -> { n, reset } : limits sign-in guessing
function limited(ip) {
  const now = Date.now(); let h = hits.get(ip);
  if (!h || now > h.reset) { h = { n: 0, reset: now + 10 * 60 * 1000 }; hits.set(ip, h); }
  return ++h.n > 25;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now > h.reset) hits.delete(k); }, 60000).unref();

function newSession(lower) {
  const now = Date.now();
  for (const k of Object.keys(db.sessions)) if (db.sessions[k].exp < now) delete db.sessions[k];
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions[sha(token)] = { u: lower, exp: now + SESSION_MS };
  return token;
}
function userFromToken(token) {
  if (typeof token !== 'string' || token.length !== 64) return null;
  const s = db.sessions[sha(token)];
  if (!s || s.exp < Date.now() || !getUser(s.u)) return null;
  return s.u;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = 100 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
async function handleApi(req, res, url) {
  if (req.method !== 'POST' && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  const ip = req.socket.remoteAddress || 'x';
  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(res, 400, { error: 'Bad request' });
  }
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (url === '/api/register' || url === '/api/login') {
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    if (limited(ip)) return json(res, 429, { error: 'Too many attempts. Please wait a few minutes.' });
    const name = String(body.username || '').trim(), pw = String(body.password || '');
    const lower = name.toLowerCase();
    if (url === '/api/register') {
      if (!USER_RE.test(name)) return json(res, 400, { error: 'Username must be 3-20 letters, numbers, dot, dash or underscore.' });
      if (pw.length < 6 || pw.length > 100) return json(res, 400, { error: 'Password must be 6-100 characters.' });
      if (lower in Object.prototype) return json(res, 400, { error: 'That username is not allowed.' });
      if (getUser(lower)) return json(res, 409, { error: 'That username is taken.' });
      if (Object.keys(db.users).length >= 20000) return json(res, 503, { error: 'Sign-ups are closed right now.' });
      const salt = crypto.randomBytes(16);
      db.users[lower] = { name, salt: salt.toString('hex'), hash: (await hashPw(pw, salt)).toString('hex'), data: {}, created: Date.now() };
      persistDb();
      return json(res, 200, { token: newSession(lower), user: { name, data: {} } });
    }
    if (pw.length > 100) return json(res, 401, { error: 'Wrong username or password.' });
    const u = getUser(lower);
    const salt = u ? Buffer.from(u.salt, 'hex') : crypto.randomBytes(16);        // same work whether or not the user exists
    const got = await hashPw(pw, salt);
    const ok = u && crypto.timingSafeEqual(got, Buffer.from(u.hash, 'hex'));
    if (!ok) return json(res, 401, { error: 'Wrong username or password.' });
    const t = newSession(lower); persistDb();
    return json(res, 200, { token: t, user: { name: u.name, data: u.data || {} } });
  }

  const lower = userFromToken(token);
  if (!lower) return json(res, 401, { error: 'Please sign in again.' });
  const u = getUser(lower);
  if (url === '/api/me' && req.method === 'GET') return json(res, 200, { user: { name: u.name, data: u.data || {} } });
  if (url === '/api/save' && req.method === 'POST') {
    const d = body.data;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return json(res, 400, { error: 'Bad data' });
    if (JSON.stringify(d).length > MAX_DATA_BYTES) return json(res, 413, { error: 'Saved data is too large.' });
    u.data = d; persistDb();
    return json(res, 200, { ok: true });
  }
  if (url === '/api/logout' && req.method === 'POST') { delete db.sessions[sha(token)]; persistDb(); return json(res, 200, { ok: true }); }
  return json(res, 404, { error: 'Not found' });
}

/* ---------- static files ---------- */
const PUB = path.join(__dirname, 'public');
const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/core.js': ['core.js', 'text/javascript; charset=utf-8']
};
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  if (url.startsWith('/api/')) return handleApi(req, res, url).catch(() => json(res, 500, { error: 'Server error' }));
  const f = STATIC[url];
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(path.join(PUB, f[0]), (err, buf) => {
    if (err) { res.writeHead(500); return res.end('Error'); }
    res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 2048 });

/* ---------- state ---------- */
let nextId = 1;
const players = new Map();                  // ws -> player
const rooms = new Map();                    // code -> room
const queues = { 1: [], 2: [], 3: [], 4: [] };

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function cleanName(n, id) {
  const s = String(n || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return s || ('Player' + id);
}
// Signed-in players always race under their account name. A guest can't pose as a registered name.
function displayName(p, raw) {
  if (p.user && getUser(p.user)) return getUser(p.user).name;
  let n = cleanName(raw, p.id);
  if (getUser(n.toLowerCase())) n = (n.slice(0, 12) + ' (guest)');
  return n;
}
function validLevel(l) { l = Number(l); return Number.isInteger(l) && l >= 1 && l <= 4 ? l : null; }
function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)];
    if (!rooms.has(c)) return c;
  }
}
function roomInfo(r) {
  return { t: 'room', code: r.code, hostId: r.hostId, level: r.level, state: r.race ? 'race' : 'lobby',
           players: r.players.map(p => ({ id: p.id, name: p.name })) };
}
function broadcastRoom(r) { const m = roomInfo(r); r.players.forEach(p => send(p.ws, m)); }

/* ---------- rooms ---------- */
function createRoom(host, level) {
  const r = { code: newCode(), hostId: host.id, level, players: [host], race: null };
  rooms.set(r.code, r);
  host.room = r;
  return r;
}
function joinRoom(p, code) {
  const r = rooms.get(code);
  if (!r) return send(p.ws, { t: 'error', msg: 'Room ' + code + ' was not found.' });
  if (r.race) return send(p.ws, { t: 'error', msg: 'That race has already started. Try again in a moment.' });
  if (r.players.length >= MAX_PLAYERS) return send(p.ws, { t: 'error', msg: 'That room is full.' });
  r.players.push(p);
  p.room = r;
  broadcastRoom(r);
}
function leaveRoom(p) {
  const r = p.room;
  if (!r) return;
  p.room = null;
  r.players = r.players.filter(x => x !== p);
  if (r.race) { const st = r.race.st.get(p.id); if (st) st.left = true; }
  if (r.players.length === 0) {
    if (r.race) clearInterval(r.race.timer);
    rooms.delete(r.code);
    return;
  }
  if (r.hostId === p.id) r.hostId = r.players[0].id;
  broadcastRoom(r);
  if (r.race) checkEnd(r);
}
function leaveQueue(p) {
  for (const k of Object.keys(queues)) queues[k] = queues[k].filter(x => x !== p);
  p.queued = false;
}

/* ---------- matchmaking ---------- */
function matchmake(level) {
  const q = queues[level];
  while (q.length >= 2) {
    const a = q.shift(), b = q.shift();
    a.queued = b.queued = false;
    const r = createRoom(a, level);
    r.players.push(b); b.room = r;
    startRace(r);
    broadcastRoom(r);
  }
}

/* ---------- the race ---------- */
function startRace(r) {
  const items = core.makeItems(r.level);
  const lens = items.map(t => core.variants(t)[0].length);
  const total = lens.reduce((a, b) => a + b, 0);
  const limit = Math.round(total * 1.5 + 10);
  const startAt = Date.now() + START_DELAY;
  const st = new Map(), names = new Map();
  r.players.forEach(p => { st.set(p.id, { units: 0, c: 0, w: 0, fin: null, left: false }); names.set(p.id, p.name); });
  r.race = { items, total, limit, startAt, st, names, timer: null, ended: false };
  const list = r.players.map(p => ({ id: p.id, name: p.name }));
  r.players.forEach(p => send(p.ws, { t: 'start', level: r.level, items, total, limit, startAt, serverNow: Date.now(), players: list }));
  r.race.timer = setInterval(() => tickRace(r), STATE_MS);
}
function wpmOf(race, s, now) {
  const elapsed = s.fin != null ? s.fin : Math.min(race.limit, (now - race.startAt) / 1000);
  return elapsed > 1 ? Math.round((s.c / 5) / (elapsed / 60)) : 0;
}
function tickRace(r) {
  const race = r.race;
  if (!race) return;
  const now = Date.now();
  if (now >= race.startAt) {
    const m = { t: 'state', players: [...race.st].map(([id, s]) => ({
      id, prog: s.units / race.total, wpm: wpmOf(race, s, now), fin: s.fin, left: s.left })) };
    r.players.forEach(p => send(p.ws, m));
  }
  checkEnd(r);
}
function onProgress(p, m) {
  const r = p.room;
  if (!r || !r.race) return;
  const race = r.race, now = Date.now();
  const s = race.st.get(p.id);
  if (!s || s.fin != null || s.left || now < race.startAt) return;
  const cap = Math.floor(MAX_KPS * (now - race.startAt) / 1000) + 3;   // nobody types faster than this
  const claimed = Math.max(0, Math.min(race.total, Math.floor(Number(m.k)) || 0));
  s.units = Math.min(claimed, cap, race.total);
  s.c = Math.max(s.c, Math.min(Math.max(0, Math.floor(Number(m.c)) || 0), cap));
  s.w = Math.min(Math.max(0, Math.floor(Number(m.w)) || 0), 2000);
  if (s.units >= race.total) { s.fin = (now - race.startAt) / 1000; checkEnd(r); }
}
function checkEnd(r) {
  const race = r.race;
  if (!race || race.ended) return;
  const all = [...race.st.values()];
  const active = all.filter(s => !s.left);
  const anyFin = all.some(s => s.fin != null);
  const forfeit = active.length <= 1 && all.length > 1 && !anyFin;   // everyone else quit before anyone finished
  if (forfeit || Date.now() >= race.startAt + race.limit * 1000 || active.every(s => s.fin != null)) endRace(r);
}
function endRace(r) {
  const race = r.race;
  if (!race || race.ended) return;
  race.ended = true;
  clearInterval(race.timer);
  const now = Date.now();
  const rows = [...race.st].map(([id, s]) => {
    const total = s.c + s.w;
    return { id, name: race.names.get(id), prog: s.units / race.total, fin: s.fin, finished: s.fin != null,
             wpm: wpmOf(race, s, now), acc: total ? Math.round(s.c / total * 100) : 100, left: s.left };
  });
  rows.sort((a, b) => {
    if (a.finished !== b.finished) return b.finished - a.finished;     // finishers first, by time
    if (a.finished) return a.fin - b.fin;
    if (a.left !== b.left) return a.left - b.left;                     // then players still here, quitters last
    return b.prog - a.prog;                                            // then by progress
  });
  rows.forEach((x, i) => { x.place = i + 1; });
  const winByForfeit = rows.length > 1 && !rows.some(x => x.finished) && rows.filter(x => !x.left).length === 1;
  r.race = null;
  r.players.forEach(p => send(p.ws, { t: 'results', standings: rows, forfeit: winByForfeit }));
  broadcastRoom(r);
}

/* ---------- messages ---------- */
function handle(p, m) {
  switch (m.t) {
    case 'p': return onProgress(p, m);
    case 'auth': {                                   // optional: links this connection to a signed-in account
      const u = userFromToken(String(m.token || ''));
      p.user = u;
      return send(p.ws, { t: 'authed', name: u ? db.users[u].name : null });
    }
    case 'quick': {
      const lv = validLevel(m.level);
      if (!lv) return;
      if (p.room) return send(p.ws, { t: 'error', msg: 'Leave your current room first.' });
      leaveQueue(p);
      p.name = displayName(p, m.name);
      p.queued = true;
      queues[lv].push(p);
      send(p.ws, { t: 'queue', level: lv });
      return matchmake(lv);
    }
    case 'cancel': leaveQueue(p); return send(p.ws, { t: 'queue_left' });
    case 'create': {
      const lv = validLevel(m.level);
      if (!lv) return;
      if (p.room) return send(p.ws, { t: 'error', msg: 'Leave your current room first.' });
      leaveQueue(p);
      p.name = displayName(p, m.name);
      return broadcastRoom(createRoom(p, lv));
    }
    case 'join': {
      if (p.room) return send(p.ws, { t: 'error', msg: 'Leave your current room first.' });
      leaveQueue(p);
      p.name = displayName(p, m.name);
      return joinRoom(p, String(m.code || '').toUpperCase().slice(0, 4));
    }
    case 'leave': return leaveRoom(p);
    case 'level': {
      const r = p.room, lv = validLevel(m.level);
      if (!r || r.race || r.hostId !== p.id || !lv) return;
      r.level = lv;
      return broadcastRoom(r);
    }
    case 'start': {
      const r = p.room;
      if (!r || r.race || r.hostId !== p.id) return;
      if (r.players.length < 2) return send(p.ws, { t: 'error', msg: 'You need at least 2 players.' });
      startRace(r);
      return broadcastRoom(r);
    }
  }
}

wss.on('connection', ws => {
  const p = { id: nextId++, ws, name: 'Player', user: null, room: null, queued: false, count: 0, alive: true };
  players.set(ws, p);
  send(ws, { t: 'welcome', id: p.id });
  const rl = setInterval(() => { p.count = 0; }, 1000);
  ws.on('pong', () => { p.alive = true; });
  ws.on('message', data => {
    p.count++;
    if (p.count > 400) { ws.terminate(); return; }
    if (p.count > 60) return;                       // simple flood limit
    let m;
    try { m = JSON.parse(data); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;
    handle(p, m);
  });
  ws.on('close', () => { clearInterval(rl); leaveQueue(p); leaveRoom(p); players.delete(ws); });
});

// drop dead connections
setInterval(() => {
  wss.clients.forEach(ws => {
    const p = players.get(ws);
    if (p && !p.alive) return ws.terminate();
    if (p) p.alive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log('Fidel Race is running: http://localhost:' + PORT);
});

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROUND_DURATION_MS = 90 * 1000;
const ULTIMATE_DAMAGE = 9999;

const GIFTS = [
  { name: 'Rose', emoji: '🌹', points: 1 },
  { name: 'Cœur', emoji: '💕', points: 5 },
  { name: 'Câlin', emoji: '🤗', points: 10 },
  { name: 'Panda', emoji: '🐼', points: 50 },
  { name: 'Rocket', emoji: '🚀', points: 100 },
  { name: 'Galaxie', emoji: '🌌', points: 250 },
  { name: 'Crown', emoji: '👑', points: 500 },
];
const GIFT_MAP = Object.fromEntries(GIFTS.map((g) => [g.name.toLowerCase(), g]));
const GIFT_ALIASES = {
  rose: GIFT_MAP['rose'],
  heart: GIFT_MAP['coeur'],
  coeur: GIFT_MAP['coeur'],
  love: GIFT_MAP['coeur'],
  hug: GIFT_MAP['câlin'],
  câlin: GIFT_MAP['câlin'],
  kiss: GIFT_MAP['câlin'],
  panda: GIFT_MAP['panda'],
  rocket: GIFT_MAP['rocket'],
  galaxy: GIFT_MAP['galaxie'],
  crown: GIFT_MAP['crown'],
};

function findGift(rawName) {
  const key = String(rawName || '').trim().toLowerCase();
  if (GIFT_MAP[key]) return GIFT_MAP[key];
  if (GIFT_ALIASES[key]) return GIFT_ALIASES[key];
  return { name: 'Cadeau', emoji: '🎁', points: 10 };
}

const BOSSES = [
  { name: 'Le Troll des Badges', emoji: '👹', hp: 2000 },
  { name: 'La Reine du WiFi', emoji: '👸', hp: 2500 },
  { name: 'Le Monstre du Son', emoji: '👾', hp: 1800 },
  { name: 'Le Roi du Scroll', emoji: '😈', hp: 3000 },
  { name: 'La Déesse du Spam', emoji: '🤖', hp: 2200 },
];

const state = {
  status: 'idle', // idle | playing | won
  boss: { name: BOSSES[0].name, emoji: BOSSES[0].emoji, hp: 0, maxHp: 0 },
  roundId: 0,
  roundStartedAt: 0,
  roundEndsAt: 0,
  players: {}, // { name, points, gifts }
  feed: [], // derniers cadeaux: { id, name, emoji, gift, points, at }
  lastDamage: null, // { name, emoji, points, at }
  winner: null, // nom du gagnant du round
  champion: null, // nom du champion (top donateur)
  victory: false,
  ultimateUsed: false,
};

const clients = new Set();

function topPlayer() {
  const list = Object.values(state.players).filter((p) => p.points > 0);
  list.sort((a, b) => b.points - a.points);
  return list[0] || null;
}

function leaderboard() {
  const list = Object.values(state.players).filter((p) => p.points > 0);
  list.sort((a, b) => b.points - a.points);
  return list.slice(0, 10).map((p, i) => ({ ...p, rank: i + 1 }));
}

function snapshot() {
  const now = Date.now();
  if (state.status === 'playing' && now > state.roundEndsAt) {
    const top = topPlayer();
    state.status = 'won';
    state.victory = true;
    state.winner = top ? top.name : null;
    state.champion = top ? top.name : null;
  }
  const timeLeftMs = state.status === 'playing' ? Math.max(0, state.roundEndsAt - now) : 0;
  const top = topPlayer();
  return {
    ...state,
    leaderboard: leaderboard(),
    timeLeftMs,
    bossHpPercent: state.boss.maxHp > 0 ? Math.max(0, (state.boss.hp / state.boss.maxHp) * 100) : 0,
    winnerName: state.winner,
    championName: state.champion,
  };
}

function broadcast() {
  const data = 'data: ' + JSON.stringify(snapshot()) + '\n\n';
  for (const res of clients) {
    try { res.write(data); } catch (e) { clients.delete(res); }
  }
}

function startRound(bossName, hp, durationMs) {
  const boss = BOSSES.find((b) => b.name === bossName) || BOSSES[Math.floor(Math.random() * BOSSES.length)];
  state.roundId += 1;
  state.players = {};
  state.feed = [];
  state.lastDamage = null;
  state.winner = null;
  state.champion = null;
  state.victory = false;
  state.ultimateUsed = false;
  state.boss = { name: boss.name, emoji: boss.emoji, hp: boss.hp || hp || 2000, maxHp: boss.hp || hp || 2000 };
  state.status = 'playing';
  state.roundStartedAt = Date.now();
  state.roundEndsAt = Date.now() + (durationMs || ROUND_DURATION_MS);
  broadcast();
}

function endRound() {
  const top = topPlayer();
  state.status = 'won';
  state.victory = true;
  state.winner = top ? top.name : null;
  state.champion = top ? top.name : null;
  state.boss.hp = 0;
}

function applyGift(senderName, giftName, count) {
  const sender = String(senderName || 'Anonymous').trim().slice(0, 20) || 'Anonymous';
  const gift = findGift(giftName);
  const n = Math.max(1, parseInt(count, 10) || 1);
  const points = gift.points * n;

  let p = state.players[sender];
  if (!p) { p = state.players[sender] = { name: sender, points: 0, gifts: 0 }; }
  p.points += points;
  p.gifts += n;

  const now = Date.now();
  state.feed.unshift({ id: now + Math.floor(Math.random() * 1000), name: sender, emoji: gift.emoji, gift: gift.name, points, at: now });
  if (state.feed.length > 40) state.feed.pop();

  state.boss.hp = Math.max(0, state.boss.hp - points);
  state.lastDamage = { name: sender, emoji: gift.emoji, points, at: now };

  if (state.boss.hp <= 0) endRound();
  else if (Date.now() > state.roundEndsAt) endRound();

  broadcast();
}

function ultimate() {
  state.boss.hp = 0;
  state.status = 'won';
  state.victory = true;
  state.winner = state.champion;
  state.ultimateUsed = true;
}

function resetGame() {
  state.status = 'idle';
  state.players = {};
  state.feed = [];
  state.boss = { name: BOSSES[0].name, emoji: BOSSES[0].emoji, hp: 0, maxHp: 0 };
  state.winner = null;
  state.champion = null;
  state.victory = false;
  state.ultimateUsed = false;
}

// ---------- Serve static files ----------
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

function serveFile(res, file) {
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
  fs.readFile(path.join(PUBLIC_DIR, file), (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.end(data);
  });
}

function handleSSE(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  res.write('data: ' + JSON.stringify(snapshot()) + '\n\n');
  clients.add(res);
  const hb = setInterval(() => { try { res.write(':\n\n'); } catch (e) {} }, 15000);
  req.on('close', () => { clearInterval(hb); clients.delete(res); try { res.end(); } catch (e) {} });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }

  if (req.method === 'GET') {
    if (pathname === '/') return serveFile(res, 'index.html');
    if (pathname === '/style.css') return serveFile(res, 'style.css');
    if (pathname === '/game.js') return serveFile(res, 'game.js');
    if (pathname === '/webhook.html') return serveFile(res, 'webhook.html');
    if (pathname.startsWith('/api/')) return handleApi(res, pathname, req);
    if (pathname.startsWith('/')) return serveFile(res, pathname.slice(1));
    if (pathname.startsWith('/')) return serveFile(res, pathname.slice(1));
    if (pathname === '/api/state') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify(snapshot())); }
    if (pathname === '/api/gift') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); return res.end(JSON.stringify({ ok: false, error: 'Utilise POST /api/gift pour envoyer un cadeau', state: snapshot() })); }
    if (pathname === '/events') return handleSSE(req, res);
    res.writeHead(404); return res.end('Not found');
  }

  if (req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1024 * 1024) req.destroy(); });
    req.on('end', () => {
      let data = {};
      try { data = JSON.parse(raw || '{}'); } catch (e) { data = {}; }
      handlePost(pathname, data, res);
    });
    return;
  }

  res.writeHead(405); res.end('Method Not Allowed');
});

function handlePost(pathname, data, res) {
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  switch (pathname) {
    case '/api/round/start': {
      const hp = Number(data.hp) || 2000;
      const durationMs = Number(data.durationMs) || ROUND_DURATION_MS;
      startRound(data.bossName, hp, durationMs);
      return json(200, { ok: true, state: snapshot() });
    }
    case '/api/round/end': {
      if (state.status === 'playing') endRound();
      return json(200, { ok: true, state: snapshot() });
    }
    case '/api/ultimate': {
      if (state.status === 'won' && state.champion && !state.ultimateUsed) ultimate();
      return json(200, { ok: true, state: snapshot() });
    }
    case '/api/reset': {
      resetGame();
      return json(200, { ok: true, state: snapshot() });
    }
    case '/api/gift': {
      const sender = data.senderName || data.senderNickname || data.sender || data.nickname || 'Anonymous';
      const giftName = data.giftName || data.giftType || (data.gift && data.gift.name) || 'Cadeau';
      const count = data.count || data.giftCount || data.quantity || 1;
      applyGift(sender, giftName, count);
      return json(200, { ok: true, state: snapshot() });
    }
    default:
      return json(404, { ok: false, error: 'Not found' });
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LIVE BATTLE server running on http://0.0.0.0:${PORT}`);
});

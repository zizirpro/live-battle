let currentState = null;
let lastDamageRef = null;
let lastDamageTimer = null;
let prevStatus = null;

const BOSSES = [
  { name: 'Le Troll des Badges', emoji: '👹', hp: 2000 },
  { name: 'La Reine du WiFi', emoji: '👸', hp: 2500 },
  { name: 'Le Monstre du Son', emoji: '👾', hp: 1800 },
  { name: 'Le Roi du Scroll', emoji: '😈', hp: 3000 },
  { name: 'La Déesse du Spam', emoji: '🤖', hp: 2200 },
];

let audioCtx = null;
function ac() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); return audioCtx; }
function tone(freq, dur, type, vol, delay = 0) { try { const ctx = ac(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(vol, ctx.currentTime + delay); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur); o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + dur); } catch (e) {} }
function sfxDamage() { tone(200, 0.12, 'sawtooth', 0.18); tone(150, 0.18, 'sawtooth', 0.15, 0.06); }
function sfxVictory() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.28, 'square', 0.12, i * 0.12)); }
function sfxStart() { tone(330, 0.12, 'triangle', 0.15); tone(440, 0.16, 'triangle', 0.15, 0.08); }

const GIFTS = [
  { name: 'Rose', emoji: '🌹', points: 1 },
  { name: 'Cœur', emoji: '💕', points: 5 },
  { name: 'Câlin', emoji: '🤗', points: 10 },
  { name: 'Panda', emoji: '🐼', points: 50 },
  { name: 'Rocket', emoji: '🚀', points: 100 },
  { name: 'Galaxie', emoji: '🌌', points: 250 },
  { name: 'Crown', emoji: '👑', points: 500 },
];

const $ = (id) => document.getElementById(id);

function post(path, body) {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json());
}

function applyState(s) { currentState = s; render(s); }

function connect() {
  const es = new EventSource('/events');
  es.onmessage = (e) => { try { applyState(JSON.parse(e.data)); } catch (err) {} };
  es.onerror = () => { /* fallback polling */ pollState(); setInterval(pollState, 2000); };
}

function pollState() { fetch('/api/state').then(r => r.json()).then(applyState).catch(() => {}); }

function startRound(bossName) { post('/api/round/start', bossName ? { bossName } : {}).then(() => pollState()); }
function endRoundAction() { post('/api/round/end', {}).then(() => pollState()); }
function ultimateAction() { post('/api/ultimate', {}).then(() => pollState()); }
function resetAction() { post('/api/reset', {}).then(() => pollState()); }
function sendGift(giftName, count, sender) { post('/api/gift', { senderName: sender, giftName, count }); }

function render(s) {
  if (s.status !== prevStatus) {
    if (s.status === 'playing') sfxStart();
    if (s.status === 'won') sfxVictory();
    prevStatus = s.status;
  }
  renderBoss(s);
  renderDamage(s);
  renderTimer(s);
  renderLeaderboard(s);
  renderFeed(s);
  renderStage(s);
  renderControls(s);
  renderWinner(s);
}

function renderBoss(s) {
  $('boss-emoji').textContent = s.boss ? s.boss.emoji : '👹';
  $('boss-name').textContent = s.boss ? s.boss.name : '';
  const pct = s.bossHpPercent !== undefined ? s.bossHpPercent : (s.boss && s.boss.maxHp > 0 ? (s.boss.hp / s.boss.maxHp) * 100 : 0);
  const fill = $('hp-fill');
  fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
  fill.classList.toggle('low', pct < 25);
  $('hp-current').textContent = Math.max(0, Math.ceil(s.boss ? s.boss.hp : 0));
  $('hp-max').textContent = s.boss ? s.boss.maxHp : 0;
}

function renderDamage(s) {
  if (s.lastDamage && s.lastDamage !== lastDamageRef) {
    lastDamageRef = s.lastDamage;
    sfxDamage();
    const el = $('damage-float');
    el.innerHTML = `<div class="dmg">${s.lastDamage.emoji} +${s.lastDamage.points}</div>`;
    clearTimeout(lastDamageTimer);
    lastDamageTimer = setTimeout(() => { el.innerHTML = ''; }, 1700);

    const emojiEl = $('boss-emoji');
    emojiEl.classList.remove('hit');
    void emojiEl.offsetWidth;
    emojiEl.classList.add('hit');
    const vp = $('boss-viewport');
    vp.classList.remove('shake');
    void vp.offsetWidth;
    vp.classList.add('shake');
  }
}

function renderTimer(s) {
  const secs = Math.max(0, Math.ceil((s.timeLeftMs || 0) / 1000));
  $('timer-value').textContent = secs;
  $('timer').classList.toggle('danger', s.status === 'playing' && secs <= 10);
}

function renderLeaderboard(s) {
  const list = $('leaderboard');
  if (!s.leaderboard || s.leaderboard.length === 0) {
    list.innerHTML = '<div class="lb-empty">Aucun donateur pour ce round.</div>';
    return;
  }
  list.innerHTML = s.leaderboard.map(p => `
    <div class="lb-row ${p.rank === 1 ? 'first' : ''} ${p.name === s.champion ? 'champion' : ''}">
      <span class="lb-rank">${p.rank}</span>
      <span class="lb-name">${p.name}</span>
      <span class="lb-points">${p.points} pts</span>
    </div>`).join('');
}

function renderFeed(s) {
  const feed = $('feed');
  if (!s.feed || s.feed.length === 0) { feed.innerHTML = '<div class="feed-empty">En attente de cadeaux…</div>'; return; }
  feed.innerHTML = s.feed.slice(0, 8).map(f => `
    <div class="feed-item">
      <span class="feed-emoji">${f.emoji}</span>
      <span class="feed-name">${f.name}</span>
      <span class="feed-gift">${f.gift}</span>
      <span class="feed-points">+${f.points}</span>
    </div>`).join('');
}

function renderStage(s) {
  const el = $('stage-content');
  let html = '';
  if (s.status === 'idle') {
    html = `
      <div class="stage-card">
        <div class="stage-emoji">👹</div>
        <h2>Battre le boss !</h2>
        <p>Le streamer lance un round. Les <strong>cadeaux envoyés lors du live TikTok</strong> des viewers infligent des dégâts.</p>
        <p>Le <strong>top donateur</strong> du round devient <strong>#1</strong> et déclenche l'<strong>ULTIMATE</strong> !</p>
        <div class="boss-options">
          ${BOSSES.map(b => `<button class="sim-gift-btn" data-boss="${b.name}">${b.emoji} ${b.name}</button>`).join('')}
        </div>
        <button id="stage-start-btn" class="btn-primary">▶ Démarrer le round</button>
      </div>`;
  } else if (s.status === 'playing') {
    html = `
      <div class="stage-card playing">
        <h2>🔴 Débattez avec le boss !</h2>
        <p>Envoyez des cadeaux pendant le round pour infliger des dégâts. Le boss se régénère au round suivant !</p>
        <div class="stage-gifts">
          ${GIFTS.map(g => `<span class="stage-gift">${g.emoji} ${g.name} = <b>+${g.points}</b> pts</span>`).join('')}
        </div>
      </div>`;
  } else {
    html = `
      <div class="stage-card won">
        <div class="stage-emoji">🏆</div>
        <h2>Victoire !</h2>
        <p>Le round est terminé. Le top donateur remporte le trophée.</p>
      </div>`;
  }
  el.innerHTML = html;
  const btn = $('stage-start-btn');
  if (btn) btn.onclick = () => startRound();
  document.querySelectorAll('[data-boss]').forEach(b => { b.onclick = () => startRound(b.dataset.boss); });
}

function renderControls(s) {
  const ultimateBtn = $('btn-ultimate');
  ultimateBtn.disabled = !(s.status === 'won' && s.championName && !s.ultimateUsed);
  ultimateBtn.textContent = s.ultimateUsed ? '⚡ ULTIMATE (utilisé)' : '⚡ ULTIMATE';
}

function renderWinner(s) {
  const overlay = $('winner-overlay');
  const show = s.status === 'won' && s.winnerName;
  overlay.classList.toggle('hidden', !show);
  if (show) {
    $('winner-name').textContent = s.winnerName;
    $('champion-title').textContent = s.championName === s.winnerName ? `👑 ${s.winnerName} est le numéro 1 !` : '';
    spawnConfetti();
  } else {
    const box = document.getElementById('confetti');
    if (box) box.innerHTML = '';
  }
}

function spawnConfetti() {
  let box = document.getElementById('confetti');
  if (!box) { box = document.createElement('div'); box.id = 'confetti'; document.body.appendChild(box); }
  const emojis = ['🎉', '🎊', '🏆', '⭐', '💥', '👑'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    c.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    c.style.left = Math.random() * 100 + '%';
    c.style.animationDelay = Math.random() * 0.8 + 's';
    c.style.fontSize = (14 + Math.random() * 24) + 'px';
    box.appendChild(c);
  }
  setTimeout(() => { if (box) box.innerHTML = ''; }, 4500);
}

function render(s) {
  const badge = $('status-badge');
  badge.className = 'status ' + s.status;
  badge.textContent = s.status === 'idle' ? '⏸ En attente' : (s.status === 'playing' ? '🔴 Round en cours' : '🏆 Victoire');

  renderBoss(s);
  renderDamage(s);
  renderTimer(s);
  renderLeaderboard(s);
  renderFeed(s);
  renderStage(s);
  renderControls(s);
  renderWinner(s);
}

// ---------- Init ----------
pollState();
connect();

setInterval(() => { if (currentState) renderTimer(currentState); }, 250);

// ---------- Actions ----------
$('btn-start').onclick = startRound;
$('btn-end').onclick = endRoundAction;
$('btn-ultimate').onclick = ultimateAction;
$('btn-reset').onclick = resetAction;
$('next-round-btn').onclick = startRound;

$('btn-send-custom').onclick = () => {
  const sender = ($('sim-sender').value || 'TikTokViewer').trim() || 'TikTokViewer';
  const gift = $('sim-gift').value;
  const count = Math.max(1, parseInt($('sim-count').value) || 1);
  sendGift(gift, count, sender);
};

document.querySelectorAll('.sim-gift-btn').forEach(btn => {
  btn.onclick = () => {
    const gift = btn.dataset.gift;
    const count = parseInt(btn.dataset.count) || 1;
    sendGift(gift, count, ($('sim-sender').value || 'TikTokViewer').trim() || 'TikTokViewer');
  };
});

document.querySelectorAll('[data-gift-count]').forEach(btn => {
  btn.onclick = () => {
    const gift = btn.dataset.gift;
    const count = parseInt(btn.dataset.count) || 1;
    sendGift(gift, count, ($('sim-sender').value || 'TikTokViewer').trim() || 'TikTokViewer');
  };
});

// Build quick gift buttons
const simGiftsEl = $('sim-gifts');
GIFTS.forEach(g => {
  const b = document.createElement('button');
  b.className = 'sim-gift-btn';
  b.dataset.gift = g.name;
  b.dataset.count = g.points >= 100 ? 1 : (g.points >= 10 ? 5 : 10);
  b.textContent = `${g.emoji} ${g.name}`;
  b.onclick = () => sendGift(g.name, parseInt(b.dataset.count) || 1, ($('sim-sender').value || 'TikTokViewer').trim() || 'TikTokViewer');
  simGiftsEl.appendChild(b);
});

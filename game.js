import * as THREE from 'three';

// ---------- Rules and tuning ----------
const MAX_PLAYERS = 50;
const ROOM = 40;               // floor runs -ROOM..ROOM on both axes
const WALL_H = 6;
const BODY_R = 0.45;
const MOVE_SPEED = 6;
const BOT_SPEED = 4.2;
const MAX_HP = 100;
const PILE_COUNT = 140;
const KOTH_TIME = 600;         // seconds
const RESPAWN_TIME = 3;        // King of the Hill only
const PERCEIVE = 35;           // bot sight range
const SLOT_R = 35;             // slot machines ring
const SPAWN_R = 31.5;          // spawn ring, in front of each slot
const CROWN_CASH = 5000;
const SNAP_EVERY = 0.1;        // seconds between host snapshots
const INPUT_EVERY = 1 / 15;    // seconds between client position updates

const TIERS = [
  { name: 'Pistol',         price: 1000,  dmg: 25, range: 40,  cd: 0.45, spread: 0.025, pellets: 1, color: 0xc9c9c9 },
  { name: 'Shotgun',        price: 3000,  dmg: 14, range: 14,  cd: 0.9,  spread: 0.09,  pellets: 5, color: 0xd98a3a },
  { name: 'Assault Rifle',  price: 6000,  dmg: 20, range: 70,  cd: 0.11, spread: 0.045, pellets: 1, color: 0x6fb3ff },
  { name: 'Sniper',         price: 10000, dmg: 95, range: 200, cd: 1.6,  spread: 0.004, pellets: 1, color: 0xffd24a },
];
const REDEEM = [
  { x: 0, z: 0 }, { x: -16, z: 10 }, { x: 17, z: -11 }, { x: -17, z: -14 },
];
const TABLES = [
  { x: -9, z: -6, kind: 'roulette' }, { x: 9, z: 6, kind: 'roulette' },
  { x: 6, z: -20, kind: 'roulette' }, { x: 16, z: 16, kind: 'roulette' },
  { x: -22, z: 14, kind: 'roulette' },
  { x: -20, z: -2, kind: 'poker' }, { x: 20, z: 2, kind: 'poker' },
  { x: -6, z: 18, kind: 'poker' }, { x: 12, z: 16, kind: 'poker' }, { x: -6, z: -14, kind: 'poker' },
];
const PILLARS = [{ x: 0, z: 12 }, { x: 0, z: -12 }, { x: 12, z: 0 }, { x: -12, z: 0 }];

// Circular obstacles: used for body collision and for blocking shots
const OBSTACLES = [];
for (const t of TABLES) OBSTACLES.push({ x: t.x, z: t.z, r: t.kind === 'roulette' ? 2.2 : 1.8 });
for (const c of REDEEM) OBSTACLES.push({ x: c.x, z: c.z, r: 1.7 });
for (const p of PILLARS) OBSTACLES.push({ x: p.x, z: p.z, r: 0.8 });
for (let i = 0; i < MAX_PLAYERS; i++) {
  const s = slotPos(i);
  OBSTACLES.push({ x: s.x, z: s.z, r: 0.8 });
}

// ---------- Small helpers ----------
const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const pad2 = (n) => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const yawToward = (dx, dz) => Math.atan2(-dx, -dz);   // yaw whose forward (-sin, -cos) points along (dx, dz)

function slotPos(i) {
  const a = (i / MAX_PLAYERS) * Math.PI * 2;
  return { x: Math.cos(a) * SLOT_R, z: Math.sin(a) * SLOT_R };
}
function spawnPoint(i) {
  const a = (i / MAX_PLAYERS) * Math.PI * 2;
  const x = Math.cos(a) * SPAWN_R;
  const z = Math.sin(a) * SPAWN_R;
  return { x, z, yaw: yawToward(x, z) };   // stand in front of the slot, facing it, so the camera sits in the room
}
function randomPoint(minR, maxR) {
  const a = Math.random() * Math.PI * 2;
  const r = minR + Math.random() * (maxR - minR);
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}
function blocked(x, z, pad) {
  return OBSTACLES.some((o) => Math.hypot(x - o.x, z - o.z) < o.r + pad);
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function fmtTime(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${pad2(s % 60)}`;
}
function cleanName(n) {
  return (n || '').trim().slice(0, 16) || 'Player';
}

// ---------- Renderer and world ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0d0f);
scene.fog = new THREE.Fog(0x0d0d0f, 60, 130);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const sun = new THREE.DirectionalLight(0xfff3d0, 0.7);
sun.position.set(20, 40, 10);
scene.add(sun);

function buildWorld() {
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(ROOM * 2, ROOM * 2),
    new THREE.MeshStandardMaterial({ color: 0xf1ece0, roughness: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const carpet = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x7a1620 }),
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.y = 0.01;
  scene.add(carpet);

  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1b1b20 });
  const wall = (x, z, w, d) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
    m.position.set(x, WALL_H / 2, z);
    scene.add(m);
  };
  wall(0, -ROOM, ROOM * 2, 1);
  wall(0, ROOM, ROOM * 2, 1);
  wall(-ROOM, 0, 1, ROOM * 2);
  wall(ROOM, 0, 1, ROOM * 2);

  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.7, roughness: 0.3 });
  const slotBody = new THREE.MeshStandardMaterial({ color: 0x17171b });
  const slotScreen = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0x6b4d00 });
  for (let i = 0; i < MAX_PLAYERS; i++) {
    const s = slotPos(i);
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.9), slotBody);
    body.position.y = 1.1;
    const trim = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.2, 0.95), gold);
    trim.position.y = 2.3;
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.7, 0.05), slotScreen);
    screen.position.set(0, 1.4, 0.46);
    g.add(body, trim, screen);
    g.position.set(s.x, 0, s.z);
    g.rotation.y = yawToward(s.x, s.z);   // screen faces the room
    scene.add(g);
  }

  const wood = new THREE.MeshStandardMaterial({ color: 0x3b2412 });
  const felt = new THREE.MeshStandardMaterial({ color: 0x0f5b2a });
  for (const t of TABLES) {
    if (t.kind === 'roulette') {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.9, 32), wood);
      base.position.set(t.x, 0.45, t.z);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.05, 32), felt);
      top.position.set(t.x, 0.92, t.z);
      scene.add(base, top);
    } else {
      const base = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.9, 2.2), wood);
      base.position.set(t.x, 0.45, t.z);
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.05, 1.8), felt);
      top.position.set(t.x, 0.92, t.z);
      scene.add(base, top);
    }
  }

  for (const c of REDEEM) {
    const kiosk = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.2, 2.4), gold);
    kiosk.position.set(c.x, 1.1, c.z);
    const light = new THREE.PointLight(0xffd24a, 6, 14);
    light.position.set(c.x, 4, c.z);
    scene.add(kiosk, light);
  }

  for (const p of PILLARS) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, WALL_H, 16), gold);
    pillar.position.set(p.x, WALL_H / 2, p.z);
    scene.add(pillar);
  }
}

// ---------- Figures and piles (client-side visuals) ----------
const SUIT_POOR = new THREE.Color(0x2b2b30);
const SUIT_RICH = new THREE.Color(0xd4af37);
const figures = new Map();   // entity id -> figure
const pileMeshes = new Map(); // pile id -> mesh

function makeFigure() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: SUIT_POOR.clone(), roughness: 0.55 });
  const part = (geo, y) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    group.add(m);
  };
  part(new THREE.BoxGeometry(0.5, 0.9, 0.4), 0.45);
  part(new THREE.BoxGeometry(0.75, 0.9, 0.45), 1.35);
  // Goblin head: green skin, separate from the suit so the suit still shifts with cash
  const skin = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshStandardMaterial({ color: 0x7fae3a, roughness: 0.6 }));
  skin.position.y = 1.9;
  group.add(skin);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.7), new THREE.MeshStandardMaterial({ color: 0x444444 }));
  gun.position.set(0.35, 1.3, -0.35);
  group.add(gun);
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.3, 5),
    new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0x806000 }),
  );
  crown.position.y = 2.3;
  group.add(crown);
  scene.add(group);
  const tag = document.createElement('div');
  tag.className = 'tag';
  $('labels').appendChild(tag);
  return { group, mat, gun, crown, tag, ent: null };
}

function syncFigures(ents) {
  const seen = new Set();
  for (const ent of ents) {
    seen.add(ent.id);
    let f = figures.get(ent.id);
    if (!f) {
      f = makeFigure();
      f.group.position.set(ent.x, 0, ent.z);
      figures.set(ent.id, f);
    }
    f.ent = ent;
  }
  for (const [id, f] of figures) {
    if (seen.has(id)) continue;
    scene.remove(f.group);
    f.tag.remove();
    figures.delete(id);
  }
}

function syncPiles(list) {
  const seen = new Set();
  for (const p of list) {
    seen.add(p.id);
    if (pileMeshes.has(p.id)) continue;
    const h = 0.12 + (p.amt / 1000) * 0.35;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.5, h, 12),
      new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.35 }),
    );
    m.position.set(p.x, h / 2, p.z);
    scene.add(m);
    pileMeshes.set(p.id, m);
  }
  for (const [id, m] of pileMeshes) {
    if (seen.has(id)) continue;
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
    pileMeshes.delete(id);
  }
}

// ---------- Shared game state ----------
let isHost = false;
let phase = 'lobby';          // host truth: 'lobby' | 'playing' | 'over'
let mode = 'br';              // 'br' | 'koth'
let myId = null;
let roomCode = '';
let peer = null;
let hostConn = null;          // client only
const lobby = new Map();      // host only: peer id -> { name, conn }
let hostName = 'Player';
let entities = [];            // host only: authoritative entities
let piles = [];               // host only
let feed = [];                // host only: recent kill lines
let timeLeft = KOTH_TIME;
let winnerText = '';
let hostEntity = null;

let state = null;             // latest snapshot (host builds it too)
let myEnt = null;             // my row in the latest snapshot
let me = { x: 0, z: 0, yaw: 0 };     // my body; the host points this at its own entity
let pitch = 0;
let clientCd = 0;
let inputAcc = 0;
let snapAcc = 0;
let hitTimer = 0;
let noteTimer = 0;
let mouseDown = false;
const keys = {};

// ---------- Entities (host) ----------
function makeEntity(id, name, bot, conn, slot) {
  const sp = spawnPoint(slot);
  return {
    id, name, bot, conn,
    x: sp.x, z: sp.z, sx: sp.x, sz: sp.z, yaw: sp.yaw,
    cash: 0, hp: MAX_HP, tier: -1, alive: true, rs: 0, cd: 0,
    goal: null, thinkT: 0, wander: null, strafe: 1, strafeT: 0,
  };
}

function resolveMove(e) {
  e.x = clamp(e.x, -ROOM + 1, ROOM - 1);
  e.z = clamp(e.z, -ROOM + 1, ROOM - 1);
  for (const o of OBSTACLES) {
    const dx = e.x - o.x;
    const dz = e.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + BODY_R;
    if (d >= min) continue;
    if (d < 1e-6) {
      e.x = o.x + min;
    } else {
      e.x = o.x + (dx / d) * min;
      e.z = o.z + (dz / d) * min;
    }
  }
}

function randomPile() {
  let p;
  do { p = randomPoint(4, ROOM - 6); } while (blocked(p.x, p.z, 0.6));
  return { id: Math.random().toString(36).slice(2, 10), x: p.x, z: p.z, amt: 50 * (2 + Math.floor(Math.random() * 19)) };
}

function pushFeed(text) {
  feed.push(text);
  if (feed.length > 8) feed.shift();
}

function notify(e, text) {
  if (e.conn) e.conn.send({ t: 'note', text });
  else if (e === hostEntity) showNote(text);
}

function nextBuy(cash, tier) {
  let best = -1;
  for (let k = tier + 1; k < TIERS.length; k++) {
    if (TIERS[k].price <= cash) best = k;
  }
  return best;
}

function nearCenter(x, z, range = 3) {
  return REDEEM.some((c) => Math.hypot(x - c.x, z - c.z) < range);
}

function tryRedeem(e) {
  if (!e.alive || !nearCenter(e.x, e.z)) return;
  const k = nextBuy(e.cash, e.tier);
  if (k < 0) {
    notify(e, 'Not enough cash for a better weapon');
    return;
  }
  e.cash -= TIERS[k].price;
  e.tier = k;
  notify(e, `Redeemed for ${TIERS[k].name}`);
}

function applyDamage(t, dmg, killer) {
  if (!t.alive) return;
  t.hp -= dmg;
  if (t.hp <= 0) kill(t, killer);
}

function kill(v, k) {
  const loot = v.cash;
  k.cash += loot;
  v.cash = 0;
  v.tier = -1;
  v.hp = 0;
  v.alive = false;
  v.rs = mode === 'koth' ? RESPAWN_TIME : Infinity;
  pushFeed(`${k.name} eliminated ${v.name}${loot ? ` and took $${fmt(loot)}` : ''}`);
  notify(k, `Eliminated ${v.name}${loot ? ` (+$${fmt(loot)})` : ''}`);
  notify(v, `Eliminated by ${k.name}`);
}

function respawn(e) {
  e.alive = true;
  e.hp = MAX_HP;
  e.cash = 0;
  e.tier = -1;
  e.x = e.sx;
  e.z = e.sz;
  e.yaw = yawToward(e.sx, e.sz);
  e.rs = 0;
}

// Ray vs circle in the floor plane. Returns distance along the ray, or -1.
function rayCircle(ox, oz, dx, dz, o) {
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const fx = ox - o.x;
  const fz = oz - o.z;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - o.r * o.r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  return (-b - Math.sqrt(disc)) / (2 * a);
}

// Hitscan. Only targets richer than the shooter can be hit (the same rule as visibility).
function raycast(shooter, dir, range) {
  const ox = shooter.x;
  const oy = 1.5;
  const oz = shooter.z;
  const [dx, dy, dz] = dir;
  let blockT = range;
  for (const o of OBSTACLES) {
    const t = rayCircle(ox, oz, dx, dz, o);
    if (t > 0 && t < blockT) blockT = t;
  }
  let best = null;
  let bestT = blockT;
  for (const t of entities) {
    if (t === shooter || !t.alive) continue;
    const cx = t.x - ox;
    const cy = 1.1 - oy;
    const cz = t.z - oz;
    const along = cx * dx + cy * dy + cz * dz;
    if (along < 0) continue;
    const perp2 = cx * cx + cy * cy + cz * cz - along * along;
    if (perp2 > 0.2025) continue;            // body radius 0.45
    const th = along - Math.sqrt(0.2025 - perp2);
    if (th > 0 && th < bestT) {
      best = t;
      bestT = th;
    }
  }
  return best;
}

function jitter(d, spread) {
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const x = d[0] / len + (Math.random() * 2 - 1) * spread;
  const y = d[1] / len + (Math.random() * 2 - 1) * spread;
  const z = d[2] / len + (Math.random() * 2 - 1) * spread;
  const l = Math.hypot(x, y, z);
  return [x / l, y / l, z / l];
}

function fire(shooter, d) {
  if (!shooter.alive || shooter.tier < 0 || shooter.cd > 0) return;
  const w = TIERS[shooter.tier];
  shooter.cd = w.cd;
  let hits = 0;
  for (let p = 0; p < w.pellets; p++) {
    const target = raycast(shooter, jitter(d, w.spread), w.range);
    if (target) {
      hits++;
      applyDamage(target, w.dmg, shooter);
    }
  }
  if (hits) {
    if (shooter.conn) shooter.conn.send({ t: 'hit' });
    else if (shooter === hostEntity) flashHit();
  }
}

function moveTo(e, tx, tz, speed, dt) {
  const dx = tx - e.x;
  const dz = tz - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return;
  e.yaw = yawToward(dx, dz);
  const step = Math.min(d, speed * dt);
  e.x += (dx / d) * step;
  e.z += (dz / d) * step;
  resolveMove(e);
}

function moveSide(e, ux, uz, speed, dt) {
  e.x += ux * speed * dt;
  e.z += uz * speed * dt;
  resolveMove(e);
}

function nearestPile(e, maxDist) {
  let best = null;
  let bestD = maxDist;
  for (const p of piles) {
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

function nearestCenter(e) {
  let best = REDEEM[0];
  let bestD = Infinity;
  for (const c of REDEEM) {
    const d = Math.hypot(c.x - e.x, c.z - e.z);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function botTick(b, dt) {
  const w = b.tier >= 0 ? TIERS[b.tier] : null;

  // Sight: only richer players are visible to a bot
  let foe = null;
  let fd = PERCEIVE;
  if (w) {
    for (const t of entities) {
      if (t === b || !t.alive || t.cash <= b.cash) continue;
      const d = Math.hypot(t.x - b.x, t.z - b.z);
      if (d < fd) {
        fd = d;
        foe = t;
      }
    }
  }

  if (foe) {
    const dx = foe.x - b.x;
    const dz = foe.z - b.z;
    b.yaw = yawToward(dx, dz) + (Math.random() - 0.5) * 0.12;
    if (b.cd <= 0 && fd <= w.range) fire(b, [dx, -0.3, dz]);
    if (fd > w.range * 0.6) {
      moveTo(b, foe.x, foe.z, BOT_SPEED, dt);
    } else {
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafe = -b.strafe;
        b.strafeT = 1 + Math.random() * 1.5;
      }
      moveSide(b, (-dz / fd) * b.strafe, (dx / fd) * b.strafe, BOT_SPEED, dt);
    }
    return;
  }

  // Upgrade when affordable
  if (nextBuy(b.cash, b.tier) >= 0) {
    if (nearCenter(b.x, b.z, 2.2)) tryRedeem(b);
    else {
      const c = nearestCenter(b);
      moveTo(b, c.x, c.z, BOT_SPEED, dt);
    }
    return;
  }

  // Loot, re-picking the nearest pile every half second
  b.thinkT -= dt;
  if (b.thinkT <= 0) {
    b.goal = nearestPile(b, 45);
    b.thinkT = 0.5;
  }
  if (b.goal && piles.includes(b.goal)) {
    moveTo(b, b.goal.x, b.goal.z, BOT_SPEED, dt);
    return;
  }

  // Wander
  if (!b.wander || Math.hypot(b.wander.x - b.x, b.wander.z - b.z) < 1.2) {
    b.wander = randomPoint(4, ROOM - 6);
  }
  moveTo(b, b.wander.x, b.wander.z, BOT_SPEED * 0.6, dt);
}

function collectPiles() {
  for (let i = 0; i < piles.length; i++) {
    const p = piles[i];
    for (const e of entities) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - p.x, e.z - p.z) < 1.1) {
        e.cash += p.amt;
        piles[i] = randomPile();
        break;
      }
    }
  }
}

function richestAlive() {
  let best = null;
  for (const e of entities) {
    if (e.alive && (!best || e.cash > best.cash)) best = e;
  }
  return best;
}

function endMatch(winner) {
  phase = 'over';
  winnerText = winner ? `${winner.name} wins with $${fmt(winner.cash)}` : 'No winner';
  broadcastSnapshot();
}

function simulate(dt) {
  for (const e of entities) {
    e.cd = Math.max(0, e.cd - dt);
    if (!e.alive) {
      if (isFinite(e.rs) && e.rs > 0) {
        e.rs -= dt;
        if (e.rs <= 0) respawn(e);
      }
      continue;
    }
    if (e.bot) botTick(e, dt);
  }
  collectPiles();

  if (mode === 'koth') {
    timeLeft -= dt;
    if (timeLeft <= 0) endMatch(richestAlive());
  } else {
    const alive = entities.filter((e) => e.alive);
    if (alive.length <= 1) endMatch(alive[0] || null);
  }
}

// ---------- Snapshot (host -> everyone) ----------
function buildSnapshot() {
  const alive = entities.filter((e) => e.alive).length;
  return {
    t: 'snap',
    phase,
    mode,
    timeLeft,
    alive,
    total: entities.length,
    winner: winnerText,
    feed: feed.slice(-5),
    ents: entities.map((e) => ({
      id: e.id, name: e.name, bot: e.bot,
      x: e.x, z: e.z, yaw: e.yaw,
      cash: e.cash, hp: e.hp, tier: e.tier, alive: e.alive,
      rs: isFinite(e.rs) ? Math.ceil(e.rs) : 0,
    })),
    piles: piles.map((p) => ({ id: p.id, x: p.x, z: p.z, amt: p.amt })),
  };
}

function broadcast(msg) {
  for (const p of lobby.values()) {
    if (p.conn && p.conn.open) p.conn.send(msg);
  }
}

function broadcastSnapshot() {
  const s = buildSnapshot();
  setState(s);
  broadcast(s);
}

function setState(s) {
  state = s;
  myEnt = s.ents.find((e) => e.id === myId) || null;
  syncFigures(s.ents);
  syncPiles(s.piles);
  if (!isHost && myEnt) {
    // Adopt the server's position when dead, respawned, or far off
    if (!myEnt.alive || Math.hypot(me.x - myEnt.x, me.z - myEnt.z) > 3) {
      me.x = myEnt.x;
      me.z = myEnt.z;
      me.yaw = myEnt.yaw;
    }
  }
}

// ---------- Lobby and networking ----------
function renderLobby(names) {
  const ul = $('players');
  ul.classList.remove('hidden');
  ul.innerHTML = '';
  for (const n of names) {
    const li = document.createElement('li');
    li.textContent = n;
    ul.appendChild(li);
  }
  $('status').textContent = `${names.length} / ${MAX_PLAYERS} in lobby`;
}

function broadcastLobby() {
  const names = [hostName, ...[...lobby.values()].map((p) => p.name)];
  renderLobby(names);
  broadcast({ t: 'lobby', names });
}

function randomCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 5; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function hostGame() {
  hostName = cleanName($('name').value);
  roomCode = randomCode();
  isHost = true;
  $('host-btn').disabled = true;
  $('status').textContent = 'Creating room...';
  peer = new Peer(`PR-${roomCode}`);
  peer.on('open', (id) => {
    myId = id;
    $('host-box').classList.remove('hidden');
    $('code').textContent = roomCode;
    $('start-btn').disabled = false;
    broadcastLobby();
  });
  peer.on('connection', (conn) => {
    conn.on('data', (m) => onHostData(conn, m));
    conn.on('close', () => onHostClose(conn.peer));
  });
  peer.on('error', (err) => {
    $('status').textContent = `Network error: ${err.type}`;
  });
}

function onHostData(conn, m) {
  if (m.t === 'join') {
    if (phase !== 'lobby') {
      conn.send({ t: 'reject', text: 'That match has already started' });
      return;
    }
    if (lobby.size >= MAX_PLAYERS - 1) {
      conn.send({ t: 'reject', text: 'Room is full' });
      return;
    }
    lobby.set(conn.peer, { name: cleanName(m.name), conn });
    broadcastLobby();
    return;
  }
  const e = entities.find((x) => x.id === conn.peer);
  if (!e) return;
  if (m.t === 'in') onInput(e, m);
  else if (m.t === 'fire') fire(e, m.d);
  else if (m.t === 'buy') tryRedeem(e);
}

function onInput(e, m) {
  if (!e.alive) return;
  if (Math.hypot(m.x - e.x, m.z - e.z) > 1.5) return;   // no teleporting
  e.x = m.x;
  e.z = m.z;
  e.yaw = m.yaw;
  resolveMove(e);
}

function onHostClose(id) {
  lobby.delete(id);
  const e = entities.find((x) => x.id === id);
  if (e) {
    // A player who drops mid-match becomes a bot
    e.conn = null;
    e.bot = true;
    e.name = `${e.name} (bot)`;
  }
  broadcastLobby();
}

function startMatch() {
  mode = $('mode').value;
  phase = 'playing';
  timeLeft = KOTH_TIME;
  winnerText = '';
  feed = [];
  const order = shuffle([...Array(MAX_PLAYERS).keys()]);
  let slot = 0;
  hostEntity = makeEntity(myId, hostName, false, null, order[slot++]);
  entities = [hostEntity];
  for (const [id, p] of lobby) {
    entities.push(makeEntity(id, p.name, false, p.conn, order[slot++]));
  }
  for (let b = 1; entities.length < MAX_PLAYERS; b++) {
    entities.push(makeEntity(`bot${b}`, `Bot ${pad2(b)}`, true, null, order[slot++]));
  }
  piles = [];
  for (let i = 0; i < PILE_COUNT; i++) piles.push(randomPile());
  me = hostEntity;
  beginGame(mode);
  broadcast({ t: 'start', mode });
  broadcastSnapshot();
}

function joinGame() {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 5) {
    $('status').textContent = 'Enter the 5-letter room code';
    return;
  }
  hostName = cleanName($('name').value);
  isHost = false;
  $('status').textContent = 'Connecting...';
  peer = new Peer();
  peer.on('open', (id) => {
    myId = id;
    hostConn = peer.connect(`PR-${code}`, { reliable: true });
    hostConn.on('open', () => {
      hostConn.send({ t: 'join', name: hostName });
      $('status').textContent = 'Joined. Waiting for the host to start...';
    });
    hostConn.on('data', onClientData);
    hostConn.on('close', () => {
      $('status').textContent = 'Disconnected from host';
    });
  });
  peer.on('error', (err) => {
    $('status').textContent = `Could not connect: ${err.type}`;
  });
}

function onClientData(m) {
  switch (m.t) {
    case 'lobby': renderLobby(m.names); break;
    case 'start': beginGame(m.mode); break;
    case 'snap': setState(m); break;
    case 'note': showNote(m.text); break;
    case 'hit': flashHit(); break;
    case 'reject':
      $('status').textContent = m.text;
      break;
  }
}

function lockPointer() {
  // Browsers reject pointer lock without a user gesture; that is harmless here
  const p = canvas.requestPointerLock();
  if (p && p.catch) p.catch(() => {});
}

function beginGame(m) {
  mode = m;
  $('lobby').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('players').classList.add('hidden');
  lockPointer();
}

// ---------- Local control ----------
function self() {
  return isHost ? hostEntity : myEnt;
}

function aimDir() {
  const cp = Math.cos(pitch);
  return [-Math.sin(me.yaw) * cp, Math.sin(pitch), -Math.cos(me.yaw) * cp];
}

function shoot() {
  const s = self();
  if (!s || !s.alive || s.tier < 0) return;
  if (isHost) {
    fire(hostEntity, aimDir());
    return;
  }
  if (clientCd > 0) return;
  clientCd = TIERS[s.tier].cd;
  hostConn.send({ t: 'fire', d: aimDir() });
}

function control(dt) {
  clientCd = Math.max(0, clientCd - dt);
  const s = self();
  if (!s || !s.alive || !state || state.phase !== 'playing') {
    if (!isHost && hostConn && state) {
      inputAcc += dt;
      if (inputAcc >= INPUT_EVERY) {
        inputAcc = 0;
        hostConn.send({ t: 'in', x: me.x, z: me.z, yaw: me.yaw });
      }
    }
    return;
  }
  const fwdX = -Math.sin(me.yaw);
  const fwdZ = -Math.cos(me.yaw);
  const rightX = Math.cos(me.yaw);
  const rightZ = -Math.sin(me.yaw);
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  let vx = fwdX * f + rightX * r;
  let vz = fwdZ * f + rightZ * r;
  const len = Math.hypot(vx, vz);
  if (len > 0) {
    vx /= len;
    vz /= len;
    me.x += vx * MOVE_SPEED * dt;
    me.z += vz * MOVE_SPEED * dt;
  }
  resolveMove(me);
  if (!isHost) {
    inputAcc += dt;
    if (inputAcc >= INPUT_EVERY) {
      inputAcc = 0;
      hostConn.send({ t: 'in', x: me.x, z: me.z, yaw: me.yaw });
    }
  }
  if (mouseDown) shoot();
}

// ---------- HUD ----------
function showNote(text) {
  const n = $('note');
  n.textContent = text;
  n.classList.add('on');
  noteTimer = 2;
}

function flashHit() {
  hitTimer = 0.15;
}

function updateHud() {
  const s = self();
  if (!state || !s) return;
  const hud = $('hud');
  if (hud.classList.contains('hidden')) return;

  $('hud-mode').textContent = state.mode === 'koth' ? 'King of the Hill' : 'Battle Royale';
  $('hud-time').textContent = state.mode === 'koth' ? fmtTime(state.timeLeft) : `${state.alive} alive`;
  $('hud-alive').textContent = `${state.alive} / ${state.total} standing`;

  $('cash').textContent = `$${fmt(s.cash)}`;
  $('hud-hp').style.width = `${clamp(s.hp, 0, MAX_HP)}%`;
  const cur = s.tier >= 0 ? TIERS[s.tier].name : 'Unarmed';
  const nxt = nextBuy(s.cash, s.tier);
  $('hud-weapon').textContent = s.tier + 1 < TIERS.length
    ? `${cur} · next ${TIERS[s.tier + 1].name} $${fmt(TIERS[s.tier + 1].price)}`
    : `${cur} · max`;

  const seen = state.ents.filter((e) => e.alive && e.id !== myId && (!s.alive || e.cash > s.cash)).length;
  $('hud-seen').textContent = `Visible richer players: ${seen}`;
  $('feed').innerHTML = state.feed.map((line) => `<div>${line}</div>`).join('');

  const prompt = $('prompt');
  if (s.alive && nearCenter(me.x, me.z)) {
    prompt.classList.remove('hidden');
    prompt.textContent = nxt >= 0
      ? `E · redeem for ${TIERS[nxt].name} ($${fmt(TIERS[nxt].price)})`
      : 'E · not enough cash to upgrade';
  } else {
    prompt.classList.add('hidden');
  }

  const dead = $('dead');
  if (!s.alive) {
    dead.classList.remove('hidden');
    dead.textContent = state.mode === 'koth' ? `Respawning in ${Math.ceil(s.rs || 0)}` : 'Eliminated · spectating';
  } else {
    dead.classList.add('hidden');
  }

  if (state.phase === 'over') {
    $('over-text').textContent = state.winner || 'Match over';
    $('over').classList.remove('hidden');
  }
}

// ---------- Render loop ----------
const tagPos = new THREE.Vector3();

function renderFigures(dt) {
  const s = self();
  const myAlive = !!(s && s.alive);
  const myCash = s ? s.cash : 0;
  for (const [id, f] of figures) {
    const e = f.ent;
    const isMe = id === myId;
    const visible = isMe ? myAlive : e.alive && (!myAlive || e.cash > myCash);
    f.group.visible = visible;
    if (!visible) {
      f.tag.style.display = 'none';
      continue;
    }

    const x = isMe ? me.x : e.x;
    const z = isMe ? me.z : e.z;
    const yaw = isMe ? me.yaw : e.yaw;
    if (isMe) {
      f.group.position.set(x, 0, z);
    } else {
      const k = Math.min(1, dt * 12);
      f.group.position.x += (x - f.group.position.x) * k;
      f.group.position.z += (z - f.group.position.z) * k;
    }
    f.group.rotation.y = yaw;

    // Richer players read as brighter and bigger
    const rich = Math.min(1, e.cash / 8000);
    f.mat.color.lerpColors(SUIT_POOR, SUIT_RICH, rich);
    f.mat.emissive.setRGB(rich * 0.35, rich * 0.28, 0);
    f.group.scale.setScalar(1 + rich * 0.08);
    f.crown.visible = e.cash >= CROWN_CASH;
    f.gun.visible = e.tier >= 0;
    if (e.tier >= 0) f.gun.material.color.setHex(TIERS[e.tier].color);

    if (isMe) {
      f.tag.style.display = 'none';
      continue;
    }
    tagPos.set(x, 2.7, z).project(camera);
    if (tagPos.z > 1) {
      f.tag.style.display = 'none';
      continue;
    }
    f.tag.style.display = 'block';
    f.tag.textContent = `${e.name} · $${fmt(e.cash)}`;
    const sx = (tagPos.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-tagPos.y * 0.5 + 0.5) * window.innerHeight;
    f.tag.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) translate(-50%, -100%)`;
  }
}

function updateCamera() {
  const cp = Math.cos(pitch);
  const dx = -Math.sin(me.yaw) * cp;
  const dy = Math.sin(pitch);
  const dz = -Math.cos(me.yaw) * cp;
  const ox = me.x;
  const oy = 1.6;
  const oz = me.z;
  camera.position.set(ox - dx * 4.5, oy - dy * 4.5, oz - dz * 4.5);
  camera.lookAt(ox + dx * 30, oy + dy * 30, oz + dz * 30);
}

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  if (isHost && phase === 'playing') {
    simulate(dt);
    snapAcc += dt;
    if (snapAcc >= SNAP_EVERY) {
      snapAcc = 0;
      broadcastSnapshot();
    }
  }
  control(dt);

  renderFigures(dt);
  updateCamera();

  if (hitTimer > 0) {
    hitTimer -= dt;
    $('hitmark').classList.toggle('on', hitTimer > 0);
  }
  if (noteTimer > 0) {
    noteTimer -= dt;
    if (noteTimer <= 0) $('note').classList.remove('on');
  }
  updateHud();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Input ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyE' && !e.repeat && state && state.phase === 'playing') {
    if (isHost) tryRedeem(hostEntity);
    else if (hostConn) hostConn.send({ t: 'buy' });
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  mouseDown = true;
  if (!document.pointerLockElement && state) lockPointer();
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouseDown = false;
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  me.yaw -= e.movementX * 0.0025;
  pitch = clamp(pitch - e.movementY * 0.002, -0.5, 0.35);
});

$('host-btn').addEventListener('click', hostGame);
$('start-btn').addEventListener('click', () => {
  if (isHost && phase === 'lobby') startMatch();
});
$('join-btn').addEventListener('click', joinGame);
$('again-btn').addEventListener('click', () => location.reload());

// ---------- Boot ----------
buildWorld();
requestAnimationFrame(frame);

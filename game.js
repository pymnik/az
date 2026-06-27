/* =========================================================================
   AZ — TANK BATTLE
   An original desktop remake inspired by the classic "AZ" tank maze game.
   Top-down tanks, randomly generated mazes, ricocheting shells, weapon crates.
   All graphics drawn in-engine; all sounds synthesized via Web Audio.
   ========================================================================= */
(() => {
"use strict";

// ----------------------------- constants --------------------------------
const CS = 78;          // cell size (px)
const WT = 12;          // wall thickness (px)
const PAD = WT / 2;     // outer padding so border walls are fully visible
const SCORE_H = 150;    // bottom strip for the tank score icons
let COLS = 9, ROWS = 7; // maze size (recomputed per round from #players)

// Rectangular tank, length:width = 4:3. These half-extents are also the
// EXACT collision hitbox.
const TANK_HW  = CS * 0.24;   // half length (front-to-back, along barrel)
const TANK_HH  = CS * 0.18;   // half width  (side-to-side)  -> 0.48 : 0.36 = 4:3
// The protruding barrel is also solid (its own little hitbox in front).
const BARREL_OFF = TANK_HW * 1.35;   // centre offset forward from tank centre
const BARREL_HL  = TANK_HW * 0.35;   // half length of the protruding part
const BARREL_HW  = TANK_HH * 0.28;   // half width of the barrel
const TANK_SPEED = 2.8;       // direct, no inertia (no sliding/drift)
const TANK_TURN = 0.065;

const PLAYER_COLORS = ['#e02020', '#27c12a', '#2a6bff', '#f2c014'];
const PLAYER_NAMES  = ['P1', 'P2', 'P3', 'P4'];

// Per-player controls, keyed by KeyboardEvent.code (layout-independent).
//  P1: E S D F  + fire 1      P2: O K L ;  + fire Right Ctrl
//  P3: Numpad 8 4 5 6 + fire Arrow Up
const CONTROLS = [
  { up:'KeyE', left:'KeyS', down:'KeyD', right:'KeyF', fire:'Digit1' },
  { up:'KeyO', left:'KeyK', down:'KeyL', right:'Semicolon', fire:'ControlRight' },
  { up:'Numpad8', left:'Numpad4', down:'Numpad5', right:'Numpad6', fire:'ArrowUp' },
];

// maze palette tuned to the original AZ look
const COL_FLOOR  = '#e9e9e9';
const COL_WALL   = '#565656';
const COL_WALL_HI= 'rgba(255,255,255,0.18)';
const COL_WALL_LO= 'rgba(0,0,0,0.28)';
const COL_BORDER = '#1f1f1f';
const COL_PAGE   = '#ffffff';

// ----------------------------- helpers ----------------------------------
const rand  = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const TAU = Math.PI * 2;
const angLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU) - Math.PI;
  if (d < -Math.PI) d += TAU;
  return a + d * t;
};

// ============================= AUDIO ====================================
const Audio = (() => {
  let ac = null, master = null, muted = false;
  function ensure() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain();
    master.gain.value = 0.5;
    master.connect(ac.destination);
  }
  function resume() { ensure(); if (ac.state === 'suspended') ac.resume(); }

  function tone(freq, dur, type, vol, slideTo, when) {
    if (!ac || muted) return;
    const t = (when || ac.currentTime);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, lpStart, lpEnd) {
    if (!ac || muted) return;
    const t = ac.currentTime;
    const n = Math.floor(ac.sampleRate * dur);
    const buf = ac.createBuffer(1, n, ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ac.createBufferSource(); src.buffer = buf;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(lpStart, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, lpEnd), t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur);
  }

  // Very deep, low-frequency arcade SFX set.
  return {
    resume,
    setMuted(m){ muted = m; },
    shoot(){ tone(85, 0.18, 'square', 0.22, 30); tone(42, 0.14, 'triangle', 0.18, 20); },
    rapid(){ tone(110, 0.08, 'square', 0.14, 60); },
    ricochet(){ tone(rand(170,250), 0.08, 'triangle', 0.10, 80); },
    explosion(){ noise(0.6, 0.65, 420, 40); tone(38, 0.55, 'sawtooth', 0.32, 16); },
    smallboom(){ noise(0.32, 0.42, 380, 45); tone(50, 0.24, 'sawtooth', 0.2, 20); },
    pickup(){ const b = ac ? ac.currentTime : 0; tone(110,0.11,'square',0.16,null,b); tone(147,0.11,'square',0.16,null,b+0.08); tone(185,0.15,'square',0.18,null,b+0.16); },
    laser(){ tone(210, 0.28, 'sawtooth', 0.16, 45); },
    win(){ const b = ac ? ac.currentTime : 0; [82,98,123,165].forEach((f,i)=>tone(f,0.22,'square',0.2,null,b+i*0.11)); },
    spawn(){ tone(70, 0.24, 'sine', 0.16, 150); },
  };
})();

// ============================= MAZE =====================================
// Walls live on grid lines. We keep two boolean grids:
//   hWall[r][c]  horizontal wall on line y=r, spanning column c   (r:0..ROWS, c:0..COLS-1)
//   vWall[r][c]  vertical   wall on line x=c, spanning row r      (r:0..ROWS-1, c:0..COLS)
let hWall = [], vWall = [], wallRects = [];

function X(c){ return PAD + c * CS; }
function Y(r){ return PAD + r * CS; }
function cellCenter(r, c){ return { x: X(c) + CS/2, y: Y(r) + CS/2 }; }

function buildMaze() {
  hWall = []; vWall = [];
  for (let r = 0; r <= ROWS; r++){ hWall[r] = []; for (let c = 0; c < COLS; c++) hWall[r][c] = true; }
  for (let r = 0; r < ROWS; r++){ vWall[r] = []; for (let c = 0; c <= COLS; c++) vWall[r][c] = true; }

  // recursive backtracker carve
  const visited = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
  const stack = [];
  let r = randi(0, ROWS), c = randi(0, COLS);
  visited[r][c] = true; stack.push([r, c]);
  while (stack.length) {
    const [cr, cc] = stack[stack.length - 1];
    const nb = [];
    if (cr > 0       && !visited[cr-1][cc]) nb.push([cr-1, cc, 'N']);
    if (cr < ROWS-1  && !visited[cr+1][cc]) nb.push([cr+1, cc, 'S']);
    if (cc > 0       && !visited[cr][cc-1]) nb.push([cr, cc-1, 'W']);
    if (cc < COLS-1  && !visited[cr][cc+1]) nb.push([cr, cc+1, 'E']);
    if (!nb.length) { stack.pop(); continue; }
    const [nr, ncc, dir] = nb[randi(0, nb.length)];
    if (dir === 'N') hWall[cr][cc]   = false;
    if (dir === 'S') hWall[cr+1][cc] = false;
    if (dir === 'W') vWall[cr][cc]   = false;
    if (dir === 'E') vWall[cr][cc+1] = false;
    visited[nr][ncc] = true; stack.push([nr, ncc]);
  }

  // knock down extra interior walls => loops & open arenas (Tank-Trouble feel)
  const extra = Math.floor(COLS * ROWS * 0.30);
  for (let i = 0; i < extra; i++) {
    if (Math.random() < 0.5) {
      const rr = randi(1, ROWS), cc = randi(0, COLS);
      hWall[rr][cc] = false;
    } else {
      const rr = randi(0, ROWS), cc = randi(1, COLS);
      vWall[rr][cc] = false;
    }
  }
  buildWallRects();
}

function buildWallRects() {
  wallRects = [];
  for (let r = 0; r <= ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (hWall[r][c]) wallRects.push({ x: X(c) - WT/2, y: Y(r) - WT/2, w: CS + WT, h: WT });
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c <= COLS; c++)
      if (vWall[r][c]) wallRects.push({ x: X(c) - WT/2, y: Y(r) - WT/2, w: WT, h: CS + WT });
}

// circle vs all wall rects -> resolved position + collision flag
function resolveCircle(px, py, rad) {
  let hit = false;
  for (const w of wallRects) {
    const nx = clamp(px, w.x, w.x + w.w);
    const ny = clamp(py, w.y, w.y + w.h);
    let dx = px - nx, dy = py - ny;
    let d2 = dx*dx + dy*dy;
    if (d2 < rad*rad) {
      hit = true;
      if (d2 < 1e-6) { // center inside rect: push out along smallest axis
        const left = px - w.x, right = w.x + w.w - px;
        const top = py - w.y, bottom = w.y + w.h - py;
        const m = Math.min(left, right, top, bottom);
        if (m === left)  px = w.x - rad;
        else if (m === right) px = w.x + w.w + rad;
        else if (m === top)   py = w.y - rad;
        else py = w.y + w.h + rad;
      } else {
        const d = Math.sqrt(d2);
        px = nx + (dx/d) * rad;
        py = ny + (dy/d) * rad;
      }
    }
  }
  return { x: px, y: py, hit };
}

// segment vs walls — true if blocked (used by bots & laser)
function segmentBlocked(x1, y1, x2, y2) {
  for (const w of wallRects) if (segRectIntersect(x1,y1,x2,y2,w)) return true;
  return false;
}
function segRectIntersect(x1,y1,x2,y2,w){
  // quick reject
  if (Math.max(x1,x2) < w.x || Math.min(x1,x2) > w.x+w.w ||
      Math.max(y1,y2) < w.y || Math.min(y1,y2) > w.y+w.h) return false;
  const edges = [
    [w.x, w.y, w.x+w.w, w.y],
    [w.x+w.w, w.y, w.x+w.w, w.y+w.h],
    [w.x+w.w, w.y+w.h, w.x, w.y+w.h],
    [w.x, w.y+w.h, w.x, w.y],
  ];
  for (const e of edges) if (segSeg(x1,y1,x2,y2,e[0],e[1],e[2],e[3])) return true;
  // also: fully inside
  if (x1 > w.x && x1 < w.x+w.w && y1 > w.y && y1 < w.y+w.h) return true;
  return false;
}
function segSeg(a,b,c,d,p,q,r,s){
  const det = (c-a)*(s-q) - (r-p)*(d-b);
  if (det === 0) return false;
  const lambda = ((s-q)*(r-a) + (p-r)*(s-b)) / det;
  const gamma  = ((b-d)*(r-a) + (c-a)*(s-b)) / det;
  return lambda>0 && lambda<1 && gamma>0 && gamma<1;
}

// ---- exact rectangular (oriented box) collision ----
// Does the tank's oriented hitbox (centre cx,cy, half-extents hw,hh, rotated
// by ang) overlap ANY wall? Uses the Separating Axis Theorem (OBB vs AABB).
function obbHitsWalls(cx, cy, hw, hh, ang) {
  const ux = Math.cos(ang), uy = Math.sin(ang);   // forward axis
  const vx = -uy, vy = ux;                         // side axis
  for (const w of wallRects) {
    const rhx = w.w/2, rhy = w.h/2;
    const dx = cx - (w.x + rhx), dy = cy - (w.y + rhy);
    // axis (1,0)
    if (Math.abs(dx) > hw*Math.abs(ux) + hh*Math.abs(vx) + rhx) continue;
    // axis (0,1)
    if (Math.abs(dy) > hw*Math.abs(uy) + hh*Math.abs(vy) + rhy) continue;
    // axis u (forward)
    if (Math.abs(dx*ux + dy*uy) > hw + rhx*Math.abs(ux) + rhy*Math.abs(uy)) continue;
    // axis v (side)
    if (Math.abs(dx*vx + dy*vy) > hh + rhx*Math.abs(vx) + rhy*Math.abs(vy)) continue;
    return true;   // no separating axis -> overlap
  }
  return false;
}

// Exact circle-vs-oriented-box test (closest point within radius).
function circleHitsOBB(x, y, r, cx, cy, hw, hh, ang) {
  const dx = x - cx, dy = y - cy;
  const c = Math.cos(ang), s = Math.sin(ang);
  const lx = dx*c + dy*s, ly = -dx*s + dy*c;
  const clx = clamp(lx, -hw, hw), cly = clamp(ly, -hh, hh);
  const ex = lx - clx, ey = ly - cly;
  return ex*ex + ey*ey < r*r;
}
// Bullet vs tank: body rectangle OR the protruding barrel.
function circleHitsTank(x, y, r, t) {
  if (circleHitsOBB(x, y, r, t.x, t.y, TANK_HW, TANK_HH, t.angle)) return true;
  const bx = t.x + Math.cos(t.angle)*BARREL_OFF, by = t.y + Math.sin(t.angle)*BARREL_OFF;
  return circleHitsOBB(x, y, r, bx, by, BARREL_HL, BARREL_HW, t.angle);
}
// Tank vs walls: body OR barrel touching any wall (used for movement).
function tankBlocked(cx, cy, ang) {
  if (obbHitsWalls(cx, cy, TANK_HW, TANK_HH, ang)) return true;
  const bx = cx + Math.cos(ang)*BARREL_OFF, by = cy + Math.sin(ang)*BARREL_OFF;
  return obbHitsWalls(bx, by, BARREL_HL, BARREL_HW, ang);
}

// =========================== MODS / WEAPONS =============================
// Single-use pickups + the tank's default cannon. Behaviour lives in
// Game.handleWeapon / updateProjectiles.
// All bullets fly at tank speed; the laser at 100x (near-instant beam).
const BULLET_SPEED  = TANK_SPEED;
const LASER_SPEED   = TANK_SPEED * 100;
const BULLET_LIFE   = 22000;        // normal & machine-gun bullets live a long time
const DEFAULT_CD    = 12000;        // 12-second reload on the basic cannon
const MGUN_SPINUP   = 1000;         // ms to spin up
const MGUN_CD       = 250;          // 4 rounds / second
const MISSILE_TURN  = TANK_TURN * 0.9;
const TILE = CS;
const MINE_ARM      = 600;          // ms before a placed mine goes live
const MINE_R        = 11;
const MINE_PICKLOCK = 1000;         // ms after dropping a mine before next pickup
const DEATH_DELAY   = 4000;         // grace window after only one tank is left

// The four pickups. Each is single-use; while one is equipped a tank cannot
// pick up another. `default` is the tank's basic unlimited cannon.
const MODS = {
  bomb:    { name:'Bomb',        glyph:'bomb',    color:'#ff6a3d' },
  mgun:    { name:'Machine Gun', glyph:'mgun',    color:'#ffd24d' },
  missile: { name:'Seeker',      glyph:'missile', color:'#4dd2ff' },
  laser:   { name:'Laser',       glyph:'laser',   color:'#ff4d4d' },
  mine:    { name:'Mine',        glyph:'mine',    color:'#9bd64b' },
};
const MOD_TYPES = ['bomb','mgun','missile','laser','mine'];

// ============================ ENTITIES ==================================
class Tank {
  constructor(idx, isBot) {
    this.idx = idx;
    this.color = PLAYER_COLORS[idx];
    this.isBot = isBot;
    this.score = 0;
    this.reset();
  }
  reset() {
    this.alive = true;
    this.angle = rand(0, TAU);
    this.weapon = 'default';   // current mod (or 'default' basic cannon)
    this.cooldown = 0;
    this.bulletsOut = 0;       // live basic shots (capped)
    this.firePrev = false;     // for press-edge detection
    this.holdLock = false;     // blocks default fire until the trigger is released
    this.spinup = 0;           // machine-gun spin-up timer
    this.mgunFired = false;    // machine gun has fired at least once this hold
    this.bombRef = null;       // bomb currently in flight (this tank's)
    this.missileRef = null;    // missile currently in flight
    this.pickupLock = 0;       // ms before this tank may grab another mod
    this.spawnGuard = 900;     // ms invulnerable + flashing on spawn
    // bot brain
    this.botTimer = 0; this.botTurn = 0; this.botFwd = 1; this.botTarget = null;
  }
  giveWeapon(type) {
    this.weapon = type;
    this.cooldown = 0;
    this.spinup = 0;
    this.firePrev = true;      // don't auto-fire from a held button on pickup
    this.holdLock = false;
    this.mgunFired = false;
    this.bombRef = null;
    this.missileRef = null;
  }
}

class Bullet {
  constructor(owner, x, y, ang, opt) {
    this.owner = owner;
    this.x = x; this.y = y;
    this.r = opt.r || 5;
    const sp = opt.speed != null ? opt.speed : BULLET_SPEED;
    this.vx = Math.cos(ang) * sp;
    this.vy = Math.sin(ang) * sp;
    this.speed = sp;
    this.bounces = opt.bounces != null ? opt.bounces : 5;
    this.life = opt.life || 7000;
    this.age = 0;
    this.arm = 120;                 // ms before it can hit its owner
    this.kind = opt.kind || 'shot'; // shot | laser | bomb | missile | frag
    this.phantom = !!opt.phantom;   // passes through walls
    this.counts = !!opt.counts;     // counts toward owner.bulletsOut
    this.killsOwner = !!opt.killsOwner;
    this.dead = false;
    this.color = opt.color || owner.color;
    this.trail = [];
    // missile fields
    this.mode = null; this.modeTimer = 0; this.target = null;
  }
}

class Mine {
  constructor(owner, x, y){ this.owner=owner; this.x=x; this.y=y; this.arm=MINE_ARM; this.r=MINE_R; this.dead=false; }
}
class Particle {
  constructor(x,y,vx,vy,life,size,color){ this.x=x;this.y=y;this.vx=vx;this.vy=vy;this.life=life;this.max=life;this.size=size;this.color=color; }
}
class Crate {
  constructor(x,y,type){ this.x=x;this.y=y;this.type=type;this.t=0;this.born=300;this.angle=rand(-0.55,0.55); }
}

// ============================== GAME ====================================
class Game {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.tanks = [];
    this.bullets = [];
    this.mines = [];
    this.particles = [];
    this.crates = [];
    this.keys = {};
    this.state = 'menu';       // menu | countdown | playing | roundend | matchover | paused
    this.last = 0;
    this.crateTimer = 3000;
    this.targetScore = 10;
    this.bound = this.loop.bind(this);
    this.roundTimer = 0;
    this.prevState = null;
    this._raf = null;
  }

  // ---- setup ----
  start(numHumans, numBots, targetScore) {
    // 4 player colors/identities max -> cap total tanks at 4 (keep humans first)
    numHumans = clamp(numHumans, 1, 3);
    if (numHumans + numBots > 4) numBots = 4 - numHumans;
    numBots = Math.max(0, numBots);
    if (numHumans + numBots < 2) numBots = 2 - numHumans; // need >=2 tanks
    this.numHumans = numHumans;
    this.numBots = numBots;
    this.targetScore = targetScore;
    const total = numHumans + numBots;
    // size maze to player count
    if (total <= 2)      { COLS = 8;  ROWS = 6; }
    else if (total === 3){ COLS = 9;  ROWS = 7; }
    else                 { COLS = 11; ROWS = 8; }
    this.cv.width  = COLS * CS + WT;
    this.cv.height = ROWS * CS + WT + SCORE_H;
    this.fitCanvas();

    this.tanks = [];
    for (let i = 0; i < total; i++) this.tanks.push(new Tank(i, i >= numHumans));
    this.newRound(true);
    if (!this._raf) { this.last = performance.now(); this._raf = requestAnimationFrame(this.bound); }
    UI.buildHud(this.tanks, this.targetScore);
  }

  fitCanvas() {
    // scale canvas to fit viewport while keeping aspect
    const maxW = window.innerWidth - 40, maxH = window.innerHeight - 40;
    const s = Math.min(maxW / this.cv.width, maxH / this.cv.height, 1.4);
    this.cv.style.width  = Math.round(this.cv.width * s) + 'px';
    this.cv.style.height = Math.round(this.cv.height * s) + 'px';
  }

  newRound(first) {
    buildMaze();
    this.bullets = []; this.mines = []; this.particles = []; this.crates = [];
    this.crateTimer = 1000;   // a new pickup roughly every second
    this.lastTimer = null;    // last-tank grace-window timer
    // place tanks in well-separated cells
    const cells = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push([r, c]);
    const chosen = [];
    for (const t of this.tanks) {
      let best = null, bestD = -1;
      for (let tries = 0; tries < 40; tries++) {
        const cell = cells[randi(0, cells.length)];
        let mind = 1e9;
        for (const ch of chosen) mind = Math.min(mind, Math.abs(ch[0]-cell[0]) + Math.abs(ch[1]-cell[1]));
        if (mind > bestD) { bestD = mind; best = cell; }
      }
      chosen.push(best);
      const ctr = cellCenter(best[0], best[1]);
      t.reset();
      t.x = ctr.x; t.y = ctr.y;
    }
    // a few pickups to start; more trickle in (one per second) during play
    for (let i = 0; i < 3; i++) { const k = this.spawnCrate(); if (k) k.born = 0; }
    this.aliveCount = this.tanks.length;
    Audio.spawn();
    this.state = 'countdown';
    this.roundTimer = first ? 1500 : 1200;
    UI.banner('GET READY', 'Round start', false);
    UI.updateHud(this.tanks);
  }

  // ---- firing ----
  spawnBullet(t, ang, opt) {
    const mx = t.x + Math.cos(ang) * (TANK_HW + 8);
    const my = t.y + Math.sin(ang) * (TANK_HW + 8);
    const b = new Bullet(t, mx, my, ang, opt);
    this.bullets.push(b);
    if (b.counts) t.bulletsOut++;
    return b;
  }

  // Revert a tank to its basic cannon, and hold-lock the trigger so a still-held
  // fire button doesn't instantly loose a normal shot (laser/mine/etc bug).
  revertToDefault(t) { t.weapon = 'default'; t.holdLock = true; t.spinup = 0; }

  // Central weapon handler. `fireDown` = fire key held this frame.
  handleWeapon(t, fireDown, dt) {
    const pressed = fireDown && !t.firePrev;   // rising edge
    if (!fireDown) t.holdLock = false;
    switch (t.weapon) {
      case 'default':
        if (fireDown && !t.holdLock && t.cooldown <= 0 && t.bulletsOut < 5) {
          this.spawnBullet(t, t.angle, {r:5, bounces:5, life:BULLET_LIFE, kind:'shot', counts:true});
          t.cooldown = DEFAULT_CD; Audio.shoot();
        }
        break;

      case 'laser':
        if (pressed) {
          this.spawnBullet(t, t.angle, {speed:LASER_SPEED, r:4, bounces:40, life:1200, kind:'laser', color:'#ff4d4d'});
          Audio.laser(); this.revertToDefault(t);
        }
        break;

      case 'bomb':
        if (!t.bombRef) {
          if (pressed) {
            t.bombRef = this.spawnBullet(t, t.angle, {r:13, bounces:99999, life:30000, kind:'bomb', color:'#ff6a3d'});
            Audio.shoot();
          }
        } else if (pressed) {
          this.bombExplode(t.bombRef);    // detonate on second press
        }
        break;

      case 'missile':
        if (!t.missileRef) {
          if (pressed) {
            const m = this.spawnBullet(t, t.angle, {r:6, bounces:99999, life:60000, kind:'missile', color:'#4dd2ff'});
            m.mode = 'straight'; m.modeTimer = 4000;
            t.missileRef = m; Audio.shoot();
          }
        } else if (pressed) {
          this.lockMissile(t.missileRef);  // second press -> lock now
        }
        break;

      case 'mgun':
        if (fireDown) {
          t.spinup = Math.min(MGUN_SPINUP, t.spinup + dt);
          if (t.spinup >= MGUN_SPINUP && t.cooldown <= 0) {
            this.spawnBullet(t, t.angle + rand(-0.13, 0.13), {r:3.5, bounces:2, life:BULLET_LIFE, kind:'shot'});
            t.cooldown = MGUN_CD; Audio.rapid();
            t.mgunFired = true;
          }
        } else {
          t.spinup = Math.max(0, t.spinup - dt);
          if (t.mgunFired) this.revertToDefault(t);   // gone the moment you stop firing
        }
        break;

      case 'mine':
        if (pressed) this.placeMine(t);    // drop behind, then 1s pickup lock
        break;
    }
    t.firePrev = fireDown;
  }

  lockMissile(m) {
    if (!m || m.dead || m.mode === 'seek') return;
    m.mode = 'seek'; m.modeTimer = 10000; m.relock = 0;
    m.target = this.nearestTank(m.x, m.y);   // any tank, including the owner
  }
  // Nearest living tank to a point — INCLUDING the missile's owner.
  nearestTank(x, y) {
    let best = null, bd = 1e18;
    for (const e of this.tanks) {
      if (!e.alive) continue;
      const d = (e.x-x)**2 + (e.y-y)**2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  nearestEnemy(owner, x, y) {   // used by bots only
    let best = null, bd = 1e18;
    for (const e of this.tanks) {
      if (e === owner || !e.alive) continue;
      const d = (e.x-x)**2 + (e.y-y)**2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  // Bomb bursts into ~50 fragments with an uneven, random spread so the blast
  // leaves gaps — a nearby tank can get lucky and survive. Frags pass through
  // the whole map.
  bombExplode(b) {
    if (!b || b.dead) return;
    b.dead = true;
    if (b.owner && b.owner.bombRef === b) { b.owner.bombRef = null; this.revertToDefault(b.owner); }
    this.boom(b.x, b.y, '#ff6a3d', 34, 4.2);
    Audio.explosion();
    for (let i = 0; i < 50; i++) {
      const a = rand(0, TAU);                       // fully random direction (clusters + gaps)
      const f = new Bullet(b.owner, b.x, b.y, a, {speed:BULLET_SPEED*rand(1.2,2.4), r:3, bounces:0, life:rand(2500,4500), kind:'frag', phantom:true, color:'#ffb24d', killsOwner:true});
      f.arm = 250;
      this.bullets.push(f);
    }
  }

  missilePop(m) {
    if (!m || m.dead) return;
    this.boom(m.x, m.y, '#4dd2ff', 18, 3.2);
    Audio.smallboom();
    for (const e of this.tanks) {
      if (!e.alive || e.spawnGuard > 0) continue;
      if ((m.x-e.x)**2 + (m.y-e.y)**2 < 34*34) this.killTank(e, m.owner);
    }
    this.killBullet(m);   // clears owner.missileRef and reverts weapon
  }

  // Drop a mine behind the tank; it persists all round. Owner then can't grab
  // another mod for 1 second.
  placeMine(t) {
    const bx = t.x - Math.cos(t.angle) * (TANK_HW + MINE_R + 4);
    const by = t.y - Math.sin(t.angle) * (TANK_HW + MINE_R + 4);
    this.mines.push(new Mine(t, bx, by));
    Audio.smallboom();
    this.revertToDefault(t);
    t.pickupLock = MINE_PICKLOCK;
  }

  updateMines(dt) {
    for (const m of this.mines) {
      if (m.dead) continue;
      if (m.arm > 0) { m.arm -= dt; continue; }
      for (const t of this.tanks) {
        if (!t.alive || t.spawnGuard > 0) continue;
        if (circleHitsTank(m.x, m.y, m.r, t)) { this.triggerMine(m); break; }
      }
    }
    this.mines = this.mines.filter(m => !m.dead);
  }
  triggerMine(m) {
    if (m.dead) return;
    m.dead = true;
    this.boom(m.x, m.y, '#9bd64b', 24, 3.4);
    Audio.explosion();
    for (const t of this.tanks) {     // small blast radius
      if (!t.alive || t.spawnGuard > 0) continue;
      if ((m.x-t.x)**2 + (m.y-t.y)**2 < 40*40 || circleHitsTank(m.x, m.y, m.r, t)) this.killTank(t, m.owner);
    }
  }

  // Rotate the tank only if the resulting hitbox is clear of walls — stops it
  // from spinning a corner into a wall and wedging itself.
  tryRotate(t, newAngle) {
    if (!obbHitsWalls(t.x, t.y, TANK_HW, TANK_HH, newAngle)) t.angle = newAngle;
  }

  killTank(t, killer) {
    if (!t.alive || t.spawnGuard > 0) return;
    t.alive = false;
    this.boom(t.x, t.y, t.color, 28, 3.6);
    Audio.explosion();
    this.aliveCount--;
    UI.updateHud(this.tanks);
  }

  boom(x, y, color, n, spd) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), s = rand(0.4, spd);
      this.particles.push(new Particle(x, y, Math.cos(a)*s, Math.sin(a)*s, rand(300,650), rand(2,5), Math.random()<0.5?color:'#ffd76b'));
    }
    this.particles.push(new Particle(x, y, 0, 0, 220, 40, 'ring:'+color));
  }

  // ---- main loop ----
  loop(now) {
    let dt = now - this.last; this.last = now;
    if (dt > 50) dt = 50;
    if (this.state !== 'paused') this.update(dt);
    this.render();
    this._raf = requestAnimationFrame(this.bound);
  }

  update(dt) {
    if (this.state === 'countdown') {
      this.roundTimer -= dt;
      // tanks invuln tick
      for (const t of this.tanks) if (t.spawnGuard > 0) t.spawnGuard -= dt;
      if (this.roundTimer <= 0) { this.state = 'playing'; UI.hideBanner(); }
      this.updateParticles(dt);
      return;
    }
    if (this.state === 'roundend') {
      this.roundTimer -= dt;
      this.updateProjectiles(dt);
      this.updateParticles(dt);
      if (this.roundTimer <= 0) {
        const winner = this.tanks.find(t => t.score >= this.targetScore);
        if (winner) { this.matchOver(winner); }
        else this.newRound(false);
      }
      return;
    }
    if (this.state !== 'playing') return;

    for (const t of this.tanks) {
      if (t.spawnGuard > 0) t.spawnGuard -= dt;
      if (t.pickupLock > 0) t.pickupLock -= dt;
      if (!t.alive) continue;
      if (t.cooldown > 0) t.cooldown -= dt;
      if (t.isBot) this.botThink(t, dt);
      else this.humanControl(t, dt);
      this.moveTank(t, dt);
    }

    this.updateProjectiles(dt);
    this.updateMines(dt);
    this.updateParticles(dt);
    this.updateCrates(dt);

    // round-end / last-tank grace window
    if (this.tanks.length > 1 && this.aliveCount <= 1) {
      if (this.lastTimer == null) this.lastTimer = DEATH_DELAY;   // start 4s grace
      this.lastTimer -= dt;
      if (this.aliveCount === 0) {
        this.endRound(null);              // everyone gone -> tie
      } else if (this.lastTimer <= 0) {
        this.endRound(this.tanks.find(t => t.alive));   // survivor outlasted it
      }
    }
  }

  endRound(survivor) {
    this.lastTimer = null;
    if (survivor) {
      survivor.score++; Audio.win();
      UI.banner(PLAYER_NAMES[survivor.idx] + ' SCORES!', survivor.score + ' / ' + this.targetScore, true, survivor.color);
    } else {
      UI.banner('TIE!', 'Mutual destruction', true);
    }
    this.state = 'roundend';
    this.roundTimer = 1700;
    UI.updateHud(this.tanks);
  }

  matchOver(winner) {
    this.state = 'matchover';
    UI.matchOver(winner, this.tanks);
  }

  // ---- controls ----
  humanControl(t, dt) {
    const K = this.keys;
    const m = CONTROLS[t.idx];
    if (!m) { t._fwd = 0; return; }
    let turn = 0, fwd = 0;
    if (K[m.left])  turn -= 1;
    if (K[m.right]) turn += 1;
    if (K[m.up])    fwd  += 1;
    if (K[m.down])  fwd  -= 1;
    if (turn !== 0) this.tryRotate(t, t.angle + turn * TANK_TURN * (fwd >= 0 ? 1 : -1));
    t._fwd = fwd;
    this.handleWeapon(t, !!K[m.fire], dt);
  }

  botThink(t, dt) {
    t.botTimer -= dt;
    const target = this.nearestEnemy(t, t.x, t.y);
    let wantFire = false;
    if (target && !segmentBlocked(t.x, t.y, target.x, target.y)) {
      const ang = Math.atan2(target.y - t.y, target.x - t.x);
      let diff = ((ang - t.angle + Math.PI) % TAU) - Math.PI;
      if (diff < -Math.PI) diff += TAU;
      this.tryRotate(t, angLerp(t.angle, ang, 0.18));
      const bestD = (target.x-t.x)**2 + (target.y-t.y)**2;
      t._fwd = bestD > (CS*2.4)**2 ? 1 : (bestD < (CS*1.1)**2 ? -0.6 : 0);
      if (Math.abs(diff) < 0.22) wantFire = Math.random() < 0.7;  // taps create press edges
      t.botTimer = Math.min(t.botTimer, 200);
    } else {
      this.botWander(t);
    }
    // bots detonate their own bomb after it has travelled a bit
    if (t.bombRef && t.bombRef.age > 2200) this.bombExplode(t.bombRef);
    this.handleWeapon(t, wantFire, dt);
  }

  botWander(t) {
    if (t.botTimer <= 0) {
      let cr = null, cd = 1e18;
      if (t.weapon === 'default') {   // only chase pickups when able to grab one
        for (const k of this.crates) { if (k.born>0) continue; const d=(k.x-t.x)**2+(k.y-t.y)**2; if(d<cd){cd=d;cr=k;} }
      }
      if (cr && !segmentBlocked(t.x,t.y,cr.x,cr.y)) t._wantAngle = Math.atan2(cr.y-t.y, cr.x-t.x);
      else t._wantAngle = t.angle + rand(-1.2, 1.2);
      t.botTimer = rand(350, 800);
    }
    if (t._wantAngle != null) this.tryRotate(t, angLerp(t.angle, t._wantAngle, 0.08));
    t._fwd = 1;
  }

  moveTank(t, dt) {
    // Direct movement, no momentum. If the next step would touch a wall we
    // stop completely (no sliding along walls) — turn to get free.
    const fwd = t._fwd || 0;
    if (fwd !== 0) {
      const step = TANK_SPEED * fwd;
      const nx = t.x + Math.cos(t.angle) * step;
      const ny = t.y + Math.sin(t.angle) * step;
      if (!tankBlocked(nx, ny, t.angle)) { t.x = nx; t.y = ny; }   // body + barrel
    }

    // crate pickup — only with the basic cannon and once the mine lock expires
    if (t.weapon === 'default' && t.pickupLock <= 0) {
      for (let i = this.crates.length - 1; i >= 0; i--) {
        const k = this.crates[i];
        if (k.born > 0) continue;
        if (circleHitsTank(k.x, k.y, 16, t)) {
          t.giveWeapon(k.type);
          this.crates.splice(i, 1);
          Audio.pickup();
          this.boom(k.x, k.y, MODS[k.type].color, 12, 2);
          break;
        }
      }
    }
  }

  // ---- projectiles ----
  updateProjectiles(dt) {
    for (const b of this.bullets) {
      if (b.dead) continue;

      // timers
      b.age += dt; b.arm -= dt;
      if (b.kind === 'missile') {
        b.modeTimer -= dt;
        if (b.mode === 'straight' && b.modeTimer <= 0) this.lockMissile(b);
        else if (b.mode === 'seek' && b.modeTimer <= 0) { this.missilePop(b); continue; }
        if (b.mode === 'seek') this.steerMissile(b, dt);
      }
      if (b.age > b.life) { if (b.kind === 'bomb') this.bombExplode(b); else this.killBullet(b); continue; }

      // sub-stepped move; ricochet off walls and hit tanks each step so even
      // the 100x laser can't tunnel through anything.
      const steps = Math.max(2, Math.ceil(Math.hypot(b.vx, b.vy) / 4));
      for (let s = 0; s < steps && !b.dead; s++) {
        b.x += b.vx / steps; b.y += b.vy / steps;
        if (!b.phantom) {
          for (const w of wallRects) {
            const nx = clamp(b.x, w.x, w.x+w.w), ny = clamp(b.y, w.y, w.y+w.h);
            const ex = b.x - nx, ey = b.y - ny;
            const d2 = ex*ex + ey*ey;
            if (d2 < b.r*b.r) {
              if (b.bounces <= 0) { this.killBullet(b); break; }
              // push fully out of the wall along the contact normal, then
              // reflect velocity — robust even for the big slow bomb.
              if (d2 > 1e-6) {
                const d = Math.sqrt(d2), nlx = ex/d, nly = ey/d;
                b.x = nx + nlx*(b.r + 0.5); b.y = ny + nly*(b.r + 0.5);
                const dot = b.vx*nlx + b.vy*nly;
                b.vx -= 2*dot*nlx; b.vy -= 2*dot*nly;
              } else {                          // centre inside the wall: eject on min-penetration axis
                const pL=b.x-w.x, pR=w.x+w.w-b.x, pT=b.y-w.y, pB=w.y+w.h-b.y;
                const mn=Math.min(pL,pR,pT,pB);
                if (mn===pL){ b.x=w.x-b.r-0.5; b.vx=-Math.abs(b.vx); }
                else if (mn===pR){ b.x=w.x+w.w+b.r+0.5; b.vx=Math.abs(b.vx); }
                else if (mn===pT){ b.y=w.y-b.r-0.5; b.vy=-Math.abs(b.vy); }
                else { b.y=w.y+w.h+b.r+0.5; b.vy=Math.abs(b.vy); }
              }
              b.bounces--; Audio.ricochet();
              break;
            }
          }
        }
        if (b.dead) break;
        if (b.kind === 'missile') this.emitMissileSmoke(b);
        if (b.kind === 'laser') { b.trail.push({x:b.x, y:b.y}); if (b.trail.length > 200) b.trail.shift(); }
        for (const t of this.tanks) {
          if (!t.alive || t.spawnGuard > 0) continue;
          if (t === b.owner && b.arm > 0) continue;
          if (circleHitsTank(b.x, b.y, b.r, t)) { this.onBulletHitTank(b, t); if (b.dead) break; }
        }
      }

      if (b.kind !== 'laser' && !b.dead) {     // ordinary trail (one point / frame)
        b.trail.push({x:b.x, y:b.y});
        if (b.trail.length > 7) b.trail.shift();
      }
    }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  onBulletHitTank(b, t) {
    this.killTank(t, b.owner);
    switch (b.kind) {
      case 'bomb':    this.bombExplode(b); break;
      case 'missile': this.missilePop(b);  break;
      case 'frag':    break;               // fragments sweep on through the map
      default:        this.killBullet(b);  // shot / laser
    }
  }

  killBullet(b) {
    if (b.dead) return;
    b.dead = true;
    if (b.owner) {
      if (b.owner.missileRef === b) { b.owner.missileRef = null; this.revertToDefault(b.owner); }
      if (b.owner.bombRef    === b) { b.owner.bombRef    = null; this.revertToDefault(b.owner); }
      if (b.counts) b.owner.bulletsOut = Math.max(0, b.owner.bulletsOut - 1);
    }
    this.particles.push(new Particle(b.x, b.y, 0, 0, 120, b.r*1.4, 'spark:'+b.color));
  }

  // --- seeking missile: pathfind to its (re-)locked target ---
  steerMissile(m, dt) {
    // re-lock onto the nearest tank (incl. owner) twice a second
    m.relock = (m.relock || 0) - dt;
    if (m.relock <= 0 || !m.target || !m.target.alive) {
      m.target = this.nearestTank(m.x, m.y);
      m.relock = 500;
    }
    if (!m.target) return;
    // steer toward the next waypoint of a path through the maze (or straight
    // at the target if there's clear line of sight)
    let wx = m.target.x, wy = m.target.y;
    if (segmentBlocked(m.x, m.y, m.target.x, m.target.y)) {
      const wp = this.nextWaypoint(m.x, m.y, m.target.x, m.target.y);
      if (wp) { wx = wp.x; wy = wp.y; }
    }
    const want = Math.atan2(wy - m.y, wx - m.x);
    const na = angLerp(Math.atan2(m.vy, m.vx), want, MISSILE_TURN);
    m.vx = Math.cos(na) * m.speed; m.vy = Math.sin(na) * m.speed;
  }

  emitMissileSmoke(m) {
    const col = (m.mode === 'seek' && m.target) ? m.target.color : '#b8b8b8';
    this.particles.push(new Particle(m.x, m.y, rand(-0.2,0.2), rand(-0.2,0.2), rand(350,650), rand(2.5,4.5), col));
  }

  // BFS through the maze grid; returns the centre of the next cell to head to.
  nextWaypoint(x, y, tx, ty) {
    const sr = clamp(Math.floor((y-PAD)/CS), 0, ROWS-1), sc = clamp(Math.floor((x-PAD)/CS), 0, COLS-1);
    const gr = clamp(Math.floor((ty-PAD)/CS), 0, ROWS-1), gc = clamp(Math.floor((tx-PAD)/CS), 0, COLS-1);
    if (sr === gr && sc === gc) return null;
    const key = (r,c) => r*COLS + c;
    const prev = new Array(ROWS*COLS).fill(-1);
    const seen = new Uint8Array(ROWS*COLS);
    const q = [[sr,sc]]; seen[key(sr,sc)] = 1;
    let found = false;
    while (q.length) {
      const [r,c] = q.shift();
      if (r === gr && c === gc) { found = true; break; }
      const nb = [];
      if (r>0       && !hWall[r][c])   nb.push([r-1,c]);
      if (r<ROWS-1  && !hWall[r+1][c]) nb.push([r+1,c]);
      if (c>0       && !vWall[r][c])   nb.push([r,c-1]);
      if (c<COLS-1  && !vWall[r][c+1]) nb.push([r,c+1]);
      for (const [nr,nc] of nb) { const k = key(nr,nc); if (!seen[k]) { seen[k]=1; prev[k]=key(r,c); q.push([nr,nc]); } }
    }
    if (!found) return null;
    // walk back from goal to the cell right after the start
    let k = key(gr,gc), p = prev[k];
    while (p !== -1 && p !== key(sr,sc)) { k = p; p = prev[k]; }
    const nr = Math.floor(k / COLS), nc = k % COLS;
    return cellCenter(nr, nc);
  }

  updateParticles(dt) {
    for (const p of this.particles) {
      p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; p.life -= dt;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  updateCrates(dt) {
    for (const k of this.crates) { k.t += dt; if (k.born > 0) k.born -= dt; }
    this.crateTimer -= dt;
    if (this.crateTimer <= 0) {
      this.crateTimer = 1000;                  // one new pickup per second
      if (this.crates.length < 18) this.spawnCrate();
    }
  }
  // Spawn a mod on a random free tile. Returns the crate (or null).
  spawnCrate() {
    for (let tries = 0; tries < 30; tries++) {
      const r = randi(0, ROWS), c = randi(0, COLS);
      const ctr = cellCenter(r, c);
      let ok = true;
      for (const t of this.tanks) if ((t.x-ctr.x)**2+(t.y-ctr.y)**2 < (CS*0.8)**2) ok=false;
      for (const k of this.crates) if ((k.x-ctr.x)**2+(k.y-ctr.y)**2 < (CS*0.8)**2) ok=false;
      if (ok) {
        const k = new Crate(ctr.x, ctr.y, MOD_TYPES[randi(0, MOD_TYPES.length)]);
        this.crates.push(k);
        return k;
      }
    }
    return null;
  }

  // ============================ RENDER =================================
  render() {
    const ctx = this.ctx, W = this.cv.width, H = this.cv.height;
    // page background
    ctx.fillStyle = COL_PAGE; ctx.fillRect(0, 0, W, H);

    if (this.state === 'menu') return;

    // maze floor
    ctx.fillStyle = COL_FLOOR;
    ctx.fillRect(X(0), Y(0), COLS*CS, ROWS*CS);

    this.drawWalls(ctx);
    this.drawBorder(ctx);
    for (const k of this.crates) this.drawCrate(ctx, k);
    for (const m of this.mines) this.drawMine(ctx, m);
    for (const t of this.tanks) if (t.alive && t.weapon === 'laser') this.drawAimLine(ctx, t);
    for (const b of this.bullets) this.drawBullet(ctx, b);
    for (const t of this.tanks) if (t.alive) this.drawTank(ctx, t);
    for (const p of this.particles) this.drawParticle(ctx, p);
    this.drawScoreboard(ctx, W, H);
  }

  drawWalls(ctx) {
    // plain flat rectangles, square corners
    ctx.fillStyle = COL_WALL;
    for (const w of wallRects) ctx.fillRect(w.x, w.y, w.w, w.h);
  }

  drawBorder(ctx) {
    // thick dark frame, square corners
    ctx.save();
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = COL_BORDER;
    ctx.lineWidth = WT + 4;
    ctx.strokeRect(X(0), Y(0), COLS*CS, ROWS*CS);
    ctx.restore();
  }

  drawScoreboard(ctx, W, H) {
    const n = this.tanks.length;
    const top = ROWS*CS + WT;          // y where score strip starts
    const cy = top + SCORE_H * 0.5;
    const SC = 2.6;                    // scoreboard tank scale
    const hw = TANK_HW * SC, hh = TANK_HH * SC;
    for (let i = 0; i < n; i++) {
      const t = this.tanks[i];
      // spread icons: first left, last right, middles evenly between
      const fx = n === 1 ? 0.5 : i / (n - 1);
      const margin = 100;
      const cx = margin + fx * (W - margin*2);
      const face = fx < 0.5 ? 0 : Math.PI;   // outer tanks face inward
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(face);
      drawTankBody(ctx, hw, hh, t.color, !t.alive, t.weapon);
      ctx.restore();
      // score number beside, toward centre
      ctx.fillStyle = '#3a3a3a';
      ctx.font = '900 46px Segoe UI, Arial, sans-serif';
      ctx.textBaseline = 'middle';
      const off = hw + 34;
      if (fx < 0.5) { ctx.textAlign = 'left';  ctx.fillText(t.score, cx + off, cy); }
      else          { ctx.textAlign = 'right'; ctx.fillText(t.score, cx - off, cy); }
      // current weapon indicator
      if (t.weapon !== 'default' && t.alive) {
        const wx = cx, wy = cy + hh + 22;
        ctx.fillStyle = '#555';
        ctx.font = '700 13px Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(MODS[t.weapon].name, wx, wy);
      }
    }
  }

  drawTank(ctx, t) {
    ctx.save();
    ctx.translate(t.x, t.y);
    if (t.spawnGuard > 0 && Math.floor(t.spawnGuard/120) % 2 === 0) ctx.globalAlpha = 0.4;
    ctx.rotate(t.angle);
    drawTankBody(ctx, TANK_HW, TANK_HH, t.color, false, t.weapon);
    ctx.restore();
  }

  drawBullet(ctx, b) {
    if (b.kind === 'laser') { this.drawLaser(ctx, b); return; }

    // trail
    for (let i=0;i<b.trail.length;i++){
      const p = b.trail[i]; const a = i/b.trail.length;
      ctx.globalAlpha = a*0.45;
      ctx.fillStyle = b.color;
      ctx.beginPath(); ctx.arc(p.x,p.y,b.r*a,0,TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.save();

    if (b.kind === 'missile') {
      // rocket: pointed body + flame
      ctx.translate(b.x, b.y); ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath(); ctx.moveTo(-b.r*1.4, -b.r*0.6); ctx.lineTo(-b.r*2.4, 0); ctx.lineTo(-b.r*1.4, b.r*0.6); ctx.fill();
      ctx.fillStyle = b.color; ctx.strokeStyle = '#0a3a4a'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.r*1.7, 0); ctx.lineTo(-b.r, -b.r); ctx.lineTo(-b.r, b.r); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore(); return;
    }

    const blur = b.kind==='bomb' ? 24 : (b.kind==='laser' ? 18 : 10);
    ctx.shadowColor = b.color; ctx.shadowBlur = blur;
    const g = ctx.createRadialGradient(b.x,b.y,0,b.x,b.y,b.r);
    g.addColorStop(0,'#ffffff'); g.addColorStop(0.5,b.color); g.addColorStop(1, shade(b.color,0.6));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,TAU); ctx.fill();
    if (b.kind === 'bomb') {   // little fuse spark
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r*0.35 + Math.sin(performance.now()/80)*1.5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  // The laser as a glowing beam following its full ricochet path.
  drawLaser(ctx, b) {
    if (b.trail.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = b.color; ctx.shadowBlur = 16;
    ctx.strokeStyle = b.color; ctx.lineWidth = 5; ctx.globalAlpha = 0.9;
    ctx.beginPath(); ctx.moveTo(b.trail[0].x, b.trail[0].y);
    for (let i=1;i<b.trail.length;i++) ctx.lineTo(b.trail[i].x, b.trail[i].y);
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha = 1;
    ctx.stroke();
    // bright head
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r*1.3, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // 3-tile aim guide shown while the laser is equipped (before firing).
  drawAimLine(ctx, t) {
    let x = t.x + Math.cos(t.angle)*(TANK_HW+4), y = t.y + Math.sin(t.angle)*(TANK_HW+4);
    let dx = Math.cos(t.angle), dy = Math.sin(t.angle);
    let remaining = TILE * 3;
    const pts = [{x,y}];
    let guard = 0;
    while (remaining > 0 && guard++ < 400) {
      const step = Math.min(6, remaining);
      const nx = x + dx*step, ny = y + dy*step;
      let bounced = false;
      for (const w of wallRects) {
        if (nx > w.x && nx < w.x+w.w && ny > w.y && ny < w.y+w.h) {
          const penx = Math.min(Math.abs(nx-w.x), Math.abs(nx-(w.x+w.w)));
          const peny = Math.min(Math.abs(ny-w.y), Math.abs(ny-(w.y+w.h)));
          if (penx < peny) dx = -dx; else dy = -dy;
          bounced = true; break;
        }
      }
      if (!bounced) { x = nx; y = ny; pts.push({x,y}); remaining -= step; }
    }
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 2; ctx.setLineDash([7,6]);
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.restore();
  }

  drawMine(ctx, m) {
    ctx.save();
    ctx.translate(m.x, m.y);
    const live = m.arm <= 0;
    const pulse = live ? (Math.sin(performance.now()/110)*0.5 + 0.5) : 0.25;
    // spikes
    ctx.fillStyle = '#3a3f30';
    for (let i = 0; i < 8; i++) { const a = i/8*TAU; ctx.fillRect(Math.cos(a)*m.r-1.5, Math.sin(a)*m.r-1.5, 3.2, 3.2); }
    // body
    ctx.fillStyle = '#5a6340';
    ctx.beginPath(); ctx.arc(0, 0, m.r*0.85, 0, TAU); ctx.fill();
    // light
    ctx.fillStyle = `rgba(255,70,70,${0.35 + pulse*0.6})`;
    ctx.beginPath(); ctx.arc(0, 0, m.r*0.4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawCrate(ctx, k) {
    // grey beveled tile, slightly rotated, with a dark weapon glyph — like the
    // pickup tiles scattered across the original AZ maze.
    ctx.save();
    ctx.translate(k.x, k.y);
    const pop = k.born>0 ? clamp(1-k.born/300,0,1) : 1;
    ctx.scale(pop, pop);
    ctx.rotate(k.angle);
    const s = 22;
    // drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    roundRect(ctx, -s+2, -s+3, s*2, s*2, 5); ctx.fill();
    // tile face (grey gradient bevel)
    const g = ctx.createLinearGradient(0, -s, 0, s);
    g.addColorStop(0, '#bdbdbd'); g.addColorStop(0.5, '#9a9a9a'); g.addColorStop(1, '#7c7c7c');
    ctx.fillStyle = g;
    roundRect(ctx, -s, -s, s*2, s*2, 5); ctx.fill();
    // bevel highlight / shadow edges
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    roundRect(ctx, -s+1.5, -s+1.5, s*2-3, s*2-3, 4); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    roundRect(ctx, -s, -s, s*2, s*2, 5); ctx.stroke();
    // dark glyph
    ctx.fillStyle = '#2f2f2f';
    drawWeaponIcon(ctx, MODS[k.type].glyph);
    ctx.restore();
  }

  drawParticle(ctx, p) {
    const a = clamp(p.life / p.max, 0, 1);
    if (typeof p.color === 'string' && p.color.startsWith('ring:')) {
      const col = p.color.slice(5);
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size*(1-a)+6, 0, TAU); ctx.stroke(); ctx.restore();
      return;
    }
    if (typeof p.color === 'string' && p.color.startsWith('spark:')) {
      const col = p.color.slice(6);
      ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size*a, 0, TAU); ctx.fill(); ctx.restore();
      return;
    }
    ctx.save(); ctx.globalAlpha = a; ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill(); ctx.restore();
  }

  pause() { if (this.state==='playing'||this.state==='countdown') { this.prevState=this.state; this.state='paused'; } }
  resume() { if (this.state==='paused') { this.state=this.prevState||'playing'; this.last=performance.now(); } }
}

// ---- drawing utils ----
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n>>16)&255, g=(n>>8)&255, b=n&255;
  r = clamp(Math.round(r*f),0,255); g=clamp(Math.round(g*f),0,255); b=clamp(Math.round(b*f),0,255);
  return `rgb(${r},${g},${b})`;
}
// Draw a top-down tank centred at origin, barrel pointing +x. The barrel /
// fittings change with the equipped mod so you can see what each tank holds.
function drawTankBody(ctx, hw, hh, color, dead, weapon) {
  const body = dead ? '#9a9a9a' : color;
  const lw = Math.max(1.5, hh*0.18);
  weapon = weapon || 'default';

  // ---- barrel (drawn first, under the body) ----
  ctx.fillStyle = '#333';
  switch (weapon) {
    case 'bomb':                       // thick stubby barrel
      ctx.fillStyle = '#2c2c2c';
      ctx.fillRect(0, -hh*0.5, hw*1.5, hh*1.0);
      ctx.fillStyle = '#444';
      ctx.fillRect(hw*1.2, -hh*0.6, hh*0.5, hh*1.2);   // muzzle ring
      break;
    case 'mgun': {                     // machine gun: receiver box + vented barrel
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(-hh*0.2, -hh*0.7, hh*1.2, hh*1.4);  // receiver
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(hh*0.8, -hh*0.26, hw*1.7, hh*0.52); // long barrel
      ctx.fillStyle = '#555';
      for (let i=0;i<4;i++) ctx.fillRect(hh*1.0 + i*hw*0.32, -hh*0.34, hh*0.16, hh*0.68); // cooling vents
      break;
    }
    case 'laser':                      // thin antenna + emitter
      ctx.strokeStyle = '#777'; ctx.lineWidth = Math.max(1.2, hh*0.16);
      ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(hw*2.1, 0); ctx.stroke();
      ctx.fillStyle = '#bbb';
      ctx.beginPath(); ctx.arc(hw*2.1, 0, hh*0.28, 0, TAU); ctx.fill();
      break;
    default:                           // normal barrel (also for 'mine')
      ctx.fillRect(0, -hh*0.28, hw*1.7, hh*0.56);
  }

  // ---- body (rectangle = exact hitbox) ----
  ctx.fillStyle = body;
  ctx.strokeStyle = '#222'; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.rect(-hw, -hh, hw*2, hh*2); ctx.fill(); ctx.stroke();
  // turret
  ctx.fillStyle = shade(body, 0.78);
  ctx.beginPath(); ctx.arc(0, 0, hh*0.82, 0, TAU); ctx.fill(); ctx.stroke();

  // ---- mod fittings drawn on top ----
  if (weapon === 'mine') {             // red laser dot at the barrel tip
    ctx.fillStyle = '#ff2a2a';
    ctx.shadowColor = '#ff2a2a'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.arc(hw*1.7, 0, hh*0.26, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
  } else if (weapon === 'laser') {     // emitter glow tip
    ctx.fillStyle = '#ff5a5a';
    ctx.beginPath(); ctx.arc(hw*2.1, 0, hh*0.16, 0, TAU); ctx.fill();
  }
}

function drawWeaponIcon(ctx, icon) {
  ctx.save();
  ctx.lineWidth = 2.4; ctx.strokeStyle = ctx.fillStyle; ctx.lineCap='round';
  switch (icon) {
    case 'mgun':   // machine gun: stacked barrels
      for (let i=-1;i<=1;i++){ ctx.fillRect(-9, i*4-1, 18, 2.2); }
      break;
    case 'missile': // rocket pointing up
      ctx.beginPath(); ctx.moveTo(-6,8); ctx.lineTo(0,-9); ctx.lineTo(6,8); ctx.lineTo(0,4); ctx.closePath(); ctx.fill(); break;
    case 'laser':  // beam + dot
      ctx.fillRect(-10,-1.5,20,3); ctx.beginPath(); ctx.arc(9,0,3,0,TAU); ctx.fill(); break;
    case 'bomb':   // round bomb with fuse
      ctx.beginPath(); ctx.arc(0,2,7,0,TAU); ctx.fill(); ctx.fillRect(-1,-9,2,5); break;
    case 'mine':   // spiked mine
      ctx.beginPath(); ctx.arc(0,0,5,0,TAU); ctx.fill();
      for (let i=0;i<8;i++){ const a=i/8*TAU; ctx.fillRect(Math.cos(a)*8-1.3, Math.sin(a)*8-1.3, 2.6, 2.6); } break;
    default:
      ctx.beginPath(); ctx.arc(0,0,6,0,TAU); ctx.fill();
  }
  ctx.restore();
}

// ============================== UI ======================================
const UI = {
  el(id){ return document.getElementById(id); },
  // Scores & current weapon are drawn on the canvas scoreboard now.
  buildHud() { const hud = this.el('hud'); if (hud) hud.innerHTML = ''; },
  updateHud() {},
  banner(text, sub, autohide, color) {
    const b = this.el('banner'); b.classList.remove('hidden');
    const tx = this.el('banner-text'); tx.textContent = text; tx.style.color = color || '#fff';
    this.el('banner-sub').textContent = sub || '';
    if (autohide) setTimeout(()=>b.classList.add('hidden'), 1400);
  },
  hideBanner(){ this.el('banner').classList.add('hidden'); },
  matchOver(winner, tanks) {
    this.el('winline').textContent = PLAYER_NAMES[winner.idx] + ' WINS!';
    this.el('winline').style.color = winner.color;
    const fs = this.el('finalscores'); fs.innerHTML = '';
    [...tanks].sort((a,b)=>b.score-a.score).forEach(t=>{
      const r = document.createElement('div'); r.className='fs';
      r.innerHTML = `<span style="color:${t.color}">${PLAYER_NAMES[t.idx]}${t.isBot?' (BOT)':''}</span><span>${t.score}</span>`;
      fs.appendChild(r);
    });
    this.el('gameover').classList.remove('hidden');
  },
};

// ============================ BOOTSTRAP =================================
const canvas = document.getElementById('game');
const game = new Game(canvas);

// menu segmented controls
let cfg = { humans: 2, bots: 0, target: 10 };
function wireSeg(id, key) {
  const seg = document.getElementById(id);
  seg.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn) return;
    [...seg.children].forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    cfg[key] = parseInt(btn.dataset.v, 10);
  });
}
wireSeg('seg-humans', 'humans');
wireSeg('seg-bots', 'bots');
wireSeg('seg-target', 'target');

function startMatch() {
  let humans = cfg.humans, bots = cfg.bots;
  if (humans + bots < 2) bots = Math.max(bots, 2 - humans); // need >=2 tanks
  Audio.resume();
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  game.start(humans, bots, cfg.target);
}

document.getElementById('play').addEventListener('click', startMatch);
document.getElementById('again').addEventListener('click', () => {
  document.getElementById('gameover').classList.add('hidden');
  game.start(game.numHumans, game.numBots, game.targetScore);
});
document.getElementById('tomenu').addEventListener('click', toMenu);
document.getElementById('quit').addEventListener('click', toMenu);
document.getElementById('resume').addEventListener('click', () => { document.getElementById('pause').classList.add('hidden'); game.resume(); });
document.getElementById('pausebtn').addEventListener('click', togglePause);

function toMenu() {
  game.state = 'menu';
  document.getElementById('pause').classList.add('hidden');
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('banner').classList.add('hidden');
  document.getElementById('menu').classList.remove('hidden');
  document.getElementById('hud').innerHTML = '';
  // reset canvas to menu size
  canvas.width = 8*CS+WT; canvas.height = 6*CS+WT+SCORE_H; game.fitCanvas();
}
function togglePause() {
  if (game.state === 'paused') { document.getElementById('pause').classList.add('hidden'); game.resume(); }
  else if (game.state === 'playing' || game.state === 'countdown') { game.pause(); document.getElementById('pause').classList.remove('hidden'); }
}

// keyboard — track by physical code so numpad/digits/ctrl are distinct
const PREVENT = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space',
  'Numpad8','Numpad4','Numpad5','Numpad6','ControlRight','Semicolon','Digit1']);
window.addEventListener('keydown', e => {
  if (PREVENT.has(e.code)) e.preventDefault();
  if (e.code === 'Escape') { togglePause(); return; }
  if (e.code === 'Enter' && game.state === 'menu') { startMatch(); return; }
  game.keys[e.code] = true;
});
window.addEventListener('keyup', e => { game.keys[e.code] = false; });
window.addEventListener('blur', () => { game.keys = {}; });
window.addEventListener('resize', () => game.fitCanvas());

// initialize menu canvas
canvas.width = 8*CS+WT; canvas.height = 6*CS+WT+SCORE_H; game.fitCanvas();

if (location.search.includes('debug')) { window.__game = game; window.__startMatch = startMatch; }
})();

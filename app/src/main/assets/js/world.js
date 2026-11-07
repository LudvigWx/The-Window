'use strict';
// =====================================================================
//  The Window – världen och dess naturlagar.
//  Här finns INGA beteenden. Bara fysik, energi, växter och kroppar.
//  Allt varelserna gör kommer från deras egna hjärnor.
// =====================================================================

const TS = 8;            // en ruta = 8 världsenheter
const WW = 240, WH = 96; // världens storlek i rutor
const DAY = 1200;        // ett dygn = 1200 sekunder (20 min i realtid)
const DT = 0.05;         // ett simuleringssteg = 1/20 sekund
const T = { AIR: 0, DIRT: 1, GRASS: 2, STONE: 3, SAND: 4, WATER: 5, CLAY: 6 };
const SOLID = [0, 1, 1, 1, 1, 0, 1];

// Hjärnans in- och utgångar (fast storlek, så att sparade världar håller mellan versioner)
const IN_LABELS = [
  'syn 1 nära', 'syn 1 växt', 'syn 1 varelse',
  'syn 2 nära', 'syn 2 växt', 'syn 2 varelse',
  'syn 3 nära', 'syn 3 växt', 'syn 3 varelse',
  'syn 4 nära', 'syn 4 växt', 'syn 4 varelse',
  'syn 5 nära', 'syn 5 växt', 'syn 5 varelse',
  'rör en växt', 'står på mark', 'vägg framför', 'energi', 'smärta', 'ljus',
  'hör framifrån', 'hör bakifrån', 'blicken', 'hörd tonhöjd', 'rör en varelse', 'är ung'
];
const OUT_LABELS = ['gå', 'hoppa', 'ät', 'greppa', 'gräv', 'röst', 'tonhöjd', 'para', 'ge'];
const VOX = ['mu', 'mo', 'ma', 'na', 'ne', 'ni', 'ki', 'ti']; // låg ton → hög ton, så att ljuden kan skrivas som text
const HARD = { 1: 1.2, 2: 1.2, 4: 0.8, 6: 2.5, 3: 7 };      // sekunder att gräva bort en ruta
const MAT = { 1: 'jord', 2: 'jord', 3: 'sten', 4: 'sand', 6: 'lera' };
const CTX = [['food', 'nära mat'], ['mate', 'nära en möjlig partner'], ['child', 'nära sitt barn'], ['young', 'när talaren är ung'], ['hungry', 'när talaren är hungrig'], ['dark', 'i mörker'], ['alone', 'när talaren är ensam']];
const OUT_ACTIVE = [1, 1, 1, 1, 1, 1, 1, 1, 1]; // alla utgångar är inkopplade i kroppen (fas 3)
const MAXPOP = 120;      // tekniskt tak för vad en mobil orkar
const ADULT = 2 * DAY;   // vuxen efter två dygn
const GROW_T = 1.5 * DAY; // tid att växa till full storlek
const NI = IN_LABELS.length, NO = OUT_LABELS.length;
const RAY_ANGLES = [-0.6, -0.28, 0, 0.28, 0.6];
const RAY_LEN = 140;

// ---------- deterministisk slump ----------
class RNG {
  constructor(seed) { this.s = seed >>> 0; }
  next() { let t = (this.s = (this.s + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a, b) { return a + (b - a) * this.next(); }
  int(n) { return Math.floor(this.next() * n); }
  gauss() { let u = 0; while (!u) u = this.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.2831853 * this.next()); }
  pick(a) { return a[this.int(a.length)]; }
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// Dalen är rund som en liten planet: går man ut till höger kommer man in från vänster.
const WPX = WW * TS;
const wrapX = x => ((x % WPX) + WPX) % WPX;
const wrapT = tx => ((tx % WW) + WW) % WW;
const wrapD = d => { d = ((d % WPX) + WPX) % WPX; return d > WPX / 2 ? d - WPX : d; };
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

const SYL = ['ka', 'lo', 'mi', 'ra', 'vi', 'su', 'ne', 'to', 'ya', 'el', 'sol', 'ek', 'ul', 'fy', 'mo', 'ri', 'an', 'ja', 'ny', 'ix', 'ba', 'li', 'sa', 'du', 'or', 'vo', 'ina', 'eo'];

// =====================================================================
class World {
  constructor(seed, names) {
    this.seed = seed >>> 0;
    this.rng = new RNG(seed);
    this.time = 0;
    this.tiles = new Uint8Array(WW * WH);
    this.surface = new Int16Array(WW);
    this.plants = [];
    this.plantAt = new Array(WW).fill(null);
    this.creatures = [];
    this.log = [];
    this.nextId = 1;
    this.firsts = {};
    this.terrainVersion = 0;
    this.plantAcc = 0;
    this.wind = 0;
    this.fert = new Float32Array(WW).fill(1); // näring i jorden, per kolumn
    this.bins = Array.from({ length: WW }, () => []);
    this.dead = []; this.maxGen = 1; this.births = 0; this.aliveCount = 0; this.popHist = [];
    this.sounds = []; this.lex = {}; this.ctxTot = {}; this.uttTot = 0; this.dirty = []; this.stats = { digs: 0, builds: 0, gifts: 0 };
    if (names) { this.generate(); this.seedPlants(); this.spawnFounders(names); }
  }

  // ---------- tid & ljus ----------
  dayFrac() { return ((this.time / DAY) + 0.25) % 1; } // 0 = midnatt, 0.25 = 06:00
  dayNumber() { return Math.floor((this.time / DAY) + 0.25) + 1; }
  clock() { const m = Math.floor(this.dayFrac() * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  sunHeight() { return -Math.cos(this.dayFrac() * 2 * Math.PI); }
  daylight() { return clamp(this.sunHeight() * 1.6 + 0.35, 0.06, 1); }
  lightAt(wx, wy) {
    const tx = wrapT(Math.floor(wx / TS)), ty = Math.floor(wy / TS);
    const depth = ty - this.surface[tx];
    const base = this.daylight();
    return depth <= 1 ? base : base * Math.max(0, 1 - (depth - 1) / 6);
  }

  // ---------- rutor ----------
  tile(tx, ty) { if (ty >= WH) return T.STONE; if (ty < 0) return T.AIR; return this.tiles[ty * WW + wrapT(tx)]; }
  setTile(tx, ty, v) { if (ty < 0 || ty >= WH) return; this.tiles[ty * WW + wrapT(tx)] = v; this.terrainVersion++; }
  // ändra en ruta medan världen lever: uppdatera ytan och be fönstret måla om just den rutan
  setTileLive(tx, ty, v) {
    tx = wrapT(tx); if (ty < 0 || ty >= WH) return;
    this.tiles[ty * WW + tx] = v;
    let y = 0; while (y < WH - 1 && !SOLID[this.tiles[y * WW + tx]]) y++;
    this.surface[tx] = y;
    if (this.dirty.length < 4000) this.dirty.push(tx, ty);
  }
  solidAt(wx, wy) { return SOLID[this.tile(Math.floor(wx / TS), Math.floor(wy / TS))] === 1; }
  waterAt(wx, wy) { return this.tile(Math.floor(wx / TS), Math.floor(wy / TS)) === T.WATER; }
  boxSolid(cx, feet, w, h) {
    const x0 = Math.floor((cx - w / 2) / TS), x1 = Math.floor((cx + w / 2) / TS);
    const y0 = Math.floor((feet - h) / TS), y1 = Math.floor((feet - 0.01) / TS);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (SOLID[this.tile(tx, ty)]) return true;
    return false;
  }

  generate() {
    const r = this.rng, ph = [r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28), r.range(0, 6.28)];
    const lakeX = 50 + r.int(WW - 100), lakeW = 16 + r.int(8);
    for (let x = 0; x < WW; x++) {
      const u = x / WW * 2 * Math.PI; // periodiskt, så att dalen går runt
      let h = WH * 0.42 + Math.sin(u * 3 + ph[0]) * 8 + Math.sin(u * 9 + ph[1]) * 3.2 + Math.sin(u * 25 + ph[2]) * 1.1;
      const d = Math.max(0, 1 - Math.abs(wrapD((x - lakeX) * TS) / TS) / lakeW);
      h += d * d * 10;
      this.surface[x] = Math.round(h);
    }
    for (let x = 0; x < WW; x++) {
      const s = this.surface[x], dirtDepth = 4 + Math.floor(hash2(x, 7) * 3 + Math.sin(x / WW * 2 * Math.PI * 12 + ph[3]) * 1.5);
      for (let y = 0; y < WH; y++) {
        let t = T.AIR;
        if (y === s) t = T.GRASS;
        else if (y > s && y <= s + dirtDepth) t = T.DIRT;
        else if (y > s + dirtDepth) t = (hash2(x >> 2, y >> 2) > 0.93) ? T.CLAY : T.STONE;
        this.tiles[y * WW + x] = t;
      }
    }
    // grottor: slingrande maskgångar i berget
    for (let k = 0; k < 5; k++) {
      let x = r.range(0, WW), y = r.range(WH * 0.62, WH - 8), a = r.range(0, 6.28);
      const len = 40 + r.int(60);
      for (let i = 0; i < len; i++) {
        a += r.range(-0.35, 0.35); x += Math.cos(a) * 1.2; y += Math.sin(a) * 0.6;
        const rad = 1.6 + Math.sin(i * 0.2) * 0.8;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const tx = Math.round(x + dx), ty = Math.round(y + dy);
          if (dx * dx + dy * dy * 2 <= rad * rad && ty > this.surface[wrapT(tx)] + 6 && ty < WH - 2) this.setTile(tx, ty, T.AIR);
        }
      }
    }
    // sjön: vatten fyller sänkan nerifrån och upp, men aldrig högre än den lägsta strandkanten
    let bx = lakeX; for (let x = lakeX - lakeW; x <= lakeX + lakeW; x++) if (this.surface[wrapT(x)] > this.surface[wrapT(bx)]) bx = wrapT(x);
    let filled = null, L = this.surface[bx] - 10;
    for (; L < this.surface[bx]; L++) {
      const seen = new Set(), q = [[bx, this.surface[bx] - 1]]; let leak = false;
      while (q.length && !leak) {
        const [x, y] = q.pop(), k = wrapT(x) + ',' + y;
        if (seen.has(k) || y < L || y >= WH || this.tile(x, y) !== T.AIR) continue;
        seen.add(k);
        if (Math.abs(wrapD((x - bx) * TS) / TS) > lakeW * 2 || seen.size > 3000) { leak = true; break; }
        q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
      }
      if (!leak && seen.size > 0) { filled = seen; break; }
    }
    let lx0 = bx, lx1 = bx;
    if (filled) for (const k of filled) {
      const [x, y] = k.split(',').map(Number); this.setTile(x, y, T.WATER);
      const d = wrapD((x - bx) * TS) / TS; if (d < wrapD((lx0 - bx) * TS) / TS) lx0 = x; if (d > wrapD((lx1 - bx) * TS) / TS) lx1 = x;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [1, 1], [-1, 1]]) { const t = this.tile(x + dx, y + dy); if (t === T.GRASS || t === T.DIRT) this.setTile(x + dx, y + dy, T.SAND); }
    }
    if (lx1 < lx0) lx1 += WW;
    this.lake = { x0: lx0, x1: lx1, level: L };
    this.terrainVersion++;
  }

  isGrowable(x) {
    x = wrapT(x);
    const s = this.surface[x], t = this.tile(x, s);
    return (t === T.GRASS || t === T.DIRT) && this.tile(x, s - 1) === T.AIR;
  }
  nearLake(x, pad) { if (!this.lake) return false; const m = (this.lake.x0 + this.lake.x1) / 2; return Math.abs(wrapD((x - m) * TS) / TS) <= (this.lake.x1 - this.lake.x0) / 2 + pad; }
  moisture(x) { if (!this.lake) return 0.5; const m = (this.lake.x0 + this.lake.x1) / 2, d = Math.max(0, Math.abs(wrapD((x - m) * TS) / TS) - (this.lake.x1 - this.lake.x0) / 2); return 0.45 + 0.55 * Math.max(0, 1 - d / 30); }

  // ---------- växter ----------
  newPlant(x, parent) {
    const r = this.rng;
    const g = parent ? {
      max: clamp(parent.max * Math.exp(r.gauss() * 0.08), 6, 60), grow: clamp(parent.grow * Math.exp(r.gauss() * 0.08), 0.02, 0.5),
      h: clamp(parent.h + r.gauss() * 0.06, 0.4, 2.5), hue: (parent.hue + r.gauss() * 4 + 360) % 360, berry: (parent.berry + r.gauss() * 6 + 360) % 360,
      life: clamp(parent.life * Math.exp(r.gauss() * 0.08), DAY * 2, DAY * 30)
    } : { max: r.range(10, 30), grow: r.range(0.06, 0.16), h: r.range(0.6, 1.6), hue: r.range(85, 135), berry: r.pick([350, 10, 25, 300, 45]), life: r.range(DAY * 5, DAY * 14) };
    const p = { x, b: parent ? 1 : r.range(2, g.max), age: parent ? 0 : r.range(0, g.life * 0.6), ...g };
    this.plants.push(p); this.plantAt[x] = p; return p;
  }
  seedPlants() { for (let x = 0; x < WW; x++) if (this.isGrowable(x) && this.rng.next() < 0.45) this.newPlant(x); }
  updatePlants(dt) {
    const light = this.daylight();
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      p.age += dt;
      if (!this.isGrowable(p.x) || p.age > p.life) { this.plants.splice(i, 1); this.plantAt[p.x] = null; continue; }
      const f = this.fert[p.x], grown = p.grow * light * this.moisture(p.x) * (0.3 + 0.7 * clamp(f, 0, 2)) * (1 - p.b / p.max) * dt;
      p.b += grown; this.fert[p.x] = Math.max(0, f - grown * 0.004);
      if (p.b > p.max * 0.7 && this.plants.length < 230 && this.rng.next() < 0.004 * dt) {
        const nx = wrapT(p.x + (this.rng.next() < 0.5 ? -1 : 1) * (1 + this.rng.int(6)));
        if (this.isGrowable(nx) && !this.plantAt[nx]) this.newPlant(nx, p);
      }
    }
  }
  // jorden återhämtar sig långsamt mot sin naturliga näringsnivå
  updateSoil(dt) { for (let x = 0; x < WW; x++) this.fert[x] += (1 - this.fert[x]) * dt / (4 * DAY); }
  fertilize(x, amt) { for (let k = -2; k <= 2; k++) { const c = wrapT(Math.floor(x / TS) + k); this.fert[c] = Math.min(3, this.fert[c] + amt * (k === 0 ? 0.4 : k * k === 1 ? 0.2 : 0.1)); } }
  plantHeight(p) { return (4 + p.h * 20) * (0.3 + 0.7 * p.b / p.max); }

  // ---------- varelser ----------
  makeGenes() {
    const r = this.rng;
    return {
      seg: 1 + r.int(3), segL: r.range(6, 11), segH: r.range(5, 9), legs: 1 + r.int(3), legL: r.range(4, 9),
      hue: r.range(0, 360), hue2: r.range(0, 360), pattern: r.int(3), eye: r.range(1.6, 2.8),
      ant: r.next() < 0.5 ? 0 : r.range(3, 8), tail: r.next() < 0.4 ? 0 : r.range(3, 11),
      hid: 8 + r.int(5), explore: r.range(0.15, 0.3), lr: r.range(0.002, 0.008), maxAge: r.range(15, 25) * DAY
    };
  }
  makeBrain(g) {
    const r = this.rng, H = g.hid, f = (n, s) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = r.gauss() * s; return a; };
    const bo = f(NO, 0.1);
    // Dyra handlingar börjar som ovanliga (en medfödd återhållsamhet) – evolutionen kan ändra det.
    bo[3] -= 1.2; bo[4] -= 1.5; bo[5] -= 0.6; bo[8] -= 1.2;
    return { H, wih: f(H * NI, 0.5), whh: f(H * H, 0.2), bh: f(H, 0.1), who: f(NO * H, 0.5), bo };
  }
  bodySize(g) { const L = g.segL * (0.75 * (g.seg - 1) + 1.2); return { w: L * 0.8, h: g.segH + g.legL * 0.85, L }; }
  applySize(c) { const s = this.bodySize(c.g); c.w = s.w * c.size; c.h = s.h * c.size; }
  makeCreature(name, x, g, br, gen, parents, opt = {}) {
    const H = br.H, sz = opt.size || 1, s = this.bodySize(g);
    const cp = b => ({ H: b.H, wih: Float32Array.from(b.wih), whh: Float32Array.from(b.whh), bh: Float32Array.from(b.bh), who: Float32Array.from(b.who), bo: Float32Array.from(b.bo) });
    const c = { br0: opt.br0 ? cp(opt.br0) : cp(br), size: sz, born: this.time, kids: 0, mateCd: 0, flesh: 0, diedAt: 0, pnames: opt.pnames || null,
      id: this.nextId++, name, gen: gen || 1, parents: parents || null, g, br,
      x, y: this.surface[wrapT(Math.floor(x / TS))] * TS, vx: 0, vy: 0, face: 1, w: s.w * sz, h: s.h * sz,
      energy: opt.energy || 90, age: 0, alive: true, grounded: false, pain: 0, jumpCd: 0, wall: 0, touch: 0, watched: 0,
      inp: new Float32Array(NI), out: new Float32Array(NO), hs: new Float32Array(H),
      noiseH: new Float32Array(H), noiseO: new Float32Array(NO),
      eih: new Float32Array(H * NI), ehh: new Float32Array(H * H), ebh: new Float32Array(H), eho: new Float32Array(NO * H), ebo: new Float32Array(NO),
      rbar: 0, meals: 0, biteT: 9, eating: 0, walk: 0, blink: 3, lastSeen: 0, px: x, py: 0, lastReward: 0, gain: 0, seenId: 0, prevAir: false, prevVy: 0, learnN: 0, gainIn: 0, voiceCd: 0, utt: [], lastSyl: 0, say: null, touchO: null, digKey: -1, digP: 0, carry: 0, builds: 0, spoke: 0, rayHit: new Int8Array(RAY_ANGLES.length), rayD: new Float32Array(RAY_ANGLES.length), hs2: null
    };
    this.creatures.push(c); return c;
  }
  spawnFounders(names, evolved) {
    const mid = WW / 2;
    let xs = [mid - 8, mid + 8].map(x => {
      let tx = Math.round(x);
      for (let k = 0; k < WW; k++) { const a = wrapT(tx + (k % 2 ? k : -k)); if (this.tile(a, this.surface[a] - 1) === T.AIR && !this.nearLake(a, 3)) { tx = a; break; } }
      return tx * TS + TS / 2;
    });
    if (Math.abs(wrapD(xs[1] - xs[0])) < 5 * TS) { let tx = Math.floor(xs[0] / TS) + 6; for (let k = 0; k < WW; k++, tx++) { const a = wrapT(tx); if (this.tile(a, this.surface[a] - 1) === T.AIR && !this.nearLake(a, 3)) { xs[1] = a * TS + TS / 2; break; } } }
    names.forEach((n, i) => {
      const e = evolved && evolved[i];
      const g = e ? { ...e.g } : this.makeGenes();
      const br = e ? { H: e.br.H, wih: Float32Array.from(e.br.wih), whh: Float32Array.from(e.br.whh), bh: Float32Array.from(e.br.bh), who: Float32Array.from(e.br.who), bo: Float32Array.from(e.br.bo) } : this.makeBrain(g);
      const c = this.makeCreature(n, xs[i], g, br, 1, null); c.energy = 120;
    });
    this.chron(`${names[0]} och ${names[1]} öppnar ögonen för första gången.`);
  }

  // ---------- urtiden: en dold förhistoria som formar stamföräldrarna ----------
  // Stamföräldrarna är inte handgjorda. De är de bästa överlevarna från en snabb
  // evolution i en kopia av dalen, där tusentals förfäder levde och dog.
  static *prehistory(seed, names, opt = {}) {
    const POP = opt.pop || 14, GENS = opt.gens || 12, EVAL = opt.eval || 450;
    const base = new World(seed, null); base.generate(); base.seedPlants();
    const r = base.rng;
    const mutB = (br, s) => { const m = a => { const o = Float32Array.from(a); for (let i = 0; i < o.length; i++) if (r.next() < 0.3) o[i] = clamp(o[i] + r.gauss() * s, -4, 4); return o; }; return { H: br.H, wih: m(br.wih), whh: m(br.whh), bh: m(br.bh), who: m(br.who), bo: m(br.bo) }; };
    const mutG = g => { const n = { ...g }; for (const k of ['segL', 'segH', 'legL', 'eye', 'explore', 'lr']) n[k] = g[k] * Math.exp(r.gauss() * 0.06); n.hue = (g.hue + r.gauss() * 6 + 360) % 360; n.hue2 = (g.hue2 + r.gauss() * 6 + 360) % 360; return n; };
    let pop = []; for (let i = 0; i < POP; i++) { const g = base.makeGenes(); pop.push({ g, br: base.makeBrain(g), fresh: true }); }
    let best = [];
    for (let gen = 0; gen < GENS; gen++) {
      for (const ind of pop) {
        const w = new World(seed + 1 + gen, null);
        w.tiles = base.tiles; w.surface = base.surface; w.lake = base.lake;
        w.plants = base.plants.map(p => ({ ...p, b: p.b * 0.5 })); w.plantAt = new Array(WW).fill(null); for (const p of w.plants) w.plantAt[p.x] = p;
        w.time = r.range(0, DAY); w.chron = () => {}; w.first = () => {};
        let tx = r.int(WW); for (let k = 0; k < WW && (w.tile(tx, w.surface[tx]) === T.WATER || w.tile(tx, w.surface[tx] - 1) !== T.AIR); k++) tx = wrapT(tx + 7);
        const c = w.makeCreature('?', tx * TS + TS / 2, ind.g, { H: ind.br.H, wih: Float32Array.from(ind.br.wih), whh: Float32Array.from(ind.br.whh), bh: Float32Array.from(ind.br.bh), who: Float32Array.from(ind.br.who), bo: Float32Array.from(ind.br.bo) });
        c.energy = 30; let eaten = 0, lived = 0;
        for (let t = 0; t < EVAL / DT && c.alive; t++) { w.step(); eaten += c.gain; lived += DT; }
        const f = lived + eaten * 0.3 + (c.alive ? 60 : 0); ind.fit = ind.fit === undefined || ind.fresh ? f : (ind.fit + f) / 2; ind.fresh = false;
        yield { gen: gen + 1, gens: GENS, frac: (gen + (pop.indexOf(ind) + 1) / POP) / GENS };
      }
      pop.sort((a, b) => b.fit - a.fit);
      best = pop.slice(0, 4);
      const next = best.map(b => ({ g: b.g, br: b.br, fit: b.fit, fresh: false }));
      while (next.length < POP) { const p = best[r.int(best.length)]; next.push({ g: mutG(p.g), br: mutB(p.br, 0.25), fresh: true }); }
      pop = next;
    }
    const w = new World(seed, null); w.generate(); w.seedPlants();
    w.spawnFounders(names, best.slice(0, 2));
    w.chron(`De är de första ur en urtid på ${GENS} generationer och ${GENS * POP} förfäder som ingen kommer att minnas.`);
    yield { done: true, world: w };
  }

  chron(msg, c) { this.log.push({ t: this.time, msg, id: c ? c.id : 0 }); if (this.log.length > 500) this.log.shift(); if (this.onLog) this.onLog(this.log[this.log.length - 1]); }
  first(key, msg, c) { if (this.firsts[key] || (c && c.gen > 1)) return; this.firsts[key] = this.time; this.chron(msg, c); }

  // ---------- sinnen ----------
  sense(c) {
    const inp = c.inp, ex = c.x + c.face * c.w * 0.4, ey = c.y - c.h * 0.8;
    // synen uppdateras tio gånger per sekund (varannan takt), känslorna varje takt
    if (((this.stepN + c.id) & 1) === 0) for (let k = 0; k < RAY_ANGLES.length; k++) {
      const a = RAY_ANGLES[k], dx = Math.cos(a) * c.face, dy = Math.sin(a);
      let hit = 0, d = RAY_LEN;
      for (let s = 5; s <= RAY_LEN; s += 5) {
        const px = ex + dx * s, py = ey + dy * s;
        const ty = Math.floor(py / TS), col = wrapT(Math.floor(px / TS));
        if (ty >= WH || (ty >= 0 && SOLID[this.tiles[ty * WW + col]])) { hit = 1; d = s; break; }
        const p = this.plantAt[col];
        if (p && p.b > 0.5) { const base = this.surface[col] * TS; if (py <= base && py >= base - this.plantHeight(p)) { hit = 2; d = s; break; } }
        let found = null;
        for (const o of this.bins[col]) { if (o === c) continue; if (Math.abs(wrapD(px - o.x)) < o.w / 2 && py > o.y - o.h && py < o.y) { found = o; break; } }
        if (found) { hit = 3; d = s; c.seenId = found.id; break; }
      }
      c.rayHit[k] = hit; c.rayD[k] = d;
      inp[k * 3] = hit ? 1 - d / RAY_LEN : 0; inp[k * 3 + 1] = hit === 2 ? 1 : 0; inp[k * 3 + 2] = hit === 3 ? 1 : 0;
      if (hit === 3 && c.gen === 1) this.sawOther(c);
    }
    inp[15] = c.touch; inp[16] = c.grounded ? 1 : 0; inp[17] = c.wall; inp[18] = clamp(c.energy / 120, 0, 1);
    inp[19] = c.pain; inp[20] = this.lightAt(c.x, c.y - c.h / 2); inp[23] = c.watched;
    // hörsel: det starkaste ljudet framifrån och bakifrån, och tonhöjden på det starkaste
    let fr = 0, bk = 0, best = 0, pitch = 0;
    for (const sd of this.sounds) {
      if (sd.id === c.id) continue;
      const age = this.time - sd.t; if (age > 0.4) continue;
      const dx = wrapD(sd.x - c.x), dist = Math.abs(dx) + Math.abs(sd.y - c.y) * 0.5; if (dist > 220) continue;
      const loud = (1 - dist / 220) * (1 - age / 0.4);
      if (Math.sign(dx) === c.face || dx === 0) fr = Math.max(fr, loud); else bk = Math.max(bk, loud);
      if (loud > best) { best = loud; pitch = sd.p; }
    }
    inp[21] = fr; inp[22] = bk; inp[24] = pitch; inp[25] = c.touchO ? 1 : 0; inp[26] = c.size < 1 ? 1 : 0;
  }
  sawOther(c) { const o = this.creatures.find(z => z.id === c.seenId); if (o && o.gen === 1) this.first('saw' + c.id, `${c.name} får syn på ${o.name} för första gången.`, c); }

  // ---------- hjärnan: tänker och lär sig av belöning ----------
  think(c, reward) {
    const br = c.br, H = br.H, x = c.inp, hp = c.hs, r = this.rng;
    const lam = Math.exp(-DT / 1.0), nd = Math.exp(-DT / 0.5), ns = Math.sqrt(1 - nd * nd), sig = c.g.explore;
    // lärande: belöning jämfört med vad den brukar få
    const rate = reward / DT; const adv = rate - c.rbar; c.rbar += (rate - c.rbar) * DT / 20;
    const k = c.g.lr * adv * DT;
    const wih = br.wih, whh = br.whh, bh = br.bh, who = br.who, bo = br.bo, eih = c.eih, ehh = c.ehh, ebh = c.ebh, eho = c.eho, ebo = c.ebo;
    const upd = (w, e) => { for (let i = 0; i < w.length; i++) { const v = w[i] + k * e[i]; w[i] = v > 4 ? 4 : v < -4 ? -4 : v; } };
    if (k !== 0) { upd(wih, eih); upd(whh, ehh); upd(bh, ebh); upd(who, eho); upd(bo, ebo); }
    // Inlärda ändringar bleknar långsamt tillbaka mot det medfödda (minnen som inte förstärks glöms).
    if (++c.learnN >= 20) {
      c.learnN = 0; const fade = 20 * DT / 3000, b0 = c.br0;
      const fd = (w, w0) => { for (let i = 0; i < w.length; i++) w[i] -= fade * (w[i] - w0[i]); };
      fd(wih, b0.wih); fd(whh, b0.whh); fd(bh, b0.bh); fd(who, b0.who); fd(bo, b0.bo);
    }
    // framåt: dolda neuroner med minne (återkoppling) och lite utforskande brus
    const hn = c.hs2 && c.hs2.length === H ? c.hs2 : new Float32Array(H), nH = c.noiseH, nO = c.noiseO, out = c.out;
    for (let j = 0; j < H; j++) {
      let z = bh[j]; const ji = j * NI, jh = j * H;
      for (let i = 0; i < NI; i++) z += wih[ji + i] * x[i];
      for (let i = 0; i < H; i++) z += whh[jh + i] * hp[i];
      nH[j] = nH[j] * nd + ns * sig * (r.next() + r.next() + r.next() - 1.5) * 2;
      const v = Math.tanh(z + nH[j]), dv = v - Math.tanh(z);
      hn[j] = v;
      for (let i = 0; i < NI; i++) eih[ji + i] = eih[ji + i] * lam + dv * x[i];
      for (let i = 0; i < H; i++) ehh[jh + i] = ehh[jh + i] * lam + dv * hp[i];
      ebh[j] = ebh[j] * lam + dv;
    }
    for (let m = 0; m < NO; m++) {
      let z = bo[m]; const mh = m * H;
      for (let j = 0; j < H; j++) z += who[mh + j] * hn[j];
      nO[m] = nO[m] * nd + ns * sig * (r.next() + r.next() + r.next() - 1.5) * 2;
      const v = Math.tanh(z + nO[m]), dv = v - Math.tanh(z);
      out[m] = v;
      for (let j = 0; j < H; j++) eho[mh + j] = eho[mh + j] * lam + dv * hn[j];
      ebo[m] = ebo[m] * lam + dv;
    }
    c.hs2 = hp; c.hs = hn; // två buffertar som turas om
  }

  // ---------- kroppen: fysik och energi ----------
  body(c) {
    const g = c.g, dt = DT;
    let reward = 0;
    const move = c.out[0], maxV = 14 + g.legL * 2.2 + g.legs * 3;
    const inWater = this.waterAt(c.x, c.y - c.h * 0.5);
    const target = Math.abs(move) > 0.15 ? move * maxV * (inWater ? 0.5 : 1) : 0;
    if (Math.abs(move) > 0.15) c.face = move > 0 ? 1 : -1;
    c.vx += (target - c.vx) * Math.min(1, dt * (c.grounded ? 8 : inWater ? 3 : 1.5));
    c.jumpCd -= dt;
    if (c.out[1] > 0.5 && c.jumpCd <= 0 && (c.grounded || inWater)) {
      c.vy = inWater ? Math.min(c.vy, -95) : -(90 + g.legL * 9); c.jumpCd = inWater ? 0.25 : 0.6; c.energy -= inWater ? 0.02 : 0.06 + g.legL * 0.005; c.grounded = false;
      this.first('jump' + c.id, `${c.name} hoppar för första gången.`, c);
    }
    c.vy += (inWater ? 600 * 0.12 : 600) * dt;
    if (inWater) { c.vx *= 1 - dt * 1.5; c.vy *= 1 - dt * 3; this.first('swim' + c.id, `${c.name} har gått ner i vattnet.`, c); }
    // X-led
    c.wall = 0;
    const nx = wrapX(c.x + c.vx * dt);
    if (!this.boxSolid(nx, c.y, c.w, c.h)) c.x = nx;
    else if ((c.grounded || inWater) && !this.boxSolid(nx, c.y - TS, c.w, c.h)) { c.x = nx; c.y -= TS; } // små steg och strandkanter går att kliva upp på
    else { c.vx = 0; c.wall = 1; }
    // Y-led
    const ny = c.y + c.vy * dt;
    if (c.vy >= 0) {
      if (this.boxSolid(c.x, ny, c.w, c.h)) {
        const impact = c.vy;
        c.y = Math.floor(ny / TS) * TS; while (this.boxSolid(c.x, c.y, c.w, c.h) && c.y > 0) c.y -= 1;
        if (!c.grounded && impact > 230) { const dmg = (impact - 230) * 0.04; c.energy -= dmg; c.pain = Math.min(1, c.pain + dmg / 6); reward -= dmg; this.first('fall' + c.id, `${c.name} slår sig vid ett fall.`, c); }
        c.vy = 0; c.grounded = true;
      } else { c.y = ny; c.grounded = false; }
    } else {
      if (this.boxSolid(c.x, ny, c.w, c.h)) c.vy = 0; else c.y = ny;
      c.grounded = false;
    }
    if (c.y > WH * TS) { c.y = WH * TS - 1; c.vy = 0; }
    // äta: munnen måste nå en växt, och hjärnan måste vilja äta
    const mx = c.x + c.face * (c.w / 2 + 3), col = wrapT(Math.floor(mx / TS)), p = this.plantAt[col];
    c.touch = 0; c.eating = Math.max(0, c.eating - dt * 4);
    let plant = null, corpse = null;
    if (p && p.b > 0.3) { const base = this.surface[col] * TS; if (c.y > base - this.plantHeight(p) - 2 && c.y - c.h < base + 2 && Math.abs(c.y - base) < TS * 1.6) { c.touch = 1; plant = p; } }
    if (!plant) for (const d of this.corpses) { if (d.flesh > 0.2 && Math.abs(wrapD(mx - d.x)) < d.w / 2 + 2 && Math.abs(c.y - d.y) < 10) { c.touch = 1; corpse = d; break; } }
    if (c.out[2] > 0) {
      c.energy -= 0.01 * dt;
      if (c.touch && c.energy < 120) {
        const food = plant ? plant.b - 0.2 : corpse.flesh, bite = Math.min(food, 3 * dt * (0.5 + c.size * 0.5)), gain = Math.min(bite * 1.6, 120 - c.energy);
        if (plant) plant.b -= bite; else { corpse.flesh -= bite; this.first('scav', `${c.name} äter av den döda kroppen efter ${corpse.name}. Det har aldrig hänt i dalen förut.`); }
        c.energy += gain; c.gain += gain; c.eating = 1;
        if (c.biteT > 1.5) { c.meals++; if (c.meals === 1 && c.gen === 1) this.chron(`${c.name} äter för första gången.`, c); }
        c.biteT = 0;
      }
    }
    c.biteT += dt;
    // växa upp
    if (c.size < 1) { c.size = Math.min(1, c.size + dt / GROW_T * 0.5); this.applySize(c); }
    // para sig: båda måste vara vuxna, mätta, nära varandra och vilja det
    c.mateCd -= dt;
    if (c.out[7] > 0 && c.age > ADULT && c.energy > 70 && c.mateCd <= 0 && this.aliveCount < MAXPOP) {
      const cc = wrapT(Math.floor(c.x / TS));
      search: for (let k = -2; k <= 2; k++) for (const o of this.bins[wrapT(cc + k)]) {
        if (o === c || o.out[7] <= 0 || o.age <= ADULT || o.energy <= 70 || o.mateCd > 0) continue;
        if (Math.abs(wrapD(o.x - c.x)) < (c.w + o.w) / 2 + 3 && Math.abs(o.y - c.y) < 10) { this.birth(c, o); break search; }
      }
    }
    // rör vid någon framför munnen?
    c.touchO = null;
    { const mc = wrapT(Math.floor(mx / TS)); for (let k = -1; k <= 1 && !c.touchO; k++) for (const o of this.bins[wrapT(mc + k)]) if (o !== c && Math.abs(wrapD(o.x - mx)) < o.w / 2 + 2 && Math.abs(o.y - c.y) < 10) { c.touchO = o; break; } }
    // ge: flytta energi till den man rör vid
    if (c.out[8] > 0.5 && c.touchO && c.energy > 50 && c.touchO.energy < 110) {
      const o = c.touchO, amt = 4 * dt, got = amt * 0.85; c.energy -= amt; o.energy += got; o.gainIn += got;
      this.stats.gifts++;
      if (o.parents && o.parents.includes(c.id)) this.first('feed', `${c.name} ger energi till sitt barn ${o.name}. För första gången matar en förälder sin unge.`);
      else this.first('gift', `${c.name} ger av sin energi till ${o.name}. Ingen har delat med sig förut.`);
    }
    // röst: hjärnan bestämmer om och hur den låter
    c.voiceCd -= dt;
    if (c.out[5] > 0.3 && c.voiceCd <= 0 && c.energy > 3) {
      const p = c.out[6], syl = VOX[clamp(Math.floor((p + 1) / 2 * 8), 0, 7)];
      c.energy -= 0.012; c.voiceCd = 0.28; c.spoke++;
      this.sounds.push({ x: c.x, y: c.y - c.h * 0.7, p, t: this.time, id: c.id, syl, size: c.size, timbre: c.g.hue2 });
      if (c.utt.length < 4) c.utt.push(syl);
      c.lastSyl = this.time; c.say = { txt: c.utt.join('-'), t: this.time };
      this.first('voice', `${c.name} ger ifrån sig ett ljud: "${syl}". Det är första gången någon låter i dalen.`);
    }
    if (c.utt.length && this.time - c.lastSyl > 0.6) { this.hearWord(c, c.utt.join('-')); c.utt = []; }
    // gräva: det som finns framför, vid fötterna eller under kroppen
    if (c.out[4] > 0.5) {
      const fx = Math.floor((c.x + c.face * (c.w / 2 + 2)) / TS), cands = [[fx, Math.floor((c.y - c.h * 0.5) / TS)], [fx, Math.floor((c.y - 2) / TS)], [fx, Math.floor((c.y + 2) / TS)]];
      let tgt = null; for (const [tx, ty] of cands) { const t = this.tile(tx, ty); if (HARD[t] && ty < WH - 2) { tgt = [wrapT(tx), ty, t]; break; } }
      if (tgt) {
        const key = tgt[1] * WW + tgt[0]; if (key !== c.digKey) { c.digKey = key; c.digP = 0; }
        c.digP += dt / HARD[tgt[2]]; c.energy -= 0.08 * dt;
        if (c.digP >= 1) {
          this.setTileLive(tgt[0], tgt[1], T.AIR); c.digP = 0; c.digKey = -1; this.stats.digs++;
          if (!c.carry && c.out[3] > 0) { c.carry = tgt[2] === T.GRASS ? T.DIRT : tgt[2]; this.first('carry', `${c.name} bär med sig ${MAT[c.carry]} i munnen.`); }
          this.first('dig', `${c.name} gräver bort en bit ${MAT[tgt[2]]}. Det är första gången någon förändrar dalen.`);
        }
      } else c.digP = 0;
    } else c.digP = 0;
    // lägga ner det man bär
    if (c.carry && c.out[3] < -0.5) {
      const tx = Math.floor((c.x + c.face * (c.w / 2 + 4)) / TS), ty = Math.floor((c.y - 2) / TS);
      if (this.tile(tx, ty) === T.AIR && (SOLID[this.tile(tx, ty + 1)] || SOLID[this.tile(tx + c.face, ty)])) {
        let blocked = false; for (const o of this.bins[wrapT(tx)]) if (o.y > ty * TS && o.y - o.h < (ty + 1) * TS) blocked = true;
        if (!blocked) { this.first('build', `${c.name} lägger ner ${MAT[c.carry]}. Det är det första bygget i dalens historia.`); this.setTileLive(tx, ty, c.carry); c.carry = 0; c.builds++; this.stats.builds++; }
      }
    }
    // ämnesomsättning: allt kostar
    const metab = 0.02 + 0.0015 * c.w + 0.0004 * c.br.H + Math.abs(c.vx) * 0.0006 + (c.size < 1 ? 0.02 : 0) + (c.carry ? 0.01 : 0);
    c.energy -= metab * dt;
    c.pain *= 1 - dt * 0.8;
    c.walk += Math.abs(c.vx) * dt * 0.28;
    c.age += dt;
    return reward;
  }

  rebuildBins() {
    for (const b of this.bins) b.length = 0;
    let n = 0;
    this.corpses = [];
    for (const c of this.creatures) {
      if (!c.alive) { if (c.flesh > 0.2) this.corpses.push(c); continue; }
      n++;
      const a = Math.floor((c.x - c.w / 2) / TS), b = Math.floor((c.x + c.w / 2) / TS);
      for (let t = a; t <= b; t++) this.bins[wrapT(t)].push(c);
    }
    this.aliveCount = n;
  }
  step() {
    this.time += DT; this.stepN = (this.stepN || 0) + 1;
    this.wind = Math.sin(this.time * 0.05) * 0.6 + Math.sin(this.time * 0.013) * 0.4;
    this.plantAcc += DT; if (this.plantAcc >= 1) { this.updatePlants(this.plantAcc); this.updateSoil(this.plantAcc); this.decay(this.plantAcc); this.plantAcc = 0; }
    this.rebuildBins();
    if (this.sounds.length && this.time - this.sounds[0].t > 0.5) this.sounds = this.sounds.filter(sd => this.time - sd.t <= 0.5);
    for (const c of this.creatures) {
      c.px = c.x; c.py = c.y; // förra läget, så att fönstret kan rita mjuka rörelser mellan stegen
      if (!c.alive) continue;
      this.sense(c);
      this.think(c, c.lastReward || 0);
      const e0 = c.energy, p0 = c.pain, gi = c.gainIn; c.gain = gi; c.gainIn = 0;
      this.body(c);
      // Belöning = kroppens egna signaler: mat smakar gott (bättre ju hungrigare),
      // smärta gör ont, och ansträngning känns lite. Inget beteende är förprogrammerat.
      const hunger = 1 - clamp(c.energy / 120, 0, 1), cost = (c.energy - e0) - (c.gain - gi);
      c.lastReward = c.gain * (1 + 2 * hunger) - Math.max(0, c.pain - p0) * 6 + cost * 0.05;
      if (c.energy <= 0) this.die(c, `har somnat in av hunger, ${this.fmtAge(c.age)} gammal`);
      else if (c.age > c.g.maxAge) this.die(c, `har dött av ålder, ${this.fmtAge(c.age)} gammal`);
    }
    const [a, b] = this.creatures;
    if (a && b && a.gen === 1 && b.gen === 1 && a.alive && b.alive && Math.abs(wrapD(a.x - b.x)) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < 12) this.first('meet', `${a.name} och ${b.name} möts för första gången.`);
    const d = this.dayNumber(); if (d !== this.lastDay) { if (this.lastDay && this.aliveCount <= 6) this.chron(`Dag ${d} gryr i dalen.`); this.lastDay = d; this.popHist.push([this.time, this.aliveCount, this.maxGen]); if (this.popHist.length > 400) this.popHist.shift(); }
  }

  // ---------- liv och död ----------
  die(c, how) {
    c.alive = false; c.diedAt = this.time; c.flesh = 25 * c.size;
    if (c.gen === 1 || c.kids > 0 || this.aliveCount < 12) this.chron(`${c.name} ${how}${c.kids ? `, och lämnar ${c.kids} barn efter sig` : ''}.`, c);
    let alive = 0; for (const o of this.creatures) if (o.alive) alive++;
    if (!alive) this.chron('Det finns inget liv kvar i dalen. Bara växterna och jorden minns.');
  }
  decay(dt) {
    // döda kroppar bryts ner till näring i jorden
    for (const c of this.creatures) if (!c.alive) { const rot = Math.min(c.flesh, dt * 25 / DAY); c.flesh -= rot; this.fertilize(c.x, rot * 0.06); }
    const keep = [];
    for (const c of this.creatures) {
      if (c.alive || (c.flesh > 0.2 && this.time - c.diedAt < 1.5 * DAY)) { keep.push(c); continue; }
      this.fertilize(c.x, Math.max(0, c.flesh) * 0.06);
      this.dead.push({ id: c.id, name: c.name, gen: c.gen, parents: c.parents, pnames: c.pnames, kids: c.kids, born: c.born, died: c.diedAt, hue: c.g.hue });
      if (this.dead.length > 3000) this.dead.shift();
    }
    this.creatures = keep;
  }
  // ---------- översättaren: i vilka situationer används varje ord? ----------
  hearWord(c, w) {
    const ctx = {}, others = [];
    for (const o of this.creatures) if (o !== c && o.alive && Math.abs(wrapD(o.x - c.x)) < 120 && Math.abs(o.y - c.y) < 60) others.push(o);
    ctx.food = c.touch || [0, 1, 2, 3, 4].some(k => c.inp[k * 3 + 1] && c.inp[k * 3] > 0.5) ? 1 : 0;
    ctx.mate = c.age > ADULT && others.some(o => o.age > ADULT && Math.abs(wrapD(o.x - c.x)) < 40) ? 1 : 0;
    ctx.child = others.some(o => o.parents && o.parents.includes(c.id) && Math.abs(wrapD(o.x - c.x)) < 60) ? 1 : 0;
    ctx.young = c.size < 1 ? 1 : 0; ctx.hungry = c.energy < 40 ? 1 : 0; ctx.dark = this.lightAt(c.x, c.y) < 0.3 ? 1 : 0; ctx.alone = others.length ? 0 : 1;
    let e = this.lex[w];
    if (!e) {
      const keys = Object.keys(this.lex);
      if (keys.length >= 300) { let lo = keys[0]; for (const k of keys) if (this.lex[k].n < this.lex[lo].n) lo = k; delete this.lex[lo]; }
      e = this.lex[w] = { n: 0, sp: [], ctx: {}, first: this.time, by: c.name, logged: 0 };
    }
    e.n++; this.uttTot++; e.last = this.time;
    if (!e.sp.includes(c.id)) { e.sp.push(c.id); if (e.sp.length > 40) e.sp.shift(); }
    for (const [k] of CTX) if (ctx[k]) { e.ctx[k] = (e.ctx[k] || 0) + 1; this.ctxTot[k] = (this.ctxTot[k] || 0) + 1; }
    if (e.n >= 10 && e.sp.length >= 3 && !(e.logged & 1)) { e.logged |= 1; this.chron(`Ordet "${w}" används nu av ${e.sp.length} olika varelser.`); }
    const m = this.meaning(w);
    if (m && !(e.logged & 2)) { e.logged |= 2; this.chron(`Översättaren: "${w}" verkar sägas ${m.label} (${Math.round(m.p * 100)} % av gångerna).`); }
  }
  meaning(w) {
    const e = this.lex[w]; if (!e || e.n < 20 || e.sp.length < 2 || this.uttTot < 200) return null;
    let best = null;
    for (const [k, label] of CTX) {
      const p = (e.ctx[k] || 0) / e.n, base = (this.ctxTot[k] || 0) / this.uttTot, lift = base > 0 ? p / base : 0;
      if (p >= 0.45 && lift >= 1.5 && (!best || lift > best.lift)) best = { k, label, p, lift };
    }
    return best;
  }
  syllables(name) { return (name.toLowerCase().match(/[^aeiouyåäö]*[aeiouyåäö]+/g) || [name.toLowerCase()]); }
  childName(a, b) {
    const r = this.rng, sa = this.syllables(a.name), sb = this.syllables(b.name);
    // ett ljud från en förälder och ett nytt – så att namnen bär släktskap men inte blir likadana
    let n = '';
    for (let tries = 0; tries < 8; tries++) {
      const inh = r.next() < 0.5 ? r.pick(sa) : r.pick(sb), fresh = r.pick(SYL);
      n = (r.next() < 0.5 ? inh + fresh : fresh + inh).slice(0, 8);
      if (!this.creatures.some(o => o.alive && o.name.toLowerCase() === n)) break;
    }
    return n.charAt(0).toUpperCase() + n.slice(1);
  }
  childGenes(a, b) {
    const r = this.rng, g = {}, pick = k => (r.next() < 0.5 ? a[k] : b[k]);
    const mutF = (k, sd, lo, hi) => { g[k] = clamp(pick(k) * Math.exp(r.gauss() * sd), lo, hi); };
    const mutI = (k, lo, hi) => { g[k] = pick(k); if (r.next() < 0.05) g[k] = clamp(g[k] + (r.next() < 0.5 ? -1 : 1), lo, hi); };
    mutF('segL', 0.05, 4, 16); mutF('segH', 0.05, 3, 13); mutF('legL', 0.05, 2.5, 14); mutF('eye', 0.05, 1, 4);
    mutF('explore', 0.08, 0.05, 0.6); mutF('lr', 0.08, 0.0005, 0.03); mutF('maxAge', 0.05, 6 * DAY, 60 * DAY);
    mutI('seg', 1, 5); mutI('legs', 0, 5); mutI('pattern', 0, 2); mutI('hid', 3, 40);
    for (const k of ['ant', 'tail']) { g[k] = pick(k); if (g[k] === 0 && r.next() < 0.03) g[k] = r.range(2, 6); else if (g[k] > 0) { g[k] *= Math.exp(r.gauss() * 0.06); if (r.next() < 0.02) g[k] = 0; } }
    for (const k of ['hue', 'hue2']) g[k] = (pick(k) + r.gauss() * 7 + 360) % 360;
    return g;
  }
  resizeBrain(br, H2) {
    const H = br.H, r = this.rng;
    const wih = new Float32Array(H2 * NI), whh = new Float32Array(H2 * H2), bh = new Float32Array(H2), who = new Float32Array(NO * H2);
    for (let j = 0; j < H2; j++) {
      for (let i = 0; i < NI; i++) wih[j * NI + i] = j < H ? br.wih[j * NI + i] : r.gauss() * 0.15;
      for (let i = 0; i < H2; i++) whh[j * H2 + i] = j < H && i < H ? br.whh[j * H + i] : r.gauss() * 0.05;
      bh[j] = j < H ? br.bh[j] : 0;
      for (let m = 0; m < NO; m++) who[m * H2 + j] = j < H ? br.who[m * H + j] : r.gauss() * 0.05;
    }
    return { H: H2, wih, whh, bh, who, bo: Float32Array.from(br.bo) };
  }
  childBrain(a, b, H2) {
    // barnet ärver föräldrarnas MEDFÖDDA hjärnor – det de lärt sig under livet ärvs inte
    const r = this.rng;
    let br;
    if (a.H === b.H) {
      const H = a.H; br = { H, wih: new Float32Array(H * NI), whh: new Float32Array(H * H), bh: new Float32Array(H), who: new Float32Array(NO * H), bo: new Float32Array(NO) };
      for (let j = 0; j < H; j++) {
        const s = r.next() < 0.5 ? a : b;
        for (let i = 0; i < NI; i++) br.wih[j * NI + i] = s.wih[j * NI + i];
        for (let i = 0; i < H; i++) br.whh[j * H + i] = s.whh[j * H + i];
        br.bh[j] = s.bh[j];
        for (let m = 0; m < NO; m++) br.who[m * H + j] = s.who[m * H + j];
      }
      for (let m = 0; m < NO; m++) br.bo[m] = (r.next() < 0.5 ? a : b).bo[m];
    } else { const s = r.next() < 0.5 ? a : b; br = { H: s.H, wih: Float32Array.from(s.wih), whh: Float32Array.from(s.whh), bh: Float32Array.from(s.bh), who: Float32Array.from(s.who), bo: Float32Array.from(s.bo) }; }
    for (const k of ['wih', 'whh', 'bh', 'who', 'bo']) { const w = br[k]; for (let i = 0; i < w.length; i++) if (r.next() < 0.1) w[i] = clamp(w[i] + r.gauss() * 0.15, -4, 4); }
    if (H2 !== br.H) br = this.resizeBrain(br, H2);
    return br;
  }
  birth(a, b) {
    const g = this.childGenes(a.g, b.g), br = this.childBrain(a.br0, b.br0, g.hid);
    g.hid = br.H;
    a.energy -= 35; b.energy -= 35; a.mateCd = b.mateCd = 0.5 * DAY; a.kids++; b.kids++;
    const gen = Math.max(a.gen, b.gen) + 1, x = wrapX(a.x + wrapD(b.x - a.x) / 2);
    const ch = this.makeCreature(this.childName(a, b), x, g, br, gen, [a.id, b.id], { size: 0.5, energy: 50, pnames: [a.name, b.name] });
    ch.y = Math.min(a.y, b.y); ch.face = a.face;
    this.births++; this.aliveCount++;
    if (this.births === 1) this.chron(`Det första barnet i dalens historia är fött: ${ch.name}, barn till ${a.name} och ${b.name}.`, ch);
    else if (gen > this.maxGen) this.chron(`Generation ${gen} är född: ${ch.name}, barn till ${a.name} och ${b.name}.`, ch);
    else if (this.aliveCount <= 12) this.chron(`${ch.name} föds, barn till ${a.name} och ${b.name}.`, ch);
    this.maxGen = Math.max(this.maxGen, gen);
    for (const m of [10, 25, 50, 100]) if (this.aliveCount >= m) this.first('pop' + m, `Nu lever ${m} varelser i dalen.`);
  }
  fmtAge(s) { const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / DAY * 24); return d ? `${d} dagar` + (h ? ` och ${h} timmar` : '') : `${h} timmar`; }

  // ---------- spara / ladda ----------
  toJSON() {
    const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
    const arr = a => Array.from(a, v => Math.round(v * 1e4) / 1e4);
    return {
      v: 2, seed: this.seed, rng: this.rng.s, time: this.time, nextId: this.nextId, firsts: this.firsts, log: this.log, lastDay: this.lastDay, lake: this.lake,
      fert: arr(this.fert), dead: this.dead, maxGen: this.maxGen, births: this.births, popHist: this.popHist, lex: this.lex, ctxTot: this.ctxTot, uttTot: this.uttTot, stats: this.stats,
      tiles: b64(this.tiles), surface: Array.from(this.surface), plants: this.plants,
      creatures: this.creatures.map(c => ({
        id: c.id, name: c.name, gen: c.gen, parents: c.parents, g: c.g, x: c.x, y: c.y, vx: c.vx, vy: c.vy, face: c.face, energy: c.energy, age: c.age, alive: c.alive,
        meals: c.meals, rbar: c.rbar, hs: arr(c.hs), size: c.size, born: c.born, kids: c.kids, mateCd: c.mateCd, flesh: c.flesh, diedAt: c.diedAt, pnames: c.pnames, carry: c.carry, builds: c.builds, spoke: c.spoke,
        br: { H: c.br.H, wih: arr(c.br.wih), whh: arr(c.br.whh), bh: arr(c.br.bh), who: arr(c.br.who), bo: arr(c.br.bo) },
        br0: { H: c.br0.H, wih: arr(c.br0.wih), whh: arr(c.br0.whh), bh: arr(c.br0.bh), who: arr(c.br0.who), bo: arr(c.br0.bo) }
      }))
    };
  }
  static fromJSON(d) {
    const w = new World(d.seed, null);
    w.rng.s = d.rng; w.time = d.time; w.nextId = d.nextId; w.firsts = d.firsts || {}; w.log = d.log || []; w.lastDay = d.lastDay; w.lake = d.lake;
    if (d.fert) w.fert = Float32Array.from(d.fert); w.dead = d.dead || []; w.maxGen = d.maxGen || 1; w.births = d.births || 0; w.popHist = d.popHist || [];
    w.lex = d.lex || {}; w.ctxTot = d.ctxTot || {}; w.uttTot = d.uttTot || 0; w.stats = d.stats || { digs: 0, builds: 0, gifts: 0 };
    const bin = atob(d.tiles); for (let i = 0; i < bin.length; i++) w.tiles[i] = bin.charCodeAt(i);
    w.surface = Int16Array.from(d.surface);
    w.plants = d.plants; w.plantAt = new Array(WW).fill(null); for (const p of w.plants) w.plantAt[p.x] = p;
    const F = a => Float32Array.from(a);
    for (const s of d.creatures) {
      const nid = w.nextId;
      // äldre hjärnor (fas 1–2) hade färre sinnen och handlingar: de nya kopplingarna börjar på noll
      const mig = b => {
        const H = b.H, ni = b.wih.length / H, no = b.bo.length, wih = new Float32Array(H * NI), who = new Float32Array(NO * H), bo = new Float32Array(NO);
        for (let j = 0; j < H; j++) for (let i = 0; i < Math.min(ni, NI); i++) wih[j * NI + i] = b.wih[j * ni + i];
        for (let m = 0; m < Math.min(no, NO); m++) { bo[m] = b.bo[m]; for (let j = 0; j < H; j++) who[m * H + j] = b.who[m * H + j]; }
        return { H, wih, whh: F(b.whh), bh: F(b.bh), who, bo };
      };
      const br = mig(s.br), br0 = s.br0 ? mig(s.br0) : null;
      const c = w.makeCreature(s.name, s.x, s.g, br, s.gen, s.parents, { size: s.size || 1, br0, pnames: s.pnames });
      w.nextId = nid;
      Object.assign(c, { id: s.id, y: s.y, vx: s.vx, vy: s.vy, face: s.face, energy: s.energy, age: s.age, alive: s.alive, meals: s.meals, rbar: s.rbar, hs: F(s.hs),
        born: s.born || 0, kids: s.kids || 0, mateCd: s.mateCd || 0, flesh: s.flesh || 0, diedAt: s.diedAt || 0, carry: s.carry || 0, builds: s.builds || 0, spoke: s.spoke || 0 });
    }
    w.rebuildBins(); w.terrainVersion++;
    return w;
  }
}

if (typeof module !== 'undefined') module.exports = { World, VOX, CTX, MAT, MAXPOP, ADULT, WPX, wrapX, wrapD, wrapT, TS, WW, WH, DAY, DT, T, NI, NO, IN_LABELS, OUT_LABELS, OUT_ACTIVE, RAY_ANGLES, RAY_LEN, hash2, clamp };

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
  'hör vänster', 'hör höger', 'blicken'
];
const OUT_LABELS = ['gå', 'hoppa', 'ät', 'greppa', 'gräv', 'röst', 'tonhöjd', 'para'];
const OUT_ACTIVE = [1, 1, 1, 0, 0, 0, 0, 0]; // vilka utgångar kroppen kan använda i fas 1
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
    // sjön: fyll sänkan med vatten upp till den lägsta kanten
    const lx0 = Math.max(1, lakeX - lakeW), lx1 = Math.min(WW - 2, lakeX + lakeW);
    let rim = Math.min(this.surface[lx0], this.surface[lx1]);
    for (let x = lx0; x <= lx1; x++) for (let y = rim + 1; y < this.surface[x] + 1; y++) if (this.tile(x, y) === T.AIR) this.setTile(x, y, T.WATER);
    for (let x = lx0 - 2; x <= lx1 + 2; x++) {
      const s = this.surface[wrapT(x)];
      if (s > rim) { for (let y = s; y < s + 3; y++) if (this.tile(x, y) !== T.WATER) this.setTile(x, y, T.SAND); }
    }
    this.lake = { x0: lx0, x1: lx1, level: rim + 1 };
    this.terrainVersion++;
  }

  isGrowable(x) {
    x = wrapT(x);
    const s = this.surface[x], t = this.tile(x, s);
    return (t === T.GRASS || t === T.DIRT) && this.tile(x, s - 1) === T.AIR;
  }
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
      p.b += p.grow * light * this.moisture(p.x) * (1 - p.b / p.max) * dt;
      if (p.b > p.max * 0.7 && this.plants.length < 170 && this.rng.next() < 0.0025 * dt) {
        const nx = wrapT(p.x + (this.rng.next() < 0.5 ? -1 : 1) * (1 + this.rng.int(6)));
        if (this.isGrowable(nx) && !this.plantAt[nx]) this.newPlant(nx, p);
      }
    }
  }
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
    return { H, wih: f(H * NI, 0.5), whh: f(H * H, 0.2), bh: f(H, 0.1), who: f(NO * H, 0.5), bo: f(NO, 0.1) };
  }
  bodySize(g) { const L = g.segL * (0.75 * (g.seg - 1) + 1.2); return { w: L * 0.8, h: g.segH + g.legL * 0.85, L }; }
  makeCreature(name, x, g, br, gen, parents) {
    const H = br.H, s = this.bodySize(g);
    const cp = b => ({ H: b.H, wih: Float32Array.from(b.wih), whh: Float32Array.from(b.whh), bh: Float32Array.from(b.bh), who: Float32Array.from(b.who), bo: Float32Array.from(b.bo) });
    const c = { br0: cp(br),
      id: this.nextId++, name, gen: gen || 1, parents: parents || null, g, br,
      x, y: this.surface[wrapT(Math.floor(x / TS))] * TS, vx: 0, vy: 0, face: 1, w: s.w, h: s.h,
      energy: 90, age: 0, alive: true, grounded: false, pain: 0, jumpCd: 0, wall: 0, touch: 0, watched: 0,
      inp: new Float32Array(NI), out: new Float32Array(NO), hs: new Float32Array(H),
      noiseH: new Float32Array(H), noiseO: new Float32Array(NO),
      eih: new Float32Array(H * NI), ehh: new Float32Array(H * H), ebh: new Float32Array(H), eho: new Float32Array(NO * H), ebo: new Float32Array(NO),
      rbar: 0, meals: 0, biteT: 9, eating: 0, walk: 0, blink: 3, lastSeen: 0, rayHit: new Int8Array(RAY_ANGLES.length), rayD: new Float32Array(RAY_ANGLES.length)
    };
    this.creatures.push(c); return c;
  }
  spawnFounders(names, evolved) {
    const mid = WW / 2;
    let xs = [mid - 8, mid + 8].map(x => {
      let tx = Math.round(x);
      for (let k = 0; k < WW; k++) { const a = tx + (k % 2 ? k : -k) * 1; if (this.tile(a, this.surface[a] - 1) === T.AIR && this.tile(a, this.surface[a]) !== T.WATER && !(this.lake && a >= this.lake.x0 - 2 && a <= this.lake.x1 + 2)) { tx = a; break; } }
      return tx * TS + TS / 2;
    });
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
  first(key, msg, c) { if (this.firsts[key]) return; this.firsts[key] = this.time; this.chron(msg, c); }

  // ---------- sinnen ----------
  sense(c) {
    const inp = c.inp, ex = c.x + c.face * c.w * 0.4, ey = c.y - c.h * 0.8;
    for (let k = 0; k < RAY_ANGLES.length; k++) {
      const a = RAY_ANGLES[k], dx = Math.cos(a) * c.face, dy = Math.sin(a);
      let hit = 0, d = RAY_LEN;
      for (let s = 5; s <= RAY_LEN; s += 5) {
        const px = ex + dx * s, py = ey + dy * s;
        if (this.solidAt(px, py)) { hit = 1; d = s; break; }
        const col = wrapT(Math.floor(px / TS)), p = this.plantAt[col];
        if (p && p.b > 0.5) { const base = this.surface[col] * TS; if (py <= base && py >= base - this.plantHeight(p)) { hit = 2; d = s; break; } }
        let found = false;
        for (const o of this.creatures) { if (o === c || !o.alive) continue; if (Math.abs(wrapD(px - o.x)) < o.w / 2 && py > o.y - o.h && py < o.y) { found = true; break; } }
        if (found) { hit = 3; d = s; break; }
      }
      c.rayHit[k] = hit; c.rayD[k] = d;
      inp[k * 3] = hit ? 1 - d / RAY_LEN : 0; inp[k * 3 + 1] = hit === 2 ? 1 : 0; inp[k * 3 + 2] = hit === 3 ? 1 : 0;
      if (hit === 3) this.sawOther(c);
    }
    inp[15] = c.touch; inp[16] = c.grounded ? 1 : 0; inp[17] = c.wall; inp[18] = clamp(c.energy / 120, 0, 1);
    inp[19] = c.pain; inp[20] = this.lightAt(c.x, c.y - c.h / 2); inp[21] = 0; inp[22] = 0; inp[23] = c.watched;
  }
  sawOther(c) { const o = this.creatures.find(z => z !== c && z.alive); if (o) this.first('saw' + c.id, `${c.name} får syn på ${o.name} för första gången.`, c); }

  // ---------- hjärnan: tänker och lär sig av belöning ----------
  think(c, reward) {
    const br = c.br, H = br.H, x = c.inp, hp = c.hs, r = this.rng;
    const lam = Math.exp(-DT / 1.0), nd = Math.exp(-DT / 0.5), ns = Math.sqrt(1 - nd * nd), sig = c.g.explore;
    // lärande: belöning jämfört med vad den brukar få
    const rate = reward / DT; const adv = rate - c.rbar; c.rbar += (rate - c.rbar) * DT / 20;
    const k = c.g.lr * adv * DT;
    // Inlärda ändringar bleknar långsamt tillbaka mot det medfödda (minnen som inte förstärks glöms).
    const fade = DT / 3000, b0 = c.br0;
    for (let i = 0; i < br.wih.length; i++) br.wih[i] = clamp(br.wih[i] + k * c.eih[i] - fade * (br.wih[i] - b0.wih[i]), -4, 4);
    for (let i = 0; i < br.whh.length; i++) br.whh[i] = clamp(br.whh[i] + k * c.ehh[i] - fade * (br.whh[i] - b0.whh[i]), -4, 4);
    for (let i = 0; i < H; i++) br.bh[i] = clamp(br.bh[i] + k * c.ebh[i] - fade * (br.bh[i] - b0.bh[i]), -4, 4);
    for (let i = 0; i < br.who.length; i++) br.who[i] = clamp(br.who[i] + k * c.eho[i] - fade * (br.who[i] - b0.who[i]), -4, 4);
    for (let i = 0; i < NO; i++) br.bo[i] = clamp(br.bo[i] + k * c.ebo[i] - fade * (br.bo[i] - b0.bo[i]), -4, 4);
    // framåt: dolda neuroner med minne (återkoppling) och lite utforskande brus
    const hn = new Float32Array(H);
    for (let j = 0; j < H; j++) {
      let z = br.bh[j];
      for (let i = 0; i < NI; i++) z += br.wih[j * NI + i] * x[i];
      for (let i = 0; i < H; i++) z += br.whh[j * H + i] * hp[i];
      c.noiseH[j] = c.noiseH[j] * nd + ns * sig * r.gauss();
      const mean = Math.tanh(z), v = Math.tanh(z + c.noiseH[j]), dv = v - mean;
      hn[j] = v;
      for (let i = 0; i < NI; i++) c.eih[j * NI + i] = c.eih[j * NI + i] * lam + dv * x[i];
      for (let i = 0; i < H; i++) c.ehh[j * H + i] = c.ehh[j * H + i] * lam + dv * hp[i];
      c.ebh[j] = c.ebh[j] * lam + dv;
    }
    for (let m = 0; m < NO; m++) {
      let z = br.bo[m];
      for (let j = 0; j < H; j++) z += br.who[m * H + j] * hn[j];
      c.noiseO[m] = c.noiseO[m] * nd + ns * sig * r.gauss();
      const mean = Math.tanh(z), v = Math.tanh(z + c.noiseO[m]), dv = v - mean;
      c.out[m] = v;
      for (let j = 0; j < H; j++) c.eho[m * H + j] = c.eho[m * H + j] * lam + dv * hn[j];
      c.ebo[m] = c.ebo[m] * lam + dv;
    }
    c.hs = hn;
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
    if (p && p.b > 0.3) { const base = this.surface[col] * TS; if (c.y > base - this.plantHeight(p) - 2 && c.y - c.h < base + 2 && Math.abs(c.y - base) < TS * 1.6) c.touch = 1; }
    if (c.out[2] > 0) {
      c.energy -= 0.01 * dt;
      if (c.touch && c.energy < 120) {
        const bite = Math.min(p.b - 0.2, 3 * dt), gain = Math.min(bite * 1.6, 120 - c.energy);
        p.b -= bite; c.energy += gain; c.gain += gain; c.eating = 1;
        if (c.biteT > 1.5) { c.meals++; if (c.meals === 1) this.chron(`${c.name} äter för första gången.`, c); }
        c.biteT = 0;
      }
    }
    c.biteT += dt;
    // ämnesomsättning: allt kostar
    const metab = 0.02 + 0.0015 * c.w + 0.0004 * c.br.H + Math.abs(c.vx) * 0.0006;
    c.energy -= metab * dt;
    c.pain *= 1 - dt * 0.8;
    c.walk += Math.abs(c.vx) * dt * 0.28;
    c.age += dt;
    return reward;
  }

  step() {
    this.time += DT;
    this.wind = Math.sin(this.time * 0.05) * 0.6 + Math.sin(this.time * 0.013) * 0.4;
    this.plantAcc += DT; if (this.plantAcc >= 1) { this.updatePlants(this.plantAcc); this.plantAcc = 0; }
    for (const c of this.creatures) {
      c.px = c.x; c.py = c.y; // förra läget, så att fönstret kan rita mjuka rörelser mellan stegen
      if (!c.alive) continue;
      this.sense(c);
      this.think(c, c.lastReward || 0);
      const e0 = c.energy, p0 = c.pain; c.gain = 0;
      this.body(c);
      // Belöning = kroppens egna signaler: mat smakar gott (bättre ju hungrigare),
      // smärta gör ont, och ansträngning känns lite. Inget beteende är förprogrammerat.
      const hunger = 1 - clamp(c.energy / 120, 0, 1), cost = (c.energy - e0) - c.gain;
      c.lastReward = c.gain * (1 + 2 * hunger) - Math.max(0, c.pain - p0) * 6 + cost * 0.05;
      if (c.energy <= 0) { c.alive = false; this.chron(`${c.name} har somnat in av hunger, ${this.fmtAge(c.age)} gammal.`, c); }
      else if (c.age > c.g.maxAge) { c.alive = false; this.chron(`${c.name} har dött av ålder, ${this.fmtAge(c.age)} gammal.`, c); }
    }
    const [a, b] = this.creatures;
    if (a && b && a.alive && b.alive && Math.abs(wrapD(a.x - b.x)) < (a.w + b.w) / 2 + 4 && Math.abs(a.y - b.y) < 12) this.first('meet', `${a.name} och ${b.name} möts för första gången.`);
    const d = this.dayNumber(); if (d !== this.lastDay) { if (this.lastDay) this.chron(`Dag ${d} gryr i dalen.`); this.lastDay = d; }
  }
  fmtAge(s) { const d = Math.floor(s / DAY), h = Math.floor((s % DAY) / DAY * 24); return d ? `${d} dagar` + (h ? ` och ${h} timmar` : '') : `${h} timmar`; }

  // ---------- spara / ladda ----------
  toJSON() {
    const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
    const arr = a => Array.from(a, v => Math.round(v * 1e4) / 1e4);
    return {
      v: 1, seed: this.seed, rng: this.rng.s, time: this.time, nextId: this.nextId, firsts: this.firsts, log: this.log, lastDay: this.lastDay, lake: this.lake,
      tiles: b64(this.tiles), surface: Array.from(this.surface), plants: this.plants,
      creatures: this.creatures.map(c => ({
        id: c.id, name: c.name, gen: c.gen, parents: c.parents, g: c.g, x: c.x, y: c.y, vx: c.vx, vy: c.vy, face: c.face, energy: c.energy, age: c.age, alive: c.alive,
        meals: c.meals, rbar: c.rbar, hs: arr(c.hs), br: { H: c.br.H, wih: arr(c.br.wih), whh: arr(c.br.whh), bh: arr(c.br.bh), who: arr(c.br.who), bo: arr(c.br.bo) }
      }))
    };
  }
  static fromJSON(d) {
    const w = new World(d.seed, null);
    w.rng.s = d.rng; w.time = d.time; w.nextId = d.nextId; w.firsts = d.firsts || {}; w.log = d.log || []; w.lastDay = d.lastDay; w.lake = d.lake;
    const bin = atob(d.tiles); for (let i = 0; i < bin.length; i++) w.tiles[i] = bin.charCodeAt(i);
    w.surface = Int16Array.from(d.surface);
    w.plants = d.plants; w.plantAt = new Array(WW).fill(null); for (const p of w.plants) w.plantAt[p.x] = p;
    const F = a => Float32Array.from(a);
    for (const s of d.creatures) {
      const br = { H: s.br.H, wih: F(s.br.wih), whh: F(s.br.whh), bh: F(s.br.bh), who: F(s.br.who), bo: F(s.br.bo) };
      const nid = w.nextId;
      const c = w.makeCreature(s.name, s.x, s.g, br, s.gen, s.parents);
      w.nextId = nid;
      Object.assign(c, { id: s.id, y: s.y, vx: s.vx, vy: s.vy, face: s.face, energy: s.energy, age: s.age, alive: s.alive, meals: s.meals, rbar: s.rbar, hs: F(s.hs) });
    }
    w.terrainVersion++;
    return w;
  }
}

if (typeof module !== 'undefined') module.exports = { World, WPX, wrapX, wrapD, wrapT, TS, WW, WH, DAY, DT, T, NI, NO, IN_LABELS, OUT_LABELS, OUT_ACTIVE, RAY_ANGLES, RAY_LEN, hash2, clamp };

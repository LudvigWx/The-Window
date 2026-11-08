'use strict';
// =====================================================================
//  The Window – fönstret. Ritar dalen, växterna och varelserna.
// =====================================================================

class Renderer {
  static COL = { 1: [118, 84, 58], 2: [118, 84, 58], 3: [104, 104, 114], 4: [204, 180, 122], 6: [150, 96, 74] };
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.cam = { x: 0, y: 0, zoom: 2 };
    this.terrain = null; this.terrainVer = -1;
    this.stars = Array.from({ length: 140 }, (_, i) => ({ x: hash2(i, 1), y: hash2(i, 2) * 0.7, s: 0.5 + hash2(i, 3) * 1.4, p: hash2(i, 4) * 6.28 }));
    this.clouds = Array.from({ length: 9 }, (_, i) => ({ x: hash2(i, 11) * 3000, y: 20 + hash2(i, 12) * 110, s: 0.6 + hash2(i, 13) * 1.2 }));
    this.particles = [];
    this.resize();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.cv.width = Math.round(this.W * this.dpr); this.cv.height = Math.round(this.H * this.dpr);
  }
  minZoom() { return Math.min(this.H / (WH * TS), this.W / WPX); }

  // ---------- terräng: målas en gång pixel för pixel ----------
  buildTerrain(world) {
    const pw = WW * TS, ph = WH * TS;
    const c = document.createElement('canvas'); c.width = pw; c.height = ph;
    const g = c.getContext('2d'), img = g.createImageData(pw, ph);
    // avstånd till luft (för att mörka ner djupt under jord)
    const depth = new Uint8Array(WW * WH).fill(255), q = [];
    for (let y = 0; y < WH; y++) for (let x = 0; x < WW; x++) { const t = world.tiles[y * WW + x]; if (t === T.AIR || t === T.WATER) { depth[y * WW + x] = 0; q.push(x, y); } }
    for (let i = 0; i < q.length; i += 2) {
      const x = q[i], y = q[i + 1], dv = depth[y * WW + x];
      if (dv >= 10) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = wrapT(x + dx), ny = y + dy; if (ny < 0 || ny >= WH) continue;
        const k = ny * WW + nx; if (depth[k] > dv + 1) { depth[k] = dv + 1; q.push(nx, ny); }
      }
    }
    for (let ty = 0; ty < WH; ty++) for (let tx = 0; tx < WW; tx++) this.paintTile(world, img.data, tx, ty, depth[ty * WW + tx]);
    g.putImageData(img, 0, 0);
    this.terrain = c; this.tctx = g; this.timg = img; this.terrainVer = world.terrainVersion;
    world.dirty.length = 0;
  }
  paintTile(world, d, tx, ty, dep) {
    const pw = WW * TS, t = world.tiles[ty * WW + tx];
    const COL = Renderer.COL;
    if (t === T.AIR || t === T.WATER) {
      const back = ty > world.surface[tx]; // under ytan: grottans mörka bakvägg, annars genomskinligt
      for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) { const X = tx * TS + px, Y = ty * TS + py, o = (Y * pw + X) * 4; if (back) { const n = (hash2(X, Y) - 0.5) * 10; d[o] = 30 + n; d[o + 1] = 27 + n; d[o + 2] = 34 + n; d[o + 3] = 255; } else d[o + 3] = 0; }
      return;
    }
    const base = COL[t], shade = 1 - Math.min(dep, 10) / 10 * 0.78;
    for (let py = 0; py < TS; py++) for (let px = 0; px < TS; px++) {
      const X = tx * TS + px, Y = ty * TS + py, n = hash2(X, Y);
      let r = base[0], gg = base[1], b = base[2];
      const v = (n - 0.5) * (t === T.STONE ? 26 : 20);
      r += v; gg += v; b += v;
      if (t === T.STONE && hash2(X >> 1, Y >> 1) > 0.92) { r += 22; gg += 22; b += 26; } // ådror
      if ((t === T.DIRT || t === T.GRASS) && hash2(X >> 1, Y >> 1) > 0.95) { r -= 25; gg -= 22; b -= 20; } // småsten
      if (t === T.GRASS && py < 3 - (hash2(X, 99) * 2 | 0)) { r = 72 + v; gg = 140 + v * 1.4; b = 58 + v; }
      const o = (Y * pw + X) * 4; d[o] = r * shade; d[o + 1] = gg * shade; d[o + 2] = b * shade; d[o + 3] = 255;
    }
    // grässtrån upp i luften ovanför
    if (t === T.GRASS && ty > 0 && world.tiles[(ty - 1) * WW + tx] === T.AIR) {
      for (let px = 0; px < TS; px++) {
        const X = tx * TS + px, hgt = (hash2(X, 7) * 4) | 0;
        for (let k = 1; k <= hgt; k++) { const Y = ty * TS - k; if (Y < 0) break; const o = (Y * pw + X) * 4; const gv = 120 + hash2(X, k) * 50; d[o] = 60; d[o + 1] = gv; d[o + 2] = 50; d[o + 3] = 255; }
      }
    }
  }
  localDepth(world, tx, ty) {
    const open = (x, y) => { const t = world.tile(x, y); return t === T.AIR || t === T.WATER; };
    if (open(tx, ty)) return 0;
    for (let r = 1; r <= 10; r++) for (let dx = -r; dx <= r; dx++) { const dy = r - Math.abs(dx); if (open(tx + dx, ty + dy) || open(tx + dx, ty - dy)) return r; }
    return 10;
  }
  // måla bara om de rutor som varelserna har grävt eller byggt i
  repaint(world) {
    const dl = world.dirty; if (!dl.length) return;
    if (dl.length > 600) { this.buildTerrain(world); return; }
    const done = new Set();
    for (let i = 0; i < dl.length; i += 2) {
      const cx = dl[i], cy = dl[i + 1];
      for (let ty = Math.max(0, cy - 2); ty <= Math.min(WH - 1, cy + 2); ty++) for (let k = -2; k <= 2; k++) {
        const tx = wrapT(cx + k), key = ty * WW + tx; if (done.has(key)) continue; done.add(key);
        this.paintTile(world, this.timg.data, tx, ty, this.localDepth(world, tx, ty));
      }
    }
    // lägg tillbaka strån från gräsrutor precis under det omålade området
    for (const key of done) { const tx = key % WW, ty = (key / WW) | 0; if (ty + 1 < WH && !done.has(key + WW) && world.tiles[key + WW] === T.GRASS) this.paintTile(world, this.timg.data, tx, ty + 1, this.localDepth(world, tx, ty + 1)); }
    let x0 = WW, x1 = -1, y0 = WH, y1 = -1;
    for (const key of done) { const tx = key % WW, ty = (key / WW) | 0; x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty + 1); }
    if (x1 - x0 > WW / 2) { x0 = 0; x1 = WW - 1; }
    y0 = Math.max(0, y0 - 1);
    this.tctx.putImageData(this.timg, 0, 0, x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (Math.min(WH, y1 + 1) - y0) * TS);
    dl.length = 0;
  }

  // ---------- himmel ----------
  sky(world) {
    const g = this.g, W = this.W, H = this.H, sh = world.sunHeight(), L = world.daylight();
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const dusk = Math.max(0, 1 - Math.abs(sh) * 3.2);
    let topC = mix([8, 10, 28], [70, 130, 210], L), botC = mix([20, 22, 50], [170, 205, 235], L);
    botC = mix(botC, [240, 140, 90], dusk * 0.7); topC = mix(topC, [90, 70, 130], dusk * 0.4);
    const rain = world.weather ? world.weather.rain : 0;
    if (rain > 0) { const grey = mix([30, 32, 40], [120, 128, 140], L); topC = mix(topC, grey, rain * 0.75); botC = mix(botC, grey, rain * 0.6); }
    const gr = g.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, `rgb(${topC})`); gr.addColorStop(1, `rgb(${botC})`);
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // stjärnor
    const night = 1 - Math.min(1, L * 1.6);
    if (night > 0.02) for (const s of this.stars) {
      const a = night * (0.5 + 0.5 * Math.sin(world.time * 0.7 + s.p));
      g.fillStyle = `rgba(255,255,240,${a})`; g.fillRect(((s.x * W * 1.3 - this.cam.x * 0.02) % W + W) % W, s.y * H, s.s, s.s);
    }
    // sol och måne längs en båge
    const f = world.dayFrac(), ang = (f - 0.25) * 2 * Math.PI;
    const sx = W / 2 - Math.cos(ang) * W * 0.45, sy = H * 0.62 - Math.sin(ang) * H * 0.55;
    if (sh > -0.25) { const glow = g.createRadialGradient(sx, sy, 2, sx, sy, 60); glow.addColorStop(0, 'rgba(255,240,200,0.9)'); glow.addColorStop(0.25, 'rgba(255,215,150,0.35)'); glow.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = glow; g.beginPath(); g.arc(sx, sy, 60, 0, 6.283); g.fill(); g.fillStyle = '#fff4d8'; g.beginPath(); g.arc(sx, sy, 11, 0, 6.283); g.fill(); }
    const mx = W - sx, my = H * 0.62 + Math.sin(ang) * H * 0.55 - H * 0.2;
    if (sh < 0.25) { g.fillStyle = 'rgba(235,235,255,0.85)'; g.beginPath(); g.arc(mx, my, 8, 0, 6.283); g.fill(); g.fillStyle = `rgb(${topC})`; g.beginPath(); g.arc(mx + 3.5, my - 2, 7, 0, 6.283); g.fill(); }
    // moln
    for (const c of this.clouds) {
      const x = ((c.x + world.time * 3 * c.s - this.cam.x * 0.08) % (W + 300) + W + 300) % (W + 300) - 150, y = c.y;
      const a = 0.15 + L * 0.5;
      g.fillStyle = `rgba(${mix([60, 60, 90], [255, 255, 255], L).join(',')},${a})`;
      for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + k * 16 * c.s, y + Math.sin(k * 1.7) * 5, 22 * c.s, 11 * c.s, 0, 0, 6.283); g.fill(); }
    }
    // avlägsna kullar (parallax)
    const hill = (fac, yb, amp, col, sd) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, H);
      for (let x = 0; x <= W + 8; x += 8) { const wx = x + this.cam.x * fac * this.cam.zoom * 0.25; const h = Math.sin(wx * 0.004 + sd) * amp + Math.sin(wx * 0.011 + sd * 2) * amp * 0.4; g.lineTo(x, yb - h - (this.cam.y * this.cam.zoom - H / 2) * fac * 0.3); }
      g.lineTo(W, H); g.fill();
    };
    hill(0.15, H * 0.62, 40, `rgb(${mix([16, 18, 36], [120, 150, 175], L)})`, 1.3);
    hill(0.35, H * 0.7, 30, `rgb(${mix([14, 20, 30], [90, 125, 110], L)})`, 4.1);
  }

  // ---------- världen ----------
  toScreen(wx, wy) { return [this.W / 2 + wrapD(wx - this.cam.x) * this.cam.zoom, this.H / 2 + (wy - this.cam.y) * this.cam.zoom]; }
  ipos(c) { const a = this.alpha; if (c.px === undefined) return [c.x, c.y]; return [c.px + wrapD(c.x - c.px) * a, c.py + (c.y - c.py) * a]; }
  draw(world, sel, rdt, alpha = 1) {
    this.alpha = alpha;
    const g = this.g, z = this.cam.zoom, dpr = this.dpr;
    if (!this.terrain || this.terrainVer !== world.terrainVersion || this.tWorld !== world) { this.buildTerrain(world); this.tWorld = world; }
    else this.repaint(world);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.sky(world);
    const ox = this.W / 2 - this.cam.x * z, oy = this.H / 2 - this.cam.y * z;
    g.setTransform(dpr * z, 0, 0, dpr * z, ox * dpr, oy * dpr);
    g.imageSmoothingEnabled = false;
    const L = world.daylight(), t = world.time;
    // dalen går runt: rita en kopia till vänster och höger
    for (const k of [-1, 0, 1]) {
      const sh = k * WPX;
      if (Math.abs(this.cam.x - (sh + WPX / 2)) > WPX / 2 + this.W / z) continue;
      g.save(); g.translate(sh, 0);
      g.drawImage(this.terrain, 0, 0);
      g.fillStyle = '#07070c'; g.fillRect(0, WH * TS, WPX, 4000);
      const vx0 = Math.floor((this.cam.x - this.W / 2 / z - sh) / TS) - 1, vx1 = Math.ceil((this.cam.x + this.W / 2 / z - sh) / TS) + 1;
      const vy0 = Math.max(0, Math.floor((this.cam.y - this.H / 2 / z) / TS) - 1), vy1 = Math.min(WH - 1, Math.ceil((this.cam.y + this.H / 2 / z) / TS) + 1);
      const tx0 = Math.max(0, vx0), tx1 = Math.min(WW - 1, vx1);
      if (tx0 <= tx1) {
        this.water(world, g, t, L, tx0, tx1, vy0, vy1);
        this.snowCover(world, g, tx0, tx1);
      }
      this.plants(world, g, t);
      this.items(world, g);
      g.restore();
    }
    // varelser (ritas nära kameran, med hänsyn till att dalen går runt)
    for (const c of world.creatures) {
      const [ix, iy] = this.ipos(c), x = this.cam.x + wrapD(ix - this.cam.x);
      if (c.alive) this.creature(c, x, iy, g, t, c === sel); else this.corpse(c, x, iy, g);
    }
    // ljudvågor från den som låter
    for (const sd of world.sounds) {
      const age = world.time - sd.t; if (age > 0.5 || age < 0) continue;
      const x = this.cam.x + wrapD(sd.x - this.cam.x);
      g.strokeStyle = `hsla(${200 + sd.p * 120},80%,75%,${(1 - age / 0.5) * 0.6})`; g.lineWidth = 0.8;
      for (const k of [0, 0.4]) { const r = 3 + (age + k * 0.2) * 55; g.beginPath(); g.arc(x, sd.y, r, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(x, sd.y, r, Math.PI - 0.9, Math.PI + 0.9); g.stroke(); }
    }
    // partiklar
    for (const p of this.particles) { p.x += p.vx * rdt; p.y += p.vy * rdt; p.vy += 120 * rdt; p.life -= rdt; g.fillStyle = `hsla(${p.h},60%,55%,${Math.max(0, p.life)})`; g.fillRect(this.cam.x + wrapD(p.x - this.cam.x), p.y, p.s, p.s); }
    this.particles = this.particles.filter(p => p.life > 0);
    // natt
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // regn och snö
    const rn = world.weather ? world.weather.rain : 0;
    if (rn > 0) {
      const snowing = world.temp < 0, n = Math.floor(rn * (snowing ? 90 : 140)), tt = world.time, W = this.W, H = this.H;
      if (snowing) { g.fillStyle = 'rgba(250,250,255,0.85)'; for (let i = 0; i < n; i++) { const sp = 18 + hash2(i, 3) * 16, x = ((hash2(i, 1) * W + Math.sin(tt * 0.8 + i) * 12 + tt * 6) % W + W) % W, y = ((hash2(i, 2) * H + tt * sp) % H); g.beginPath(); g.arc(x, y, 1 + hash2(i, 4) * 1.4, 0, 6.283); g.fill(); } }
      else { g.strokeStyle = 'rgba(200,215,240,0.45)'; g.lineWidth = 1; g.beginPath(); for (let i = 0; i < n; i++) { const sp = 420 + hash2(i, 3) * 200, x = ((hash2(i, 1) * W - tt * 40) % W + W) % W, y = ((hash2(i, 2) * H + tt * sp) % H); g.moveTo(x, y); g.lineTo(x - 3, y + 12); } g.stroke(); }
    }
    const nightA = (1 - L) * 0.55;
    if (nightA > 0.01) { g.fillStyle = `rgba(6,8,30,${nightA})`; g.fillRect(0, 0, this.W, this.H); }
    // ögon som lyser svagt i mörkret, och namn
    g.setTransform(dpr * z, 0, 0, dpr * z, ox * dpr, oy * dpr);
    if (nightA > 0.15) for (const c of world.creatures) if (c.alive) { const [ix, iy] = this.ipos(c), [ex0, ey0] = this.eyePos(c), ex = ex0 + wrapD(ix - c.x), ey = ey0 + iy - c.y; const x = this.cam.x + wrapD(ex - this.cam.x); g.fillStyle = `rgba(255,240,180,${nightA * 0.8})`; g.beginPath(); g.arc(x, ey, c.g.eye * 0.6, 0, 6.283); g.fill(); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // pratbubblor: det de säger, skrivet som stavelser
    if (this.cam.zoom >= 1.6) for (const c of world.creatures) {
      if (!c.alive || !c.say || world.time - c.say.t > 2.5 || world.time < c.say.t) continue;
      const [ix, iy] = this.ipos(c), [sx, sy] = this.toScreen(ix, iy - c.h - 6);
      if (sx < -80 || sx > this.W + 80) continue;
      const a = Math.min(1, (2.5 - (world.time - c.say.t)) * 2);
      g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center';
      const txt = c.say.txt, tw = g.measureText(txt).width + 14, bx = sx - tw / 2, by = sy - 40;
      g.globalAlpha = a; g.fillStyle = 'rgba(250,247,238,0.94)';
      g.beginPath(); g.moveTo(bx + 8, by); g.arcTo(bx + tw, by, bx + tw, by + 20, 8); g.arcTo(bx + tw, by + 20, bx, by + 20, 8); g.arcTo(bx, by + 20, bx, by, 8); g.arcTo(bx, by, bx + tw, by, 8); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(sx - 4, by + 20); g.lineTo(sx, by + 26); g.lineTo(sx + 4, by + 20); g.fill();
      g.fillStyle = '#2a2236'; g.fillText(txt, sx, by + 14); g.globalAlpha = 1;
    }
    for (const c of world.creatures) {
      if (c !== sel && (!c.alive || this.cam.zoom < 2.6)) continue; // namn bara när man är nära, så att det inte blir rörigt
      const [ix, iy] = this.ipos(c), [sx, sy] = this.toScreen(ix, iy - c.h - 6);
      if (sx < -50 || sx > this.W + 50) continue;
      g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillStyle = c === sel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)';
      g.fillText(c.alive ? c.name : c.name + ' †', sx, sy - 4);
      if (c === sel) { g.beginPath(); g.moveTo(sx - 5, sy + 2); g.lineTo(sx + 5, sy + 2); g.lineTo(sx, sy + 8); g.closePath(); g.fill(); }
    }
  }

  water(world, g, t, L, tx0, tx1, ty0, ty1) {
    const frozen = world.temp < -1;
    for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
      if (world.tiles[ty * WW + tx] !== T.WATER) continue;
      const surf = world.tile(tx, ty - 1) === T.AIR;
      g.fillStyle = frozen && surf ? `rgba(${170 + L * 60},${200 + L * 40},${225 + L * 30},0.85)` : `rgba(${40 + L * 40},${90 + L * 60},${150 + L * 60},0.62)`;
      g.fillRect(tx * TS, ty * TS, TS, TS);
      if (frozen) continue;
      if (surf) { for (let px = 0; px < TS; px++) { const X = tx * TS + px, y = ty * TS + Math.sin(X * 0.25 + t * 1.6) * 0.8; g.fillStyle = `rgba(200,230,255,${0.35 + L * 0.3})`; g.fillRect(X, y, 1, 1); } }
    }
  }

  items(world, g) {
    for (const it of world.items) {
      const n = Math.min(6, 1 + Math.floor(it.f / 1.2)), fresh = Math.min(1, it.f / 4);
      for (let k = 0; k < n; k++) { g.fillStyle = `hsl(${350 - (1 - fresh) * 320},${40 + fresh * 35}%,${35 + fresh * 18}%)`; g.beginPath(); g.arc(it.x + (k % 3 - 1) * 1.6, it.y - 1 - Math.floor(k / 3) * 1.4, 1.1, 0, 6.283); g.fill(); }
    }
  }
  snowCover(world, g, tx0, tx1) {
    if (world.snow < 0.02 && !world.zoneE) return;
    const snowAmt = Math.max(world.snow, world.zoneE ? clamp(-(world.temp - 6) / 10, 0, 0.6) : 0);
    if (snowAmt < 0.02) return;
    g.fillStyle = `rgba(245,248,255,${Math.min(0.95, snowAmt * 1.4)})`;
    for (let tx = tx0; tx <= tx1; tx++) { const y = world.surface[tx] * TS; if (world.tiles[(world.surface[tx] - 1) * WW + tx] !== T.AIR || (world.localTemp && world.localTemp(tx) > 1.5)) continue; g.fillRect(tx * TS, y - 1, TS, 1 + snowAmt * 3 + hash2(tx, 5) * 1.2); }
  }
  plants(world, g, t) {
    const z = this.cam.zoom;
    for (const p of world.plants) {
      const bx = p.x * TS + TS / 2, by = world.surface[p.x] * TS, h = world.plantHeight(p);
      const sway = Math.sin(t * 1.3 + p.x) * (1 + world.wind) * h * 0.06;
      const ripe = p.b / p.max;
      const autumn = clamp((13 - world.temp) / 13, 0, 1), tox = p.tox || 0;
      let hue = p.hue + (35 - p.hue) * autumn * 0.8; hue = hue + (285 - hue) * Math.min(1, tox * 0.9);
      const sat = 45 - autumn * 15;
      g.strokeStyle = `hsl(${hue},${sat}%,${26 + ripe * 8}%)`; g.lineWidth = 1 + p.h * 0.4;
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + sway * 0.3, by - h * 0.6, bx + sway, by - h); g.stroke();
      const n = Math.min(8, 2 + Math.floor(p.b / 3));
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / (n + 1), lx = bx + sway * f * f, ly = by - h * f, side = i % 2 ? 1 : -1;
        g.fillStyle = `hsl(${hue + (i % 3) * 6},${sat + 5 + ripe * 15}%,${30 + f * 14 - tox * 8}%)`;
        g.beginPath(); g.ellipse(lx + side * 3.2, ly, 3.6, 1.6, side * 0.5 + sway * 0.05, 0, 6.283); g.fill();
      }
      if (ripe > 0.6) {
        g.fillStyle = tox > 0.3 ? `hsl(280,70%,${45 + tox * 10}%)` : `hsl(${p.berry},75%,55%)`;
        const k = Math.floor((ripe - 0.6) * 10) + 1;
        for (let i = 0; i < k; i++) { g.beginPath(); g.arc(bx + sway + Math.sin(i * 2.4) * 2.5, by - h + 1 + Math.cos(i * 2.4) * 2, 1.3, 0, 6.283); g.fill(); }
      }
    }
  }

  eyePos(c) { const g = c.g, s = c.size, bodyY = c.y - (g.legL * 0.85 + g.segH / 2) * s, front = ((g.seg - 1) / 2 * g.segL * 0.75 + g.segL * 0.25) * s; return [c.x + c.face * front, bodyY - g.segH * 0.15 * s]; }

  creature(c, x, y, g, t, selected) {
    const G = c.g, legH = G.legL * 0.85, bodyY = -(legH + G.segH / 2), breathe = 1 + Math.sin(t * 2.2 + c.id) * 0.03;
    const moving = Math.min(1, Math.abs(c.vx) / 20), air = !c.grounded;
    g.save(); g.translate(x, y); g.scale(c.face * c.size, c.size);
    // skugga
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(0, 0.5, c.w / c.size * 0.55, 1.5, 0, 0, 6.283); g.fill();
    const col = (l, s = 55) => `hsl(${G.hue},${s}%,${l}%)`, col2 = (l) => `hsl(${G.hue2},55%,${l}%)`;
    const segX = i => (i - (G.seg - 1) / 2) * G.segL * 0.75;
    // ben
    const legsAt = []; for (let k = 0; k < G.legs; k++) legsAt.push(G.legs === 1 ? 0 : (k / (G.legs - 1) - 0.5) * (G.seg * G.segL * 0.6));
    const drawLeg = (lx, ph, back) => {
      const swing = Math.sin(ph) * G.legL * 0.45 * moving, lift = Math.max(0, Math.cos(ph)) * G.legL * 0.35 * moving + (air ? G.legL * 0.25 : 0);
      const hipY = bodyY + G.segH * 0.25, fx = lx + swing, fy = -lift, kx = (lx + fx) / 2 + G.legL * 0.25, ky = (hipY + fy) / 2;
      g.strokeStyle = back ? col(28) : col(36); g.lineWidth = 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(lx, hipY); g.lineTo(kx, ky); g.lineTo(fx, fy); g.stroke();
    };
    legsAt.forEach((lx, k) => drawLeg(lx, c.walk * 2 + k * 2.2 + Math.PI, true));
    // svans
    if (G.tail > 0) { const bx = segX(0) - G.segL * 0.5; g.strokeStyle = col(45); g.lineWidth = 1.8; g.beginPath(); g.moveTo(bx, bodyY); g.quadraticCurveTo(bx - G.tail * 0.6, bodyY - G.tail * 0.2 + Math.sin(t * 3 + c.id) * 2, bx - G.tail, bodyY - G.tail * 0.5 + Math.sin(t * 3 + c.id + 1) * 2.5); g.stroke(); }
    // kropp, segment bakifrån och fram
    for (let i = 0; i < G.seg; i++) {
      const fat = 1 + Math.max(0, c.energy - 120) / 260, sx = segX(i), head = i === G.seg - 1, rx = G.segL * (head ? 0.62 : 0.56) * (head ? 1 : fat), ry = G.segH / 2 * (head ? 1.05 : fat) * breathe;
      const gr = g.createLinearGradient(0, bodyY - ry, 0, bodyY + ry); gr.addColorStop(0, col(64)); gr.addColorStop(1, col(42));
      g.fillStyle = gr; g.beginPath(); g.ellipse(sx, bodyY, rx, ry, 0, 0, 6.283); g.fill();
      if (G.pattern === 1) { g.fillStyle = col2(48); for (let s = -1; s <= 1; s++) g.fillRect(sx + s * rx * 0.45 - 0.6, bodyY - ry * 0.9, 1.2, ry * 1.3); }
      if (G.pattern === 2) { g.fillStyle = col2(55); for (let s = 0; s < 3; s++) { g.beginPath(); g.arc(sx + Math.sin(i * 3 + s * 2) * rx * 0.5, bodyY - ry * 0.3 + Math.cos(s * 2.7) * ry * 0.3, 0.9, 0, 6.283); g.fill(); } }
    }
    if (c.par) { g.fillStyle = 'rgba(190,220,120,0.75)'; for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(segX(i % G.seg) + Math.sin(c.id + i * 2.1) * G.segL * 0.3, bodyY + Math.cos(c.id * 1.7 + i) * G.segH * 0.25, 0.7, 0, 6.283); g.fill(); } } // sjuk: bleka prickar
    legsAt.forEach((lx, k) => drawLeg(lx, c.walk * 2 + k * 2.2, false));
    // huvud: antenner, öga, mun
    const hx = segX(G.seg - 1), hr = G.segL * 0.62;
    if (G.ant > 0) { g.strokeStyle = col(32); g.lineWidth = 0.8; for (const s of [-1, 1]) { const ax = hx + hr * 0.3 + s * 1, ay = bodyY - G.segH * 0.45, w = Math.sin(t * 4 + c.id + s) * 1.5; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(ax + 2 + w, ay - G.ant * 0.6, ax + 3 + w, ay - G.ant); g.stroke(); g.fillStyle = col2(60); g.beginPath(); g.arc(ax + 3 + w, ay - G.ant, 0.9, 0, 6.283); g.fill(); } }
    const ex = hx + hr * 0.35, ey = bodyY - G.segH * 0.15;
    c.blink -= 0.016; if (c.blink < -0.12) c.blink = 2 + hash2(c.id, Math.floor(t)) * 4;
    const open = c.blink < 0 ? 0.15 : 1;
    g.fillStyle = '#fbfaf5'; g.beginPath(); g.ellipse(ex, ey, G.eye, G.eye * open, 0, 0, 6.283); g.fill();
    if (open > 0.5) { g.fillStyle = '#16121c'; g.beginPath(); g.arc(ex + G.eye * 0.35, ey + (c.vy > 50 ? 0.6 : 0), G.eye * 0.5, 0, 6.283); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + G.eye * 0.5, ey - G.eye * 0.25, G.eye * 0.16, 0, 6.283); g.fill(); }
    if (c.carry === 9) { g.fillStyle = 'hsl(350,75%,52%)'; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(hx + hr * 0.95 + (k % 2) * 1.4, bodyY + G.segH * 0.15 + k * 0.7, 1.1, 0, 6.283); g.fill(); } }
    else if (c.carry) { const col = Renderer.COL[c.carry] || [120, 90, 60]; g.fillStyle = `rgb(${col})`; g.fillRect(hx + hr * 0.9, bodyY + G.segH * 0.05, 3.2, 3.2); }
    const mo = c.eating > 0 ? 0.8 + Math.sin(t * 18) * 0.6 : c.say && t - c.say.t < 0.3 ? 1.2 : 0.2;
    g.fillStyle = (G.carn || 0) > 0.25 ? 'hsl(355,55%,28%)' : col(22); g.beginPath(); g.ellipse(hx + hr * 0.85, bodyY + G.segH * 0.18, 1.2, mo, 0, 0, 6.283); g.fill();
    if ((G.carn || 0) > 0.25) { g.fillStyle = '#f4f1e8'; g.fillRect(hx + hr * 0.8, bodyY + G.segH * 0.18 - 0.2, 0.5, 0.9); g.fillRect(hx + hr * 0.95, bodyY + G.segH * 0.18 - 0.2, 0.5, 0.9); }
    g.restore();
    if (c.eating > 0.9 && Math.random() < 0.3) this.particles.push({ x: c.x + c.face * (c.w / 2 + 3), y: c.y - 4, vx: (Math.random() - 0.5) * 20, vy: -20 - Math.random() * 20, life: 0.6, h: 110, s: 1 });
    if (c.grounded && c.prevAir && Math.abs(c.prevVy || 0) > 80) for (let i = 0; i < 4; i++) this.particles.push({ x: c.x + (Math.random() - 0.5) * c.w, y: c.y - 1, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 15, life: 0.5, h: 30, s: 1 });
    c.prevAir = !c.grounded; c.prevVy = c.vy;
  }
  corpse(c, x, y, g) {
    const left = Math.max(0.15, Math.min(1, c.flesh / (25 * c.size)));
    g.save(); g.translate(x, y); g.globalAlpha = 0.3 + 0.4 * left;
    g.fillStyle = `hsl(${c.g.hue},${15 * left}%,${30 + 10 * left}%)`; g.beginPath(); g.ellipse(0, -1.5 * left - 0.5, c.w * 0.5 * (0.5 + 0.5 * left), 2.5 * left + 0.5, 0, 0, 6.283); g.fill();
    g.restore();
  }
}

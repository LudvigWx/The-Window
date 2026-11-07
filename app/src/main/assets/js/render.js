'use strict';
// =====================================================================
//  The Window – fönstret. Ritar dalen, växterna och varelserna.
// =====================================================================

class Renderer {
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
    const g = c.getContext('2d'), img = g.createImageData(pw, ph), d = img.data;
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
    const COL = { 1: [118, 84, 58], 2: [118, 84, 58], 3: [104, 104, 114], 4: [204, 180, 122], 6: [150, 96, 74] };
    for (let ty = 0; ty < WH; ty++) for (let tx = 0; tx < WW; tx++) {
      const t = world.tiles[ty * WW + tx]; if (t === T.AIR || t === T.WATER) continue;
      const base = COL[t], dep = depth[ty * WW + tx], shade = 1 - Math.min(dep, 10) / 10 * 0.78;
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
    g.putImageData(img, 0, 0);
    this.terrain = c; this.terrainVer = world.terrainVersion;
  }

  // ---------- himmel ----------
  sky(world) {
    const g = this.g, W = this.W, H = this.H, sh = world.sunHeight(), L = world.daylight();
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const dusk = Math.max(0, 1 - Math.abs(sh) * 3.2);
    let topC = mix([8, 10, 28], [70, 130, 210], L), botC = mix([20, 22, 50], [170, 205, 235], L);
    botC = mix(botC, [240, 140, 90], dusk * 0.7); topC = mix(topC, [90, 70, 130], dusk * 0.4);
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
    if (!this.terrain || this.terrainVer !== world.terrainVersion) this.buildTerrain(world);
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
      this.water(world, g, t, L);
      this.plants(world, g, t);
      g.restore();
    }
    // varelser (ritas nära kameran, med hänsyn till att dalen går runt)
    for (const c of world.creatures) {
      const [ix, iy] = this.ipos(c), x = this.cam.x + wrapD(ix - this.cam.x);
      if (c.alive) this.creature(c, x, iy, g, t, c === sel); else this.corpse(c, x, iy, g);
    }
    // partiklar
    for (const p of this.particles) { p.x += p.vx * rdt; p.y += p.vy * rdt; p.vy += 120 * rdt; p.life -= rdt; g.fillStyle = `hsla(${p.h},60%,55%,${Math.max(0, p.life)})`; g.fillRect(this.cam.x + wrapD(p.x - this.cam.x), p.y, p.s, p.s); }
    this.particles = this.particles.filter(p => p.life > 0);
    // natt
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const nightA = (1 - L) * 0.55;
    if (nightA > 0.01) { g.fillStyle = `rgba(6,8,30,${nightA})`; g.fillRect(0, 0, this.W, this.H); }
    // ögon som lyser svagt i mörkret, och namn
    g.setTransform(dpr * z, 0, 0, dpr * z, ox * dpr, oy * dpr);
    if (nightA > 0.15) for (const c of world.creatures) if (c.alive) { const [ix, iy] = this.ipos(c), [ex0, ey0] = this.eyePos(c), ex = ex0 + wrapD(ix - c.x), ey = ey0 + iy - c.y; const x = this.cam.x + wrapD(ex - this.cam.x); g.fillStyle = `rgba(255,240,180,${nightA * 0.8})`; g.beginPath(); g.arc(x, ey, c.g.eye * 0.6, 0, 6.283); g.fill(); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of world.creatures) {
      const [ix, iy] = this.ipos(c), [sx, sy] = this.toScreen(ix, iy - c.h - 6);
      if (sx < -50 || sx > this.W + 50) continue;
      g.font = '600 12px system-ui, sans-serif'; g.textAlign = 'center';
      g.fillStyle = c === sel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)';
      g.fillText(c.alive ? c.name : c.name + ' †', sx, sy - 4);
      if (c === sel) { g.beginPath(); g.moveTo(sx - 5, sy + 2); g.lineTo(sx + 5, sy + 2); g.lineTo(sx, sy + 8); g.closePath(); g.fill(); }
    }
  }

  water(world, g, t, L) {
    const lk = world.lake; if (!lk) return;
    for (let tx = lk.x0 - 1; tx <= lk.x1 + 1; tx++) for (let ty = lk.level - 1; ty < WH; ty++) {
      if (world.tile(tx, ty) !== T.WATER) continue;
      const surf = world.tile(tx, ty - 1) === T.AIR;
      g.fillStyle = `rgba(${40 + L * 40},${90 + L * 60},${150 + L * 60},0.62)`;
      g.fillRect(tx * TS, ty * TS, TS, TS);
      if (surf) { for (let px = 0; px < TS; px++) { const X = tx * TS + px, y = ty * TS + Math.sin(X * 0.25 + t * 1.6) * 0.8; g.fillStyle = `rgba(200,230,255,${0.35 + L * 0.3})`; g.fillRect(X, y, 1, 1); } }
    }
  }

  plants(world, g, t) {
    const z = this.cam.zoom;
    for (const p of world.plants) {
      const bx = p.x * TS + TS / 2, by = world.surface[p.x] * TS, h = world.plantHeight(p);
      const sway = Math.sin(t * 1.3 + p.x) * (1 + world.wind) * h * 0.06;
      const ripe = p.b / p.max;
      g.strokeStyle = `hsl(${p.hue},45%,${26 + ripe * 8}%)`; g.lineWidth = 1 + p.h * 0.4;
      g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo(bx + sway * 0.3, by - h * 0.6, bx + sway, by - h); g.stroke();
      const n = Math.min(8, 2 + Math.floor(p.b / 3));
      for (let i = 0; i < n; i++) {
        const f = (i + 1) / (n + 1), lx = bx + sway * f * f, ly = by - h * f, side = i % 2 ? 1 : -1;
        g.fillStyle = `hsl(${p.hue + (i % 3) * 6},${50 + ripe * 15}%,${30 + f * 14}%)`;
        g.beginPath(); g.ellipse(lx + side * 3.2, ly, 3.6, 1.6, side * 0.5 + sway * 0.05, 0, 6.283); g.fill();
      }
      if (ripe > 0.6) {
        g.fillStyle = `hsl(${p.berry},75%,55%)`;
        const k = Math.floor((ripe - 0.6) * 10) + 1;
        for (let i = 0; i < k; i++) { g.beginPath(); g.arc(bx + sway + Math.sin(i * 2.4) * 2.5, by - h + 1 + Math.cos(i * 2.4) * 2, 1.3, 0, 6.283); g.fill(); }
      }
    }
  }

  eyePos(c) { const g = c.g, bodyY = c.y - (g.legL * 0.85 + g.segH / 2), front = (g.seg - 1) / 2 * g.segL * 0.75; return [c.x + c.face * (front + g.segL * 0.25), bodyY - g.segH * 0.15]; }

  creature(c, x, y, g, t, selected) {
    const G = c.g, legH = G.legL * 0.85, bodyY = -(legH + G.segH / 2), breathe = 1 + Math.sin(t * 2.2 + c.id) * 0.03;
    const moving = Math.min(1, Math.abs(c.vx) / 20), air = !c.grounded;
    g.save(); g.translate(x, y); g.scale(c.face, 1);
    // skugga
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.ellipse(0, 0.5, c.w * 0.55, 1.5, 0, 0, 6.283); g.fill();
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
      const sx = segX(i), head = i === G.seg - 1, rx = G.segL * (head ? 0.62 : 0.56), ry = G.segH / 2 * (head ? 1.05 : 1) * breathe;
      const gr = g.createLinearGradient(0, bodyY - ry, 0, bodyY + ry); gr.addColorStop(0, col(64)); gr.addColorStop(1, col(42));
      g.fillStyle = gr; g.beginPath(); g.ellipse(sx, bodyY, rx, ry, 0, 0, 6.283); g.fill();
      if (G.pattern === 1) { g.fillStyle = col2(48); for (let s = -1; s <= 1; s++) g.fillRect(sx + s * rx * 0.45 - 0.6, bodyY - ry * 0.9, 1.2, ry * 1.3); }
      if (G.pattern === 2) { g.fillStyle = col2(55); for (let s = 0; s < 3; s++) { g.beginPath(); g.arc(sx + Math.sin(i * 3 + s * 2) * rx * 0.5, bodyY - ry * 0.3 + Math.cos(s * 2.7) * ry * 0.3, 0.9, 0, 6.283); g.fill(); } }
    }
    legsAt.forEach((lx, k) => drawLeg(lx, c.walk * 2 + k * 2.2, false));
    // huvud: antenner, öga, mun
    const hx = segX(G.seg - 1), hr = G.segL * 0.62;
    if (G.ant > 0) { g.strokeStyle = col(32); g.lineWidth = 0.8; for (const s of [-1, 1]) { const ax = hx + hr * 0.3 + s * 1, ay = bodyY - G.segH * 0.45, w = Math.sin(t * 4 + c.id + s) * 1.5; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(ax + 2 + w, ay - G.ant * 0.6, ax + 3 + w, ay - G.ant); g.stroke(); g.fillStyle = col2(60); g.beginPath(); g.arc(ax + 3 + w, ay - G.ant, 0.9, 0, 6.283); g.fill(); } }
    const ex = hx + hr * 0.35, ey = bodyY - G.segH * 0.15;
    c.blink -= 0.016; if (c.blink < -0.12) c.blink = 2 + hash2(c.id, Math.floor(t)) * 4;
    const open = c.blink < 0 ? 0.15 : 1;
    g.fillStyle = '#fbfaf5'; g.beginPath(); g.ellipse(ex, ey, G.eye, G.eye * open, 0, 0, 6.283); g.fill();
    if (open > 0.5) { g.fillStyle = '#16121c'; g.beginPath(); g.arc(ex + G.eye * 0.35, ey + (c.vy > 50 ? 0.6 : 0), G.eye * 0.5, 0, 6.283); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.arc(ex + G.eye * 0.5, ey - G.eye * 0.25, G.eye * 0.16, 0, 6.283); g.fill(); }
    const mo = c.eating > 0 ? 0.8 + Math.sin(t * 18) * 0.6 : 0.2;
    g.fillStyle = col(22); g.beginPath(); g.ellipse(hx + hr * 0.85, bodyY + G.segH * 0.18, 1.2, mo, 0, 0, 6.283); g.fill();
    g.restore();
    if (c.eating > 0.9 && Math.random() < 0.3) this.particles.push({ x: c.x + c.face * (c.w / 2 + 3), y: c.y - 4, vx: (Math.random() - 0.5) * 20, vy: -20 - Math.random() * 20, life: 0.6, h: 110, s: 1 });
    if (c.grounded && c.prevAir && Math.abs(c.prevVy || 0) > 80) for (let i = 0; i < 4; i++) this.particles.push({ x: c.x + (Math.random() - 0.5) * c.w, y: c.y - 1, vx: (Math.random() - 0.5) * 30, vy: -10 - Math.random() * 15, life: 0.5, h: 30, s: 1 });
    c.prevAir = !c.grounded; c.prevVy = c.vy;
  }
  corpse(c, x, y, g) {
    g.save(); g.translate(x, y); g.globalAlpha = 0.55;
    g.fillStyle = `hsl(${c.g.hue},15%,40%)`; g.beginPath(); g.ellipse(0, -2, c.w * 0.5, 2.5, 0, 0, 6.283); g.fill();
    g.restore();
  }
}

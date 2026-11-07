'use strict';
// =====================================================================
//  The Window – appen runt fönstret: tid, kamera, sparning, gränssnitt.
// =====================================================================
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAX_CATCHUP = 12 * 3600; // räkna ikapp högst 12 timmar

let world = null, ren = null, sel = null, follow = null;
let speed = 1, paused = false, busy = true, simAcc = 0, lastT = performance.now(), effWin = [], pausedAt = 0, showBrain = false;

// ---------- lagring (Android-fil, annars webbläsarens lagring) ----------
const store = {
  load() { try { if (window.Android) return Android.load(); return localStorage.getItem('thewindow') || ''; } catch (e) { return ''; } },
  save(s) { try { if (window.Android) Android.save(s); else localStorage.setItem('thewindow', s); } catch (e) { } },
  wipe() { try { if (window.Android) Android.wipe(); else localStorage.removeItem('thewindow'); } catch (e) { } }
};
function saveWorld() { if (!world || busy) return; const d = world.toJSON(); d.realTime = Date.now(); d.ui = { speedV: +$('#spd').value }; store.save(JSON.stringify(d)); }

function fmtT(t) { const d = Math.floor(t / DAY + 0.25) + 1, m = Math.floor((((t / DAY) + 0.25) % 1) * 1440); return `Dag ${d} · ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function fmtDur(s) { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : m ? `${m} min` : `${Math.round(s)} s`; }

// ---------- uppstart ----------
const NAME_PAIRS = [['Ava', 'Bo'], ['Ilo', 'Mira'], ['Eon', 'Lyra'], ['Nox', 'Sol'], ['Tiv', 'Runa'], ['Oki', 'Ena'], ['Ask', 'Embla']];
function showIntro() {
  busy = true; const p = NAME_PAIRS[Math.floor(Math.random() * NAME_PAIRS.length)];
  $('#n1').value = p[0]; $('#n2').value = p[1];
  $('#overlay').classList.remove('hidden'); ['#ovPre', '#ovCatch'].forEach(s => $(s).classList.add('hidden')); $('#ovIntro').classList.remove('hidden');
}
$('#startBtn').onclick = () => {
  const names = [$('#n1').value.trim() || 'Ava', $('#n2').value.trim() || 'Bo'];
  $('#ovIntro').classList.add('hidden'); $('#ovPre').classList.remove('hidden');
  const seed = (Date.now() ^ (Math.random() * 1e9)) >>> 0, gen = World.prehistory(seed, names);
  const tick = () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 40) {
      const r = gen.next().value;
      if (r.done) { world = r.world; begin(); return; }
      $('#preBar').style.width = (r.frac * 100) + '%'; $('#preTxt').textContent = `Generation ${r.gen} av ${r.gens}`;
    }
    setTimeout(tick, 0);
  };
  setTimeout(tick, 50);
};
function begin() {
  world.onLog = pushFeed;
  sel = follow = world.creatures[0];
  ren.cam.x = world.creatures[0].x; ren.cam.y = world.creatures[0].y - 30; ren.cam.zoom = Math.max(ren.minZoom(), Math.min(4, ren.H / 230));
  buildChips(); busy = false; $('#overlay').classList.add('hidden'); saveWorld(); updCard();
}
function boot() {
  ren = new Renderer($('#cv'));
  const raw = store.load();
  if (raw) {
    try {
      const d = JSON.parse(raw);
      world = World.fromJSON(d);
      if (d.ui && d.ui.speedV) { $('#spd').value = d.ui.speedV; setSpeed(); }
      world.onLog = pushFeed; sel = follow = world.creatures.find(c => c.alive) || world.creatures[0];
      ren.cam.x = follow.x; ren.cam.y = follow.y - 30; ren.cam.zoom = Math.max(ren.minZoom(), Math.min(4, ren.H / 230));
      buildChips(); busy = false; updCard();
      catchUp((Date.now() - (d.realTime || Date.now())) / 1000);
      return;
    } catch (e) { console.error(e); }
  }
  showIntro();
}

// ---------- tiden går även när fönstret är stängt ----------
function catchUp(sec) {
  sec = Math.min(sec, MAX_CATCHUP);
  if (!world || sec < 20) return;
  busy = true;
  const steps = Math.floor(sec / DT), logStart = world.log.length, budget = 45000, tStart = performance.now(); let done = 0, cut = false;
  $('#overlay').classList.remove('hidden'); ['#ovIntro', '#ovPre'].forEach(s => $(s).classList.add('hidden')); $('#ovCatch').classList.remove('hidden');
  $('#catchOk').classList.add('hidden'); $('#catchSum').innerHTML = '';
  $('#catchTxt').textContent = `Det har gått ${fmtDur(sec)} i dalen. Räknar ikapp…`;
  const saveLog = world.onLog; world.onLog = null;
  const tick = () => {
    const t0 = performance.now();
    while (done < steps && performance.now() - t0 < 40) { world.step(); done++; }
    $('#catchBar').style.width = (done / steps * 100) + '%';
    if (done < steps && performance.now() - tStart > budget) cut = true; // telefonen hinner inte allt – resten av tiden sov dalen
    if (done < steps && !cut) { setTimeout(tick, 0); return; }
    world.onLog = saveLog;
    const ev = world.log.slice(logStart);
    $('#catchTxt').textContent = cut ? `Du var borta i ${fmtDur(sec)}. Telefonen hann räkna ${fmtDur(done * DT)} av det – resten av tiden vilade dalen.` : `Det har gått ${fmtDur(sec)} i dalen. Nu är det ${fmtT(world.time).toLowerCase()}.`;
    $('#catchSum').innerHTML = ev.length ? ev.slice(-12).map(l => `<div>${esc(l.msg)}</div>`).join('') : '<div>Inget särskilt hände. De har levt sina liv.</div>';
    $('#catchOk').classList.remove('hidden');
  };
  setTimeout(tick, 30);
}
$('#catchOk').onclick = () => { $('#overlay').classList.add('hidden'); busy = false; saveWorld(); };
window.onAppPause = () => { saveWorld(); pausedAt = Date.now(); };
window.onAppResume = () => { if (pausedAt && !busy) { const s = (Date.now() - pausedAt) / 1000; pausedAt = 0; catchUp(s); } };
document.addEventListener('visibilitychange', () => { if (window.Android) return; if (document.hidden) window.onAppPause(); else window.onAppResume(); });
setInterval(saveWorld, 20000);

// ---------- tidsreglaget ----------
function setSpeed() { const v = +$('#spd').value; speed = Math.pow(2000, v / 100); }
$('#spd').oninput = setSpeed;
$('#pauseBtn').onclick = () => { paused = !paused; $('#pauseBtn').textContent = paused ? '▶' : '⏸'; };

// ---------- huvudloopen ----------
function frame(ts) {
  const rdt = Math.min(0.1, (ts - lastT) / 1000); lastT = ts;
  if (world) {
    let simulated = 0;
    if (!busy && !paused) {
      simAcc += rdt * speed; const t0 = performance.now();
      while (simAcc >= DT) { world.step(); simAcc -= DT; simulated += DT; if (performance.now() - t0 > 14) { simAcc = 0; break; } }
    }
    effWin.push([rdt, simulated]); if (effWin.length > 40) effWin.shift();
    for (const c of world.creatures) c.watched = c === follow ? 1 : 0;
    const alpha = (!busy && !paused) ? clamp(simAcc / DT, 0, 1) : 1;
    ren.alpha = alpha; camera(rdt);
    ren.draw(world, sel, rdt, alpha);
    playVoices();
  }
  requestAnimationFrame(frame);
}
function camera(rdt) {
  const cam = ren.cam;
  if (follow) { const [fx, fy] = ren.ipos(follow); cam.x += wrapD(fx - cam.x) * Math.min(1, rdt * 5); cam.y += (fy - 24 - cam.y) * Math.min(1, rdt * 5); }
  cam.zoom = clamp(cam.zoom, ren.minZoom(), 10);
  cam.x = wrapX(cam.x);
  const half = ren.H / 2 / cam.zoom; cam.y = half * 2 >= WH * TS ? WH * TS * 0.42 : clamp(cam.y, half, WH * TS - half);
}
setInterval(() => {
  if (!world) return;
  const alive = world.creatures.filter(c => c.alive).length;
  const wx = world.weather && world.weather.rain > 0 ? (world.temp < 0 ? ' · snö' : ' · regn') : '';
  $('#clock').innerHTML = `${fmtT(world.time)}<small>${world.season()} ${Math.round(world.temp)}°${wx} · ${alive} lever</small>`;
  if (++chipTick % 8 === 0) refreshChipLabels(alive);
  if (!$('#people').classList.contains('hidden') && chipTick % 4 === 0) renderPeople();
  const rs = effWin.reduce((a, b) => a + b[0], 0), ss = effWin.reduce((a, b) => a + b[1], 0), eff = rs ? ss / rs : 0;
  const f = x => x < 10 ? x.toFixed(1) + '×' : Math.round(x) + '×';
  $('#spdV').textContent = paused ? 'Pausad' : (eff < speed * 0.8 && speed > 2 ? `${f(eff)} (max)` : f(speed));
  updCard(); renderFeed();
  if (!$('#chron').classList.contains('hidden')) renderChron();
  if (!$('#lex').classList.contains('hidden') && chipTick % 8 === 0) renderLex();
  $('#menuStats').textContent = `Dalen har funnits i ${world.fmtAge(world.time)}. ${world.plants.length} växter.`;
}, 250);
function phase() { const s = world.sunHeight(); return s < -0.2 ? 0 : s < 0.2 ? (world.dayFrac() < 0.5 ? 1 : 3) : 2; }

// ---------- kamera: dra, nyp, tryck ----------
const pts = new Map(); let tap = null, pinch = null;
const cv = $('#cv');
cv.addEventListener('pointerdown', e => {
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pts.size === 1) tap = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: ren.cam.zoom }; if (tap) tap.moved = true; }
});
cv.addEventListener('pointermove', e => {
  const p = pts.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
  if (pts.size === 1) {
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) { tap.moved = true; follow = null; refreshChips(); }
    if (tap && tap.moved) { ren.cam.x -= dx / ren.cam.zoom; ren.cam.y -= dy / ren.cam.zoom; }
  } else if (pts.size === 2 && pinch) {
    const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const z0 = ren.cam.zoom, z1 = clamp(pinch.z * d / pinch.d, ren.minZoom(), 10);
    const wx = ren.cam.x + (mx - ren.W / 2) / z0, wy = ren.cam.y + (my - ren.H / 2) / z0;
    ren.cam.zoom = z1; ren.cam.x = wx - (mx - ren.W / 2) / z1; ren.cam.y = wy - (my - ren.H / 2) / z1;
  }
});
const up = e => {
  if (pts.size === 1 && tap && !tap.moved && performance.now() - tap.t < 400) handleTap(e.clientX, e.clientY);
  pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) tap = null;
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); pinch = null; tap = null; });
cv.addEventListener('wheel', e => { e.preventDefault(); ren.cam.zoom = clamp(ren.cam.zoom * Math.exp(-e.deltaY * 0.0015), ren.minZoom(), 10); }, { passive: false });
window.addEventListener('resize', () => ren && ren.resize());
function handleTap(x, y) {
  if (!world) return;
  let best = null, bd = 34;
  for (const c of world.creatures) { const [ix, iy] = ren.ipos(c), [sx, sy] = ren.toScreen(ix, iy - c.h / 2); const d = Math.hypot(sx - x, sy - y); if (d < bd) { bd = d; best = c; } }
  if (best) select(best); else { sel = null; follow = null; $('#card').classList.add('hidden'); refreshChips(); }
}
function select(c) { sel = follow = c; if (ren.cam.zoom < 2) ren.cam.zoom = Math.min(4, ren.H / 230); $('#card').classList.remove('hidden'); closePanels(); refreshChips(); updCard(); }

// ---------- knappar längst ner ----------
let chipTick = 0;
function buildChips() {
  const box = $('#chips'); box.innerHTML = '';
  const all2 = document.createElement('button'); all2.className = 'chip glass'; all2.id = 'peopleChip'; all2.textContent = `👪 Alla (${world.creatures.filter(c => c.alive).length})`;
  all2.onclick = () => { const was = $('#people').classList.contains('hidden'); closePanels(); $('#people').classList.toggle('hidden', !was); if (was) renderPeople(); };
  box.appendChild(all2);
  for (const c of world.creatures.filter(c => c.gen === 1)) { const b = document.createElement('button'); b.className = 'chip glass'; b.dataset.id = c.id; b.innerHTML = `<span class="dot" style="background:hsl(${c.g.hue},55%,55%)"></span>${esc(c.name)}${c.alive ? '' : ' †'}`; b.onclick = () => select(c); box.appendChild(b); }
  const all = document.createElement('button'); all.className = 'chip glass'; all.textContent = '🌄 Översikt';
  all.onclick = () => { follow = null; sel = null; $('#card').classList.add('hidden'); ren.cam.zoom = ren.minZoom(); refreshChips(); };
  box.appendChild(all); refreshChips();
}
function refreshChipLabels(alive) { const b = $('#peopleChip'); if (b) b.textContent = `👪 Alla (${alive})`; }
function closePanels() { ['#chron', '#menu', '#people', '#lex'].forEach(s => $(s).classList.add('hidden')); }
function renderPeople() {
  const al = world.creatures.filter(c => c.alive).sort((a, b) => b.gen - a.gen || a.age - b.age);
  $('#peopleTitle').textContent = `Alla som lever (${al.length}) · generation ${world.maxGen}`;
  $('#peopleList').innerHTML = al.map(c => `<div class="prow" data-id="${c.id}"><span class="dot" style="background:hsl(${c.g.hue},55%,55%)"></span><div><b>${esc(c.name)}</b>${c.size < 1 ? ' · ung' : ''}<div class="meta">Generation ${c.gen} · ${world.fmtAge(c.age)} · ${c.kids} barn${c.pnames ? ' · barn till ' + esc(c.pnames.join(' och ')) : ''}</div></div></div>`).join('') +
    `<p class="meta" style="color:var(--dim);font-size:12px;margin-top:12px">${world.births} har fötts i dalen. ${world.dead.length + world.creatures.filter(c => !c.alive).length} har dött.</p>`;
  document.querySelectorAll('#peopleList .prow').forEach(r => r.onclick = () => { const c = world.creatures.find(z => z.id === +r.dataset.id); if (c) { closePanels(); select(c); } });
}
$('#peopleClose').onclick = () => $('#people').classList.add('hidden');
function refreshChips() { document.querySelectorAll('#chips .chip').forEach(b => b.classList.toggle('on', !!follow && +b.dataset.id === follow.id)); }

// ---------- kortet om en varelse ----------
$('#cClose').onclick = () => { $('#card').classList.add('hidden'); sel = null; follow = null; refreshChips(); };
$('#brainBtn').onclick = () => { showBrain = !showBrain; $('#brainCv').classList.toggle('hidden', !showBrain); $('#brainBtn').textContent = showBrain ? '🧠 Dölj hjärnan' : '🧠 Visa hjärnan'; updCard(); };
function doing(c) { if (!c.alive) return 'Lever inte längre'; if (c.eating > 0.5) return 'Äter'; if (c.digP > 0) return 'Gräver'; if (c.touchW && c.out[2] > 0 && c.hyd < 99) return 'Dricker'; if (c.say && world.time - c.say.t < 0.6) return 'Låter: "' + c.say.txt + '"'; if (c.size < 1 && c.age < 0.05 * DAY) return 'Har precis fötts'; if (world.waterAt(c.x, c.y - c.h * 0.5)) return 'Simmar'; if (!c.grounded) return 'Hoppar'; if (Math.abs(c.vx) > 4) return 'Går'; return 'Står still'; }
function seeing(c) {
  if (!c.alive) return '–'; const h = Array.from(c.rayHit);
  if (h.includes(3)) { const o = world.creatures.find(z => z.id === c.seenId); return o ? o.name : 'en varelse'; }
  if (h.includes(2)) return 'en växt'; if (h.includes(1)) return 'mark och sten'; return 'ingenting särskilt';
}
function updCard() {
  const c = sel; if (!c || $('#card').classList.contains('hidden') || !world) return;
  $('#cName').textContent = c.name + (c.alive ? '' : ' †'); $('#cTag').textContent = (c.gen === 1 ? 'Stamförälder' : 'Generation ' + c.gen) + (c.size < 1 ? ' · ung' : '');
  $('#cEn').style.width = clamp(c.energy / 120 * 100, 0, 100) + '%'; $('#cEnT').textContent = Math.max(0, Math.round(c.energy)) + ' / 120';
  const feel = []; if (c.hyd < 50) feel.push(c.hyd < 15 ? 'mycket törstig' : 'törstig'); if (c.cold > 2) feel.push(c.cold > 6 ? 'fryser mycket' : 'fryser'); if (c.sick > 0.2) feel.push('mår illa'); if (c.energy < 30) feel.push('hungrig');
  const G = c.g;
  $('#cInfo').innerHTML = `Gör just nu: <b>${doing(c)}</b>${feel.length ? ` · Känner sig <b>${feel.join(', ')}</b>` : ''}<br>Ser: <b>${esc(seeing(c))}</b><br>Ålder: <b>${world.fmtAge(c.age)}</b> · Måltider: <b>${c.meals}</b><br>` +
    `Barn: <b>${c.kids}</b>${c.pnames ? ` · Föräldrar: <b>${esc(c.pnames.join(' och '))}</b>` : ''}${c.age < ADULT ? ' · <b>för ung för att få barn</b>' : ''}<br>` +
    [c.say ? `Senast sa: <b>"${esc(c.say.txt)}"</b>` : 'Har aldrig låtit', c.carry ? `Bär: <b>${MAT[c.carry]}</b>` : '', c.builds ? `Har byggt ${c.builds} gånger` : ''].filter(Boolean).join(' · ') + '<br>' +
    `Kropp: ${G.seg} segment, ${G.legs} benpar${G.tail ? ', svans' : ''}${G.ant ? ', antenner' : ''}<br>Hjärna: ${c.br.H} neuroner, lär sig av belöning och smärta`;
  if (showBrain) drawBrain(c);
}
function drawBrain(c) {
  const cv = $('#brainCv'), w = cv.clientWidth || 320, h = cv.clientHeight || 230, d = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * d)) { cv.width = Math.round(w * d); cv.height = Math.round(h * d); }
  const b = cv.getContext('2d'); b.setTransform(d, 0, 0, d, 0, 0); b.clearRect(0, 0, w, h);
  const H = c.br.H, xi = 78, xh = w / 2 + 6, xo = w - 56, yI = i => 8 + i * (h - 16) / (NI - 1), yH = j => 10 + j * (h - 20) / Math.max(1, H - 1), yO = m => 14 + m * (h - 28) / (NO - 1);
  const col = (v, a) => v > 0 ? `rgba(127,209,160,${a})` : `rgba(242,120,140,${a})`;
  b.lineWidth = 0.7;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < NI; i++) { const v = c.br.wih[j * NI + i], a = Math.min(0.55, Math.abs(v * c.inp[i]) / 2); if (a < 0.06) continue; b.strokeStyle = col(v, a); b.beginPath(); b.moveTo(xi, yI(i)); b.lineTo(xh, yH(j)); b.stroke(); }
    for (let m = 0; m < NO; m++) { const v = c.br.who[m * H + j], a = Math.min(0.6, Math.abs(v * c.hs[j]) / 2); if (a < 0.06) continue; b.strokeStyle = col(v, a); b.beginPath(); b.moveTo(xh, yH(j)); b.lineTo(xo, yO(m)); b.stroke(); }
  }
  b.font = '8.5px system-ui, sans-serif';
  for (let i = 0; i < NI; i++) { const v = c.inp[i]; b.fillStyle = `rgba(255,255,255,${0.2 + Math.min(1, Math.abs(v)) * 0.8})`; b.beginPath(); b.arc(xi, yI(i), 2.4, 0, 6.283); b.fill(); b.fillStyle = '#a9a5c2'; b.textAlign = 'right'; b.fillText(IN_LABELS[i], xi - 6, yI(i) + 3); }
  for (let j = 0; j < H; j++) { const v = c.hs[j] || 0; b.fillStyle = col(v, 0.3 + Math.abs(v) * 0.7); b.beginPath(); b.arc(xh, yH(j), 4, 0, 6.283); b.fill(); }
  for (let m = 0; m < NO; m++) { const v = c.out[m], on = OUT_ACTIVE[m]; b.fillStyle = on ? col(v, 0.3 + Math.abs(v) * 0.7) : 'rgba(255,255,255,0.12)'; b.beginPath(); b.arc(xo, yO(m), 3.6, 0, 6.283); b.fill(); b.fillStyle = on ? '#eeeaf7' : '#5e5a78'; b.textAlign = 'left'; b.fillText(OUT_LABELS[m] + (on ? '' : ' (snart)'), xo + 7, yO(m) + 3); }
  b.fillStyle = '#a9a5c2'; b.textAlign = 'center'; b.fillText(`${H} neuroner med minne`, xh, h - 2);
}

// ---------- krönika & flöde ----------
let feed = [];
function pushFeed(l) { feed.push({ msg: l.msg, wall: performance.now() }); if (feed.length > 3) feed.shift(); renderFeed(); }
function renderFeed() { const now = performance.now(); $('#feed').innerHTML = feed.filter(f => now - f.wall < 9000).map(f => `<div class="glass">${esc(f.msg)}</div>`).join(''); }
function renderChron() { $('#chronList').innerHTML = world.log.slice().reverse().map(l => `<div><em>${fmtT(l.t)}</em>${esc(l.msg)}</div>`).join(''); }
$('#chronBtn').onclick = () => { const was = $('#chron').classList.contains('hidden'); closePanels(); $('#chron').classList.toggle('hidden', !was); if (was) renderChron(); };
$('#chronClose').onclick = () => $('#chron').classList.add('hidden');
$('#menuBtn').onclick = () => { const was = $('#menu').classList.contains('hidden'); closePanels(); $('#menu').classList.toggle('hidden', !was); $('#confirmNew').classList.add('hidden'); };
$('#menuClose').onclick = () => $('#menu').classList.add('hidden');
$('#newWorldBtn').onclick = () => $('#confirmNew').classList.remove('hidden');
$('#confirmNo').onclick = () => $('#confirmNew').classList.add('hidden');
$('#confirmYes').onclick = () => { store.wipe(); world = null; sel = follow = null; $('#menu').classList.add('hidden'); $('#card').classList.add('hidden'); $('#chips').innerHTML = ''; showIntro(); };

// ---------- ordboken ----------
function renderLex() {
  const words = Object.entries(world.lex).sort((a, b) => b[1].n - a[1].n);
  const withMeaning = words.filter(([w]) => world.meaning(w));
  let html = `<p>${words.length} olika ljudföljder har hörts, ${world.uttTot} gånger totalt. ${withMeaning.length ? `Översättaren har en gissning för ${withMeaning.length} av dem.` : 'Översättaren har ingen gissning än.'}</p>` +
    `<p style="color:var(--dim);font-size:12px">Gissningarna bygger bara på statistik: ett ord får en betydelse om det sägs i en viss situation mycket oftare än andra ljud. Det betyder inte att de "menar" något – men det är så språk brukar börja.</p>`;
  html += words.slice(0, 50).map(([w, e]) => { const m = world.meaning(w); return `<div><b>"${esc(w)}"</b> · ${e.n} gånger · ${e.sp.length} ${e.sp.length === 1 ? 'talare' : 'talare'}<em>${m ? `Sägs troligen ${m.label} (${Math.round(m.p * 100)} %)` : 'Betydelse okänd'} · först sagt av ${esc(e.by)}</em></div>`; }).join('');
  $('#lexList').innerHTML = html || '<p>Ingen har låtit än.</p>';
}
$('#lexBtn').onclick = () => { const was = $('#lex').classList.contains('hidden'); closePanels(); $('#lex').classList.toggle('hidden', !was); if (was) renderLex(); };
$('#lexClose').onclick = () => $('#lex').classList.add('hidden');

// ---------- ljud: varelsernas röster ----------
let actx = null, soundOn = false, lastSoundT = 0, voiceWin = [];
function setSound(on) {
  soundOn = on; $('#soundBtn').textContent = on ? '🔊' : '🔇';
  if (on) { try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { soundOn = false; } }
  try { localStorage.setItem('thewindow-sound', on ? '1' : '0'); } catch (e) { }
}
$('#soundBtn').onclick = () => setSound(!soundOn);
function voice(sd, pan) {
  const t = actx.currentTime, o = actx.createOscillator(), f = actx.createBiquadFilter(), g = actx.createGain();
  const base = 170 * Math.pow(2, (sd.p + 1) * 1.3) / Math.sqrt(Math.max(0.4, sd.size));
  o.type = 'triangle'; o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * (1.04 + sd.p * 0.03), t + 0.12);
  f.type = 'bandpass'; f.frequency.value = 600 + (sd.timbre / 360) * 1800; f.Q.value = 2.5;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  o.connect(f); f.connect(g);
  if (actx.createStereoPanner) { const p = actx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); g.connect(p); p.connect(actx.destination); } else g.connect(actx.destination);
  o.start(t); o.stop(t + 0.22);
}
function playVoices() {
  if (!world) return;
  if (!soundOn || !actx || busy || paused || speed > 6 || ren.cam.zoom < 1.6) { lastSoundT = world.time; return; }
  const now = performance.now(); voiceWin = voiceWin.filter(x => now - x < 500);
  for (const sd of world.sounds) {
    if (sd.t <= lastSoundT || voiceWin.length >= 10) continue;
    const [sx, sy] = ren.toScreen(sd.x, sd.y); if (sx < -40 || sx > ren.W + 40 || sy < -40 || sy > ren.H + 40) continue;
    voice(sd, sx / ren.W * 2 - 1); voiceWin.push(now);
  }
  lastSoundT = world.time;
}
try { if (localStorage.getItem('thewindow-sound') === '1') setSound(true); } catch (e) { }

boot();
requestAnimationFrame(frame);

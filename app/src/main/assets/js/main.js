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
  wipe() { try { if (window.Android) Android.wipe(); else localStorage.removeItem('thewindow'); } catch (e) { } },
  archSave(id, meta, data) { try { if (window.Android && Android.archiveSave) Android.archiveSave(id, JSON.stringify(meta), data); else { localStorage.setItem('arch:' + id, data); localStorage.setItem('archm:' + id, JSON.stringify(meta)); } return true; } catch (e) { return false; } },
  archList() { try { if (window.Android && Android.archiveList) return JSON.parse(Android.archiveList()); return Object.keys(localStorage).filter(k => k.startsWith('archm:')).map(k => JSON.parse(localStorage.getItem(k))); } catch (e) { return []; } },
  archLoad(id) { try { if (window.Android && Android.archiveLoad) return Android.archiveLoad(id); return localStorage.getItem('arch:' + id) || ''; } catch (e) { return ''; } }
};
// ---------- dalarkivet ----------
let liveWorld = null, liveSel = null;
function archiveWorld(w) {
  if (!w || w.time < DAY) return false;
  const al = w.creatures.filter(c => c.alive).length, f = w.founders || [], peak = (w.hist || []).reduce((a, h) => Math.max(a, h.pop), 0);
  const meta = { id: 'v' + w.seed, name: f.length >= 2 ? `Dalen efter ${f[0].name} och ${f[1].name}` : 'En dal', days: Math.floor(w.time / DAY + 0.25) + 1, gen: w.maxGen, births: w.births, peak, alive: al, saved: Date.now() };
  const d = w.toJSON(); d.archived = true;
  return store.archSave(meta.id, meta, JSON.stringify(d));
}
function renderArch() {
  const L = store.archList().sort((a, b) => b.saved - a.saved);
  $('#archList').innerHTML = L.length ? L.map(m => `<div class="archItem" data-id="${esc(m.id)}"><b>${esc(m.name)}</b><br><small>${m.days} dagar · generation ${m.gen} · ${m.births} födda · som flest ${m.peak} · ${m.alive ? `${m.alive} levde när den sparades` : 'utdöd'} · sparad ${new Date(m.saved).toLocaleDateString('sv-SE')}</small></div>`).join('') : '<p style="color:var(--dim)">Arkivet är tomt än.</p>';
  for (const el of document.querySelectorAll('.archItem')) el.onclick = () => openArchive(el.dataset.id, el.querySelector('b').textContent);
}
function openArchive(id, name) {
  const raw = store.archLoad(id); if (!raw) return;
  let w; try { w = World.fromJSON(JSON.parse(raw)); } catch (e) { return; }
  if (!liveWorld) { liveWorld = world; liveSel = sel; }
  saveWorld(); world = w; world.onLog = null; paused = true; $('#pauseBtn').textContent = '▶';
  sel = follow = null; closePanels(); $('#card').classList.add('hidden');
  const c = w.creatures.find(c => c.alive) || w.creatures[w.creatures.length - 1]; if (c) { ren.cam.x = c.x; ren.cam.y = c.y - 30; }
  $('#archBannerTxt').textContent = `📚 ${name} – dag ${Math.floor(w.time / DAY + 0.25) + 1}`; $('#archBanner').classList.remove('hidden');
  buildChips();
}
function closeArchive() {
  if (!liveWorld) return;
  world = liveWorld; liveWorld = null; sel = follow = liveSel; liveSel = null; world.onLog = pushFeed;
  $('#archBanner').classList.add('hidden'); closePanels(); $('#card').classList.add('hidden'); buildChips();
}
function saveWorld() { const W0 = liveWorld || world; if (!W0 || busy) return; const d = W0.toJSON(); d.realTime = Date.now(); d.ui = { speedV: +$('#spd').value }; store.save(JSON.stringify(d)); }

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
    const ev = world.log.slice(logStart), hs = world.hist.filter(h => h.t > world.time - done * DT);
    let born = 0, died = {}, peak = 0; for (const h of hs) { born += h.births; peak = Math.max(peak, h.pop); for (const k in h.deaths) died[k] = (died[k] || 0) + h.deaths[k]; }
    const dsum = Object.values(died).reduce((a, b) => a + b, 0);
    const story = hs.length ? [`${born} föddes och ${dsum} dog${dsum ? ` (${Object.entries(died).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v} av ${CAUSE_SV[k] || k}`).join(', ')})` : ''}.`, `Som flest levde ${peak} samtidigt. Nu lever ${world.creatures.filter(c => c.alive).length}.`] : [];
    if (hs.length > 2) { $('#catchSpark').classList.remove('hidden'); spark($('#catchSpark'), hs.map(h => h.pop)); } else $('#catchSpark').classList.add('hidden');
    $('#catchTxt').textContent = cut ? `Du var borta i ${fmtDur(sec)}. Telefonen hann räkna ${fmtDur(done * DT)} av det – resten av tiden vilade dalen.` : `Det har gått ${fmtDur(sec)} i dalen. Nu är det ${fmtT(world.time).toLowerCase()}.`;
    $('#catchSum').innerHTML = story.map(s => `<div><b>${esc(s)}</b></div>`).join('') + (ev.length ? ev.slice(-12).map(l => `<div>${esc(l.msg)}</div>`).join('') : '<div>Inget särskilt hände. De har levt sina liv.</div>');
    $('#catchOk').classList.remove('hidden');
  };
  setTimeout(tick, 30);
}
$('#catchOk').onclick = () => { $('#overlay').classList.add('hidden'); busy = false; saveWorld(); };
window.onAppPause = () => { saveWorld(); pausedAt = Date.now(); };
window.onAppResume = () => { if (pausedAt && !busy) { if (liveWorld) closeArchive(); const s = (Date.now() - pausedAt) / 1000; pausedAt = 0; catchUp(s); } };
document.addEventListener('visibilitychange', () => { if (window.Android) return; if (document.hidden) window.onAppPause(); else window.onAppResume(); });
setInterval(saveWorld, 20000);

// ---------- tidsreglaget ----------
function setSpeed() { const v = +$('#spd').value; speed = Math.pow(2000, v / 100); }
$('#spd').oninput = setSpeed;
$('#pauseBtn').onclick = () => { if (liveWorld) return; paused = !paused; $('#pauseBtn').textContent = paused ? '▶' : '⏸'; };

// ---------- huvudloopen ----------
function frame(ts) {
  const rdt = Math.min(0.1, (ts - lastT) / 1000); lastT = ts;
  if (world) {
    let simulated = 0;
    if (!busy && !paused) {
      simAcc += rdt * speed; const t0 = performance.now();
      while (simAcc >= DT) { world.step(); simAcc -= DT; simulated += DT; if (performance.now() - t0 > (speed > 30 ? 26 : 14)) { simAcc = 0; break; } } // på hög fart får simuleringen mer av varje bildruta
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
  $('#extinct').classList.toggle('hidden', !(alive === 0 && !busy && $('#card').classList.contains('hidden') && $('#menu').classList.contains('hidden') && $('#chron').classList.contains('hidden') && $('#lex').classList.contains('hidden')));
  if (!$('#people').classList.contains('hidden') && chipTick % 4 === 0) renderPeople();
  const rs = effWin.reduce((a, b) => a + b[0], 0), ss = effWin.reduce((a, b) => a + b[1], 0), eff = rs ? ss / rs : 0;
  const f = x => x < 10 ? x.toFixed(1) + '×' : Math.round(x) + '×';
  $('#spdV').textContent = paused ? 'Pausad' : (eff < speed * 0.8 && speed > 2 ? `${f(eff)} (max)` : f(speed));
  updCard(); renderFeed();
  if (!$('#chron').classList.contains('hidden')) renderChron();
  if (!$('#lex').classList.contains('hidden') && chipTick % 8 === 0) renderLex();
  if (!$('#histP').classList.contains('hidden') && chipTick % 20 === 0) renderHist();
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
  const hb = document.createElement('button'); hb.className = 'chip glass'; hb.textContent = '📈 Historia';
  hb.onclick = () => { const was = $('#histP').classList.contains('hidden'); closePanels(); $('#histP').classList.toggle('hidden', !was); if (was) renderHist(); };
  box.appendChild(hb);
  const all = document.createElement('button'); all.className = 'chip glass'; all.textContent = '🌄 Översikt';
  all.onclick = () => { follow = null; sel = null; $('#card').classList.add('hidden'); ren.cam.zoom = ren.minZoom(); refreshChips(); };
  box.appendChild(all); refreshChips();
}
function refreshChipLabels(alive) {
  const b = $('#peopleChip'); if (b) b.textContent = `👪 Alla (${alive})`;
  // stamföräldrarnas knappar: markera de döda med † och ta bort dem som inte längre finns i dalen
  document.querySelectorAll('#chips .chip[data-id]').forEach(ch => { const c = world.creatures.find(z => z.id === +ch.dataset.id); if (!c) ch.remove(); else if (!c.alive && !ch.textContent.includes('†')) ch.innerHTML += ' †'; });
}
function closePanels() { ['#chron', '#menu', '#people', '#lex', '#histP', '#arch'].forEach(s => $(s).classList.add('hidden')); }
function renderPeople() {
  const al = world.creatures.filter(c => c.alive).sort((a, b) => b.gen - a.gen || a.age - b.age);
  $('#peopleTitle').textContent = `Alla som lever (${al.length}) · generation ${world.maxGen}`;
  $('#peopleList').innerHTML = al.map(c => `<div class="prow" data-id="${c.id}"><span class="dot" style="background:hsl(${c.g.hue},55%,55%)"></span><div><b>${esc(c.name)}</b>${c.size < 1 ? ' · ung' : ''}<div class="meta">${c.sp && world.species.length > 1 && world.species.find(s => s.id === c.sp) ? esc(world.species.find(s => s.id === c.sp).name) + ' · ' : ''}Generation ${c.gen} · ${world.fmtAge(c.age)} · ${c.kids} barn${c.pnames ? ' · barn till ' + esc(c.pnames.join(' och ')) : ''}</div></div></div>`).join('') +
    `<p class="meta" style="color:var(--dim);font-size:12px;margin-top:12px">${world.births} har fötts i dalen. ${world.dead.length + world.creatures.filter(c => !c.alive).length} har dött.</p>`;
  document.querySelectorAll('#peopleList .prow').forEach(r => r.onclick = () => { const c = world.creatures.find(z => z.id === +r.dataset.id); if (c) { closePanels(); select(c); } });
}
$('#peopleClose').onclick = () => $('#people').classList.add('hidden');
function refreshChips() { document.querySelectorAll('#chips .chip').forEach(b => b.classList.toggle('on', !!follow && +b.dataset.id === follow.id)); }

// ---------- kortet om en varelse ----------
$('#cClose').onclick = () => { $('#card').classList.add('hidden'); sel = null; follow = null; refreshChips(); };
let showKin = false;
$('#kinBtn').onclick = () => { showKin = !showKin; $('#kin').classList.toggle('hidden', !showKin); updCard(); };
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
  $('#cEn').style.width = clamp(c.energy / EMAX * 100, 0, 100) + '%'; $('#cEnT').textContent = Math.max(0, Math.round(c.energy)) + (c.energy > 120 ? ' (fettreserv)' : '') + ' / ' + EMAX;
  const feel = []; if (c.hyd < 50) feel.push(c.hyd < 15 ? 'mycket törstig' : 'törstig'); if (c.cold > 2) feel.push(c.cold > 6 ? 'fryser mycket' : 'fryser'); if (c.sick > 0.2) feel.push('mår illa'); if (c.energy < 30) feel.push('hungrig');
  const G = c.g;
  $('#cInfo').innerHTML = `Gör just nu: <b>${doing(c)}</b>${feel.length ? ` · Känner sig <b>${feel.join(', ')}</b>` : ''}<br>Ser: <b>${esc(seeing(c))}</b><br>Ålder: <b>${world.fmtAge(c.age)}</b> · Måltider: <b>${c.meals}</b><br>` +
    `Barn: <b>${c.kids}</b>${c.pnames ? ` · Föräldrar: <b>${esc(c.pnames.join(' och '))}</b>` : ''}${c.age < ADULT ? ' · <b>för ung för att få barn</b>' : ''}<br>` +
    [c.say ? `Senast sa: <b>"${esc(c.say.txt)}"</b>` : 'Har aldrig låtit', c.carry ? `Bär: <b>${MAT[c.carry]}</b>` : '', c.builds ? `Har byggt ${c.builds} gånger` : ''].filter(Boolean).join(' · ') + '<br>' +
    `Plats: ${world.zoneName(Math.floor(c.x / TS))} · Kost: ${(G.carn || 0) > 0.6 ? 'köttätare' : (G.carn || 0) > 0.25 ? 'allätare (kan jaga)' : 'växtätare'}${c.sp && world.species.find(s => s.id === c.sp) ? ` · Art: <b>${esc(world.species.find(s => s.id === c.sp).name)}</b>` : ''}<br>` +
    `Kropp: ${G.seg} segment, ${G.legs} benpar${G.tail ? ', svans' : ''}${G.ant ? ', antenner' : ''}<br>Hjärna: ${c.br.H} neuroner, lär sig av belöning och smärta${c.par ? `<br>🤒 Sjuk (sjukdom nr ${c.par.id}, farlighet ${Math.round(c.par.v * 100)} %)` : ''}`;
  if (showBrain) drawBrain(c);
  if (showKin && kinTick++ % 8 === 0) renderKin(c);
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
$('#archBtn').onclick = () => { closePanels(); $('#arch').classList.remove('hidden'); renderArch(); };
$('#archClose').onclick = () => $('#arch').classList.add('hidden');
$('#archBack').onclick = closeArchive;
$('#archSaveNow').onclick = () => { const w = liveWorld || world; const ok = archiveWorld(w); $('#archSaveNow').textContent = ok ? '✅ Sparad i arkivet' : 'Dalen är för ung för arkivet'; renderArch(); setTimeout(() => $('#archSaveNow').textContent = '📥 Spara den här dalen i arkivet nu', 2500); };
$('#newWorldBtn').onclick = () => $('#confirmNew').classList.remove('hidden');
$('#extinctNew').onclick = () => { closePanels(); $('#menu').classList.remove('hidden'); $('#confirmNew').classList.remove('hidden'); };
$('#confirmNo').onclick = () => $('#confirmNew').classList.add('hidden');
$('#confirmYes').onclick = () => { if (liveWorld) closeArchive(); archiveWorld(world); store.wipe(); world = null; sel = follow = null; $('#menu').classList.add('hidden'); $('#card').classList.add('hidden'); $('#chips').innerHTML = ''; showIntro(); };

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

// ---------- historia: grafer ----------
const CAUSE_SV = { hunger: 'hunger', thirst: 'törst', cold: 'kyla', age: 'ålder', poison: 'gift', disease: 'sjukdom', meteor: 'meteorit', kicked: 'uroxe', eaten: 'rovdjur', other: 'okänt' };
let histTab = 'pop', kinTick = 0;
document.querySelectorAll('#histTabs button').forEach(b => b.onclick = () => { histTab = b.dataset.t; document.querySelectorAll('#histTabs button').forEach(x => x.classList.toggle('on', x === b)); renderHist(); });
$('#histClose').onclick = () => $('#histP').classList.add('hidden');
function spark(cv, vals) {
  const w = cv.clientWidth || 300, h = cv.clientHeight || 60, d = window.devicePixelRatio || 1; cv.width = w * d; cv.height = h * d;
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
  const mx = Math.max(1, ...vals); g.strokeStyle = '#f2b76b'; g.lineWidth = 2; g.beginPath();
  vals.forEach((v, i) => { const x = i / Math.max(1, vals.length - 1) * w, y = h - 4 - v / mx * (h - 10); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
}
// en linjegraf: flera serier på samma skala, tid i dygn längs x
function lineChart(id, series, opt = {}) {
  const cv = document.getElementById(id); if (!cv) return;
  const w = cv.clientWidth || 320, h = cv.clientHeight || 150, d = window.devicePixelRatio || 1; cv.width = w * d; cv.height = h * d;
  const g = cv.getContext('2d'); g.setTransform(d, 0, 0, d, 0, 0); g.clearRect(0, 0, w, h);
  const H = world.hist; if (H.length < 2) { g.fillStyle = '#a9a5c2'; g.font = '12px system-ui'; g.fillText('Samlar data… (en mätpunkt var sjätte timme i dalen)', 4, h / 2); return; }
  const t0 = H[0].t, t1 = H[H.length - 1].t, L = 30, R = 8, T = 8, B = 18, pw = w - L - R, ph = h - T - B;
  let lo = opt.min ?? Infinity, hi = -Infinity;
  for (const s of series) for (const p of H) { const v = s.f(p); if (v == null) continue; if (opt.min == null) lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (!isFinite(hi)) return; if (hi === lo) hi = lo + 1; if (opt.min == null && lo > 0) lo = 0;
  const X = t => L + (t - t0) / Math.max(1, t1 - t0) * pw, Y = v => T + ph - (v - lo) / (hi - lo) * ph;
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.font = '10px system-ui'; g.fillStyle = '#8f8aa9'; g.textAlign = 'right';
  for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); g.beginPath(); g.moveTo(L, y); g.lineTo(w - R, y); g.stroke(); g.fillText(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10, L - 4, y + 3); }
  if (lo < 0 && hi > 0) { g.strokeStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.moveTo(L, Y(0)); g.lineTo(w - R, Y(0)); g.stroke(); }
  g.textAlign = 'center'; const days = (t1 - t0) / DAY, step = Math.max(1, Math.ceil(days / 5));
  for (let dd = Math.ceil(t0 / DAY); dd <= t1 / DAY; dd += step) g.fillText('dag ' + (dd + 1), X(dd * DAY), h - 4);
  // årstider som svaga band i bakgrunden
  for (let y0 = Math.floor(t0 / YEAR) * YEAR; y0 < t1; y0 += YEAR) { const a = Math.max(t0, y0 + YEAR * 0.625), b = Math.min(t1, y0 + YEAR * 0.875); if (b > a) { g.fillStyle = 'rgba(160,190,255,0.07)'; g.fillRect(X(a), T, X(b) - X(a), ph); } }
  for (const s of series) {
    g.strokeStyle = s.c; g.lineWidth = s.w || 1.8; g.beginPath(); let on = false;
    for (const p of H) { const v = s.f(p); if (v == null) { on = false; continue; } const x = X(p.t), y = Y(v); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; }
    g.stroke();
  }
}
function legend(series) { return `<div class="legend">${series.map(s => `<span><i style="background:${s.c}"></i>${s.n}</span>`).join('')}</div>`; }
const sumD = p => Object.values(p.deaths || {}).reduce((a, b) => a + b, 0);
function renderHist() {
  if (!world) return;
  const B = $('#histBody'), H = world.hist;
  let html = '', charts = [];
  const add = (title, id, series, opt, note) => { html += `<div class="ctitle">${title}</div><canvas class="chart" id="${id}"></canvas>${legend(series)}${note ? `<p style="color:var(--dim);font-size:12px;margin-top:-6px">${note}</p>` : ''}`; charts.push([id, series, opt]); };
  if (histTab === 'pop') {
    const peak = H.reduce((a, h) => Math.max(a, h.pop), 0);
    html += `<p>${world.births} har fötts och ${world.dead.length + world.creatures.filter(c => !c.alive).length} har dött sedan stamföräldrarna. Som flest har ${peak} levt samtidigt. Generation ${world.maxGen} är den senaste.</p>`;
    add('Hur många som lever', 'c1', [{ n: 'lever', c: '#f2b76b', f: p => p.pop, w: 2.2 }, { n: 'varav unga', c: '#7fd1c9', f: p => p.young }], {}, 'Blå band = vinter.');
    add('Djuren i dalen', 'c3', [{ n: 'betare', c: '#e0b070', f: p => p.small ?? null }, { n: 'uroxar', c: '#a0705a', f: p => p.big ?? null }], { min: 0 }, 'Betarna och uroxarna evolverar på egen hand. Uroxar är för stora att fälla ensam utan att få en spark.');
    add('Födslar och dödsfall (per 6 timmar)', 'c2', [{ n: 'födda', c: '#7fd1a0', f: p => p.births }, { n: 'döda', c: '#f2788c', f: sumD }]);
  } else if (histTab === 'env') {
    add('Mat i dalen (växternas samlade massa)', 'c1', [{ n: 'mat', c: '#7fd1a0', f: p => p.food, w: 2.2 }], {}, 'Om maten rasar när befolkningen växer har de ätit ur dalen.');
    add('Växterna: höjd, antal träd och frukt', 'c5', [{ n: 'höjd × 10', c: '#7fd1a0', f: p => p.treeH == null ? null : p.treeH * 10 }, { n: 'träd', c: '#c98b5b', f: p => p.trees ?? null }, { n: 'frukt × 100', c: '#f2788c', f: p => p.fr == null ? null : p.fr * 100 }], { min: 0 }, 'Växter som blir högre än grannarna skuggar dem. Höga växter blir träd, och frukten som faller sprider frön.');
    { const C = world.cosmos, ev = C ? C.log.filter(e => e.type !== 'dust').slice(-12).reverse() : [];
      const ic = { impact: '☄️', eclipse: '🌑', comet: '💫', nova: '🌟', storm: '🌌' };
      html += `<div class="ctitle">Händelser från universum</div><p style="color:var(--dim);font-size:12px;margin-top:-4px">Meteoriter följer en potenslag: många små, få stora. ${C ? `${C.impacts} nedslag hittills. Solens aktivitet just nu: ${Math.round(world.solar() * 100)} %.` : ''}${C && C.dust > 0.02 ? ` Damm i luften: ${Math.round(C.dust * 100)} %.` : ''}</p>` + (ev.length ? ev.map(e => `<div style="font-size:13px;margin:4px 0"><em style="color:var(--dim)">${fmtT(e.t)}</em> ${ic[e.type] || '✨'} ${esc(e.msg)}</div>`).join('') : '<p style="color:var(--dim)">Inget har hänt än – himlen är lugn.</p>'); }
    add('Vatten ovan jord (rutor)', 'c2', [{ n: 'vatten', c: '#6fa8ff', f: p => p.water }]);
    add('Klimatet: hur mycket varmare/kallare och blötare än vanligt', 'c4', [{ n: '°C jämfört med vanligt', c: '#f2788c', f: p => p.climT ?? null }, { n: 'regn × 10 (10 = vanligt)', c: '#6fa8ff', f: p => p.climW == null ? null : p.climW * 10 }], {}, 'Klimatet driver långsamt mellan istider, torka och blöta perioder.');
    add('Temperatur', 'c3', [{ n: '°C', c: '#f2b76b', f: p => p.temp }], { min: Math.min(-5, ...H.map(h => h.temp)) });
  } else if (histTab === 'evo') {
    html += `<p>Genomsnitt för alla som lever. Om kurvorna rör sig är det evolution: de som klarade sig bäst har fått fler barn.</p>`;
    add('Hjärnans storlek (neuroner) och minne', 'c1', [{ n: 'neuroner', c: '#c9a0ff', f: p => p.brain }, { n: 'minne (minuter)', c: '#7fd1c9', f: p => p.mem ?? null }], {}, 'Inga tak längre: hjärnan kan växa till 200 neuroner och minnet kan bli mycket långt – men stora hjärnor kostar energi.');
    add('Kroppens längd och antal benpar', 'c2', [{ n: 'kroppslängd', c: '#f2b76b', f: p => p.body }, { n: 'benpar × 10', c: '#7fd1c9', f: p => p.legs == null ? null : p.legs * 10 }]);
    add('Gift i växterna och tålighet hos varelserna', 'c3', [{ n: 'växternas gift', c: '#b07cff', f: p => p.tox }, { n: 'varelsernas tålighet', c: '#7fd1a0', f: p => p.tol }], { min: 0 });
    add('Sjukdomar: andel smittade och hur farlig sjukdomen är', 'c7', [{ n: '% smittade', c: '#9fd16b', f: p => p.sick ?? null }, { n: 'farlighet × 100', c: '#f2788c', f: p => p.vir == null ? null : p.vir * 100 }, { n: '% som smittar via kött', c: '#c9a0ff', f: p => p.parE ?? null }], { min: 0 }, 'Sjukdomen och deras immunförsvar evolverar mot varandra. Lila: hur mycket sjukdomen har anpassat sig till att smitta den som äter den sjuka.');
    add('Kost: växtätare (0) eller köttätare (1)', 'c5', [{ n: 'köttätargen', c: '#f2788c', f: p => p.carn ?? null }], { min: 0 }, 'Över 0,25 har de tänder nog att jaga levande byten.');
    add('Antal arter och matförråd på marken', 'c6', [{ n: 'arter', c: '#c9a0ff', f: p => p.species ?? null }, { n: 'förråd / 10', c: '#f2b76b', f: p => p.items == null ? null : p.items / 10 }], { min: 0 });
    add('Hur mycket de pratar och gräver (per 6 timmar)', 'c4', [{ n: 'yttranden / 10', c: '#f2d36b', f: p => p.utt / 10 }, { n: 'grävda rutor', c: '#c98b5b', f: p => p.digs }]);
  } else if (histTab === 'death') {
    const tot = Object.entries(world.causes).filter(([k]) => !k.includes('|'));
    const sum = tot.reduce((a, [, v]) => a + v, 0) || 1;
    html += `<p>${sum === 1 && !tot.length ? 'Ingen har dött än.' : `Så här har de ${sum} döda dött:`}</p><div class="bars">` + tot.sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div><span>${CAUSE_SV[k] || k}</span><b style="width:${Math.max(4, v / sum * 60)}%"></b><em>${v} (${Math.round(v / sum * 100)} %)</em></div>`).join('') + '</div>';
    const seasons = ['Vår', 'Sommar', 'Höst', 'Vinter'], causes = tot.map(([k]) => k);
    if (causes.length) html += `<div class="ctitle" style="margin-top:14px">Per årstid</div><table class="cmp"><tr><th></th>${seasons.map(s => `<th>${s}</th>`).join('')}</tr>` + causes.map(k => `<tr><td>${CAUSE_SV[k] || k}</td>${seasons.map(s => `<td>${world.causes[k + '|' + s] || 0}</td>`).join('')}</tr>`).join('') + '</table>';
    add('Dödsfall per 6 timmar, efter orsak', 'c1', ['hunger', 'thirst', 'cold', 'age', 'poison', 'eaten'].map((k, i) => ({ n: CAUSE_SV[k], c: ['#f2b76b', '#6fa8ff', '#a8d8ff', '#9a96b0', '#b07cff', '#f2788c'][i], f: p => (p.deaths || {})[k] || 0 })));
  } else if (histTab === 'then') {
    const F = world.founders, al = world.creatures.filter(c => c.alive);
    if (!F) html += '<p>Stamföräldrarnas gener sparades inte i den här dalen (den startades i en äldre version). Starta en ny värld för att kunna jämföra.</p>';
    else if (!al.length) html += '<p>Ingen lever just nu att jämföra med.</p>';
    else {
      const rows = [['Kroppssegment', g => g.seg], ['Segmentlängd', g => g.segL], ['Benpar', g => g.legs], ['Benlängd', g => g.legL], ['Ögonstorlek', g => g.eye], ['Svans (andel med)', g => g.tail > 0 ? 1 : 0, true], ['Antenner (andel med)', g => g.ant > 0 ? 1 : 0, true], ['Neuroner i hjärnan', (g, c) => c ? c.br.H : g.hid], ['Tålighet mot gift', g => g.tol || 0], ['Nyfikenhet (brus)', g => g.explore], ['Inlärningstakt × 1000', g => g.lr * 1000], ['Minne (minuter)', g => (g.mem || 3000) / 60], ['Livslängd (dygn)', g => g.maxAge / DAY], ['Köttätargen', g => g.carn || 0]];
      const fmt = (v, pct) => pct ? Math.round(v * 100) + ' %' : (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 100) / 100);
      html += `<p>Stamföräldrarna ${F.map(f => esc(f.name)).join(' och ')} jämfört med genomsnittet av de ${al.length} som lever nu (generation ${world.maxGen}).</p><table class="cmp"><tr><th></th><th>Då</th><th>Nu</th></tr>` +
        rows.map(([n, f, pct]) => { const then = F.reduce((a, x) => a + f(x.g, null), 0) / F.length, now = al.reduce((a, c) => a + f(c.g, c), 0) / al.length; const ch = then ? (now - then) / Math.abs(then) : now; const mark = Math.abs(ch) > 0.15 ? (ch > 0 ? ' ▲' : ' ▼') : ''; return `<tr><td>${n}</td><td>${fmt(then, pct)}</td><td>${fmt(now, pct)}${mark}</td></tr>`; }).join('') + '</table><p style="color:var(--dim);font-size:12px">▲▼ = förändrats mer än 15 %.</p>';
    }
  }
  const st = B.scrollTop; B.innerHTML = html; B.scrollTop = st;
  requestAnimationFrame(() => charts.forEach(([id, s, o]) => lineChart(id, s, o)));
}
// ---------- släkt ----------
function rec(id) { return world.creatures.find(c => c.id === id) || world.dead.find(d => d.id === id); }
function nameLink(r) { if (!r) return '<span style="color:var(--dim)">okänd</span>'; const alive = r.alive; return alive ? `<a href="#" data-sel="${r.id}">${esc(r.name)}</a>` : `${esc(r.name)} †`; }
function renderKin(c) {
  const lines = [];
  // anor uppåt, generation för generation
  let gen = [c], depth = 0; const labels = ['Föräldrar', 'Mor- och farföräldrar', 'Gammelföräldrar'];
  while (depth < 6) {
    const up = []; for (const x of gen) if (x && x.parents) for (const pid of x.parents) up.push(rec(pid) || { name: '?', id: pid });
    if (!up.length) break;
    // samma förfader kan dyka upp flera gånger när släktingar fått barn med varandra
    const cnt = new Map(); for (const r of up) cnt.set(r.id, (cnt.get(r.id) || 0) + 1);
    const uniq = [...new Map(up.map(r => [r.id, r])).values()];
    lines.push(`<b>${labels[depth] || `${depth + 1} generationer upp`}:</b> ${uniq.slice(0, 8).map(r => nameLink(r) + (cnt.get(r.id) > 1 ? ` ×${cnt.get(r.id)}` : '')).join(', ')}${uniq.length > 8 ? ` och ${uniq.length - 8} till` : ''}`);
    gen = uniq; depth++;
  }
  if (!c.parents) lines.push('<b>Stamförälder</b> – kommer från urtiden.');
  const kids = world.creatures.filter(o => o.parents && o.parents.includes(c.id)).concat(world.dead.filter(o => o.parents && o.parents.includes(c.id)));
  lines.push(`<b>Barn (${kids.length}):</b> ${kids.length ? kids.slice(0, 12).map(nameLink).join(', ') + (kids.length > 12 ? ` och ${kids.length - 12} till` : '') : 'inga än'}`);
  // levande ättlingar
  const kidsOf = new Map(); for (const o of world.creatures.concat(world.dead)) if (o.parents) for (const pid of o.parents) { if (!kidsOf.has(pid)) kidsOf.set(pid, []); kidsOf.get(pid).push(o); }
  const seen = new Set([c.id]), q = [c.id]; let desc = 0;
  while (q.length) { for (const o of kidsOf.get(q.pop()) || []) if (!seen.has(o.id)) { seen.add(o.id); q.push(o.id); if (o.alive) desc++; } }
  lines.push(`<b>Levande ättlingar:</b> ${desc}`);
  $('#kin').innerHTML = lines.map(l => `<div>${l}</div>`).join('');
  document.querySelectorAll('#kin a[data-sel]').forEach(a => a.onclick = e => { e.preventDefault(); const o = world.creatures.find(z => z.id === +a.dataset.sel); if (o) select(o); });
}

boot();
requestAnimationFrame(frame);

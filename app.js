import { firebaseConfig } from './firebase-config.js';
import { connect } from './db.js';

(() => {
  const S = SudokuCore;
  const $ = s => document.querySelector(s);
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const LV_INFO = {
    1: { d: 'Muchas pistas', dots: '●○○○○' },
    2: { d: 'Solo singles', dots: '●●○○○' },
    3: { d: 'Pares y bloqueos', dots: '●●●○○' },
    4: { d: 'Tríos, X-Wing', dots: '●●●●○' },
    5: { d: 'Swordfish y más', dots: '●●●●●' },
  };
  const lvName = id => (S.LEVELS.find(l => l.id === +id) || {}).name || '';

  const store = {
    get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const app = {
    db: null, user: null, uid: null, access: 'cargando', ready: null,
    alias: store.get('spl:alias') || '', level: store.get('spl:nivel') || 3,
    view: 'inicio', room: null, game: null, players: [], unsubs: [], joinedAt: 0, timer: null,
  };

  // ---------- utilidades ----------
  const randCode = () => Array.from({ length: 5 }, () => ALPH[Math.floor(Math.random() * ALPH.length)]).join('');
  function fmt(ms, tenths) {
    if (ms == null || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
    const mm = String(m % 60).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
    let out = (h ? h + ':' : '') + mm + ':' + ss;
    if (tenths) out += '.' + Math.floor((ms % 1000) / 100);
    return out;
  }
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
  async function copy(text, fallbackInput) {
    try { await navigator.clipboard.writeText(text); toast('Copiado'); }
    catch {
      if (fallbackInput) { fallbackInput.hidden = false; fallbackInput.value = text; fallbackInput.focus(); fallbackInput.select(); }
      toast('Seleccioná el texto y copialo');
    }
  }
  function show(view) {
    app.view = view;
    for (const v of ['inicio', 'sala', 'juego']) $('#v-' + v).hidden = v !== view;
    window.scrollTo(0, 0);
  }

  // ---------- plataforma (tabla compartida) ----------
  const ACCESS_TXT = {
    cargando: 'Conectando…', live: 'Tabla compartida activa',
    readonly: 'Tabla compartida: solo lectura', offline: 'Sin tabla compartida', error: 'Sin conexión con la tabla',
  };
  const ACCESS_AVISO = {
    readonly: 'Con tu acceso podés entrar a las salas, jugar y ver la tabla, pero tu tiempo no se carga. Al terminar copiá tu resultado y compartilo.',
    offline: 'Igual podés competir: creá una partida y pasá el código. Todos los que lo ingresen juegan exactamente el mismo sudoku y comparan tiempos.',
    error: 'No pudimos conectar con la tabla compartida. Revisá tu conexión y recargá la página. Mientras tanto podés jugar partidas por código.',
  };
  function setAccess(a) {
    app.access = a;
    const c = $('#acceso'); c.dataset.s = a; c.textContent = ACCESS_TXT[a];
    const av = $('#aviso-acceso'); av.hidden = !ACCESS_AVISO[a]; av.textContent = ACCESS_AVISO[a] || '';
    if (app.view === 'sala') renderRoom();
  }
  async function initPlatform() {
    if (!firebaseConfig) { setAccess('offline'); return; }
    try {
      const db = await connect(firebaseConfig);
      if (!db) { setAccess('offline'); return; }
      app.db = db; app.uid = db.uid;
      setAccess('live');
    } catch (e) { console.error('Firebase:', e); setAccess('error'); }
  }
  const serverNow = () => (app.db && app.db.now ? app.db.now() : Date.now());
  const salaRef = code => app.db.doc('salas/' + code);
  const meRef = () => app.db.doc('jugadores/' + app.room.code + '/' + app.uid);
  const canWriteRoom = () => app.access === 'live' && app.room && !app.room.local;

  // Cola de escritura del propio jugador: una escritura a la vez, juntando cambios
  const writer = (() => {
    let pending = null, busy = false, t = null;
    async function flush() {
      if (busy || !pending || !canWriteRoom()) return;
      busy = true;
      const patch = pending; pending = null;
      try { await meRef().update(patch); }
      catch (e) {
        // si el registro del jugador no existía (o se borró), se vuelve a crear completo
        try { await meRef().set({ alias: app.alias, unido: app.joinedAt || Date.now(), ...patch }); } catch {}
      }
      busy = false;
      if (pending) flush();
    }
    return {
      queue(patch, delay = 0) { pending = { ...(pending || {}), ...patch }; clearTimeout(t); t = setTimeout(flush, delay); },
      reset() { pending = null; clearTimeout(t); },
    };
  })();

  // ---------- selector de niveles ----------
  function buildLevels(el, name, onPick) {
    el.innerHTML = '';
    for (const l of S.LEVELS) {
      const lab = document.createElement('label');
      lab.className = 'nivel-opt';
      lab.innerHTML = `<input type="radio" name="${name}" id="${name}-${l.id}" value="${l.id}"><span class="opt"><span class="dots">${LV_INFO[l.id].dots}</span>${l.name}<small>${LV_INFO[l.id].d}</small></span>`;
      lab.querySelector('input').addEventListener('change', () => onPick(l.id));
      el.appendChild(lab);
    }
  }
  function setLevelUI(el, id) { const r = el.querySelector(`input[value="${id}"]`); if (r) r.checked = true; }
  function pickLevel(id) {
    app.level = id; store.set('spl:nivel', id);
    setLevelUI($('#niveles'), id); setLevelUI($('#sala-niveles'), id);
  }
  buildLevels($('#niveles'), 'nivel', pickLevel);
  buildLevels($('#sala-niveles'), 'snivel', id => {
    pickLevel(id);
    if (app.room && app.room.local && !app.room.data.ronda) app.room.data.nivel = id;
    if (app.room && !app.room.local && canWriteRoom()) salaRef(app.room.code).update({ nivelProx: id }).catch(() => {});
    renderRoom();
  });
  pickLevel(app.level);

  // ---------- tablero ----------
  function buildBoard(el, onCell) {
    el.innerHTML = '';
    const cells = [];
    for (let i = 0; i < 81; i++) {
      const c = document.createElement('div');
      const r = Math.floor(i / 9), k = i % 9;
      c.className = `cell r${r} c${k}`;
      c.dataset.i = i;
      if (onCell) c.addEventListener('pointerdown', ev => { ev.preventDefault(); onCell(i); el.focus({ preventScroll: true }); });
      el.appendChild(c); cells.push(c);
    }
    return cells;
  }
  function jitter(i) { // trazo a mano: cada número queda un poquito torcido, siempre igual
    const h = S.hashSeed('j' + i);
    return { r: ((h % 9) - 4) * 0.9 + 'deg', dx: (((h >> 4) % 5) - 2) * 0.35 + 'cqi', dy: (((h >> 8) % 5) - 2) * 0.3 + 'cqi' };
  }
  function paintCell(c, i, given, value, notes, sel) {
    let html = '';
    if (given) html = `<span class="g">${given}</span>`;
    else if (value) { const j = jitter(i); html = `<span class="p" style="--r:${j.r};--dx:${j.dx};--dy:${j.dy}">${value}</span>`; }
    else if (notes) { html = '<div class="n">'; for (let d = 1; d <= 9; d++) html += `<i class="${notes & (1 << (d - 1)) ? 'on' : ''}">${d}</i>`; html += '</div>'; }
    if (c._html !== html) { c.innerHTML = html; c._html = html; }
    c.classList.toggle('sel', !!sel);
  }

  // Tablero de ejemplo de la portada
  (async () => {
    const cells = buildBoard($('#board-ejemplo'), null);
    const g = await S.generate('EJEMPLO-PORTADA', 2, { yieldEvery: 0 });
    const pen = new Set([3, 14, 22, 40, 51, 57, 66, 70]);
    const noteCells = [1, 2, 10, 19, 28, 33, 47, 60, 61, 75];
    for (let i = 0; i < 81; i++) {
      const given = g.puzzle[i] || 0;
      let value = 0, notes = 0;
      if (!given && pen.has(i)) value = g.solution[i];
      if (!given && !value && noteCells.includes(i)) notes = (1 << (g.solution[i] - 1)) | (1 << ((g.solution[i] + 3) % 9)) | (i % 2 ? 1 << ((g.solution[i] + 5) % 9) : 0);
      paintCell(cells[i], i, given, value, notes, i === 40);
    }
  })();

  // ---------- juego ----------
  const boardCells = buildBoard($('#board'), i => { if (app.game) { app.game.sel = i; renderBoard(); } });
  const pad = $('#pad');
  for (let d = 1; d <= 9; d++) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = d; b.setAttribute('aria-label', 'Número ' + d);
    b.addEventListener('click', () => input(d));
    pad.appendChild(b);
  }
  function setMode(m) {
    if (!app.game) return;
    app.game.mode = m;
    document.querySelectorAll('.modo button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
    pad.className = 'pad ' + m;
  }
  document.querySelectorAll('.modo button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.m)));
  $('#borrar').addEventListener('click', () => erase());
  $('#deshacer').addEventListener('click', () => undo());

  const playable = () => app.game && app.game.started && !app.game.done;
  function renderBoard() {
    const g = app.game; if (!g) return;
    for (let i = 0; i < 81; i++) paintCell(boardCells[i], i, g.puzzle[i], g.values[i], g.notes[i], i === g.sel && !g.done);
  }
  function saveGame() {
    const g = app.game; if (!g) return;
    store.set(g.key, { puz: g.puzStr, values: Array.from(g.values), notes: Array.from(g.notes), startedAt: g.startedAt, done: g.done, elapsed: g.elapsed });
  }
  function filledPct() {
    const g = app.game; if (!g) return 0;
    let empty = 0, filled = 0;
    for (let i = 0; i < 81; i++) if (!g.puzzle[i]) { empty++; if (g.values[i]) filled++; }
    return empty ? Math.round((filled / empty) * 100) : 100;
  }
  function pushHist(i) { const g = app.game; g.hist.push({ i, v: g.values[i], n: g.notes[i] }); if (g.hist.length > 500) g.hist.shift(); }
  function afterChange() {
    renderBoard(); saveGame(); checkFull();
    if (canWriteRoom() && app.game && !app.game.done) writer.queue({ ronda: app.game.ronda, avance: filledPct() }, 1800);
    renderStandings();
  }
  function input(d, forcePencil) {
    if (!playable()) return;
    const g = app.game, i = g.sel;
    if (i == null || g.puzzle[i]) return;
    const pencil = forcePencil || g.mode === 'pencil';
    if (pencil) {
      if (g.values[i]) return; // sobre birome no se anota con lápiz
      pushHist(i); g.notes[i] ^= 1 << (d - 1);
    } else {
      pushHist(i); g.values[i] = g.values[i] === d ? 0 : d;
    }
    afterChange();
  }
  function erase() {
    if (!playable()) return;
    const g = app.game, i = g.sel;
    if (i == null || g.puzzle[i]) return;
    if (!g.values[i] && !g.notes[i]) return;
    pushHist(i);
    if (g.values[i]) g.values[i] = 0; else g.notes[i] = 0;
    afterChange();
  }
  function undo() {
    if (!playable()) return;
    const g = app.game, h = g.hist.pop(); if (!h) return;
    g.values[h.i] = h.v; g.notes[h.i] = h.n; g.sel = h.i;
    afterChange();
  }
  function checkFull() {
    const g = app.game; const note = $('#nota-tablero');
    if (!g || g.done) return;
    for (let i = 0; i < 81; i++) if (!g.puzzle[i] && !g.values[i]) { note.textContent = ''; note.classList.remove('on'); return; }
    for (let i = 0; i < 81; i++) if (!g.puzzle[i] && g.values[i] !== g.sol[i]) {
      note.textContent = 'El tablero está completo, pero algo no cierra. Revisalo.'; note.classList.add('on'); return;
    }
    finish();
  }
  function move(dr, dc) {
    const g = app.game; if (!g) return;
    const i = g.sel ?? 40; let r = Math.floor(i / 9) + dr, c = (i % 9) + dc;
    r = (r + 9) % 9; c = (c + 9) % 9; g.sel = r * 9 + c; renderBoard();
  }
  document.addEventListener('keydown', e => {
    if (app.view !== 'juego' || !app.game) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const k = e.key;
    if (k === 'ArrowUp') { move(-1, 0); e.preventDefault(); return; }
    if (k === 'ArrowDown') { move(1, 0); e.preventDefault(); return; }
    if (k === 'ArrowLeft') { move(0, -1); e.preventDefault(); return; }
    if (k === 'ArrowRight') { move(0, 1); e.preventDefault(); return; }
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { undo(); e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const m = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) { input(+m[2], e.shiftKey); e.preventDefault(); return; }
    if (k === 'Backspace' || k === 'Delete' || k === '0') { erase(); e.preventDefault(); return; }
    if (k === ' ' || k.toLowerCase() === 'n') { setMode(app.game.mode === 'pen' ? 'pencil' : 'pen'); e.preventDefault(); }
  });

  // Arranca una ronda (con cuenta regresiva salvo que ya estuviera empezada en este dispositivo)
  function startGame(d, { late = false } = {}) {
    stopTimer(); writer.reset();
    const key = `spl:g:${app.room.code}:${d.ronda}`;
    const g = app.game = {
      key, puzStr: d.puzzle, ronda: d.ronda, nivel: d.nivel,
      puzzle: S.fromStr(d.puzzle), sol: S.fromStr(d.solucion),
      values: new Int8Array(81), notes: new Uint16Array(81), sel: 40, mode: 'pen', hist: [],
      startedAt: null, started: false, done: false, elapsed: null,
    };
    const saved = store.get(key);
    if (saved && saved.puz === d.puzzle) {
      g.values = Int8Array.from(saved.values); g.notes = Uint16Array.from(saved.notes);
      g.startedAt = saved.startedAt; g.done = !!saved.done; g.elapsed = saved.elapsed;
    }
    setMode('pen');
    $('#j-codigo').textContent = app.room.code;
    $('#j-nivel').textContent = lvName(d.nivel);
    $('#j-ronda').textContent = app.room.local ? '' : 'Ronda ' + d.ronda;
    $('#nota-tablero').textContent = ''; $('#final').hidden = true; $('#final-txt').hidden = true;
    $('#reloj').classList.remove('fin'); $('#reloj').textContent = '00:00';
    renderBoard(); renderStandings();
    show('juego');
    if (g.startedAt) { begin(); return; }
    const delay = late ? 3000 : Math.max(0, Math.min(6000, (d.inicio || 0) - serverNow()));
    countdown(delay);
  }
  function countdown(ms) {
    const cover = $('#cover'), n = $('#cover-n');
    $('#board').style.visibility = 'hidden';
    cover.hidden = false;
    const end = Date.now() + ms;
    const tick = () => {
      if (!app.game || app.game.started) return;
      const left = end - Date.now();
      if (left <= 0) { begin(); return; }
      n.textContent = Math.ceil(left / 1000);
      app.timer = setTimeout(tick, 100);
    };
    $('#cover-txt').textContent = 'Preparate…';
    tick();
  }
  function begin() {
    const g = app.game; if (!g) return;
    $('#cover').hidden = true; $('#board').style.visibility = '';
    g.started = true;
    if (!g.startedAt) { g.startedAt = Date.now(); saveGame(); if (canWriteRoom()) writer.queue({ ronda: g.ronda, avance: filledPct(), terminado: false, tiempo: null }); }
    if (g.done) { showFinal(); return; }
    $('#board').focus({ preventScroll: true });
    const tick = () => { if (!app.game || app.game !== g || g.done) return; $('#reloj').textContent = fmt(Date.now() - g.startedAt); };
    tick(); app.timer = setInterval(tick, 250);
    renderBoard(); renderStandings();
  }
  function stopTimer() { clearInterval(app.timer); clearTimeout(app.timer); app.timer = null; }
  function finish() {
    const g = app.game; if (!g || g.done) return;
    g.done = true; g.elapsed = Date.now() - g.startedAt;
    stopTimer(); saveGame();
    if (canWriteRoom()) writer.queue({ ronda: g.ronda, avance: 100, terminado: true, tiempo: g.elapsed, terminadoEn: Date.now() }, 0);
    showFinal();
  }
  function showFinal() {
    const g = app.game;
    $('#reloj').textContent = fmt(g.elapsed, true); $('#reloj').classList.add('fin');
    $('#final-tiempo').textContent = fmt(g.elapsed, true);
    $('#final-volver').textContent = app.room.local ? 'Otra partida' : 'Volver a la sala';
    $('#final').hidden = false;
    $('#nota-tablero').textContent = '';
    renderBoard(); renderStandings();
  }
  function resultText() {
    const g = app.game; const r = app.room;
    const sala = r.local ? `Partida ${r.code}-${g.nivel}` : `Sala ${r.code}, ronda ${g.ronda}`;
    return `Sudoku papel y lápiz · ${sala} (${lvName(g.nivel)}) · ${app.alias || 'Yo'} · ${fmt(g.elapsed, true)}`;
  }
  $('#final-copiar').addEventListener('click', () => copy(resultText(), $('#final-txt')));
  $('#final-volver').addEventListener('click', () => {
    if (app.room.local) { createLocalRoom(app.game.nivel); return; }
    show('sala'); renderRoom();
  });

  // ---------- tabla de posiciones ----------
  function rowsFor(ronda) {
    const rows = app.players.filter(p => p.ronda === ronda)
      .map(p => ({ id: p.id, alias: p.alias || 'Sin nombre', avance: p.avance || 0, terminado: !!p.terminado, tiempo: p.tiempo, me: p.id === app.uid }));
    const g = app.game;
    if (g && g.ronda === ronda && g.started) {
      const mine = rows.find(r => r.me);
      const local = { avance: g.done ? 100 : filledPct(), terminado: g.done, tiempo: g.elapsed };
      if (mine) Object.assign(mine, local);
      else rows.push({ id: 'yo', alias: app.alias || 'Yo', me: true, unsaved: !app.room.local && app.access !== 'live', ...local });
    }
    rows.sort((a, b) => (b.terminado - a.terminado) || (a.terminado ? a.tiempo - b.tiempo : b.avance - a.avance));
    return rows;
  }
  function fillRows(ol, rows) {
    ol.innerHTML = '';
    let pos = 0;
    for (const r of rows) {
      const li = document.createElement('li');
      li.className = 'fila' + (r.terminado ? ' done' : '') + (r.me ? ' me' : '');
      const p = document.createElement('span'); p.className = 'pos'; p.textContent = r.terminado ? ++pos : '·';
      const q = document.createElement('div'); q.className = 'quien';
      const nm = document.createElement('div'); nm.className = 'nom'; nm.textContent = r.alias;
      if (r.me) { const em = document.createElement('em'); em.textContent = r.unsaved ? 'vos · no se carga' : 'vos'; nm.appendChild(em); }
      q.appendChild(nm);
      if (!r.terminado) { const b = document.createElement('div'); b.className = 'barra'; b.innerHTML = `<i style="width:${r.avance}%"></i>`; q.appendChild(b); }
      const t = document.createElement('span'); t.className = 't'; t.textContent = r.terminado ? fmt(r.tiempo, true) : r.avance + '%';
      li.append(p, q, t); ol.appendChild(li);
    }
    return pos;
  }
  function renderStandings() {
    const g = app.game, tabla = $('#tabla');
    if (!g || !app.room) return;
    tabla.hidden = app.room.local;
    const rows = rowsFor(g.ronda);
    fillRows($('#filas'), rows);
    if (!rows.length) $('#filas').innerHTML = '<li class="vacia">Todavía nadie escribió nada.</li>';
    if (g.done) {
      const done = rows.filter(r => r.terminado);
      const idx = done.findIndex(r => r.me);
      $('#final-pos').textContent = app.room.local ? 'Pasale el código a alguien para que juegue el mismo y compare.'
        : (idx >= 0 ? `Puesto ${idx + 1} de ${done.length} que terminaron hasta ahora.` : '');
    }
  }

  // ---------- salas ----------
  function needAlias() {
    const v = $('#alias').value.trim();
    if (!v) { $('#err-inicio').textContent = 'Poné tu nombre para aparecer en la tabla.'; $('#alias').focus(); return null; }
    app.alias = v; store.set('spl:alias', v); $('#err-inicio').textContent = ''; return v;
  }
  function cleanupRoom() {
    for (const u of app.unsubs) try { u(); } catch {}
    app.unsubs = []; app.players = []; app.room = null; app.game = null; stopTimer(); writer.reset();
    try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  }
  function setHash(code) { try { location.hash = 'sala-' + code; } catch {} }

  function createLocalRoom(level) {
    cleanupRoom();
    app.room = { code: randCode(), local: true, data: { nivel: level || app.level, ronda: 0 } };
    show('sala'); renderRoom();
  }
  function enterLocalRoom(code, level) {
    cleanupRoom();
    app.room = { code, local: true, data: { nivel: level, ronda: 0 } };
    show('sala'); renderRoom();
  }

  async function createRoom(btn) {
    if (!needAlias()) return;
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Creando…';
    await app.ready;
    try {
      if (app.access !== 'live') { createLocalRoom(app.level); return; }
      let code = randCode();
      for (let t = 0; t < 4; t++) { const s = await salaRef(code).get(); if (!s.exists) break; code = randCode(); }
      try {
        await salaRef(code).set({ code, nivel: app.level, nivelProx: app.level, ronda: 0, puzzle: null, solucion: null, inicio: null, host: app.uid, creada: Date.now() });
      } catch (e) {
        if (e && e.code === 'quota_exceeded') { $('#err-inicio').textContent = 'La página llegó a su límite de salas guardadas. Avisale a quien la publicó.'; return; }
        $('#err-inicio').textContent = e && e.code === 'denied'
          ? 'Firebase rechazó la sala: revisá que las reglas de database.rules.json estén publicadas.'
          : 'No se pudo crear la sala. Probá de nuevo en un momento.';
        return;
      }
      await enterLiveRoom(code);
    } finally { btn.disabled = false; btn.textContent = label; }
  }

  async function joinRoom(raw) {
    if (!needAlias()) return;
    const m = /^([A-Z0-9]{5})(?:-?([1-5]))?$/.exec(raw.toUpperCase().replace(/\s+/g, ''));
    if (!m) { $('#err-inicio').textContent = 'El código tiene 5 letras o números (a veces con el nivel al final, como ABCDE-3).'; return; }
    const [, code, lvl] = m;
    await app.ready;
    if (app.db) {
      let snap = null;
      try { snap = await salaRef(code).get(); } catch {}
      if (snap && snap.exists) { await enterLiveRoom(code); return; }
    }
    if (lvl) { enterLocalRoom(code, +lvl); return; }
    $('#err-inicio').textContent = app.db ? 'No encontramos esa sala. Revisá el código.' : 'Sin tabla compartida, el código tiene que incluir el nivel al final (por ejemplo ABCDE-3).';
  }

  async function enterLiveRoom(code) {
    cleanupRoom();
    app.room = { code, local: false, data: null, base: null };
    app.joinedAt = Date.now();
    setHash(code);
    show('sala'); renderRoom();
    if (app.access === 'live') {
      try {
        const me = await meRef().get();
        if (me.exists) await meRef().update({ alias: app.alias });
        else await meRef().set({ alias: app.alias, unido: app.joinedAt, ronda: 0, avance: 0, terminado: false, tiempo: null });
      } catch (e) { toast('No se pudo anotarte en la sala. Probá salir y volver a entrar.'); }
    }
    const room = app.room;
    app.unsubs.push(salaRef(code).onSnapshot(snap => {
      if (app.room !== room) return;
      if (!snap.exists) { if (!snap.metadata.fromCache) { toast('Esa sala ya no existe.'); cleanupRoom(); show('inicio'); } return; }
      const d = snap.data(); room.data = d;
      if (room.base == null) { if (!snap.metadata.fromCache) room.base = d.ronda; }
      else if (d.ronda > room.base) { room.base = d.ronda; if (d.puzzle) startGame(d); }
      if (app.view === 'sala') renderRoom();
    }, () => {}));
    app.unsubs.push(app.db.collection('jugadores/' + code).onSnapshot(qs => {
      if (app.room !== room) return;
      app.players = qs.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (!qs.metadata.fromCache) room.playersLoaded = true;
      if (app.view === 'sala') renderRoom(); else renderStandings();
    }, () => {}));
  }

  async function hostStart(btn) {
    const r = app.room; if (!r) return;
    btn.disabled = true; btn.textContent = 'Generando sudoku…';
    try {
      if (r.local) {
        const g = await S.generate(r.code + ':1', r.data.nivel);
        r.data = { nivel: r.data.nivel, ronda: 1, puzzle: S.toStr(g.puzzle), solucion: S.toStr(g.solution), inicio: Date.now() + 3000 };
        startGame(r.data);
        return;
      }
      const ronda = (r.data.ronda || 0) + 1, nivel = app.level;
      const g = await S.generate(r.code + ':' + ronda, nivel);
      await salaRef(r.code).update({ ronda, nivel, nivelProx: nivel, puzzle: S.toStr(g.puzzle), solucion: S.toStr(g.solution), inicio: serverNow() + 4000 });
    } catch (e) {
      toast(e && e.code === 'denied' ? 'Solo el anfitrión puede arrancar la partida.' : 'No se pudo arrancar. Probá de nuevo.');
    } finally { btn.disabled = false; renderRoom(); }
  }

  function renderRoom() {
    const r = app.room; if (!r) return;
    const d = r.data || {};
    $('#sala-codigo').innerHTML = '';
    $('#sala-codigo').append(r.code);
    if (r.local) { const s = document.createElement('small'); s.textContent = '-' + d.nivel; $('#sala-codigo').append(s); }
    $('#sala-tipo').textContent = r.local ? 'Código de la partida' : 'Sala';
    $('#copiar-codigo').textContent = r.local ? 'Copiar código' : 'Copiar link de la sala';
    const aviso = $('#sala-aviso');
    aviso.textContent = r.local
      ? (app.access !== 'live'
          ? 'Todos los que ingresen este código juegan exactamente el mismo sudoku. Sin tabla compartida, cada uno arranca cuando quiere y al terminar comparte su tiempo.'
          : 'Partida individual. Si alguien ingresa este código, juega exactamente el mismo sudoku.')
      : (app.access === 'readonly'
          ? 'Tu acceso es de solo lectura: ves la sala y la tabla, jugás igual, pero tu tiempo no se carga. Al terminar copiá tu resultado.'
          : 'Pasales este código. Cuando estén todos, el anfitrión arranca y el sudoku aparece a la vez para todos después de una cuenta regresiva.');

    const isHost = !r.local && (d.host === app.uid || (d.host && r.playersLoaded && !app.players.some(p => p.id === d.host) && app.access === 'live'));
    const canPick = r.local ? d.ronda === 0 : isHost && app.access === 'live';
    $('#sala-niveles-box').hidden = !canPick;
    const nivelVer = r.local ? d.nivel : (d.nivelProx || d.nivel);
    if (canPick) { if (!r.local) setLevelUI($('#sala-niveles'), app.level); else setLevelUI($('#sala-niveles'), d.nivel); }
    $('#sala-niveles-lbl').textContent = d.ronda ? 'Dificultad de la próxima ronda' : 'Dificultad';
    const nt = $('#sala-nivel-txt');
    nt.hidden = canPick || !nivelVer; nt.textContent = nivelVer ? (d.ronda ? 'Próxima ronda: ' : 'Dificultad: ') + lvName(nivelVer) : '';
    $('#sala-titulo').textContent = r.local ? 'Partida' : (d.ronda ? `Ronda ${d.ronda}` : 'Antes de empezar');

    const acc = $('#sala-acciones'); acc.innerHTML = '';
    const espera = $('#sala-espera'); espera.hidden = true;
    const enCurso = d.ronda > 0 && d.puzzle;
    if (enCurso && !r.local) {
      const saved = store.get(`spl:g:${r.code}:${d.ronda}`);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn' + (isHost ? '' : ' primary');
      b.textContent = saved && saved.done ? `Ver resultado de la ronda ${d.ronda}` : saved ? `Volver a la ronda ${d.ronda}` : `Entrar a la ronda ${d.ronda} en curso`;
      b.addEventListener('click', () => startGame(d, { late: true }));
      acc.appendChild(b);
    }
    if (r.local && d.ronda > 0) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary';
      b.textContent = app.game && app.game.done ? 'Ver mi resultado' : 'Volver a la partida';
      b.addEventListener('click', () => startGame(d, { late: true }));
      acc.appendChild(b);
    } else if (r.local || isHost) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn primary';
      if (r.local) b.textContent = 'Empezar';
      else {
        const jugando = app.players.filter(p => p.ronda === d.ronda && !p.terminado && p.id !== app.uid).length;
        b.textContent = !d.ronda ? 'Empezar' : jugando ? `Nueva ronda (${jugando} siguen jugando)` : 'Nueva ronda';
      }
      b.addEventListener('click', () => hostStart(b));
      acc.appendChild(b);
    } else if (!enCurso) espera.hidden = false;

    // gente
    const ul = $('#gente'); ul.innerHTML = '';
    let list = r.local ? [{ id: 'yo', alias: app.alias, me: true }] : app.players.slice().sort((a, b) => (a.unido || 0) - (b.unido || 0)).map(p => ({ ...p, me: p.id === app.uid }));
    if (!r.local && !list.some(p => p.me)) list.push({ id: 'yo', alias: app.alias, me: true, ro: true });
    for (const p of list) {
      const li = document.createElement('li'); if (p.me) li.className = 'me';
      const n = document.createElement('span'); n.className = 'nom'; n.textContent = (p.alias || 'Sin nombre') + (p.me ? ' (vos)' : '');
      const rol = document.createElement('span'); rol.className = 'rol';
      if (!r.local && p.id === d.host) { rol.className = 'rol host'; rol.textContent = 'anfitrión'; }
      else if (p.ro) rol.textContent = 'solo mira';
      li.append(n, rol); ul.appendChild(li);
    }
    $('#gente-n').textContent = '· ' + list.length;

    // última ronda
    const ult = $('#sala-ult');
    if (!r.local && d.ronda > 0) {
      const rows = rowsFor(d.ronda);
      ult.hidden = !rows.length;
      $('#sala-ult-tit').textContent = `Ronda ${d.ronda} · ${lvName(d.nivel)}`;
      fillRows($('#sala-ult-filas'), rows);
    } else ult.hidden = true;
  }

  $('#copiar-codigo').addEventListener('click', () => {
    const r = app.room; if (!r) return;
    copy(r.local ? `${r.code}-${r.data.nivel}` : location.origin + location.pathname + '#sala-' + r.code);
  });
  $('#salir').addEventListener('click', async () => {
    const r = app.room;
    if (r && !r.local && app.access === 'live') { try { await meRef().delete(); } catch {} }
    cleanupRoom(); show('inicio');
  });
  $('#ir-sala').addEventListener('click', () => { show('sala'); renderRoom(); });
  $('#brand').addEventListener('click', () => {
    if (app.room) { show('sala'); renderRoom(); } else show('inicio');
  });

  // ---------- inicio ----------
  $('#alias').value = app.alias;
  $('#alias').addEventListener('change', () => { const v = $('#alias').value.trim(); if (v) { app.alias = v; store.set('spl:alias', v); } });
  $('#crear').addEventListener('click', e => createRoom(e.currentTarget));
  $('#solo').addEventListener('click', () => { if (needAlias()) createLocalRoom(app.level); });
  $('#unirse').addEventListener('submit', e => { e.preventDefault(); joinRoom($('#codigo-in').value); });

  app.ready = initPlatform();
  const h = /^#sala-([A-Z0-9]{5}(?:-[1-5])?)$/i.exec(location.hash || '');
  if (h) {
    $('#codigo-in').value = h[1].toUpperCase();
    if (app.alias) joinRoom(h[1]);
  }
})();

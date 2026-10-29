/* ===== Núcleo del sudoku: azar con semilla, generador, contador de soluciones y calificador lógico ===== */
const SudokuCore = (() => {
  // --- Azar determinístico a partir de un texto (misma semilla => mismo sudoku en todos los dispositivos)
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function rng(seedStr) {
    let a = hashSeed(seedStr);
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- Geometría del tablero
  const ROW = [], COL = [], BOX = [];
  for (let i = 0; i < 81; i++) {
    ROW[i] = Math.floor(i / 9); COL[i] = i % 9;
    BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
  }
  const UNITS = []; // 0-8 filas, 9-17 columnas, 18-26 cajas
  for (let r = 0; r < 9; r++) UNITS.push([...Array(9)].map((_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) UNITS.push([...Array(9)].map((_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = Math.floor(b / 3) * 3, c0 = (b % 3) * 3, u = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) u.push((r0 + r) * 9 + c0 + c);
    UNITS.push(u);
  }
  const PEERS = [];
  for (let i = 0; i < 81; i++) {
    const s = new Set();
    for (const u of [UNITS[ROW[i]], UNITS[9 + COL[i]], UNITS[18 + BOX[i]]]) for (const j of u) if (j !== i) s.add(j);
    PEERS.push([...s]);
  }
  const PEERSET = PEERS.map(p => new Set(p));
  const sees = (a, b) => PEERSET[a].has(b);

  const POP = new Uint8Array(512);
  for (let m = 1; m < 512; m++) POP[m] = POP[m >> 1] + (m & 1);
  const ALL = 511;
  const bitsOf = m => { const out = []; for (let d = 0; d < 9; d++) if (m & (1 << d)) out.push(d); return out; };

  // --- Solución completa al azar
  function fullGrid(rand) {
    const g = new Int8Array(81);
    const rm = new Uint16Array(9), cm = new Uint16Array(9), bm = new Uint16Array(9);
    const order = [...Array(81).keys()];
    function rec(k) {
      if (k === 81) return true;
      const i = order[k];
      const used = rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]];
      const digits = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8], rand);
      for (const d of digits) {
        const b = 1 << d;
        if (used & b) continue;
        g[i] = d + 1; rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOX[i]] |= b;
        if (rec(k + 1)) return true;
        g[i] = 0; rm[ROW[i]] &= ~b; cm[COL[i]] &= ~b; bm[BOX[i]] &= ~b;
      }
      return false;
    }
    rec(0);
    return g;
  }

  // --- Cuenta soluciones (corta en "limit")
  function countSolutions(grid, limit = 2) {
    const g = Int8Array.from(grid);
    const rm = new Uint16Array(9), cm = new Uint16Array(9), bm = new Uint16Array(9);
    for (let i = 0; i < 81; i++) if (g[i]) {
      const b = 1 << (g[i] - 1);
      if ((rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]) & b) return 0;
      rm[ROW[i]] |= b; cm[COL[i]] |= b; bm[BOX[i]] |= b;
    }
    let count = 0;
    function rec() {
      let best = -1, bestMask = 0, bestN = 10;
      for (let i = 0; i < 81; i++) {
        if (g[i]) continue;
        const m = ALL & ~(rm[ROW[i]] | cm[COL[i]] | bm[BOX[i]]);
        const n = POP[m];
        if (n === 0) return;
        if (n < bestN) { bestN = n; best = i; bestMask = m; if (n === 1) break; }
      }
      if (best < 0) { count++; return; }
      for (let d = 0; d < 9; d++) {
        const b = 1 << d;
        if (!(bestMask & b)) continue;
        g[best] = d + 1; rm[ROW[best]] |= b; cm[COL[best]] |= b; bm[BOX[best]] |= b;
        rec();
        g[best] = 0; rm[ROW[best]] &= ~b; cm[COL[best]] &= ~b; bm[BOX[best]] &= ~b;
        if (count >= limit) return;
      }
    }
    rec();
    return count;
  }

  // --- Calificador lógico: resuelve como una persona y anota la técnica más difícil que necesitó
  // Nivel 0: singles · 1: bloqueos y pares · 2: tríos, X-Wing, XY-Wing · 3: Swordfish, XYZ-Wing, cuartetos · 4: ninguna alcanza
  function grade(puzzle) {
    const val = Int8Array.from(puzzle);
    const cand = new Uint16Array(81);
    for (let i = 0; i < 81; i++) cand[i] = val[i] ? 0 : ALL;
    for (let i = 0; i < 81; i++) if (val[i]) for (const p of PEERS[i]) cand[p] &= ~(1 << (val[i] - 1));
    let filled = 0; for (let i = 0; i < 81; i++) if (val[i]) filled++;
    const place = (i, d) => { val[i] = d + 1; cand[i] = 0; filled++; for (const p of PEERS[i]) cand[p] &= ~(1 << d); };
    const elim = (cells, mask) => { let ch = false; for (const c of cells) if (!val[c] && (cand[c] & mask)) { cand[c] &= ~mask; ch = true; } return ch; };

    function nakedSingle() {
      for (let i = 0; i < 81; i++) if (!val[i] && POP[cand[i]] === 1) { place(i, bitsOf(cand[i])[0]); return true; }
      return false;
    }
    function hiddenSingle() {
      for (const u of UNITS) for (let d = 0; d < 9; d++) {
        const b = 1 << d; let pos = -1, n = 0;
        for (const c of u) if (!val[c] && (cand[c] & b)) { n++; pos = c; if (n > 1) break; }
        if (n === 1) { place(pos, d); return true; }
      }
      return false;
    }
    function locked() {
      for (let d = 0; d < 9; d++) {
        const b = 1 << d;
        for (let bx = 0; bx < 9; bx++) { // apuntando: caja -> fila/columna
          const cells = UNITS[18 + bx].filter(c => !val[c] && (cand[c] & b));
          if (cells.length < 2) continue;
          const r = ROW[cells[0]], c0 = COL[cells[0]];
          if (cells.every(c => ROW[c] === r) && elim(UNITS[r].filter(c => BOX[c] !== bx), b)) return true;
          if (cells.every(c => COL[c] === c0) && elim(UNITS[9 + c0].filter(c => BOX[c] !== bx), b)) return true;
        }
        for (let u = 0; u < 18; u++) { // reclamando: fila/columna -> caja
          const cells = UNITS[u].filter(c => !val[c] && (cand[c] & b));
          if (cells.length < 2) continue;
          const bx = BOX[cells[0]];
          if (cells.every(c => BOX[c] === bx) && elim(UNITS[18 + bx].filter(c => !UNITS[u].includes(c)), b)) return true;
        }
      }
      return false;
    }
    function combos(arr, k, start = 0, acc = [], out = []) {
      if (acc.length === k) { out.push(acc.slice()); return out; }
      for (let i = start; i < arr.length; i++) { acc.push(arr[i]); combos(arr, k, i + 1, acc, out); acc.pop(); }
      return out;
    }
    function nakedSubset(k) {
      for (const u of UNITS) {
        const cells = u.filter(c => !val[c] && POP[cand[c]] >= 2 && POP[cand[c]] <= k);
        if (cells.length < k) continue;
        for (const set of combos(cells, k)) {
          let m = 0; for (const c of set) m |= cand[c];
          if (POP[m] !== k) continue;
          if (elim(u.filter(c => !set.includes(c)), m)) return true;
        }
      }
      return false;
    }
    function hiddenSubset(k) {
      for (const u of UNITS) {
        const pos = [];
        for (let d = 0; d < 9; d++) {
          const cells = u.filter(c => !val[c] && (cand[c] & (1 << d)));
          if (cells.length >= 2 && cells.length <= k) pos.push({ d, cells });
        }
        if (pos.length < k) continue;
        for (const set of combos(pos, k)) {
          const cs = new Set(); let m = 0;
          for (const p of set) { m |= 1 << p.d; for (const c of p.cells) cs.add(c); }
          if (cs.size !== k) continue;
          let ch = false;
          for (const c of cs) if (cand[c] & ~m) { cand[c] &= m; ch = true; }
          if (ch) return true;
        }
      }
      return false;
    }
    function fish(n) {
      for (let d = 0; d < 9; d++) {
        const b = 1 << d;
        for (const [baseOff, coverOff, lineOf, crossOf] of [[0, 9, ROW, COL], [9, 0, COL, ROW]]) {
          const lines = [];
          for (let l = 0; l < 9; l++) {
            const cells = UNITS[baseOff + l].filter(c => !val[c] && (cand[c] & b));
            if (cells.length >= 2 && cells.length <= n) lines.push({ l, cross: cells.map(c => crossOf[c]) });
          }
          if (lines.length < n) continue;
          for (const set of combos(lines, n)) {
            const cover = new Set(); set.forEach(s => s.cross.forEach(x => cover.add(x)));
            if (cover.size !== n) continue;
            const baseLines = new Set(set.map(s => s.l));
            let ch = false;
            for (const x of cover) ch = elim(UNITS[coverOff + x].filter(c => !baseLines.has(lineOf[c])), b) || ch;
            if (ch) return true;
          }
        }
      }
      return false;
    }
    function xyWing() {
      for (let p = 0; p < 81; p++) {
        if (val[p] || POP[cand[p]] !== 2) continue;
        const pm = cand[p];
        const wings = PEERS[p].filter(c => !val[c] && POP[cand[c]] === 2 && POP[cand[c] & pm] === 1);
        for (let i = 0; i < wings.length; i++) for (let j = i + 1; j < wings.length; j++) {
          const a = wings[i], b2 = wings[j];
          if ((cand[a] & pm) === (cand[b2] & pm)) continue;
          const z = cand[a] & ~pm;
          if (z !== (cand[b2] & ~pm) || POP[z] !== 1) continue;
          const targets = PEERS[a].filter(c => c !== b2 && c !== p && sees(c, b2));
          if (elim(targets, z)) return true;
        }
      }
      return false;
    }
    function xyzWing() {
      for (let p = 0; p < 81; p++) {
        if (val[p] || POP[cand[p]] !== 3) continue;
        const pm = cand[p];
        const wings = PEERS[p].filter(c => !val[c] && POP[cand[c]] === 2 && (cand[c] & ~pm) === 0);
        for (let i = 0; i < wings.length; i++) for (let j = i + 1; j < wings.length; j++) {
          const a = wings[i], b2 = wings[j];
          if ((cand[a] | cand[b2]) !== pm) continue;
          const z = cand[a] & cand[b2];
          if (POP[z] !== 1) continue;
          const targets = PEERS[p].filter(c => c !== a && c !== b2 && sees(c, a) && sees(c, b2));
          if (elim(targets, z)) return true;
        }
      }
      return false;
    }

    const TECH = [
      [0, nakedSingle], [0, hiddenSingle],
      [1, locked], [1, () => nakedSubset(2)], [1, () => hiddenSubset(2)],
      [2, () => nakedSubset(3)], [2, () => hiddenSubset(3)], [2, () => fish(2)], [2, xyWing],
      [3, () => fish(3)], [3, xyzWing], [3, () => nakedSubset(4)], [3, () => hiddenSubset(4)],
    ];
    let maxLevel = 0, hardSteps = 0;
    while (filled < 81) {
      let progressed = false;
      for (const [lvl, fn] of TECH) {
        if (fn()) { progressed = true; if (lvl > maxLevel) maxLevel = lvl; if (lvl >= 2) hardSteps++; break; }
      }
      if (!progressed) return { level: 4, hardSteps, solved: false };
    }
    return { level: maxLevel, hardSteps, solved: true };
  }

  // --- Niveles de dificultad
  const LEVELS = [
    { id: 1, name: 'Muy fácil', clues: [40, 44], want: l => l === 0 },
    { id: 2, name: 'Fácil', clues: [32, 35], want: l => l === 0 },
    { id: 3, name: 'Medio', clues: null, want: l => l === 1 },
    { id: 4, name: 'Difícil', clues: null, want: l => l === 2 },
    { id: 5, name: 'Experto', clues: null, want: l => l >= 3 },
  ];
  const targetGrade = { 1: 0, 2: 0, 3: 1, 4: 2, 5: 3.5 };

  // Un intento: solución al azar + quitar pistas en pares simétricos mientras la solución siga siendo única
  function attempt(rand, lv) {
    const sol = fullGrid(rand);
    const puz = Int8Array.from(sol);
    const target = lv.clues ? lv.clues[0] + Math.floor(rand() * (lv.clues[1] - lv.clues[0] + 1)) : 17;
    const order = shuffle([...Array(41).keys()], rand); // celdas 0..40 y su simétrica 80-i
    let clues = 81;
    for (const i of order) {
      if (clues <= target) break;
      const j = 80 - i;
      const a = puz[i], b = puz[j];
      puz[i] = 0; puz[j] = 0;
      if (countSolutions(puz, 2) !== 1) { puz[i] = a; puz[j] = b; }
      else clues -= i === j ? 1 : 2;
    }
    return { puzzle: puz, solution: sol, clues };
  }

  // Generación por partes (para no congelar la pantalla). Determinística para una misma semilla.
  async function generate(seedStr, levelId, { maxAttempts = 600, yieldEvery = 4 } = {}) {
    const lv = LEVELS.find(l => l.id === levelId) || LEVELS[2];
    const rand = rng(seedStr + '|' + levelId);
    let best = null, bestDist = Infinity;
    for (let k = 0; k < maxAttempts; k++) {
      const a = attempt(rand, lv);
      const g = grade(a.puzzle);
      if (lv.want(g.level)) return { ...a, grade: g, level: lv.id, attempts: k + 1 };
      const dist = Math.abs(Math.min(g.level, 3.5) - targetGrade[lv.id]);
      if (dist < bestDist) { bestDist = dist; best = { ...a, grade: g, level: lv.id, attempts: k + 1 }; }
      if (yieldEvery && k % yieldEvery === yieldEvery - 1) await new Promise(r => setTimeout(r, 0));
    }
    return best;
  }

  const toStr = g => Array.from(g).join('');
  const fromStr = s => Int8Array.from(s.split('').map(Number));

  return { rng, hashSeed, generate, grade, countSolutions, LEVELS, toStr, fromStr, ROW, COL, BOX, UNITS };
})();
if (typeof module !== 'undefined') module.exports = SudokuCore;

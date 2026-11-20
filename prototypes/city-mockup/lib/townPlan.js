// A town plan from Wave Function Collapse (WFC): which cell of a square grid is a street, a main
// road, a lot of shops or houses, a park or woods, and which way each lot faces.
//
// Each cell is 32 m. Every module has a socket on each of its 4 sides, and two cells can sit side
// by side only if the sockets where they meet fit. The sockets make the town tidy by construction:
// every lot faces a street, streets join up, and two streets never run side by side.
//
// On top of plain WFC, as in wass08/wfc-magic-school:
// - Fixed constraints: the courthouse square, its ring road and the main streets are placed
//   first. The solver only decides which side streets leave them.
// - Weights by place: shops downtown and on the main streets, then flats, townhouses, houses,
//   and woods at the edge of town.
// - Affinity: parks, woods, shops and each kind of housing attract their own kind, so streets
//   get a character instead of a random mix.
// - Spacing: junctions are unlikely within 2 cells of another junction, so blocks are long
//   enough for a row of lots (the 'solitary' idea from wfc-magic-school, applied to junctions).
// - Soft size cap: a park gets less likely to grow as it gets bigger.
// - Solitary landmarks: one town hall, one school, one hospital and so on.
// - Restarts: a plan that contradicts itself, or whose streets don't all connect, is thrown
//   away and tried again with the next seed. Of the plans that work, the one with the fewest
//   defects (tiny loops of road, cells boxed in by streets) is kept.
//
// No three.js here, so it runs in Node too.

// Sides are in the order E (+x), S (+z), W (-x), N (-z)
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const opp = (d) => (d + 2) % 4;

// Sockets
//   r  a local street carries on across this side      m  a main road carries on
//   e  the side of a street (its verge), facing whatever is next to it
//   f  the front of a lot: it must face the side of a street
//   s  the side of a lot: it may face a street, as on a corner
//   b  the back of a lot: it faces other lots, never a street, so blocks are lots back to back
//   g  the edge of a park, woods or the square
const FITS = {
  r: ['r'], m: ['m'],
  e: ['f', 's', 'g'],
  f: ['e'],
  s: ['s', 'b', 'e', 'g'],
  b: ['b', 's', 'g'],
  g: ['g', 's', 'b', 'e'],
};
// Off the map: streets may run off it, but no lot can face it
const OFF_MAP = new Set(['r', 'm', 'e', 's', 'b', 'g']);
const fits = (a, b) => FITS[a].includes(b);
const isRoad = (s) => s === 'r' || s === 'm';

// 0 below a, rising to 1 at b, 1 until c, falling to 0 at e. d is 0 at the centre, 1 at the edge.
const band = (d, a, b, c, e) => (d <= a || d >= e ? 0 : d < b ? (d - a) / (b - a) : d <= c ? 1 : (e - d) / (e - c));

// The module catalogue. `sides` are E S W N at rotation 0; a lot's front is its N side.
// `weight(ctx)` sets how likely a module is in a cell: ctx.d is the distance from the centre
// (0 to 1), ctx.main is true next to a main road and ctx.ring next to the ring road.
// `kind` is road, main, lot, green or square. Main roads and the square only go where the
// fixed plan puts them.
const road = (w) => (ctx) => w * (0.3 + 0.35 * band(ctx.d, -1, 0, 0.35, 0.8));
// Junctions keep their distance from each other
const J = { group: 'junction', spacing: 2 };
export const MODULES = [
  // Local streets: mostly straight, a few junctions, very few dead ends
  { id: 'street', char: 'R', kind: 'road', sides: 'erer', rots: 2, weight: road(1) },
  { id: 'bend', char: 'R', kind: 'road', sides: 'rree', rots: 4, weight: road(0.12), ...J },
  { id: 'tee', char: 'R', kind: 'road', sides: 'rrre', rots: 4, weight: road(0.3), ...J },
  { id: 'crossing', char: 'R', kind: 'road', sides: 'rrrr', rots: 1, weight: road(0.15), ...J },
  { id: 'dead-end', char: 'R', kind: 'road', sides: 'eree', rots: 4, weight: road(0.01), ...J },
  // Main roads, only in the fixed plan. The solver picks which local streets leave them.
  { id: 'main', char: 'M', kind: 'main', sides: 'emem', rots: 2, weight: () => 1 },
  { id: 'main-bend', char: 'M', kind: 'main', sides: 'mmee', rots: 4, weight: () => 1 },
  { id: 'main-tee', char: 'M', kind: 'main', sides: 'mmme', rots: 4, weight: () => 1 },
  { id: 'main-crossing', char: 'M', kind: 'main', sides: 'mmmm', rots: 1, weight: () => 1 },
  { id: 'main-side-street', char: 'M', kind: 'main', sides: 'rmem', rots: 4, weight: () => 0.5, ...J },
  { id: 'main-cross-street', char: 'M', kind: 'main', sides: 'rmrm', rots: 2, weight: () => 0.3, ...J },
  { id: 'main-bend-street', char: 'M', kind: 'main', sides: 'mmer', rots: 4, weight: () => 0.3, ...J },
  { id: 'main-tee-street', char: 'M', kind: 'main', sides: 'mmmr', rots: 4, weight: () => 0.3, ...J },
  // Lots: front to the north at rotation 0, back to the south
  { id: 'shops', char: 'c', kind: 'lot', sides: 'sbsf', rots: 4, group: 'shops', affinity: 0.8,
    weight: ({ d, main }) => 3 * band(d, -1, 0, 0.3, 0.5) * (main ? 3 : 1) + (main ? 1.2 * band(d, 0.2, 0.3, 0.55, 0.7) : 0) },
  { id: 'corner-shop', char: 'c', kind: 'lot', sides: 'ffbb', rots: 4, group: 'shops', affinity: 0.8,
    weight: ({ d, main }) => 1.6 * band(d, -1, 0, 0.35, 0.55) * (main ? 1.5 : 1) },
  { id: 'flats', char: 'a', kind: 'lot', sides: 'sbsf', rots: 4, group: 'flats', affinity: 1,
    weight: ({ d }) => 1.5 * band(d, 0.12, 0.28, 0.48, 0.66) },
  { id: 'townhouses', char: 'u', kind: 'lot', sides: 'sbsf', rots: 4, group: 'townhouses', affinity: 1.4,
    weight: ({ d }) => 1.5 * band(d, 0.28, 0.42, 0.6, 0.78) },
  { id: 'houses', char: 'h', kind: 'lot', sides: 'sbsf', rots: 4, group: 'houses', affinity: 0.6,
    weight: ({ d }) => 2.4 * band(d, 0.38, 0.58, 2, 3) },
  { id: 'car-park', char: 'P', kind: 'lot', sides: 'sbsf', rots: 4, max: 6,
    weight: ({ d }) => 0.45 * band(d, 0.12, 0.22, 0.42, 0.6) },
  { id: 'garden', char: 'y', kind: 'lot', sides: 'bbbb', rots: 1,
    weight: ({ d }) => 0.3 * band(d, 0.3, 0.5, 2, 3) },
  { id: 'park', char: 'p', kind: 'green', sides: 'gggg', rots: 1, group: 'park', affinity: 2.5, softCap: 6,
    weight: ({ d }) => 0.3 * band(d, 0.1, 0.2, 0.7, 0.85) },
  { id: 'woods', char: 't', kind: 'green', sides: 'gggg', rots: 1, group: 'woods', affinity: 1.5,
    weight: ({ d }) => 2.4 * band(d, 0.72, 0.95, 3, 4) },
  // Landmarks: one of each
  { id: 'town-hall', char: 'T', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d, ring }) => (ring ? 8 : 0.2 * band(d, -1, 0, 0.3, 0.45)) },
  { id: 'bank', char: 'B', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d, ring }) => (ring ? 2 : 0.5 * band(d, -1, 0, 0.35, 0.5)) },
  { id: 'school', char: 'S', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d }) => 0.5 * band(d, 0.3, 0.4, 0.65, 0.8) },
  { id: 'fire-station', char: 'X', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d, main }) => (main ? 0.8 : 0.2) * band(d, 0.2, 0.3, 0.6, 0.75) },
  { id: 'police', char: 'O', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d }) => 0.4 * band(d, 0.15, 0.25, 0.5, 0.65) },
  { id: 'hospital', char: 'H', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d }) => 0.4 * band(d, 0.3, 0.4, 0.7, 0.85) },
  { id: 'data-centre', char: 'D', kind: 'lot', sides: 'sbsf', rots: 4, max: 1, weight: ({ d }) => 0.35 * band(d, 0.45, 0.55, 0.85, 0.95) },
  // The courthouse square, only where the fixed plan puts it
  { id: 'fountain', char: 'Q', kind: 'square', sides: 'gggg', rots: 1, weight: () => 1 },
  { id: 'square', char: 'q', kind: 'square', sides: 'gggg', rots: 1, weight: () => 1 },
];

export const LEGEND = `R street   M main road   c shops   a flats   u townhouses   h houses   P car park   y garden
p park   t woods   q square   Q fountain   T town hall   B bank   S school   X fire station
O police   H hospital   D data centre`;

// Every module in every rotation it can take. Rotation k turns each side k steps: E → S → W → N.
const VARIANTS = MODULES.flatMap((module) => Array.from({ length: module.rots }, (_, rot) => ({
  module, rot, sides: [0, 1, 2, 3].map((i) => module.sides[(i - rot + 4) % 4]),
})));
VARIANTS.forEach((v, i) => { v.index = i; });
const V = VARIANTS.length;
// ok[d][a * V + b]: variant b may sit on side d of variant a
const OK = DIRS.map((_, d) => {
  const t = new Uint8Array(V * V);
  for (const a of VARIANTS) for (const b of VARIANTS) t[a.index * V + b.index] = fits(a.sides[d], b.sides[opp(d)]) ? 1 : 0;
  return t;
});

// Variants that make their cell a road
const ROAD_VARIANT = Uint8Array.from(VARIANTS, (v) => (v.sides.some(isRoad) ? 1 : 0));
const SQUARES = [[-1, -1], [0, -1], [-1, 0], [0, 0]];   // the 2×2 squares a cell is part of, by top-left corner

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The fixed plan: a 3×3 square with a fountain, a ring road round it, and main streets out from
// the middle of 3 or 4 sides of the ring to the edge of the map.
// Returns, per cell, which sides carry a main road, or 'square'/'fountain'.
function fixedPlan(N, rng) {
  const c = (N - 1) / 2, fixed = new Map();
  const key = (x, z) => z * N + x;
  const addMain = (x, z, d) => {
    const k = key(x, z);
    const f = fixed.get(k) ?? { main: new Set() };
    f.main.add(d);
    fixed.set(k, f);
  };
  for (let z = c - 1; z <= c + 1; z++) for (let x = c - 1; x <= c + 1; x++) fixed.set(key(x, z), { square: x === c && z === c ? 'fountain' : 'square' });
  // The ring: each cell joins its two neighbours along the ring
  const ring = [];
  for (let x = c - 2; x <= c + 2; x++) ring.push([x, c - 2]);
  for (let z = c - 1; z <= c + 2; z++) ring.push([c + 2, z]);
  for (let x = c + 1; x >= c - 2; x--) ring.push([x, c + 2]);
  for (let z = c + 1; z >= c - 1; z--) ring.push([c - 2, z]);
  ring.forEach(([x, z], i) => {
    for (const [nx, nz] of [ring[(i + 1) % ring.length], ring[(i - 1 + ring.length) % ring.length]]) {
      addMain(x, z, DIRS.findIndex(([dx, dz]) => dx === nx - x && dz === nz - z));
    }
  });
  // Main streets: 3 or 4 of them
  const arms = [0, 1, 2, 3];
  if (rng() < 0.4) arms.splice(Math.floor(rng() * 4), 1);
  for (const d of arms) {
    const [dx, dz] = DIRS[d];
    let x = c + dx * 2, z = c + dz * 2;
    addMain(x, z, d);
    for (x += dx, z += dz; x >= 0 && z >= 0 && x < N && z < N; x += dx, z += dz) { addMain(x, z, d); addMain(x, z, opp(d)); }
  }
  return { fixed, arms };
}

// One attempt at a plan. Returns null if it contradicts itself or its streets don't all connect.
function attempt(N, seed) {
  const rng = mulberry32(seed);
  const n = N * N, c = (N - 1) / 2;
  const { fixed, arms } = fixedPlan(N, rng);
  const isMain = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !!fixed.get(z * N + x)?.main;
  const ringCell = (x, z) => Math.max(Math.abs(x - c), Math.abs(z - c)) === 2;
  // Whether a road with these sides would run alongside a straight stretch of main road two cells away
  const straightMain = (x, z, axis) => {
    const f = x >= 0 && z >= 0 && x < N && z < N && fixed.get(z * N + x)?.main;
    return !!f && f.has(axis) && f.has(axis + 2);
  };
  const parallelToMain = (x, z, sides) =>
    (sides[1] === 'r' && sides[3] === 'r' && (straightMain(x - 2, z, 1) || straightMain(x + 2, z, 1))) ||
    (sides[0] === 'r' && sides[2] === 'r' && (straightMain(x, z - 2, 0) || straightMain(x, z + 2, 0)));

  // Weights of every variant in every cell; 0 means not allowed there
  const weights = new Float64Array(n * V);
  const dom = new Uint8Array(n * V);
  for (let i = 0; i < n; i++) {
    const x = i % N, z = Math.floor(i / N);
    const ctx = {
      d: Math.min(1, Math.hypot(x - c, z - c) / (N / 2)),
      main: DIRS.some(([dx, dz]) => isMain(x + dx, z + dz)),
      ring: DIRS.some(([dx, dz]) => isMain(x + dx, z + dz) && ringCell(x + dx, z + dz)),
    };
    const f = fixed.get(i);
    for (const v of VARIANTS) {
      const { kind, id } = v.module;
      let ok;
      if (f?.square) ok = id === f.square;
      else if (f?.main) ok = kind === 'main' && [0, 1, 2, 3].every((s) => (v.sides[s] === 'm') === f.main.has(s));
      else ok = kind !== 'main' && kind !== 'square';
      // No local street runs alongside a main road two cells away (room for one lot, not two
      // back to back), though one may cross that line
      ok &&= !(kind === 'road' && parallelToMain(x, z, v.sides));
      // Sides facing off the map
      ok &&= DIRS.every(([dx, dz], s) => { const nx = x + dx, nz = z + dz; return (nx >= 0 && nz >= 0 && nx < N && nz < N) || OFF_MAP.has(v.sides[s]); });
      const w = ok ? v.module.weight(ctx) : 0;
      weights[i * V + v.index] = w;
      dom[i * V + v.index] = w > 0 ? 1 : 0;
    }
  }

  const chosen = new Int32Array(n).fill(-1);
  const order = new Int32Array(n).fill(-1);
  const counts = new Map();   // how many of each module so far
  const queue = [];
  const inQueue = new Uint8Array(n);
  const push = (i) => { if (!inQueue[i]) { inQueue[i] = 1; queue.push(i); } };
  const has = (i) => { for (let v = 0; v < V; v++) if (dom[i * V + v]) return true; return false; };
  const onlyRoads = (i) => { for (let v = 0; v < V; v++) if (dom[i * V + v] && !ROAD_VARIANT[v]) return false; return true; };

  // No 2×2 patch of road cells: that's a tiny loop round a point, or a slab of asphalt. Pairs of
  // sockets can't say this, so propagation checks it too: when three cells of a 2×2 can only be
  // roads, the fourth can't be one.
  function noRoadSquare(i) {
    const x = i % N, z = Math.floor(i / N);
    for (const [sx, sz] of SQUARES) {
      const x0 = x + sx, z0 = z + sz;
      if (x0 < 0 || z0 < 0 || x0 + 1 >= N || z0 + 1 >= N) continue;
      const open = [z0 * N + x0, z0 * N + x0 + 1, (z0 + 1) * N + x0, (z0 + 1) * N + x0 + 1].filter((j) => !onlyRoads(j));
      if (!open.length) return false;
      if (open.length > 1) continue;
      const j = open[0];
      let changed = false;
      for (let v = 0; v < V; v++) if (dom[j * V + v] && ROAD_VARIANT[v]) { dom[j * V + v] = 0; changed = true; }
      if (changed) { if (!has(j)) return false; push(j); }
    }
    return true;
  }

  // Arc consistency: drop any variant that has nothing it can sit next to on some side
  function propagate() {
    while (queue.length) {
      const i = queue.pop(); inQueue[i] = 0;
      if (onlyRoads(i) && !noRoadSquare(i)) return false;
      const x = i % N, z = Math.floor(i / N);
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        let changed = false;
        for (let b = 0; b < V; b++) {
          if (!dom[j * V + b]) continue;
          let supported = false;
          for (let a = 0; a < V && !supported; a++) supported = dom[i * V + a] === 1 && OK[d][a * V + b] === 1;
          if (!supported) { dom[j * V + b] = 0; changed = true; }
        }
        if (changed) { if (!has(j)) return false; push(j); }
      }
    }
    return true;
  }

  // The weight of a variant in a cell right now, with street spacing, affinity and the soft size cap
  function liveWeight(i, v) {
    const { module } = VARIANTS[v];
    let w = weights[i * V + v];
    if (!module.group && module.kind !== 'road') return w;
    const x = i % N, z = Math.floor(i / N);
    // Decided cells of the same group within r cells
    const near = (r) => {
      let same = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((dx || dz) && nx >= 0 && nz >= 0 && nx < N && nz < N && chosen[nz * N + nx] >= 0 && VARIANTS[chosen[nz * N + nx]].module.group === module.group) same++;
      }
      return same;
    };
    // A straight street two cells from a parallel street would leave room for only one lot
    // between them, not two back to back
    if (module.id === 'street') {
      const [ax, az] = VARIANTS[v].sides[0] === 'r' ? [0, 1] : [1, 0];
      for (const k of [-2, 2]) {
        const nx = x + ax * k, nz = z + az * k;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (fixed.get(j)?.main || (chosen[j] >= 0 && VARIANTS[chosen[j]].module.kind === 'road')) w *= 0.04;
      }
    }
    if (module.affinity) w *= 1 + module.affinity * near(1);
    if (module.spacing && near(module.spacing)) w *= 0.03;
    if (module.softCap) w *= Math.max(0.03, 1 - groupSize(i, module.group) / module.softCap);
    return w;
  }
  // Cells of the group this cell would join (already-decided neighbours, flood filled)
  function groupSize(i, group) {
    const seen = new Set([i]), stack = [i];
    while (stack.length && seen.size < 64) {
      const k = stack.pop(), x = k % N, z = Math.floor(k / N);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz, j = nz * N + nx;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen.has(j)) continue;
        if (chosen[j] >= 0 && VARIANTS[chosen[j]].module.group === group) { seen.add(j); stack.push(j); }
      }
    }
    return seen.size - 1;
  }

  for (let i = 0; i < n; i++) push(i);
  if (!propagate()) return null;

  for (let step = 0; step < n; step++) {
    // The undecided cell with the least entropy, with a little noise to break ties
    let best = -1, bestH = Infinity;
    for (let i = 0; i < n; i++) {
      if (chosen[i] >= 0) continue;
      let sum = 0, sumWL = 0, count = 0;
      for (let v = 0; v < V; v++) if (dom[i * V + v]) { const w = weights[i * V + v]; sum += w; sumWL += w * Math.log(w); count++; }
      if (count === 1) { best = i; bestH = -1; break; }
      const h = Math.log(sum) - sumWL / sum + rng() * 1e-3;
      if (h < bestH) { bestH = h; best = i; }
    }
    if (best < 0) break;
    // Pick a variant by weight
    let total = 0;
    const options = [];
    for (let v = 0; v < V; v++) if (dom[best * V + v]) { const w = liveWeight(best, v); options.push([v, w]); total += w; }
    let r = rng() * total, pick = options[options.length - 1][0];
    for (const [v, w] of options) { r -= w; if (r <= 0) { pick = v; break; } }
    for (let v = 0; v < V; v++) dom[best * V + v] = v === pick ? 1 : 0;
    chosen[best] = pick;
    order[best] = step;
    push(best);
    // Landmarks: once a module reaches its maximum, it's gone from every other cell
    const m = VARIANTS[pick].module;
    if (m.max) {
      counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
      if (counts.get(m.id) >= m.max) {
        for (let i = 0; i < n; i++) {
          if (chosen[i] >= 0) continue;
          let changed = false;
          for (const v of VARIANTS) if (v.module === m && dom[i * V + v.index]) { dom[i * V + v.index] = 0; changed = true; }
          if (changed) { if (!has(i)) return null; push(i); }
        }
      }
    }
    if (!propagate()) return null;
  }

  // Every street must connect to the main roads
  const roadCells = [];
  for (let i = 0; i < n; i++) if (VARIANTS[chosen[i]].sides.some(isRoad)) roadCells.push(i);
  const reached = new Set(), stack = roadCells.filter((i) => VARIANTS[chosen[i]].module.kind === 'main');
  stack.forEach((i) => reached.add(i));
  while (stack.length) {
    const i = stack.pop(), x = i % N, z = Math.floor(i / N), sides = VARIANTS[chosen[i]].sides;
    for (let d = 0; d < 4; d++) {
      if (!isRoad(sides[d])) continue;
      const nx = x + DIRS[d][0], nz = z + DIRS[d][1], j = nz * N + nx;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || reached.has(j)) continue;
      reached.add(j); stack.push(j);
    }
  }
  if (reached.size !== roadCells.length) return null;
  // Defects, to choose between plans: 2×2 patches of road cells (tiny loops or slabs of asphalt),
  // and cells boxed in by streets on all four sides
  const roadAt = (x, z) => x >= 0 && z >= 0 && x < N && z < N && VARIANTS[chosen[z * N + x]].sides.some(isRoad);
  let defects = 0;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    if (roadAt(x, z) && roadAt(x + 1, z) && roadAt(x, z + 1) && roadAt(x + 1, z + 1)) defects++;
    if (!roadAt(x, z) && DIRS.every(([dx, dz]) => roadAt(x + dx, z + dz))) defects++;
  }

  const cells = Array.from({ length: n }, (_, i) => {
    const v = VARIANTS[chosen[i]];
    return { x: i % N, z: Math.floor(i / N), id: v.module.id, char: v.module.char, kind: v.module.kind, rot: v.rot, sides: v.sides, order: order[i] };
  });
  return { cells, arms, defects };
}

/**
 * Plans a town. Several plans are made from the seed and the one with the fewest defects is kept.
 * @param {{ size?: number, seed?: number, tries?: number, keep?: number }} options size is the
 *   number of cells along each side (odd, so the square has a middle); keep is how many working
 *   plans to choose from
 * @returns {{ size: number, seed: number, tries: number, defects: number, cells: object[], map: string }}
 *   cells[z * size + x] = { x, z, id, char, kind, rot, sides: [E, S, W, N], order }, where order
 *   is when the solver decided it. map is the plan as text, one character per cell.
 */
export function planTown({ size = 25, seed = 1, tries = 200, keep = 6 } = {}) {
  const N = size % 2 ? size : size + 1;
  let best = null, found = 0, t = 0;
  while (t < tries && found < keep && best?.defects !== 0) {
    const plan = attempt(N, seed * 7919 + t++);
    if (!plan) continue;
    found++;
    if (!best || plan.defects < best.defects) best = plan;
  }
  if (!best) throw new Error(`No town found for seed ${seed} in ${tries} tries`);
  const map = Array.from({ length: N }, (_, z) => best.cells.slice(z * N, z * N + N).map((cell) => cell.char).join('')).join('\n');
  return { size: N, seed, tries: t, defects: best.defects, cells: best.cells, map };
}

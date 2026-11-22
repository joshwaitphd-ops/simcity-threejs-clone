// A coastal town planned by Wave Function Collapse (WFC): which 32 m cell is a street, a main
// road, a lot of shops, houses or industry, a field, the sea, and which way each lot faces.
//
// Zones come first, from the seed: a commercial core round the courthouse square, residential
// rings, an industrial wedge on one side running down to the coast, a rural band round the edge,
// and the sea along the south. Each module is weighted by zone, so the solver fills each zone
// with its own kind of building.
//
// Every module has a socket on each side, and two cells can sit side by side only if the
// sockets where they meet fit. That keeps the town tidy by construction: every lot faces a
// street, lots sit back to back, streets never run side by side without joining, and nothing
// but a beach or a port's quay faces the sea.
//
// On top of plain WFC, as in wass08/wfc-magic-school:
// - Fixed constraints: the square, its ring road, an outer loop road along the coast, the main
//   streets and the sea are placed first.
// - Weights by zone, and affinity: like attracts like, so streets and fields get a character.
// - Spacing: junctions keep 2 cells apart; substations, water towers, supermarkets and petrol
//   stations spread out.
// - No 2×2 patch of road (a tiny loop or a slab of asphalt), enforced during propagation.
// - Soft size cap on parks, wind farms and solar farms; at most one of each landmark.
// - Required buildings: every critical infrastructure site must appear. One that the solver
//   left out is put in by changing a filler lot with the same sockets, in the right zone.
// - Restarts: a plan that contradicts itself, or whose streets don't all connect, is dropped.
//
// Domains are bitsets, so propagation is a few word operations per neighbour. No three.js here,
// so it runs in Node too.

// Sides are in the order E (+x), S (+z), W (-x), N (-z)
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const opp = (d) => (d + 2) % 4;

// Sockets
//   r  a local street carries on across this side      m  a main road carries on
//   e  the side of a street (its verge), facing whatever is next to it
//   f  the front of a lot: it must face the side of a street
//   s  the side of a lot: it may face a street, as on a corner
//   b  the back of a lot: never a street, so blocks are lots back to back
//   g  the edge of a park, field, woods or the square
//   w  the sea         q  a quay or beach: must face the sea
const FITS = {
  r: ['r'], m: ['m'],
  e: ['f', 's', 'g', 'w'],
  f: ['e'],
  s: ['s', 'b', 'e', 'g', 'w'],
  b: ['b', 's', 'g', 'w'],
  g: ['g', 's', 'b', 'e', 'w'],
  w: ['w', 'g', 's', 'b', 'e', 'q'],
  q: ['w'],
};
// Off the map: streets and the sea may run off it, but no lot can face it
const OFF_MAP = new Set(['r', 'm', 'e', 's', 'b', 'g', 'w']);
const fits = (a, b) => FITS[a].includes(b);
const isRoad = (s) => s === 'r' || s === 'm';

// 0 below a, rising to 1 at b, 1 until c, falling to 0 at e
const band = (d, a, b, c, e) => (d <= a || d >= e ? 0 : d < b ? (d - a) / (b - a) : d <= c ? 1 : (e - d) / (e - c));
// A weight per zone: Z({ core: 1, residential: 0.5 }), times an optional function of the cell
const Z = (w, f = () => 1) => (ctx) => (w[ctx.zone] ?? 0) * f(ctx);
// Roads: fewer in the countryside
const ROADS = { core: 1, residential: 0.95, industrial: 0.85, rural: 0.05 };
const road = (w) => (ctx) => w * (ROADS[ctx.zone] ?? 0) * (0.3 + 0.35 * band(ctx.d, -1, 0, 0.35, 0.8));
// Junctions keep their distance from each other
const J = { group: 'junction', spacing: 2 };
const LOT = 'sbsf', GREEN = 'gggg', SHORE = 'sqsf';

// The module catalogue. `sides` are E S W N at rotation 0; a lot's front is its N side and its
// back its S side. ctx: zone, d (distance from the centre, 0 to 1), main (next to a main road),
// ring (next to the ring road), coast (cells to the sea). `max`: at most this many. `need`:
// at least this many, put in after solving if the solver left them out. `spacing`: keep that
// many cells from another of the same group.
export const MODULES = [
  // Streets
  { id: 'street', char: 'R', kind: 'road', sides: 'erer', rots: 2, weight: road(1) },
  { id: 'bend', char: 'R', kind: 'road', sides: 'rree', rots: 4, weight: road(0.12), ...J },
  { id: 'tee', char: 'R', kind: 'road', sides: 'rrre', rots: 4, weight: road(0.3), ...J },
  { id: 'crossing', char: 'R', kind: 'road', sides: 'rrrr', rots: 1, weight: road(0.15), ...J },
  // Dead ends are rare in town, but country roads may end at a farm
  { id: 'dead-end', char: 'R', kind: 'road', sides: 'eree', rots: 4, weight: (c) => (c.zone === 'rural' ? 0.08 : road(0.01)(c)), ...J },
  // Main roads, only where the fixed plan puts them
  { id: 'main', char: 'M', kind: 'main', sides: 'emem', rots: 2, weight: () => 1 },
  { id: 'main-bend', char: 'M', kind: 'main', sides: 'mmee', rots: 4, weight: () => 1 },
  { id: 'main-tee', char: 'M', kind: 'main', sides: 'mmme', rots: 4, weight: () => 1 },
  { id: 'main-crossing', char: 'M', kind: 'main', sides: 'mmmm', rots: 1, weight: () => 1 },
  { id: 'main-side-street', char: 'M', kind: 'main', sides: 'rmem', rots: 4, weight: (c) => (c.zone === 'rural' ? 0.02 : 0.5), ...J },
  { id: 'main-cross-street', char: 'M', kind: 'main', sides: 'rmrm', rots: 2, weight: (c) => (c.zone === 'rural' ? 0.005 : 0.3), ...J },
  { id: 'main-bend-street', char: 'M', kind: 'main', sides: 'mmer', rots: 4, weight: (c) => (c.zone === 'rural' ? 0.02 : 0.3), ...J },
  { id: 'main-tee-street', char: 'M', kind: 'main', sides: 'mmmr', rots: 4, weight: (c) => (c.zone === 'rural' ? 0.02 : 0.3), ...J },

  // Commercial
  { id: 'shops', char: 'c', kind: 'lot', sides: LOT, rots: 4, group: 'shops', affinity: 0.8, weight: Z({ core: 3, residential: 0.04 }, (c) => (c.main ? 3 : 1)) },
  { id: 'corner-shop', char: 'c', kind: 'lot', sides: 'ffbb', rots: 4, group: 'shops', affinity: 0.8, weight: Z({ core: 1.6, residential: 0.05 }, (c) => (c.main ? 1.5 : 1)) },
  { id: 'car-park', char: 'P', kind: 'lot', sides: LOT, rots: 4, max: 8, weight: Z({ core: 0.4, residential: 0.04, industrial: 0.3 }) },
  { id: 'supermarket', char: 'U', kind: 'lot', sides: LOT, rots: 4, max: 3, need: 2, group: 'supermarket', spacing: 7, weight: Z({ core: 0.25, residential: 0.12 }, (c) => (c.main ? 3 : 1)) },
  { id: 'petrol', char: 'g', kind: 'lot', sides: LOT, rots: 4, max: 3, need: 2, group: 'petrol', spacing: 7, weight: Z({ core: 0.1, residential: 0.2, industrial: 0.3, rural: 0.3 }, (c) => (c.main ? 6 : 0.05)) },
  { id: 'exchange', char: 'L', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ core: 0.25 }) },
  { id: 'studio', char: 'N', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ core: 0.25 }) },
  { id: 'energy-office', char: 'J', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ core: 0.25 }) },
  { id: 'payments-office', char: 'I', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ core: 0.25 }) },
  { id: 'station', char: 'C', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ core: 0.2, residential: 0.2 }, (c) => band(c.d, 0.15, 0.25, 0.4, 0.5)) },

  // Residential
  { id: 'flats', char: 'a', kind: 'lot', sides: LOT, rots: 4, group: 'flats', affinity: 1, weight: Z({ core: 0.5, residential: 1.5 }, (c) => band(c.d, 0.1, 0.2, 0.4, 0.55)) },
  { id: 'townhouses', char: 'u', kind: 'lot', sides: LOT, rots: 4, group: 'townhouses', affinity: 1.4, weight: Z({ residential: 1.5 }, (c) => band(c.d, 0.2, 0.32, 0.5, 0.65)) },
  { id: 'houses', char: 'h', kind: 'lot', sides: LOT, rots: 4, group: 'houses', affinity: 0.6, weight: Z({ residential: 2.4, rural: 0.1 }, (c) => band(c.d, 0.3, 0.45, 2, 3)) },
  { id: 'garden', char: 'y', kind: 'lot', sides: 'bbbb', rots: 1, weight: Z({ residential: 0.3 }) },
  { id: 'water-tower', char: 'v', kind: 'lot', sides: LOT, rots: 4, max: 2, need: 1, group: 'water-tower', spacing: 8, weight: Z({ residential: 0.15 }) },
  { id: 'pumping-station', char: 'k', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ residential: 0.1, industrial: 0.1 }) },
  { id: 'substation', char: 'e', kind: 'lot', sides: LOT, rots: 4, max: 9, need: 5, group: 'substation', spacing: 6, weight: Z({ core: 0.1, residential: 0.2, industrial: 0.25, rural: 0.1 }) },

  // Industrial
  { id: 'factory', char: 'i', kind: 'lot', sides: LOT, rots: 4, group: 'industry', affinity: 0.5, weight: Z({ industrial: 2.5 }) },
  { id: 'warehouse', char: 'W', kind: 'lot', sides: LOT, rots: 4, group: 'industry', affinity: 0.5, weight: Z({ industrial: 2.5 }) },
  { id: 'power-station', char: 'E', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ industrial: 0.25 }) },
  { id: 'gas-plant', char: 'G', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ industrial: 0.25 }) },
  { id: 'fuel-terminal', char: 'F', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ industrial: 0.25 }, (c) => (c.coast < 4 ? 4 : 1)) },
  { id: 'freight-yard', char: 'Y', kind: 'lot', sides: LOT, rots: 4, max: 2, need: 1, weight: Z({ industrial: 0.3 }) },
  { id: 'food-distribution', char: 'd', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ industrial: 0.25 }) },
  { id: 'data-centre', char: 'D', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ industrial: 0.25, core: 0.05 }) },
  { id: 'sewage-works', char: 'Z', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ industrial: 0.2, rural: 0.2, residential: 0.02 }, (c) => (c.coast < 4 ? 5 : 0.2)) },

  // The coast: a port's quay or a beach faces the sea, its front a street
  { id: 'port', char: 'K', kind: 'lot', sides: SHORE, rots: 4, max: 2, need: 1, weight: Z({ industrial: 4, residential: 0.02 }) },
  { id: 'beach', char: 's', kind: 'lot', sides: SHORE, rots: 4, group: 'beach', affinity: 1.5, weight: Z({ core: 1.5, residential: 4, rural: 3, industrial: 0.05 }) },
  { id: 'sea', char: '~', kind: 'sea', sides: 'wwww', rots: 1, weight: () => 1 },

  // Rural
  { id: 'field', char: 'f', kind: 'green', sides: GREEN, rots: 1, group: 'field', affinity: 1.2, weight: Z({ rural: 3.5, industrial: 0.05 }) },
  { id: 'farm', char: 'b', kind: 'lot', sides: LOT, rots: 4, group: 'farm', spacing: 3, weight: Z({ rural: 0.6 }) },
  { id: 'wind', char: 'n', kind: 'green', sides: GREEN, rots: 1, group: 'wind', affinity: 3, softCap: 9, need: 4, weight: Z({ rural: 0.6 }) },
  { id: 'solar', char: 'o', kind: 'green', sides: GREEN, rots: 1, group: 'solar', affinity: 3, softCap: 6, need: 3, weight: Z({ rural: 0.4 }) },
  { id: 'reservoir', char: 'r', kind: 'green', sides: GREEN, rots: 1, max: 1, need: 1, weight: Z({ rural: 0.15 }) },
  { id: 'water-treatment', char: 'V', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ rural: 0.15, industrial: 0.05 }) },
  { id: 'transmitter', char: 'x', kind: 'green', sides: GREEN, rots: 1, max: 1, need: 1, weight: Z({ rural: 0.1 }) },
  { id: 'airfield', char: 'A', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ rural: 0.1 }) },
  { id: 'woods', char: 't', kind: 'green', sides: GREEN, rots: 1, group: 'woods', affinity: 1.5, weight: Z({ rural: 1.3, residential: 0.08, industrial: 0.1 }) },
  { id: 'park', char: 'p', kind: 'green', sides: GREEN, rots: 1, group: 'park', affinity: 2.5, softCap: 6, weight: Z({ core: 0.2, residential: 0.25 }) },

  // Landmarks: one of each
  { id: 'town-hall', char: 'T', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: (c) => (c.ring ? 8 : c.zone === 'core' ? 0.2 : 0) },
  { id: 'bank', char: 'B', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: (c) => (c.ring ? 2 : c.zone === 'core' ? 0.5 : 0) },
  { id: 'school', char: 'S', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ residential: 0.4 }) },
  { id: 'fire-station', char: 'X', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ residential: 0.3, core: 0.2 }, (c) => (c.main ? 3 : 1)) },
  { id: 'police', char: 'O', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ core: 0.3, residential: 0.2 }) },
  { id: 'hospital', char: 'H', kind: 'lot', sides: LOT, rots: 4, max: 1, need: 1, weight: Z({ residential: 0.3 }, (c) => (c.main ? 3 : 1) * band(c.d, 0.15, 0.25, 0.5, 0.65)) },

  // The courthouse square, only where the fixed plan puts it
  { id: 'fountain', char: 'Q', kind: 'square', sides: GREEN, rots: 1, weight: () => 1 },
  { id: 'square', char: 'q', kind: 'square', sides: GREEN, rots: 1, weight: () => 1 },
];

export const LEGEND = `R street   M main road   ~ sea   s beach   K port
Commercial: c shops   P car park   U supermarket   g petrol   L telephone exchange   N broadcast studio
  J energy market operator (local office)   I payment systems (local office)   C station and bus depot
Residential: a flats   u townhouses   h houses   y garden   v water tower   k pumping station   e substation
Industrial: i factory   W warehouse   E power station   G gas plant   F fuel terminal   Y freight yard
  d food distribution   D data centre   Z sewage works
Rural: f field   b farm   n wind turbine   o solar farm   r reservoir   V water treatment   x transmitter mast
  A airfield   t woods
Other: p park   q square   Q fountain   T town hall   B bank   S school   X fire station   O police   H hospital`;

// ---------------------------------------------------------------- variants and bitsets
const VARIANTS = MODULES.flatMap((module) => Array.from({ length: module.rots }, (_, rot) => ({
  module, rot, sides: [0, 1, 2, 3].map((i) => module.sides[(i - rot + 4) % 4]),
})));
VARIANTS.forEach((v, i) => { v.index = i; });
const V = VARIANTS.length, WORDS = Math.ceil(V / 32);
const bit = (v) => [v >> 5, 1 << (v & 31)];
// COMPAT[(a * 4 + d) * WORDS + k]: the variants that may sit on side d of variant a
const COMPAT = new Uint32Array(V * 4 * WORDS);
for (const a of VARIANTS) for (let d = 0; d < 4; d++) for (const b of VARIANTS) {
  if (!fits(a.sides[d], b.sides[opp(d)])) continue;
  const [w, m] = bit(b.index);
  COMPAT[(a.index * 4 + d) * WORDS + w] |= m;
}
const maskOf = (test) => {
  const m = new Uint32Array(WORDS);
  for (const v of VARIANTS) if (test(v)) { const [w, b] = bit(v.index); m[w] |= b; }
  return m;
};
const ROAD = maskOf((v) => v.sides.some(isRoad));
const MODULE_MASK = new Map(MODULES.map((m) => [m, maskOf((v) => v.module === m)]));

// The modules a cleared patch may be refilled with: no streets, no landmarks
const REFILL = maskOf((v) => ['garden', 'park', 'woods', 'field', 'houses', 'townhouses', 'flats', 'shops', 'factory', 'warehouse', 'farm', 'car-park', 'beach'].includes(v.module.id));

// The variant of the same kind (road or main) with side d turned from verge into road, if any
const BY_SIDES = new Map(VARIANTS.map((v) => [`${v.module.kind}:${v.sides.join('')}`, v]));
function withRoad(v, d) {
  const sides = v.sides.slice();
  sides[d] = 'r';
  return BY_SIDES.get(`${v.module.kind}:${sides.join('')}`) ?? null;
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Smooth value noise from the seed, 0 to 1
function noise(seed) {
  const h = (i, j) => { let x = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 1442695041); x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967296; };
  return (x, z) => {
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = h(i, j) + (h(i + 1, j) - h(i, j)) * u, b = h(i, j + 1) + (h(i + 1, j + 1) - h(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}

// ---------------------------------------------------------------- zones
// Per cell: 'sea', 'core', 'residential', 'industrial' or 'rural'. The sea runs along the south
// edge with a wandering coastline. The industrial wedge points east-south-east, so it reaches the
// coast for the port, and the main road east runs through it as the highway.
function zonesFor(N, seed) {
  const c = (N - 1) / 2, n1 = noise(seed * 31 + 7), n2 = noise(seed * 17 + 3);
  const coastAt = (x) => c + N * 0.31 + (n1(x * 0.12, 0.5) - 0.5) * 6;
  const zone = new Array(N * N), coastDist = new Array(N * N).fill(Infinity);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const dx = x - c, dz = z - c, r = Math.hypot(dx, dz) / (N / 2), wob = (n2(x * 0.25, z * 0.25) - 0.5) * 0.12;
    const angle = Math.atan2(dz, dx), toInd = Math.abs(Math.atan2(Math.sin(angle - 0.42), Math.cos(angle - 0.42)));
    let zn;
    if (z > coastAt(x)) zn = 'sea';
    else if (Math.max(Math.abs(dx), Math.abs(dz)) <= 4 && r < 0.3) zn = 'core';
    else if (toInd < 0.62 + wob * 2 && r > 0.3) zn = 'industrial';
    else if (r > 0.7 + wob) zn = 'rural';
    else zn = 'residential';
    zone[z * N + x] = zn;
  }
  // Cells to the nearest sea cell
  const queue = [];
  zone.forEach((zn, i) => { if (zn === 'sea') { coastDist[i] = 0; queue.push(i); } });
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], x = i % N, z = Math.floor(i / N);
    for (const [dx, dz] of DIRS) {
      const nx = x + dx, nz = z + dz, j = nz * N + nx;
      if (nx < 0 || nz < 0 || nx >= N || nz >= N || coastDist[j] <= coastDist[i] + 1) continue;
      coastDist[j] = coastDist[i] + 1; queue.push(j);
    }
  }
  return { zone, coastDist };
}

// The fixed plan: a 3×3 square with a fountain, a ring road round it, an outer loop road whose
// south side runs along the coast as the esplanade, and main streets from the ring: east, west
// and north to the edge of the map, and south to the esplanade.
function fixedPlan(N, zone) {
  const c = (N - 1) / 2, fixed = new Map();
  const key = (x, z) => z * N + x;
  const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;
  const addMain = (x, z, d) => { const k = key(x, z), f = fixed.get(k) ?? { main: new Set() }; f.main.add(d); fixed.set(k, f); };
  const link = (a, b) => { addMain(a[0], a[1], DIRS.findIndex(([dx, dz]) => dx === b[0] - a[0] && dz === b[1] - a[1])); addMain(b[0], b[1], DIRS.findIndex(([dx, dz]) => dx === a[0] - b[0] && dz === a[1] - b[1])); };
  const loop = (R) => {
    const pts = [];
    for (let x = c - R; x <= c + R; x++) pts.push([x, c - R]);
    for (let z = c - R + 1; z <= c + R; z++) pts.push([c + R, z]);
    for (let x = c + R - 1; x >= c - R; x--) pts.push([x, c + R]);
    for (let z = c + R - 1; z >= c - R + 1; z--) pts.push([c - R, z]);
    pts.forEach((p, i) => link(p, pts[(i + 1) % pts.length]));
  };
  for (let z = c - 1; z <= c + 1; z++) for (let x = c - 1; x <= c + 1; x++) fixed.set(key(x, z), { square: x === c && z === c ? 'fountain' : 'square' });
  loop(2);
  // The outer loop, as big as fits with a row of land between it and the sea
  let firstSea = N;
  for (let i = 0; i < N * N; i++) if (zone[i] === 'sea') firstSea = Math.min(firstSea, Math.floor(i / N));
  const R = Math.max(4, Math.min(Math.round(N * 0.2), firstSea - 2 - c));
  loop(R);
  // Main streets out from the ring
  for (const d of [0, 1, 2, 3]) {
    const [dx, dz] = DIRS[d];
    let prev = [c + dx * 2, c + dz * 2];
    for (let x = prev[0] + dx, z = prev[1] + dz; inMap(x, z) && zone[key(x, z)] !== 'sea'; x += dx, z += dz) {
      link(prev, [x, z]); prev = [x, z];
      if (d === 1 && z === c + R) break;   // the street south stops at the esplanade
    }
    // Main roads run on off the edge of the map
    if (!inMap(prev[0] + dx, prev[1] + dz)) addMain(prev[0], prev[1], d);
  }
  for (let i = 0; i < N * N; i++) if (zone[i] === 'sea') fixed.set(i, { sea: true });
  return fixed;
}

// ---------------------------------------------------------------- one attempt
function attempt(N, seed, zones) {
  const rng = mulberry32(seed);
  const n = N * N, c = (N - 1) / 2;
  const fixed = fixedPlan(N, zones.zone);
  const inMap = (x, z) => x >= 0 && z >= 0 && x < N && z < N;
  const isMain = (x, z) => inMap(x, z) && !!fixed.get(z * N + x)?.main;
  const ringCell = (x, z) => Math.max(Math.abs(x - c), Math.abs(z - c)) === 2;
  const straightMain = (x, z, axis) => { const f = inMap(x, z) && fixed.get(z * N + x)?.main; return !!f && f.has(axis) && f.has(axis + 2); };
  const parallelToMain = (x, z, sides) =>
    (sides[1] === 'r' && sides[3] === 'r' && (straightMain(x - 2, z, 1) || straightMain(x + 2, z, 1))) ||
    (sides[0] === 'r' && sides[2] === 'r' && (straightMain(x, z - 2, 0) || straightMain(x, z + 2, 0)));

  const weights = new Float64Array(n * V);
  const dom = new Uint32Array(n * WORDS);
  const ctxs = new Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % N, z = Math.floor(i / N);
    const ctx = ctxs[i] = {
      zone: zones.zone[i], coast: zones.coastDist[i],
      d: Math.min(1, Math.hypot(x - c, z - c) / (N / 2)),
      main: DIRS.some(([dx, dz]) => isMain(x + dx, z + dz)),
      ring: DIRS.some(([dx, dz]) => isMain(x + dx, z + dz) && ringCell(x + dx, z + dz)),
    };
    const f = fixed.get(i);
    for (const v of VARIANTS) {
      const { kind, id } = v.module;
      let ok;
      if (f?.sea) ok = kind === 'sea';
      else if (f?.square) ok = id === f.square;
      else if (f?.main) ok = kind === 'main' && [0, 1, 2, 3].every((s) => (v.sides[s] === 'm') === f.main.has(s));
      else ok = kind !== 'main' && kind !== 'square' && kind !== 'sea';
      ok &&= !(kind === 'road' && parallelToMain(x, z, v.sides));
      ok &&= DIRS.every(([dx, dz], s) => inMap(x + dx, z + dz) || OFF_MAP.has(v.sides[s]));
      const w = ok ? v.module.weight(ctx) : 0;
      weights[i * V + v.index] = w;
      if (w > 0) { const [k, m] = bit(v.index); dom[i * WORDS + k] |= m; }
    }
  }

  const initial = dom.slice();   // every cell's options before solving, for re-solving a patch
  const chosen = new Int32Array(n).fill(-1);
  const order = new Int32Array(n).fill(-1);
  const counts = new Map();
  const stack = [], inStack = new Uint8Array(n);
  const push = (i) => { if (!inStack[i]) { inStack[i] = 1; stack.push(i); } };
  const dirty = new Uint8Array(n).fill(1), entropy = new Float64Array(n), single = new Uint8Array(n);
  const has = (i) => { for (let k = 0; k < WORDS; k++) if (dom[i * WORDS + k]) return true; return false; };
  const onlyRoads = (i) => { for (let k = 0; k < WORDS; k++) if (dom[i * WORDS + k] & ~ROAD[k]) return false; return true; };
  const forEach = (i, fn) => {
    for (let k = 0; k < WORDS; k++) { let b = dom[i * WORDS + k]; while (b) { const t = b & -b; fn(k * 32 + 31 - Math.clz32(t)); b ^= t; } }
  };
  const allowed = new Uint32Array(WORDS);

  // No 2×2 patch of road: when three cells of a 2×2 can only be roads, the fourth can't be one
  function noRoadSquare(i) {
    const x = i % N, z = Math.floor(i / N);
    for (const [sx, sz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      const x0 = x + sx, z0 = z + sz;
      if (x0 < 0 || z0 < 0 || x0 + 1 >= N || z0 + 1 >= N) continue;
      const open = [z0 * N + x0, z0 * N + x0 + 1, (z0 + 1) * N + x0, (z0 + 1) * N + x0 + 1].filter((j) => !onlyRoads(j));
      if (!open.length) return false;
      if (open.length > 1) continue;
      const j = open[0];
      let changed = false;
      for (let k = 0; k < WORDS; k++) { const nw = (dom[j * WORDS + k] & ~ROAD[k]) >>> 0; if (nw !== dom[j * WORDS + k]) { dom[j * WORDS + k] = nw; changed = true; } }
      if (changed) { if (!has(j)) return false; dirty[j] = 1; push(j); }
    }
    return true;
  }
  function propagate() {
    while (stack.length) {
      const i = stack.pop(); inStack[i] = 0;
      if (onlyRoads(i) && !noRoadSquare(i)) return false;
      const x = i % N, z = Math.floor(i / N);
      for (let d = 0; d < 4; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
        if (!inMap(nx, nz)) continue;
        const j = nz * N + nx;
        allowed.fill(0);
        forEach(i, (a) => { const o = (a * 4 + d) * WORDS; for (let k = 0; k < WORDS; k++) allowed[k] |= COMPAT[o + k]; });
        let changed = false, any = false;
        for (let k = 0; k < WORDS; k++) {
          const nw = (dom[j * WORDS + k] & allowed[k]) >>> 0;
          if (nw !== dom[j * WORDS + k]) { dom[j * WORDS + k] = nw; changed = true; }
          if (nw) any = true;
        }
        if (!any) return false;
        if (changed) { dirty[j] = 1; push(j); }
      }
    }
    return true;
  }

  function liveWeight(i, v) {
    const { module } = VARIANTS[v];
    let w = weights[i * V + v];
    if (!module.group && module.id !== 'street') return w;
    const x = i % N, z = Math.floor(i / N);
    const near = (r) => {
      let same = 0;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, nz = z + dz;
        if ((dx || dz) && inMap(nx, nz) && chosen[nz * N + nx] >= 0 && VARIANTS[chosen[nz * N + nx]].module.group === module.group) same++;
      }
      return same;
    };
    // A straight street two cells from a parallel road leaves room for one lot, not two back to back
    if (module.id === 'street') {
      const [ax, az] = VARIANTS[v].sides[0] === 'r' ? [0, 1] : [1, 0];
      for (const k of [-2, 2]) {
        const nx = x + ax * k, nz = z + az * k;
        if (!inMap(nx, nz)) continue;
        const j = nz * N + nx;
        if (fixed.get(j)?.main || (chosen[j] >= 0 && VARIANTS[chosen[j]].module.kind === 'road')) w *= 0.04;
      }
    }
    if (module.affinity) w *= 1 + module.affinity * near(1);
    if (module.spacing && near(module.spacing)) w *= 0.01;
    if (module.softCap) w *= Math.max(0.03, 1 - groupSize(i, module.group) / module.softCap);
    return w;
  }
  function groupSize(i, group) {
    const seen = new Set([i]), st = [i];
    while (st.length && seen.size < 64) {
      const k = st.pop(), x = k % N, z = Math.floor(k / N);
      for (const [dx, dz] of DIRS) {
        const nx = x + dx, nz = z + dz, j = nz * N + nx;
        if (!inMap(nx, nz) || seen.has(j)) continue;
        if (chosen[j] >= 0 && VARIANTS[chosen[j]].module.group === group) { seen.add(j); st.push(j); }
      }
    }
    return seen.size - 1;
  }

  for (let i = 0; i < n; i++) push(i);
  if (!propagate()) return null;

  let step = 0;
  // Decides every undecided cell, least entropy first; false on a contradiction
  function collapse() {
  for (; step < 2 * n; step++) {
    // The undecided cell with the least entropy; entropies are cached until a cell's domain changes
    let best = -1, bestH = Infinity;
    for (let i = 0; i < n; i++) {
      if (chosen[i] >= 0) continue;
      if (dirty[i]) {
        let sum = 0, sumWL = 0, count = 0;
        forEach(i, (v) => { const w = weights[i * V + v]; sum += w; sumWL += w * Math.log(w); count++; });
        single[i] = count === 1 ? 1 : 0;
        entropy[i] = Math.log(sum) - sumWL / sum;
        dirty[i] = 0;
      }
      if (single[i]) { best = i; break; }
      const h = entropy[i] + rng() * 1e-3;
      if (h < bestH) { bestH = h; best = i; }
    }
    if (best < 0) break;
    let total = 0;
    const options = [];
    forEach(best, (v) => { const w = liveWeight(best, v); options.push([v, w]); total += w; });
    let r = rng() * total, pick = options[options.length - 1][0];
    for (const [v, w] of options) { r -= w; if (r <= 0) { pick = v; break; } }
    for (let k = 0; k < WORDS; k++) dom[best * WORDS + k] = 0;
    const [pw, pm] = bit(pick);
    dom[best * WORDS + pw] = pm;
    chosen[best] = pick; order[best] = step; dirty[best] = 1;
    push(best);
    const m = VARIANTS[pick].module;
    if (m.max) {
      counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
      if (counts.get(m.id) >= m.max) {
        const mask = MODULE_MASK.get(m);
        for (let i = 0; i < n; i++) {
          if (chosen[i] >= 0) continue;
          let changed = false;
          for (let k = 0; k < WORDS; k++) { const nw = (dom[i * WORDS + k] & ~mask[k]) >>> 0; if (nw !== dom[i * WORDS + k]) { dom[i * WORDS + k] = nw; changed = true; } }
          if (changed) { if (!has(i)) return false; dirty[i] = 1; push(i); }
        }
      }
    }
    if (!propagate()) return false;
  }
  return true;
  }
  if (!collapse()) return null;

  // Every street must connect to the main roads. A street network that doesn't is joined where
  // one of its streets runs beside a connected road: both facing sides turn from verge to road,
  // so a street becomes a tee and a main road gains a side street. Every such piece is in the
  // catalogue, so the plan stays valid.
  const variantAt = (i) => VARIANTS[chosen[i]];
  const reached = new Set();
  const spread = (start) => {
    const st = [start]; reached.add(start);
    while (st.length) {
      const i = st.pop(), x = i % N, z = Math.floor(i / N), sides = variantAt(i).sides;
      for (let d = 0; d < 4; d++) {
        if (!isRoad(sides[d])) continue;
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1], j = nz * N + nx;
        if (inMap(nx, nz) && !reached.has(j)) { reached.add(j); st.push(j); }
      }
    }
  };
  for (let i = 0; i < n; i++) if (variantAt(i).module.kind === 'main' && !reached.has(i)) spread(i);
  const isRoadCell = (i) => variantAt(i).sides.some(isRoad);
  for (let guard = 0; guard < n; guard++) {
    let join = null;
    for (let i = 0; i < n && !join; i++) {
      if (!isRoadCell(i) || reached.has(i)) continue;
      const x = i % N, z = Math.floor(i / N);
      for (let d = 0; d < 4 && !join; d++) {
        const nx = x + DIRS[d][0], nz = z + DIRS[d][1], j = nz * N + nx;
        if (!inMap(nx, nz) || !reached.has(j) || variantAt(i).sides[d] !== 'e' || variantAt(j).sides[opp(d)] !== 'e') continue;
        const a = withRoad(variantAt(i), d), b = withRoad(variantAt(j), opp(d));
        if (a && b) join = [i, a, j, b];
      }
    }
    if (!join) break;
    const [i, a, j, b] = join;
    chosen[i] = a.index; chosen[j] = b.index;
    spread(i);
  }
  const strandedLeft = new Set();
  // Street networks still cut off are cleared, with the lots that face them, and the patch is
  // solved again with streets ruled out ("modifying in blocks", as in wfc-magic-school), so it
  // fills in with gardens, parks or lots facing the streets around it.
  for (let i0 = 0; i0 < n; i0++) {
    if (!isRoadCell(i0) || reached.has(i0) || fixed.get(i0)) continue;
    const comp = [i0], seenC = new Set(comp);
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % N, z = Math.floor(i / N);
      for (const [dx, dz] of DIRS) { const j = (z + dz) * N + x + dx; if (inMap(x + dx, z + dz) && !seenC.has(j) && isRoadCell(j) && !reached.has(j)) { seenC.add(j); comp.push(j); } }
    }
    const patch = new Set(comp);
    for (const i of comp) {
      const x = i % N, z = Math.floor(i / N);
      for (const [dx, dz] of DIRS) { const j = (z + dz) * N + x + dx; if (inMap(x + dx, z + dz) && !isRoadCell(j) && !fixed.get(j)) patch.add(j); }
    }
    const saved = [...patch].map((i) => [i, chosen[i], dom.slice(i * WORDS, (i + 1) * WORDS)]);
    for (const i of patch) {
      chosen[i] = -1; dirty[i] = 1;
      for (let k = 0; k < WORDS; k++) dom[i * WORDS + k] = (initial[i * WORDS + k] & REFILL[k]) >>> 0;
      push(i);
      const x = i % N, z = Math.floor(i / N);
      for (const [dx, dz] of DIRS) if (inMap(x + dx, z + dz)) push((z + dz) * N + x + dx);
    }
    if (![...patch].every(has) || !propagate() || !collapse()) {
      stack.length = 0; inStack.fill(0);
      for (const [i, ch, d] of saved) { chosen[i] = ch; dom.set(d, i * WORDS); dirty[i] = 1; }
      for (const i of comp) reached.add(i);   // leave it; counted below
      comp.forEach((i) => strandedLeft.add(i));
    }
  }
  const roadCells = [];
  for (let i = 0; i < n; i++) if (isRoadCell(i)) roadCells.push(i);
  const stranded = roadCells.filter((i) => !reached.has(i) || strandedLeft.has(i)).length;   // road cells still cut off

  const cells = Array.from({ length: n }, (_, i) => {
    const v = VARIANTS[chosen[i]];
    return { x: i % N, z: Math.floor(i / N), id: v.module.id, char: v.module.char, kind: v.module.kind, rot: v.rot, sides: v.sides, order: order[i], zone: zones.zone[i] };
  });
  const missing = ensureRequired(cells, ctxs);
  // Defects, to choose between plans: cells boxed in by streets, and required buildings left out
  const roadAt = (x, z) => inMap(x, z) && cells[z * N + x].sides.some(isRoad);
  let defects = missing * 10 + stranded * 3;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) if (!roadAt(x, z) && cells[z * N + x].kind !== 'sea' && DIRS.every(([dx, dz]) => roadAt(x + dx, z + dz))) defects++;
  return { cells, defects, stranded };
}

// Puts in every required building the solver left out, by changing a filler cell with the same
// sockets (so the plan stays valid) in the best place for it. Returns how many couldn't be placed.
const REQUIRED = MODULES.filter((m) => m.need);
const FILLER = new Set(['shops', 'flats', 'townhouses', 'houses', 'garden', 'car-park', 'factory', 'warehouse', 'field', 'woods', 'park', 'farm', 'beach']);
const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));
function ensureRequired(cells, ctxs) {
  let missing = 0;
  for (const m of REQUIRED) {
    let have = cells.filter((k) => k.id === m.id).length;
    while (have < m.need) {
      const others = cells.filter((o) => o.id === m.id);
      let best = null, bestScore = 0;
      for (const [i, k] of cells.entries()) {
        if (!FILLER.has(k.id) || MODULE_BY_ID.get(k.id).sides !== m.sides) continue;
        let score = m.weight(ctxs[i]);
        if (score <= 0) continue;
        // Wind and solar farms grow next to their own kind; everything else keeps apart
        const dist = others.length ? Math.min(...others.map((o) => Math.hypot(o.x - k.x, o.z - k.z))) : 99;
        if (m.affinity) score *= dist <= 1.01 ? 5 : others.length ? 0.2 : 1;
        else if (dist < (m.spacing ?? 4)) score *= 0.05;
        score *= 1 + 0.001 * ((i * 2654435761) % 997);   // a deterministic tie-break
        if (score > bestScore) { bestScore = score; best = k; }
      }
      if (!best) { missing++; break; }
      Object.assign(best, { id: m.id, char: m.char, kind: m.kind });
      have++;
    }
  }
  return missing;
}

/**
 * Plans a town. Several plans are made from the seed and the one with the fewest defects is kept.
 * @param {{ size?: number, seed?: number, tries?: number, keep?: number }} options size is the
 *   number of cells along each side (odd, so the square has a middle)
 * @returns {{ size: number, seed: number, tries: number, defects: number, cells: object[], map: string }}
 *   cells[z * size + x] = { x, z, id, char, kind, rot, sides: [E, S, W, N], order, zone }
 */
export function planTown({ size = 35, seed = 1, tries = 150, keep = 8 } = {}) {
  const N = size % 2 ? size : size + 1;
  const zones = zonesFor(N, seed);
  let best = null, found = 0, t = 0;
  while (t < tries && found < keep && best?.defects !== 0) {
    const plan = attempt(N, seed * 7919 + t++, zones);
    if (!plan) continue;
    found++;
    if (!best || plan.defects < best.defects) best = plan;
  }
  if (!best) throw new Error(`No town found for seed ${seed} in ${tries} tries`);
  const map = Array.from({ length: N }, (_, z) => best.cells.slice(z * N, z * N + N).map((cell) => cell.char).join('')).join('\n');
  return { size: N, seed, tries: t, defects: best.defects, cells: best.cells, map };
}

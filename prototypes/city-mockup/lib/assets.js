// Infrastructure the kit doesn't have, built from simple shapes and coloured from the kit's own
// palette (textures/base.png), so it takes the same textures, lighting and building detail.
// Every function returns one merged mesh, standing on y = 0 and centred on x = z = 0, in scene
// units (1 unit = one 32 m cell). Fronts face +z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Palette swatches: [u, v] of the middle of a 128 px square in the 8×8 palette
const sw = (c, r) => [(c + 0.5) / 8, (r + 0.5) / 8];
export const PAL = {
  white: sw(1, 7), cream: sw(6, 1), light: sw(6, 2), concrete: sw(5, 2), grey: sw(4, 2), mid: sw(3, 2), dark: sw(1, 2), black: sw(0, 2),
  red: sw(1, 3), deepRed: sw(0, 3), brick: sw(3, 0), tan: sw(4, 1), wood: sw(2, 1), darkWood: sw(1, 1), yellow: sw(5, 3), orange: sw(3, 3),
  amber: sw(4, 3), green: sw(3, 4), darkGreen: sw(1, 4), murky: sw(2, 4), water: sw(3, 5), sea: sw(2, 5), navy: sw(0, 5), glass: sw(7, 7),
};

// Collects shapes, each painted one palette colour, and merges them into one mesh
class Shape {
  constructor() { this.parts = []; }
  add(geo, colour, matrix) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, colour[0], colour[1]);
    if (matrix) g.applyMatrix4(matrix);
    this.parts.push(g);
    return this;
  }
  // A box standing on `at` (its bottom centre), turned `ry` about y
  box(w, h, d, colour, at = [0, 0, 0], ry = 0) {
    return this.add(new THREE.BoxGeometry(w, h, d), colour, new THREE.Matrix4().makeRotationY(ry).setPosition(at[0], at[1] + h / 2, at[2]));
  }
  // A cylinder standing on `at`
  cyl(rTop, rBottom, h, colour, at = [0, 0, 0], seg = 14) {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, seg), colour, new THREE.Matrix4().makeTranslation(at[0], at[1] + h / 2, at[2]));
  }
  sphere(r, colour, at = [0, 0, 0], seg = 14) {
    return this.add(new THREE.SphereGeometry(r, seg, Math.ceil(seg / 2)), colour, new THREE.Matrix4().makeTranslation(...at));
  }
  // A thin rod from a to b
  rod(a, b, r, colour, seg = 6) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    return this.add(new THREE.CylinderGeometry(r, r, len, seg), colour, new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
  }
  // A gable roof: a triangular prism w wide, h high, d long (along z), sitting on `at`
  roof(w, h, d, colour, at = [0, 0, 0], ry = 0) {
    const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
    g.translate(0, 0, -d / 2);
    return this.add(g, colour, new THREE.Matrix4().makeRotationY(ry).setPosition(...at));
  }
  mesh(material) {
    const m = new THREE.Mesh(mergeGeometries(this.parts), material);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
}

// A wind turbine about 50 m to the hub, with three blades at a random angle
export function windTurbine(material, spin = 0) {
  const s = new Shape(), hub = [0, 1.42, 0.075];
  s.cyl(0.07, 0.07, 0.012, PAL.concrete).cyl(0.018, 0.04, 1.42, PAL.white);
  s.box(0.05, 0.05, 0.14, PAL.white, [0, 1.395, 0.02]);
  s.sphere(0.028, PAL.white, hub);
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BoxGeometry(0.032, 0.62, 0.008).translate(0, 0.33, 0).rotateZ(spin + (k * Math.PI * 2) / 3);
    s.add(g, PAL.white, new THREE.Matrix4().makeTranslation(...hub));
  }
  return s.mesh(material);
}

// Rows of tilted solar panels filling a w × d area, with an inverter shed
export function solarArray(material, w = 0.84, d = 0.84) {
  const s = new Shape(), rows = Math.floor(d / 0.12);
  for (let r = 0; r < rows; r++) {
    const z = -d / 2 + 0.06 + r * 0.12;
    s.add(new THREE.BoxGeometry(w - 0.1, 0.006, 0.075), PAL.navy, new THREE.Matrix4().makeRotationX(-0.45).setPosition(0, 0.035, z));
    for (let x = -w / 2 + 0.08; x < w / 2 - 0.05; x += 0.16) s.box(0.006, 0.03, 0.006, PAL.mid, [x, 0, z]);
  }
  s.box(0.06, 0.05, 0.04, PAL.light, [w / 2 - 0.04, 0, d / 2 - 0.03]);
  return s.mesh(material);
}

// A zone substation: transformers, a gantry of busbars, and a control building, on gravel
export function substation(material) {
  const s = new Shape();
  s.box(0.64, 0.004, 0.52, PAL.concrete);
  for (const x of [-0.14, 0.06]) {
    s.box(0.1, 0.08, 0.08, PAL.mid, [x, 0, -0.06]);
    for (let k = 0; k < 4; k++) s.box(0.004, 0.06, 0.1, PAL.grey, [x - 0.055 + k * 0.035 * 0, 0.01, -0.06 + 0 * k]);
    for (let k = -1; k <= 1; k++) s.cyl(0.006, 0.006, 0.04, PAL.white, [x + k * 0.03, 0.08, -0.06]);
  }
  for (const x of [-0.24, -0.04, 0.16]) for (const z of [0.1, 0.2]) s.cyl(0.006, 0.006, 0.17, PAL.mid, [x, 0, z]);
  for (const z of [0.1, 0.2]) s.box(0.42, 0.008, 0.008, PAL.mid, [-0.04, 0.165, z]);
  for (const x of [-0.24, -0.14, -0.04, 0.06, 0.16]) s.cyl(0.005, 0.005, 0.03, PAL.white, [x, 0.135, 0.15]);
  s.box(0.14, 0.09, 0.11, PAL.brick, [0.22, 0, -0.14]).box(0.15, 0.01, 0.12, PAL.dark, [0.22, 0.09, -0.14]);
  return s.mesh(material);
}

// A phone mast: a monopole with three antenna panels and an equipment cabinet
export function mobileTower(material, h = 0.95) {
  const s = new Shape();
  s.cyl(0.011, 0.02, h, PAL.light);
  s.cyl(0.05, 0.05, 0.008, PAL.mid, [0, h - 0.09, 0], 3);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3;
    s.box(0.024, 0.09, 0.01, PAL.white, [Math.sin(a) * 0.04, h - 0.1, Math.cos(a) * 0.04], a);
  }
  s.box(0.07, 0.055, 0.045, PAL.grey, [0.06, 0, 0]);
  return s.mesh(material);
}

// A broadcast transmitter mast about 75 m tall, red and white, held by guy wires
export function transmitterMast(material, h = 2.3) {
  const s = new Shape(), n = 10;
  for (let k = 0; k < n; k++) {
    const r0 = 0.028 - (k / n) * 0.016, r1 = 0.028 - ((k + 1) / n) * 0.016;
    s.cyl(r1, r0, h / n, k % 2 ? PAL.white : PAL.red, [0, (k * h) / n, 0], 6);
  }
  s.cyl(0.004, 0.004, 0.25, PAL.mid, [0, h, 0], 5);
  for (let k = 0; k < 3; k++) {
    const a = (k * Math.PI * 2) / 3 + 0.4, anchor = [Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7];
    for (const f of [0.35, 0.7]) s.rod([0, h * f, 0], anchor, 0.002, PAL.dark, 4);
    s.box(0.04, 0.02, 0.04, PAL.concrete, anchor);
  }
  s.box(0.14, 0.08, 0.1, PAL.concrete, [0.18, 0, 0]).box(0.15, 0.01, 0.11, PAL.dark, [0.18, 0.08, 0]);
  return s.mesh(material);
}

// A water tower: a tank on four braced legs, about 23 m tall
export function waterTower(material) {
  const s = new Shape(), top = 0.55;
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.rod([x * 0.09, 0, z * 0.09], [x * 0.06, top, z * 0.06], 0.008, PAL.mid);
  for (const y of [0.18, 0.36]) {
    const r = 0.09 - (y / top) * 0.03;
    for (const [a, b] of [[[-r, -r], [r, -r]], [[r, -r], [r, r]], [[r, r], [-r, r]], [[-r, r], [-r, -r]]]) s.rod([a[0], y, a[1]], [b[0], y, b[1]], 0.004, PAL.mid);
  }
  s.cyl(0.035, 0.035, top, PAL.grey);
  s.cyl(0.13, 0.13, 0.14, PAL.light, [0, top, 0], 18).cyl(0.005, 0.135, 0.05, PAL.mid, [0, top + 0.14, 0], 18);
  return s.mesh(material);
}

// A pumping station: a brick building with a gable roof, pipes and a valve chamber
export function pumpingStation(material) {
  const s = new Shape();
  s.box(0.24, 0.1, 0.16, PAL.brick).roof(0.27, 0.07, 0.18, PAL.dark, [0, 0.1, 0], Math.PI / 2);
  s.box(0.05, 0.06, 0.005, PAL.wood, [0, 0, 0.082]);
  for (const z of [-0.04, 0.04]) s.rod([0.12, 0.03, z], [0.36, 0.03, z], 0.012, PAL.mid, 8);
  s.box(0.08, 0.025, 0.12, PAL.concrete, [0.28, 0, 0]);
  return s.mesh(material);
}

// Water or sewage treatment: round clarifiers with bridges, long basins and a control building
export function treatmentWorks(material, kind = 'water') {
  const s = new Shape(), liquid = kind === 'sewage' ? PAL.murky : PAL.water;
  for (const [x, z] of [[-0.2, -0.18], [-0.2, 0.18]]) {
    s.cyl(0.15, 0.15, 0.04, PAL.concrete, [x, 0, z], 24).cyl(0.138, 0.138, 0.041, liquid, [x, 0, z], 24);
    s.box(0.3, 0.01, 0.022, PAL.mid, [x, 0.04, z]).cyl(0.02, 0.02, 0.05, PAL.mid, [x, 0, z], 8);
  }
  for (const z of [-0.2, 0, 0.2]) {
    s.box(0.32, 0.035, 0.15, PAL.concrete, [0.16, 0, z]).box(0.3, 0.036, 0.13, liquid, [0.16, 0, z]);
    if (kind === 'sewage') for (let x = 0.04; x < 0.3; x += 0.08) s.box(0.004, 0.01, 0.13, PAL.white, [x, 0.036, z]);
  }
  s.box(0.16, 0.08, 0.1, PAL.light, [-0.2, 0, 0.38 - 0.4]).box(0.17, 0.01, 0.11, PAL.dark, [-0.2, 0.08, -0.02]);
  return s.mesh(material);
}

// A fuel terminal: four storage tanks in a bunded yard, with pipes and a pump house
export function fuelTanks(material) {
  const s = new Shape();
  for (const [x, z] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.12], [0.17, 0.12]]) {
    s.cyl(0.12, 0.12, 0.11, PAL.white, [x, 0, z], 20).cyl(0.02, 0.122, 0.015, PAL.light, [x, 0.11, z], 20);
    s.rod([x, 0.02, z], [0, 0.02, z], 0.008, PAL.mid);
  }
  for (const [w, d, x, z] of [[0.74, 0.02, 0, -0.35], [0.74, 0.02, 0, 0.3], [0.02, 0.65, -0.37, -0.025], [0.02, 0.65, 0.37, -0.025]]) s.box(w, 0.025, d, PAL.concrete, [x, 0, z]);
  s.box(0.1, 0.06, 0.07, PAL.light, [0, 0, 0.38]);
  return s.mesh(material);
}

// A gas plant: two storage spheres on legs, a horizontal tank, a pipe rack and a flare stack
export function gasPlant(material) {
  const s = new Shape();
  for (const x of [-0.2, 0.05]) {
    s.sphere(0.095, PAL.white, [x, 0.13, -0.12], 18);
    for (let k = 0; k < 6; k++) { const a = (k * Math.PI) / 3; s.rod([x + Math.sin(a) * 0.08, 0, -0.12 + Math.cos(a) * 0.08], [x + Math.sin(a) * 0.075, 0.12, -0.12 + Math.cos(a) * 0.075], 0.005, PAL.mid, 5); }
  }
  s.add(new THREE.CylinderGeometry(0.05, 0.05, 0.32, 14), PAL.light, new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(-0.08, 0.07, 0.14));
  for (const x of [-0.2, 0.04]) s.box(0.03, 0.045, 0.05, PAL.mid, [x, 0, 0.14]);
  for (let x = -0.3; x <= 0.3; x += 0.12) s.box(0.008, 0.08, 0.008, PAL.mid, [x, 0, 0.3]);
  s.box(0.62, 0.006, 0.04, PAL.mid, [0, 0.08, 0.3]).rod([-0.3, 0.09, 0.3], [0.3, 0.09, 0.3], 0.01, PAL.yellow);
  s.cyl(0.012, 0.016, 0.55, PAL.mid, [0.3, 0, -0.25]).cyl(0.02, 0.012, 0.03, PAL.orange, [0.3, 0.55, -0.25], 8);
  return s.mesh(material);
}

// A petrol station: a canopy over two pump islands, a shop, and a price sign by the road
export function petrolStation(material) {
  const s = new Shape();
  for (const [x, z] of [[-0.16, -0.08], [0.16, -0.08], [-0.16, 0.08], [0.16, 0.08]]) s.cyl(0.009, 0.009, 0.15, PAL.light, [x, 0, z + 0.06], 8);
  s.box(0.46, 0.022, 0.3, PAL.red, [0, 0.15, 0.06]).box(0.45, 0.01, 0.29, PAL.white, [0, 0.172, 0.06]);
  for (const x of [-0.08, 0.08]) {
    s.box(0.045, 0.012, 0.18, PAL.concrete, [x, 0, 0.06]);
    for (const z of [0.0, 0.12]) s.box(0.028, 0.055, 0.032, PAL.white, [x, 0.012, z]).box(0.03, 0.015, 0.034, PAL.red, [x, 0.067, z]);
  }
  s.box(0.3, 0.1, 0.13, PAL.cream, [0, 0, -0.27]).box(0.31, 0.02, 0.14, PAL.red, [0, 0.1, -0.27]);
  s.box(0.22, 0.06, 0.006, PAL.glass, [0, 0.012, -0.204]);
  s.cyl(0.006, 0.006, 0.2, PAL.mid, [0.34, 0, 0.33], 6).box(0.09, 0.12, 0.014, PAL.red, [0.34, 0.2, 0.33]).box(0.07, 0.07, 0.016, PAL.yellow, [0.34, 0.215, 0.33]);
  return s.mesh(material);
}

// A supermarket: a big low shed with a glass front, a coloured sign band and plant on the roof
export function supermarket(material) {
  const s = new Shape();
  s.box(0.74, 0.16, 0.42, PAL.cream).box(0.76, 0.012, 0.44, PAL.light, [0, 0.16, 0]);
  s.box(0.44, 0.075, 0.006, PAL.glass, [0, 0.005, 0.212]);
  s.box(0.5, 0.04, 0.012, PAL.green, [0, 0.11, 0.216]).box(0.22, 0.012, 0.07, PAL.green, [0, 0.08, 0.25]);
  for (const x of [-0.2, 0, 0.2]) s.box(0.09, 0.04, 0.07, PAL.mid, [x, 0.172, -0.08]);
  s.box(0.08, 0.035, 0.04, PAL.mid, [0.3, 0, 0.25]);
  return s.mesh(material);
}

// A barn with a silo and two grain bins
export function farmBuildings(material) {
  const s = new Shape();
  s.box(0.22, 0.11, 0.32, PAL.deepRed).roof(0.25, 0.09, 0.34, PAL.dark, [0, 0.11, 0]);
  s.box(0.09, 0.08, 0.005, PAL.white, [0, 0, 0.162]);
  s.cyl(0.052, 0.052, 0.3, PAL.light, [0.2, 0, -0.08], 16).sphere(0.052, PAL.light, [0.2, 0.3, -0.08], 16);
  for (const z of [0.08, 0.2]) s.cyl(0.06, 0.06, 0.09, PAL.grey, [0.22, 0, z], 16).cyl(0.004, 0.062, 0.04, PAL.mid, [0.22, 0.09, z], 16);
  return s.mesh(material);
}

// A ship-to-shore crane: four legs, a cross beam, and a boom out over the water (+z)
export function portCrane(material) {
  const s = new Shape();
  for (const [x, z] of [[-0.09, -0.07], [0.09, -0.07], [-0.09, 0.07], [0.09, 0.07]]) s.box(0.018, 0.34, 0.018, PAL.orange, [x, 0, z]);
  for (const z of [-0.07, 0.07]) s.box(0.2, 0.025, 0.02, PAL.orange, [0, 0.16, z]);
  s.box(0.2, 0.03, 0.03, PAL.orange, [0, 0.34, 0]);
  s.box(0.035, 0.03, 0.8, PAL.amber, [0, 0.37, 0.24]).box(0.06, 0.05, 0.08, PAL.mid, [0, 0.34, -0.12]);
  s.rod([0, 0.48, 0], [0, 0.4, 0.62], 0.004, PAL.dark).cyl(0.008, 0.008, 0.11, PAL.orange, [0, 0.37, 0]);
  return s.mesh(material);
}

// A small satellite dish on a stand, facing +z and tilted up
export function dish(material, r = 0.05) {
  const s = new Shape();
  s.cyl(0.006, 0.008, 0.05, PAL.mid, [0, 0, 0], 6);
  s.add(new THREE.SphereGeometry(r, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), PAL.white, new THREE.Matrix4().makeRotationX(-Math.PI / 2 + 0.6).setPosition(0, 0.06, 0));
  return s.mesh(material);
}

// Railway track along x: rails and sleepers, `tracks` side by side
export function railTrack(material, len = 0.9, tracks = 1) {
  const s = new Shape();
  for (let t = 0; t < tracks; t++) {
    const z = (t - (tracks - 1) / 2) * 0.1;
    for (let x = -len / 2 + 0.015; x < len / 2; x += 0.03) s.box(0.008, 0.004, 0.06, PAL.darkWood, [x, 0, z]);
    for (const dz of [-0.02, 0.02]) s.box(len, 0.006, 0.006, PAL.mid, [0, 0.004, z + dz]);
  }
  return s.mesh(material);
}

// An aircraft hangar: an arched roof over an open-fronted shed, facing +z
export function hangar(material) {
  const s = new Shape();
  s.add(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 16, 1, false, -Math.PI / 2, Math.PI), PAL.light, new THREE.Matrix4().makeRotationX(Math.PI / 2));
  s.box(0.24, 0.002, 0.3, PAL.concrete);
  return s.mesh(material);
}

// A wooden electricity pole with a cross arm, about 10 m tall
export function woodPole(material, h = 0.3) {
  const s = new Shape();
  s.cyl(0.006, 0.008, h, PAL.darkWood, [0, 0, 0], 6).box(0.09, 0.008, 0.008, PAL.darkWood, [0, h - 0.03, 0]);
  for (const x of [-0.035, 0, 0.035]) s.cyl(0.004, 0.004, 0.012, PAL.white, [x, h - 0.022, 0], 5);
  return s.mesh(material);
}
// Where a wood pole's wires attach, relative to its base
export const WOOD_POLE_WIRES = [[-0.035, 0.288], [0, 0.288], [0.035, 0.288]];

// A beach umbrella
export function umbrella(material, colour = PAL.red) {
  const s = new Shape();
  s.cyl(0.003, 0.003, 0.06, PAL.white, [0, 0, 0], 5).cyl(0.001, 0.045, 0.018, colour, [0, 0.055, 0], 8);
  return s.mesh(material);
}

// A covered bus bay: a flat roof on posts
export function canopy(material, w = 0.4, d = 0.1, h = 0.1) {
  const s = new Shape();
  for (const x of [-w / 2 + 0.01, 0, w / 2 - 0.01]) s.cyl(0.005, 0.005, h, PAL.mid, [x, 0, -d / 2 + 0.01], 6);
  s.box(w, 0.012, d, PAL.white, [0, h, 0]);
  return s.mesh(material);
}

// A dam wall, w long along x
export function damWall(material, w = 0.9) {
  const s = new Shape();
  s.box(w, 0.06, 0.06, PAL.concrete).box(w, 0.012, 0.075, PAL.light, [0, 0.06, 0]);
  for (let x = -w / 2 + 0.1; x < w / 2; x += 0.2) s.box(0.04, 0.07, 0.07, PAL.light, [x, 0, 0.01]);
  return s.mesh(material);
}

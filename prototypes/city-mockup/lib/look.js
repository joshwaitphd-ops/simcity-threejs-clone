// Detail for the ground and buildings, shared by organic.html and town.html.
//
// Ground: grass, paving and asphalt keep their palette colour, and a shader adds detail in world
// space: patches of lighter and darker lawn, worn asphalt, and slabs with joints ('procedural') or
// the grain of a photo texture ('textures'). Each ground vertex says which surface it is with a
// `surf` attribute: [kind, x, z], where (x, z) is the direction slabs are laid in.
//
// Brick, plaster and roof grain on buildings, keeping their palette colours. The kit's UVs point
// at palette squares, so the grain is projected onto each face along the model's own axes, at
// the same scale as the ground. Glass (marked by the specular map) stays plain.
// Every building also gets its own look, so copies of the same kit model don't match: a slightly
// warmer or cooler, lighter or darker tint, its own place in the texture, and more or less weathering.
//
// Usage: const { groundMaterial, addBuildingDetail } = await createLook({ material, M });
import * as THREE from 'three';

export const SURF = { none: 0, grass: 1, slabs: 2, pavement: 3, asphalt: 4 };
export const PLAIN = [SURF.none, 1, 0], GRASS = [SURF.grass, 1, 0];

// Every detail texture is drawn at its real-world size (metres across one tile, from Poly Haven's
// metadata) times one exaggeration for the whole scene, so they all match each other and the kit,
// which is close to real size. A little over real size reads as a model. ?texscale= changes it.
const DETAIL = {
  grass: ['ground/grass.jpg', 2],          // Screaming Brain gives no size; it's a lawn photo about 2 m across
  paver: ['ground/pavers.jpg', 1.8],
  asphalt: ['ground/asphalt.jpg', 3],
  brick: ['buildings/brick.jpg', 2],
  plaster: ['buildings/plaster.jpg', 1],
  flatRoof: ['buildings/roof-flat.jpg', 2.2],
  tiles: ['buildings/roof-tiles.jpg', 1.5],
};

// A detail texture, and its mean brightness so it can darken and lighten without shifting the colour
async function detail(url) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 64, 64);
  const d = ctx.getImageData(0, 0, 64, 64).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  const t = new THREE.Texture(img); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.needsUpdate = true;
  return [t, sum / (d.length / 4) / 255];
}

/**
 * Makes the ground material and the building-detail function.
 * @param {object} o
 * @param {THREE.Material} o.material The palette material
 * @param {number} o.M Metres per scene unit
 * @param {'flat'|'procedural'|'textures'} [o.ground] How grass, paving and roads are drawn
 * @param {'flat'|'textures'} [o.buildings] Whether buildings get brick, plaster and roof grain
 * @param {number} [o.textureScale] Textures are drawn at real size times this
 * @param {number} [o.seed] Seed for each building's own look
 */
export async function createLook({ material, M, ground = 'textures', buildings = 'textures', textureScale = 2.5, seed = 11 }) {
  // Detail textures as shader uniforms: { <name>Map, <name>Mean, <name>Repeat (tiles per unit) } for each name
  async function details(names) {
    const loaded = await Promise.all(names.map((n) => detail(DETAIL[n][0])));
    return Object.fromEntries(names.flatMap((n, i) => [
      [`${n}Map`, { value: loaded[i][0] }], [`${n}Mean`, { value: loaded[i][1] }], [`${n}Repeat`, { value: M / (DETAIL[n][1] * textureScale) }],
    ]));
  }
  const groundMaterial = material.clone();
  if (ground !== 'flat') {
    const uniforms = ground === 'textures' ? await details(['grass', 'paver', 'asphalt']) : {};
    groundMaterial.defines = { GROUND_TEXTURES: ground === 'textures' ? 1 : 0 };
    groundMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', 'attribute vec3 surf;\nvarying vec3 vSurf;\nvarying vec2 vGround;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurf = surf;\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${GROUND_GLSL}`)
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= groundDetail(vGround, vSurf);');
    };
  }
  const buildingUniforms = buildings === 'textures' ? await details(['brick', 'plaster', 'flatRoof', 'tiles']) : {};
  // Building looks use their own random sequence, so changing them doesn't move any buildings
  let lookSeed = seed;
  const lookRand = () => (lookSeed = (lookSeed * 16807) % 2147483647) / 2147483647;
  // Adds the grain to a building material, after whatever shader changes it already has (window lights)
  function addBuildingDetail(m) {
    if (buildings !== 'textures') return;
    const warm = lookRand() * 2 - 1, light = 0.82 + lookRand() * 0.3;
    const look = {
      bOffset: { value: new THREE.Vector3(lookRand() * 40, 0, lookRand() * 40) },
      bTint: { value: new THREE.Color(light * (1 + warm * 0.07), light, light * (1 - warm * 0.1)) },
      bRoofTint: { value: new THREE.Color().setScalar(0.8 + lookRand() * 0.32) },
      bWear: { value: lookRand() ** 1.5 },      // most buildings fairly clean, a few grimy
    };
    const before = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      before.call(m, shader, renderer);
      Object.assign(shader.uniforms, buildingUniforms, look);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', 'varying vec3 vBPos;\nvarying vec3 vBNormal;\n#include <common>')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBPos = transformed * length(modelMatrix[0].xyz);\nvBNormal = objectNormal;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BUILDING_GLSL}`)
        .replace('#include <specularmap_fragment>', '#include <specularmap_fragment>\nif (specularStrength < 0.25) diffuseColor.rgb *= buildingDetail(vBPos, normalize(vBNormal), diffuseColor.rgb);');
    };
  }
  return { groundMaterial, addBuildingDetail };
}

// A texture's fine detail only, around 1: its brightness divided by a blurred copy of itself.
// Photos are lit a little unevenly, and without this that unevenness repeats with every tile, as
// stripes or a grid. Large-scale variation comes from noise instead, which never repeats.
// The blur is a smaller mipmap level: blocks of at least 1/32 of the (512 px) texture, and always
// two levels blurrier than the level being drawn, so it still works when the texture is far away.
const FINE_GLSL = /* glsl */ `
float fine(sampler2D map, vec2 uv) {
  vec2 d = max(abs(dFdx(uv)), abs(dFdy(uv))) * 512.0;
  float level = log2(max(max(d.x, d.y), 1.0));
  return dot(texture2D(map, uv).rgb, LUMA) / max(dot(textureLod(map, uv, max(4.0, level + 2.0)).rgb, LUMA), 0.02);
}`;
const GROUND_GLSL = /* glsl */ `
#define LUMA vec3(0.299, 0.587, 0.114)
varying vec3 vSurf;
varying vec2 vGround;
#if GROUND_TEXTURES
uniform sampler2D grassMap;
uniform sampler2D paverMap;
uniform float grassMean;
uniform sampler2D asphaltMap;
uniform float grassRepeat;
uniform float paverRepeat;
uniform float asphaltRepeat;
#endif
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Three octaves of value noise, from 0 to 1
float fbm(vec2 p) { return 0.5 * vnoise(p) + 0.3 * vnoise(p * 2.03 + 17.1) + 0.2 * vnoise(p * 4.01 + 3.7); }
${FINE_GLSL}

// p is the world position in units (32 m)
vec3 groundDetail(vec2 p, vec3 surf) {
  float kind = floor(surf.x + 0.5);
  if (kind < 0.5) return vec3(1.0);
  if (kind < 1.5) {
    // Lawn: patches about 50 m across, the brighter ones yellower, and tufts about 5 m across
    float n = fbm(p * 0.7) - 0.5, m = vnoise(p * 7.0) - 0.5;
    vec3 tone = 1.0 + n * 0.8 * vec3(1.1, 0.9, 0.5) + m * 0.14;
#if GROUND_TEXTURES
    // Photo grain, sampled at two scales so its tiling doesn't show, with its contrast raised
    float g = dot(texture2D(grassMap, p * grassRepeat).rgb, LUMA) * 0.6 + dot(texture2D(grassMap, p.yx * grassRepeat * 0.38 + 0.37).rgb, LUMA) * 0.4;
    tone *= pow(g / grassMean, 1.8);
#endif
    return tone;
  }
  // Measured along and across the way slabs are laid, or the road runs
  vec2 q = vec2(dot(p, surf.yz), dot(p, vec2(-surf.z, surf.y)));
  if (kind > 3.5) {
    // Asphalt: worn and patched areas about 30 m across, and photo grain. It's laid the same way
    // everywhere, so roads, junctions and car parks join without seams, and sampled at two scales
    // so its tiling doesn't show.
    float wear = 1.0 + (fbm(p * 1.1 + 5.3) - 0.5) * 0.3;
#if GROUND_TEXTURES
    wear *= pow(fine(asphaltMap, p * asphaltRepeat) * 0.65 + fine(asphaltMap, p.yx * asphaltRepeat * 0.41 + 0.5) * 0.35, 1.6);
#endif
    return vec3(wear);
  }
  // Paving
  float tone = 1.0 + (fbm(p * 1.5) - 0.5) * 0.14;
#if GROUND_TEXTURES
  tone *= pow(fine(paverMap, q * paverRepeat), 1.3);
#else
  // 3 m slabs, or 2 m panels across a pavement. Each slab is a slightly different shade, and the
  // joints fade out once a slab is only a few pixels wide.
  vec2 cell = kind < 2.5 ? q / 0.09 : vec2(q.x / 0.06, 0.5);
  vec2 f = fract(cell), d = min(f, 1.0 - f), w = fwidth(cell) + 1e-4;
  vec2 line = 1.0 - smoothstep(vec2(0.04), vec2(0.04) + w * 1.5, d);
  if (kind > 2.5) line.y = 0.0;
  float joint = max(line.x, line.y) * (1.0 - smoothstep(0.12, 0.3, max(w.x, w.y)));
  tone *= (1.0 + (hash12(floor(cell)) - 0.5) * 0.10) * (1.0 - joint * 0.25);
#endif
  return vec3(tone);
}
`;

const BUILDING_GLSL = /* glsl */ `
#define LUMA vec3(0.299, 0.587, 0.114)
varying vec3 vBPos;      // position in the model's axes, in world units
varying vec3 vBNormal;   // normal in the model's axes
uniform sampler2D brickMap;
uniform sampler2D plasterMap;
uniform sampler2D flatRoofMap;
uniform sampler2D tilesMap;
uniform float brickRepeat;
uniform float plasterRepeat;
uniform float flatRoofRepeat;
uniform float tilesRepeat;
// This building's own look
uniform vec3 bOffset;
uniform vec3 bTint;
uniform vec3 bRoofTint;
uniform float bWear;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

${FINE_GLSL}

// A texture's fine detail, projected onto a face from whichever of the model's axes it faces
float boxGrain(sampler2D map, vec3 p, vec3 n, float repeat) {
  vec3 w = pow(abs(n), vec3(6.0)); w /= w.x + w.y + w.z;
  return fine(map, p.zy * repeat) * w.x + fine(map, p.xz * repeat) * w.y + fine(map, p.xy * repeat) * w.z;
}

// q is the position in the model's axes, in world units, with y = 0 at the ground
vec3 buildingDetail(vec3 q, vec3 n, vec3 linear) {
  vec3 p = q + bOffset;                     // where this building's grain starts
  vec3 c = pow(linear, vec3(1.0 / 2.2));    // the palette colour as it looks on screen
  float hi = max(c.r, max(c.g, c.b)), lo = min(c.r, min(c.g, c.b));
  float sat = hi > 0.0 ? (hi - lo) / hi : 0.0;
  if (n.y > 0.9) {
    // Flat roofs: tarred gravel, on greys only, so pools and rooftop kit stay clean
    if (sat > 0.25) return vec3(1.0);
    return bRoofTint * pow(boxGrain(flatRoofMap, p, n, flatRoofRepeat), 1.3);
  }
  if (n.y > 0.3) {
    // Pitched roofs: tiles in rows along the ridge, measured down the slope
    vec2 h = normalize(n.xz);
    vec3 down = vec3(h.x * n.y, -length(n.xz), h.y * n.y);
    vec2 uv = vec2(dot(p.xz, vec2(-h.y, h.x)), dot(p, down));
    return bRoofTint * pow(fine(tilesMap, uv * tilesRepeat), 1.3);
  }
  if (n.y < -0.5) return vec3(1.0);
  // Walls: brick on the brick reds and browns, plaster on everything else
  float grain = c.r > 0.3 && c.r < 0.8 && c.r > c.g * 1.3 && c.r > c.b * 1.2
    ? pow(boxGrain(brickMap, p, n, brickRepeat), 1.5)
    : pow(boxGrain(plasterMap, p, n, plasterRepeat), 1.2);
  // Weathering: grime on the bottom 2.5 m, and rain streaks running down the walls
  float base = 1.0 - smoothstep(0.0, 0.08, q.y);
  float streak = smoothstep(0.6, 0.95, vnoise(vec2((p.x + p.z) * 50.0, q.y * 3.0)));
  return bTint * grain * (1.0 - bWear * (0.28 * base + 0.22 * streak));
}
`;

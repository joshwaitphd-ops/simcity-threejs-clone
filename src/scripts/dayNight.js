import * as THREE from 'three';

/** Length of one full day, in real seconds */
export const DAY_LENGTH_SECONDS = 180;

/** The times of day. Each one lasts a quarter of the day. */
export const PHASES = ['Morning', 'Day', 'Afternoon', 'Night'];

/** Where in the day the game starts (0 is sunrise, 1 is the next sunrise) */
const START_TIME = 0.1;

/** Time of day when the sun sets and the moon rises */
const SUNSET = 0.75;

/** Highest point of the sun and moon in the sky, in degrees */
const SUN_MAX_ELEVATION = 65;
const MOON_MAX_ELEVATION = 45;

/** Lowest elevation used for shadows, so they don't stretch forever at the horizon */
const MIN_ELEVATION = 8;

/**
 * Compass direction (degrees, in the x-z plane) where the sun and moon rise and set.
 * They sweep through 225°, which is the side the camera looks from at the start,
 * so the faces you see are lit from the side in the morning and afternoon.
 */
const RISE_DIRECTION = 158;
const SET_DIRECTION = 292;

/**
 * How the light looks through the day. `t` runs from 0 (sunrise) to 1 (the next sunrise),
 * and the values in between are blended smoothly.
 *
 * - `key`: colour and intensity of the sun by day, or the moon by night
 * - `sky`, `ground`, `fill`: the soft light from the sky above and bounced off the ground
 * - `glow`: how lit the city's windows are, from 0 (off) to 1 (all on)
 * - `top`, `bottom`: the background gradient behind the city
 */
const KEYFRAMES = [
  { t: 0.000, key: 0xff9a5c, keyIntensity: 0.0, sky: 0x8d9bd0, ground: 0x4d3f5c, fill: 1.10, glow: 0.60, top: 0x4f5f99, bottom: 0xf0a27a }, // sunrise
  { t: 0.060, key: 0xffb27a, keyIntensity: 1.3, sky: 0xaec2e8, ground: 0x6a5450, fill: 1.00, glow: 0.10, top: 0x7d9fd6, bottom: 0xf5c7a0 }, // early morning
  { t: 0.160, key: 0xffe0bc, keyIntensity: 1.9, sky: 0xc9dcf5, ground: 0x7a6a58, fill: 0.95, glow: 0.00, top: 0x84b4e6, bottom: 0xcfe2f2 }, // morning
  { t: 0.375, key: 0xfffaf0, keyIntensity: 2.3, sky: 0xdcebff, ground: 0x8a7a66, fill: 0.90, glow: 0.00, top: 0x81b1e0, bottom: 0x4a6a9a }, // midday
  { t: 0.600, key: 0xffdcaa, keyIntensity: 2.0, sky: 0xd9def0, ground: 0x86705a, fill: 0.90, glow: 0.00, top: 0x8aa9d8, bottom: 0x5f6f9a }, // afternoon
  { t: 0.690, key: 0xffa35a, keyIntensity: 1.8, sky: 0xf0c4b0, ground: 0x7a5650, fill: 1.15, glow: 0.10, top: 0x6f74ad, bottom: 0xe9926a }, // golden hour
  { t: 0.750, key: 0xff7a45, keyIntensity: 0.0, sky: 0x9078a8, ground: 0x3e304e, fill: 1.00, glow: 0.55, top: 0x3d3f7a, bottom: 0xd9775a }, // sunset
  { t: 0.800, key: 0x8fa6ff, keyIntensity: 0.35, sky: 0x5c6aae, ground: 0x2a2645, fill: 1.00, glow: 0.95, top: 0x1f2556, bottom: 0x6a4a72 }, // dusk
  { t: 0.875, key: 0xa8bcff, keyIntensity: 0.55, sky: 0x4d5ea8, ground: 0x1e2040, fill: 1.00, glow: 1.00, top: 0x070b1e, bottom: 0x16204a }, // midnight
  { t: 0.950, key: 0xa8bcff, keyIntensity: 0.35, sky: 0x5866a8, ground: 0x262440, fill: 1.05, glow: 0.90, top: 0x101634, bottom: 0x2a2c5a }, // small hours
].map((k) => ({
  ...k,
  key: new THREE.Color(k.key),
  sky: new THREE.Color(k.sky),
  ground: new THREE.Color(k.ground),
  top: new THREE.Color(k.top),
  bottom: new THREE.Color(k.bottom),
}));

/**
 * How lit the city's windows are right now (0 to 1). Every building's
 * windows read this one value, so it's shared rather than copied.
 */
const windowGlow = { value: 0 };

/**
 * Drives the time of day: moves the sun and moon, blends the light colours
 * and tells the city's windows when to light up.
 */
export class DayNightCycle {
  /**
   * Time through the current day, from 0 (sunrise) to 1 (the next sunrise)
   * @type {number}
   */
  time = START_TIME;

  /**
   * Top colour of the background gradient
   * @type {THREE.Color}
   */
  skyTop = new THREE.Color();

  /**
   * Bottom colour of the background gradient
   * @type {THREE.Color}
   */
  skyBottom = new THREE.Color();

  #direction = new THREE.Vector3();

  /**
   * @param {THREE.Scene} scene The scene to light
   * @param {THREE.Vector3} center The middle of the city
   * @param {number} radius How far from the middle shadows need to reach
   */
  constructor(scene, center, radius) {
    this.center = center.clone();
    // The sun and moon sit outside the city, far enough away to cast shadows across all of it
    this.lightDistance = radius * 1.5;

    // The sun by day and the moon by night. Only one is ever up, so one light does both.
    this.keyLight = new THREE.DirectionalLight(0xffffff, 2);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.camera.left = -radius;
    this.keyLight.shadow.camera.right = radius;
    this.keyLight.shadow.camera.top = radius;
    this.keyLight.shadow.camera.bottom = -radius;
    this.keyLight.shadow.mapSize.width = 2048;
    this.keyLight.shadow.mapSize.height = 2048;
    this.keyLight.shadow.camera.near = this.lightDistance - radius;
    this.keyLight.shadow.camera.far = this.lightDistance + radius;
    this.keyLight.shadow.normalBias = 0.01;
    this.keyLight.target.position.copy(this.center);
    scene.add(this.keyLight, this.keyLight.target);

    // Soft light from the sky above and the ground below
    this.fillLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
    scene.add(this.fillLight);

    this.update(0);
  }

  /**
   * The current time of day: Morning, Day, Afternoon or Night
   * @type {string}
   */
  get phase() {
    return PHASES[Math.floor(this.time * PHASES.length) % PHASES.length];
  }

  /**
   * True between sunset and sunrise
   * @type {boolean}
   */
  get isNight() {
    return this.time >= SUNSET;
  }

  /**
   * Jumps to the start of the next time of day
   */
  skipToNextPhase() {
    const next = Math.floor(this.time * PHASES.length) + 1;
    this.time = (next / PHASES.length) % 1;
    this.update(0);
  }

  /**
   * Moves the time of day forward and updates the lighting
   * @param {number} deltaSeconds Real seconds since the last update
   */
  update(deltaSeconds) {
    this.time = (this.time + deltaSeconds / DAY_LENGTH_SECONDS) % 1;

    const [from, to, f] = findKeyframes(this.time);

    this.keyLight.color.lerpColors(from.key, to.key, f);
    this.keyLight.intensity = THREE.MathUtils.lerp(from.keyIntensity, to.keyIntensity, f);
    this.fillLight.color.lerpColors(from.sky, to.sky, f);
    this.fillLight.groundColor.lerpColors(from.ground, to.ground, f);
    this.fillLight.intensity = THREE.MathUtils.lerp(from.fill, to.fill, f);
    this.skyTop.lerpColors(from.top, to.top, f);
    this.skyBottom.lerpColors(from.bottom, to.bottom, f);
    windowGlow.value = THREE.MathUtils.lerp(from.glow, to.glow, f);

    this.#placeKeyLight();
  }

  /**
   * Places the sun (or the moon at night) on its arc across the sky
   */
  #placeKeyLight() {
    // How far the sun or moon is through its arc, from 0 (rising) to 1 (setting)
    const arc = this.isNight
      ? (this.time - SUNSET) / (1 - SUNSET)
      : this.time / SUNSET;
    const maxElevation = this.isNight ? MOON_MAX_ELEVATION : SUN_MAX_ELEVATION;

    const elevation = THREE.MathUtils.degToRad(
      Math.max(MIN_ELEVATION, Math.sin(arc * Math.PI) * maxElevation));
    const heading = THREE.MathUtils.degToRad(
      THREE.MathUtils.lerp(RISE_DIRECTION, SET_DIRECTION, arc));

    this.#direction.set(
      Math.cos(heading) * Math.cos(elevation),
      Math.sin(elevation),
      Math.sin(heading) * Math.cos(elevation));

    this.keyLight.position.copy(this.center).addScaledVector(this.#direction, this.lightDistance);
  }
}

/**
 * Finds the two keyframes either side of a time, and how far it is between them
 * @param {number} t Time of day, from 0 to 1
 * @returns {[object, object, number]} The keyframe before, the keyframe after, and a blend from 0 to 1
 */
function findKeyframes(t) {
  const next = KEYFRAMES.findIndex((k) => k.t > t);
  const last = KEYFRAMES[KEYFRAMES.length - 1];

  // After the last keyframe, blend round to the first one
  const from = next === -1 ? last : KEYFRAMES[next - 1];
  const to = next === -1 ? KEYFRAMES[0] : KEYFRAMES[next];
  const toTime = next === -1 ? KEYFRAMES[0].t + 1 : to.t;

  const f = THREE.MathUtils.smoothstep(t, from.t, toTime);
  return [from, to, f];
}

/**
 * Creates the window light settings for one building. Each building gets a slightly
 * different colour and switch-on time, so the city lights up gradually at dusk.
 * @returns {{ on: { value: number }, threshold: { value: number }, color: { value: THREE.Color } }}
 */
export function createWindowLights() {
  const warmth = Math.random();
  const brightness = THREE.MathUtils.lerp(0.9, 1.3, Math.random());
  return {
    // 1 if this building's lights can come on, 0 if they're switched off
    on: { value: 1 },
    // How dark it has to get before this building's lights come on
    threshold: { value: THREE.MathUtils.lerp(0.05, 0.6, Math.random()) },
    // Colour of the light, from warm yellow to soft white
    color: { value: new THREE.Color(0xffc56b).lerp(new THREE.Color(0xfff0d2), warmth).multiplyScalar(brightness) },
  };
}

/**
 * Makes a building material's windows glow at night. Windows are the faces that use
 * the glass colour of the palette, which is the only part of the specular map that isn't black.
 * @param {THREE.Material} material A building material using the palette texture
 * @param {ReturnType<typeof createWindowLights>} lights The building's window light settings
 */
export function addWindowLights(material, lights) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windowGlow = windowGlow;
    shader.uniforms.windowLightsOn = lights.on;
    shader.uniforms.windowThreshold = lights.threshold;
    shader.uniforms.windowColor = lights.color;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float windowGlow;
        uniform float windowLightsOn;
        uniform float windowThreshold;
        uniform vec3 windowColor;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef USE_SPECULARMAP
          float isWindow = step(0.25, specularStrength);
          float lit = windowLightsOn * smoothstep(windowThreshold, windowThreshold + 0.15, windowGlow);
          totalEmissiveRadiance += windowColor * isWindow * lit;
        #endif`);
  };
}

import * as THREE from 'three';
import { addWindowLights, createWindowLights } from '../../dayNight.js';
import { SimObject } from '../simObject';
import { BuildingStatus } from './buildingStatus';
import { PowerModule } from './modules/power';
import { RoadAccessModule } from './modules/roadAccess';

export class Building extends SimObject {
  /**
   * The building type
   * @type {string}
   */
  type = 'building';
  /**
   * True if the terrain should not be rendered with this building type
   * @type {boolean}
   */
  hideTerrain = false;
  /**
   * @type {PowerModule}
   */
  power = new PowerModule(this);
  /**
   * @type {RoadAccessModule}
   */
  roadAccess = new RoadAccessModule(this);
  /**
   * The current status of the building
   * @type {string}
   */
  status = BuildingStatus.Ok;
  /**
   * Icon displayed when building status
   * @type {Sprite}
   */
  #statusIcon = new THREE.Sprite();
  /**
   * Settings for this building's window lights, which come on at night
   */
  #windowLights = createWindowLights();

  constructor() {
    super();
    this.#statusIcon.visible = false;
    this.#statusIcon.material = new THREE.SpriteMaterial({ depthTest: false })
    this.#statusIcon.layers.set(1);
    this.#statusIcon.scale.set(0.5, 0.5, 0.5);
    this.add(this.#statusIcon);
  }

  /**
   * True if this building's windows light up at night. Set it to false
   * to keep the building dark.
   * @type {boolean}
   */
  get lightsOn() {
    return this.#windowLights.on.value === 1;
  }

  set lightsOn(value) {
    this.#windowLights.on.value = value ? 1 : 0;
  }

  /**
   * Sets the building's mesh and connects its windows to the day/night cycle
   * @param {THREE.Mesh} value
   */
  setMesh(value) {
    super.setMesh(value);
    value?.traverse((obj) => {
      if (obj.material) {
        addWindowLights(obj.material, this.#windowLights);
      }
    });
  }

  /**
   * 
   * @param {*} status 
   */
  setStatus(status) {
    if (status !== this.status) {
      switch(status) {
        case BuildingStatus.NoPower:
          this.#statusIcon.visible = true;
          this.#statusIcon.material.map = window.assetManager.statusIcons[BuildingStatus.NoPower];
          break;
        case BuildingStatus.NoRoadAccess:
          this.#statusIcon.visible = true;
          this.#statusIcon.material.map = window.assetManager.statusIcons[BuildingStatus.NoRoadAccess];
          break;
        default:
          this.#statusIcon.visible = false;
      }
    }
  }

  simulate(city) {
    super.simulate(city);
    
    this.power.simulate(city);
    this.roadAccess.simulate(city);

    if (!this.power.isFullyPowered) {
      this.setStatus(BuildingStatus.NoPower);
    } else if (!this.roadAccess.value) {
      this.setStatus(BuildingStatus.NoRoadAccess);
    } else {
      this.setStatus(null);
    }
  }

  dispose() {
    this.power.dispose();
    this.roadAccess.dispose();
    super.dispose();
  }
  
  /**
   * Returns an HTML representation of this object
   * @returns {string}
   */
  toHTML() {
    let html = `
      <div class="info-heading">Building</div>
      <span class="info-label">Name </span>
      <span class="info-value">${this.name}</span>
      <br>
      <span class="info-label">Type </span>
      <span class="info-value">${this.type}</span>
      <br>
      <span class="info-label">Road Access </span>
      <span class="info-value">${this.roadAccess.value}</span>
      <br>`;

    if (this.power.required > 0) {
      html += `
        <span class="info-label">Power (kW)</span>
        <span class="info-value">${this.power.supplied}/${this.power.required}</span>
        <br>`;
    } 
    return html;
  }
}
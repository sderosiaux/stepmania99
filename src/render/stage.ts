import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Perspective } from '../types';
import { Background } from './background';
import { Playfield, LANE_SPACING } from './playfield';

// ============================================================================
// WebGL stage: background + playfield → bloom → screen.
// ============================================================================

/** Visible world height in flat mode (StepMania's 480px screen holds 7.5 arrows) */
const FLAT_VIEW_HEIGHT = 7.5;
const FLAT_FOV = 20;

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly background = new Background();
  readonly playfield = new Playfield();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FLAT_FOV, 1, 0.1, 200);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private perspective: Perspective = 'flat';
  private shakeAmount = 0;
  private readonly basePos = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private width = 1;
  private height = 1;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene.add(this.playfield.group);

    this.composer = new EffectComposer(this.renderer);
    const bgPass = new RenderPass(this.background.scene, this.background.camera);
    const mainPass = new RenderPass(this.scene, this.camera);
    mainPass.clear = false;
    mainPass.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.82);
    this.composer.addPass(bgPass);
    this.composer.addPass(mainPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
  }

  setPerspective(p: Perspective): void {
    this.perspective = p;
    this.playfield.setPerspective(p);
    this.resize();
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.bloom.resolution.set(w / 2, h / 2);
    this.camera.aspect = w / h;

    if (this.perspective === 'flat') {
      // Keep the 4 lanes on screen on narrow viewports
      const minWidth = LANE_SPACING * 4 + 1.2;
      const viewH = Math.max(FLAT_VIEW_HEIGHT, minWidth / this.camera.aspect);
      this.camera.fov = FLAT_FOV;
      const dist = viewH / 2 / Math.tan(THREE.MathUtils.degToRad(FLAT_FOV / 2));
      this.basePos.set(0, 0, dist);
      this.lookAt.set(0, 0, 0);
      this.playfield.group.position.set(0, viewH / 2 - 0.85, 0);
      this.playfield.group.rotation.set(0, 0, 0);
    } else {
      this.camera.fov = 52;
      this.basePos.set(0, -6.0, 5.4);
      this.lookAt.set(0, 4.0, 0);
      this.playfield.group.position.set(0, -1.1, 0);
      this.playfield.group.rotation.set(0, 0, 0);
    }
    this.camera.position.copy(this.basePos);
    this.camera.lookAt(this.lookAt);
    this.camera.updateProjectionMatrix();
    this.playfield.setPixelScale(h);
  }

  /** Screen-space Y (0 top .. 1 bottom) of the receptor line, for HUD placement */
  receptorScreenY(): number {
    const v = new THREE.Vector3(0, 0, 0).applyMatrix4(this.playfield.group.matrixWorld).project(this.camera);
    return (1 - v.y) / 2;
  }

  /** Screen-space X span (0..1) of the lane panel at the receptor line */
  laneScreenSpan(): [number, number] {
    this.playfield.group.updateMatrixWorld();
    const a = new THREE.Vector3(-LANE_SPACING * 2, 0, 0).applyMatrix4(this.playfield.group.matrixWorld).project(this.camera);
    const b = new THREE.Vector3(LANE_SPACING * 2, 0, 0).applyMatrix4(this.playfield.group.matrixWorld).project(this.camera);
    return [(a.x + 1) / 2, (b.x + 1) / 2];
  }

  private focus = false;

  /** Focus mode: no bloom, no shake, calm background, bare playfield */
  setFocus(on: boolean): void {
    this.focus = on;
    this.bloom.enabled = !on;
    this.background.setFocus(on);
    this.playfield.setFocus(on);
    if (on) this.shakeAmount = 0;
  }

  shake(amount: number): void {
    if (this.focus) return;
    this.shakeAmount = Math.min(0.6, this.shakeAmount + amount);
  }

  /** Menus: background only, pulsing on `beat` */
  renderMenu(p: { time: number; beat: number; dt: number; energy?: number }): void {
    this.playfield.group.visible = false;
    this.background.update({ width: this.width, height: this.height, time: p.time, beat: p.beat, energy: p.energy ?? 0.25, danger: 0, dt: p.dt });
    this.render(p.dt);
    this.playfield.group.visible = true;
  }

  render(dt: number): void {
    this.shakeAmount *= Math.exp(-dt * 8);
    const s = this.shakeAmount;
    this.camera.position.set(this.basePos.x + (Math.random() - 0.5) * s, this.basePos.y + (Math.random() - 0.5) * s, this.basePos.z);
    this.camera.lookAt(this.lookAt.x + (Math.random() - 0.5) * s * 0.3, this.lookAt.y, this.lookAt.z);
    this.composer.render(dt);
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  dispose(): void {
    this.playfield.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

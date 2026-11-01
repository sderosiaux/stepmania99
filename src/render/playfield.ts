import * as THREE from 'three';
import type { Note, JudgmentGrade, Perspective, ReceptorStyle } from '../types';
import { RECEPTOR_STYLES } from '../types';
import type { NoteRuntime } from '../core/judge';
import { THEME } from './theme';

// ============================================================================
// Playfield: lanes, receptors, notes, holds, mines, beams, explosions, sparks.
//
// Local space: lane width ≈ 1 unit, receptors on y = 0, notes at y = dir * d
// where d is the distance still to travel. Flat = StepMania up-scroll seen
// head-on; tilted = a receding highway (receptors at the bottom).
// ============================================================================

export const LANE_SPACING = 1.12;
const LANE_X = [-1.5, -0.5, 0.5, 1.5].map((v) => v * LANE_SPACING);
/** Arrow rotation per lane (shape points up) */
const LANE_ROT = [Math.PI / 2, Math.PI, 0, -Math.PI / 2];
/** StepMania C-mod is in 64px-arrow pixels per second */
const UNITS_PER_CMOD = 1 / 64;
const MAX_NOTES = 512;
const MAX_HOLDS = 48;
const MAX_PARTICLES = 2400;

/** Arrow outline, pointing up, in a unit box */
const ARROW_POINTS: [number, number][] = [
  [0, 0.5],
  [0.5, 0.02],
  [0.5, -0.16],
  [0.36, -0.16],
  [0.15, 0.05],
  [0.15, -0.5],
  [-0.15, -0.5],
  [-0.15, 0.05],
  [-0.36, -0.16],
  [-0.5, -0.16],
  [-0.5, 0.02],
];

function arrowShape(scale = 1): THREE.Shape {
  const s = new THREE.Shape();
  ARROW_POINTS.forEach(([x, y], i) => (i === 0 ? s.moveTo(x * scale, y * scale) : s.lineTo(x * scale, y * scale)));
  s.closePath();
  return s;
}

function arrowGeometry(): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(arrowShape(0.86), {
    depth: 0.1,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.05,
    bevelSegments: 3,
    curveSegments: 4,
  });
  g.translate(0, 0, -0.05);
  g.computeVertexNormals();
  return g;
}

const noteVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vColor;
varying vec2 vPos;
varying float vFade;
attribute float aFade;
void main() {
  vColor = instanceColor;
  vObjN = normal;
  vFade = aFade;
  vPos = position.xy;
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const noteFragment = /* glsl */ `
varying vec3 vN;
varying vec3 vObjN;
varying vec3 vColor;
varying vec2 vPos;
varying float vFade;
uniform float uTime;
uniform float uSheen;
void main() {
  vec3 n = normalize(vN);
  vec3 L = normalize(vec3(-0.35, 0.55, 1.0));
  float diff = 0.5 + 0.5 * max(dot(n, L), 0.0);
  // Face vs bevel from the object-space normal, so tilted/lying arrows keep a solid face
  float face = smoothstep(0.6, 0.95, abs(normalize(vObjN).z));
  float rim = 1.0 - face;
  float grad = 0.7 + 0.55 * (vPos.y + 0.5);
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 18.0);
  // Bright hues (yellow, cyan) would bloom as a blob: keep every face under the bloom threshold
  float lum = dot(vColor, vec3(0.2126, 0.7152, 0.0722));
  vec3 c = vColor * diff * grad * 0.7 * mix(1.0, 0.62, smoothstep(0.35, 0.85, lum));
  c += vColor * rim * 1.25;
  c += vec3(1.0) * spec * 0.45;
  // inner sheen sweeping across the face
  c += vec3(1.0) * face * smoothstep(0.04, 0.0, abs(vPos.x + vPos.y * 0.6 - fract(uTime * 0.6) * 2.4 + 1.2)) * 0.18 * uSheen;
  gl_FragColor = vec4(mix(vec3(0.12, 0.12, 0.18), c, vFade), 1.0);
}
`;

const holdVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const holdFragment = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uActive;
uniform float uDead;
uniform float uRoll;
uniform float uLength;
uniform float uTime;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float along = vUv.y * uLength;
  // rounded cap at the tail end
  float capR = 0.5;
  float distFromTail = (1.0 - vUv.y) * uLength;
  if (distFromTail < capR) {
    float cx = (vUv.x - 0.5) * 2.0 * capR;
    if (length(vec2(cx, capR - distFromTail)) > capR) discard;
  }
  float edge = smoothstep(0.62, 0.95, x);
  float core = 1.0 - smoothstep(0.0, 0.7, x);
  vec3 col = uColor * (0.25 + 0.25 * core) + uColor * edge * 1.1;
  float flow = 0.0;
  if (uRoll > 0.5) {
    flow = step(0.5, fract(along * 1.6 - abs(vUv.x - 0.5) * 1.2 + uTime * 2.0));
    col *= 0.65 + 0.55 * flow;
  } else {
    flow = smoothstep(0.85, 1.0, sin(along * 6.0 + uTime * 14.0 * uActive)) * core;
    col += uColor * flow * 0.6 * (0.3 + uActive);
  }
  col *= 0.75 + uActive * 0.35;
  col = mix(col, vec3(0.16, 0.16, 0.24) * (0.6 + 0.4 * edge), uDead);
  gl_FragColor = vec4(col, 0.92);
}
`;

/** Receptor quad side, in lane units: room for the glow around a ~1-unit arrow */
const RECEPTOR_QUAD = 1.7;

/**
 * Neon receptors, drawn from the arrow's signed distance field: strokes of any width stay crisp, and
 * glow is a falloff of the same distance. Colors go above 1 so the bloom picks the lines up, like the
 * hold bodies' edges. Premultiplied output: alpha darkens what is behind (glass), color adds (glow).
 */
const receptorFragment = /* glsl */ `
varying vec2 vUv;
uniform vec2 uPoly[${ARROW_POINTS.length}];
uniform vec3 uColor;
uniform vec3 uFlashColor;
uniform float uFlash;
uniform float uPress;
uniform float uPulse;
uniform float uTime;
/** Index in RECEPTOR_STYLES: 0 tube, 1 hologram */
uniform float uStyle;

float sdArrow(vec2 p) {
  float d = dot(p - uPoly[0], p - uPoly[0]);
  float s = 1.0;
  int j = ${ARROW_POINTS.length - 1};
  for (int i = 0; i < ${ARROW_POINTS.length}; i++) {
    vec2 e = uPoly[j] - uPoly[i];
    vec2 w = p - uPoly[i];
    vec2 b = w - e * clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= uPoly[i].y, p.y < uPoly[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
    j = i;
  }
  return s * sqrt(d);
}

/** Anti-aliased band of half-width w around distance 0 */
float band(float d, float w) {
  float aa = fwidth(d);
  return 1.0 - smoothstep(w - aa, w + aa, abs(d));
}

float insideOf(float d) {
  return 1.0 - smoothstep(0.0, fwidth(d), d);
}

void main() {
  vec2 p = (vUv - 0.5) * ${RECEPTOR_QUAD.toFixed(2)};
  vec3 tint = mix(uColor, uFlashColor, uFlash);
  vec3 hot = mix(tint, vec3(1.0), 0.55);
  // Same glow on every lane: at equal values, magenta (luminance ~0.4) stays under the bloom threshold
  // where cyan and green (~0.8) bloom. Lines and halos are lifted to a common luminance; the glass is not.
  float gain = clamp(0.8 / max(dot(tint, vec3(0.2126, 0.7152, 0.0722)), 0.05), 1.0, 2.2);
  float glow = (1.0 + 0.5 * uPulse + 0.9 * uFlash) * gain;
  vec3 col;
  float alpha;

  if (uStyle < 0.5) {
    // Neon tube: one thin line with a white-hot core and a halo, dark glass inside
    float d = sdArrow(p) - 0.05;
    float line = band(d, 0.028);
    float inside = insideOf(d);
    col = tint * (line * 0.95 + exp(-abs(d) * 24.0) * 0.22) * glow + hot * band(d, 0.01) * 0.55 * glow + tint * inside * (0.04 + 0.45 * uPress);
    alpha = max(inside * 0.6, line);
  } else {
    // Hologram: scanlined glass, chromatic fringe on the edge, a faint flicker
    float d = sdArrow(p) - 0.04;
    float inside = insideOf(d);
    float scan = 0.55 + 0.45 * sin(p.y * 110.0 - uTime * 6.0);
    float flicker = 0.93 + 0.07 * sin(uTime * 53.0) * sin(uTime * 7.3);
    vec3 fringe = vec3(band(d - 0.012, 0.016), band(d, 0.016), band(d + 0.012, 0.016));
    col = fringe * mix(vec3(1.0), tint, 0.5) * 0.9 * glow + tint * exp(-abs(d) * 26.0) * 0.12 * glow + tint * inside * (0.04 + 0.07 * scan + 0.4 * uPress) * flicker;
    alpha = max(inside * 0.5, max(fringe.r, max(fringe.g, fringe.b)));
  }
  gl_FragColor = vec4(col, alpha);
}
`;

const glowFragment = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uRing;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float a = uRing > 0.5 ? smoothstep(0.08, 0.0, abs(r - 0.85)) : exp(-r * r * 6.0) * smoothstep(1.0, 0.6, r);
  gl_FragColor = vec4(uColor * a * uAlpha * 1.3, 1.0);
}
`;

const beamFragment = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - vUv.y) * (1.0 - vUv.y) * (1.0 - x * x);
  gl_FragColor = vec4(uColor * a * uAlpha * 1.4, 1.0);
}
`;

const laneFragment = /* glsl */ `
varying vec2 vUv;
uniform float uPulse;
uniform float uEnergy;
uniform vec3 uEdge;
void main() {
  float lanes = 4.0;
  float lx = vUv.x * lanes;
  float sep = smoothstep(0.03, 0.0, abs(fract(lx + 0.5) - 0.5)) * step(0.5, lx) * step(lx, lanes - 0.5);
  float border = smoothstep(0.012, 0.0, min(vUv.x, 1.0 - vUv.x));
  float fadeFar = smoothstep(1.0, 0.55, vUv.y);
  vec3 col = vec3(0.012, 0.01, 0.035);
  col += uEdge * border * (0.8 + 0.6 * uPulse + uEnergy);
  col += vec3(0.25, 0.22, 0.45) * sep * 0.3;
  float alpha = 0.9 * fadeFar + border * 0.9;
  gl_FragColor = vec4(col, alpha);
}
`;

const particleVertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const particleFragment = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = exp(-dot(p, p) * 18.0) * vAlpha;
  gl_FragColor = vec4(vColor * a * 2.2, 1.0);
}
`;

interface Burst {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  life: number;
  from: number;
  to: number;
}

interface HoldVisual {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export interface PlayfieldFrame {
  songTime: number;
  beat: number;
  time: number;
  dt: number;
  cmod: number;
  /** Music rate: song ms per real ms (C-mod speed is real time) */
  rate: number;
  notes: readonly Note[];
  runtime: (n: Note) => NoteRuntime;
  held: boolean[];
  combo: number;
}

const additive = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
  new THREE.ShaderMaterial({
    vertexShader: holdVertex,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

export class Playfield {
  readonly group = new THREE.Group();
  private perspective: Perspective = 'flat';
  /** Focus mode: no bursts, sparks, beams, glows or beat pulse — only notes and receptors */
  private focus = false;
  private dir = -1;
  private maxDistance = 9;

  private readonly noteGeo = arrowGeometry();
  private readonly noteMat: THREE.ShaderMaterial;
  private readonly notes: THREE.InstancedMesh;
  private readonly outlines: THREE.InstancedMesh;
  private readonly fade: THREE.InstancedBufferAttribute;
  private readonly mines: THREE.InstancedMesh;

  private readonly receptors: { root: THREE.Group; mat: THREE.ShaderMaterial; press: number; flash: number; flashColor: THREE.Color }[] = [];
  private readonly beams: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; level: number }[] = [];
  private readonly holdPool: HoldVisual[] = [];
  private readonly bursts: Burst[] = [];
  private readonly holdGlow: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial }[] = [];
  private readonly laneMat: THREE.ShaderMaterial;
  private readonly lanePanel: THREE.Mesh;

  // particles
  private readonly pGeo = new THREE.BufferGeometry();
  private readonly pPos = new Float32Array(MAX_PARTICLES * 3);
  private readonly pVel = new Float32Array(MAX_PARTICLES * 3);
  private readonly pCol = new Float32Array(MAX_PARTICLES * 3);
  private readonly pSize = new Float32Array(MAX_PARTICLES);
  private readonly pAlpha = new Float32Array(MAX_PARTICLES);
  private readonly pLife = new Float32Array(MAX_PARTICLES);
  private readonly pMax = new Float32Array(MAX_PARTICLES);
  private pNext = 0;
  private readonly pMat: THREE.ShaderMaterial;

  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private readonly laneQ = LANE_ROT.map((r) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), r));
  private readonly quantColors = new Map<number, THREE.Color>();
  private time = 0;

  constructor() {
    // Lane panel
    this.laneMat = new THREE.ShaderMaterial({
      vertexShader: holdVertex,
      fragmentShader: laneFragment,
      transparent: true,
      depthWrite: false,
      uniforms: { uPulse: { value: 0 }, uEnergy: { value: 0 }, uEdge: { value: new THREE.Color(THEME.accent.violet) } },
    });
    this.lanePanel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.laneMat);
    this.lanePanel.renderOrder = -2;
    this.group.add(this.lanePanel);

    // Beams
    for (let i = 0; i < 4; i++) {
      const mat = additive(beamFragment, { uColor: { value: new THREE.Color(THEME.lane[i]) }, uAlpha: { value: 0 } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      mesh.renderOrder = -1;
      this.group.add(mesh);
      this.beams.push({ mesh, mat, level: 0 });
    }

    // Receptors
    const receptorGeo = new THREE.PlaneGeometry(RECEPTOR_QUAD, RECEPTOR_QUAD);
    // Outline the neon line rides on: the size of a note (0.86) plus a margin
    const poly = ARROW_POINTS.map(([x, y]) => new THREE.Vector2(x * 0.88, y * 0.88));
    for (let i = 0; i < 4; i++) {
      const root = new THREE.Group();
      root.position.x = LANE_X[i]!;
      root.quaternion.copy(this.laneQ[i]!);
      const mat = new THREE.ShaderMaterial({
        vertexShader: holdVertex,
        fragmentShader: receptorFragment,
        uniforms: {
          uPoly: { value: poly },
          uColor: { value: new THREE.Color(THEME.lane[i]!) },
          uFlashColor: { value: new THREE.Color() },
          uFlash: { value: 0 },
          uPress: { value: 0 },
          uPulse: { value: 0 },
          uTime: { value: 0 },
          uStyle: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      root.add(new THREE.Mesh(receptorGeo, mat));
      this.group.add(root);
      this.receptors.push({ root, mat, press: 0, flash: 0, flashColor: new THREE.Color() });
    }

    // Notes (+ dark outline instanced behind)
    this.noteMat = new THREE.ShaderMaterial({ vertexShader: noteVertex, fragmentShader: noteFragment, uniforms: { uTime: { value: 0 }, uSheen: { value: 1 } } });
    this.notes = new THREE.InstancedMesh(this.noteGeo, this.noteMat, MAX_NOTES);
    this.fade = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NOTES).fill(1), 1);
    this.notes.geometry = this.noteGeo.clone();
    this.notes.geometry.setAttribute('aFade', this.fade);
    this.notes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NOTES * 3), 3);
    this.notes.frustumCulled = false;
    this.notes.renderOrder = 2;
    const outlineGeo = new THREE.ShapeGeometry(arrowShape(1.0));
    this.outlines = new THREE.InstancedMesh(outlineGeo, new THREE.MeshBasicMaterial({ color: 0x05030c }), MAX_NOTES);
    this.outlines.frustumCulled = false;
    this.outlines.renderOrder = 1;
    this.group.add(this.outlines, this.notes);

    // Mines
    const mineMat = new THREE.ShaderMaterial({
      vertexShader: noteVertex.replace('vColor = instanceColor;', 'vColor = vec3(1.0, 0.13, 0.27);'),
      fragmentShader: /* glsl */ `
        varying vec3 vN; varying vec3 vObjN; varying vec3 vColor; varying vec2 vPos; varying float vFade;
        uniform float uTime;
        void main() {
          vec3 n = normalize(vN);
          float rim = pow(1.0 - abs(n.z), 1.5);
          float pulse = 0.6 + 0.4 * sin(uTime * 12.0);
          vec3 c = vec3(0.05, 0.0, 0.02) + vColor * rim * (1.2 + pulse) + vec3(1.0, 0.6, 0.6) * pow(rim, 6.0) * pulse;
          gl_FragColor = vec4(c, 1.0);
        }`,
      uniforms: { uTime: { value: 0 } },
    });
    const mineGeo = new THREE.IcosahedronGeometry(0.34, 1);
    mineGeo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(128).fill(1), 1));
    this.mines = new THREE.InstancedMesh(mineGeo, mineMat, 128);
    this.mines.frustumCulled = false;
    this.group.add(this.mines);

    // Holds
    for (let i = 0; i < MAX_HOLDS; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: holdVertex,
        fragmentShader: holdFragment,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uColor: { value: new THREE.Color() },
          uActive: { value: 0 },
          uDead: { value: 0 },
          uRoll: { value: 0 },
          uLength: { value: 1 },
          uTime: { value: 0 },
        },
      });
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.translate(0, 0.5, 0);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 0;
      this.group.add(mesh);
      this.holdPool.push({ mesh, mat });
    }

    // Glow sitting on receptors while a hold is active
    for (let i = 0; i < 4; i++) {
      const mat = additive(glowFragment, { uColor: { value: new THREE.Color(THEME.hold.body) }, uAlpha: { value: 0 }, uRing: { value: 0 } });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), mat);
      mesh.position.set(LANE_X[i]!, 0, 0.2);
      mesh.renderOrder = 4;
      this.group.add(mesh);
      this.holdGlow.push({ mesh, mat });
    }

    // Particles
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    this.pGeo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    this.pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    this.pMat = new THREE.ShaderMaterial({
      vertexShader: particleVertex,
      fragmentShader: particleFragment,
      uniforms: { uScale: { value: 300 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = new THREE.Points(this.pGeo, this.pMat);
    points.frustumCulled = false;
    points.renderOrder = 6;
    this.group.add(points);

    this.setPerspective('flat');
  }

  setPerspective(p: Perspective): void {
    this.perspective = p;
    this.dir = p === 'flat' ? -1 : 1;
    this.maxDistance = p === 'flat' ? 8.2 : 20;
    const len = this.maxDistance + 1.2;
    this.lanePanel.scale.set(LANE_SPACING * 4 + 0.2, len, 1);
    this.lanePanel.position.set(0, (this.dir * len) / 2 - this.dir * 0.8, -0.1);
    this.lanePanel.rotation.z = p === 'flat' ? Math.PI : 0;
    for (const [i, b] of this.beams.entries()) {
      b.mesh.scale.set(LANE_SPACING * 0.95, 5.5, 1);
      b.mesh.position.set(LANE_X[i]!, this.dir * 2.75, -0.05);
      b.mesh.rotation.z = p === 'flat' ? Math.PI : 0;
    }
  }

  setReceptorStyle(style: ReceptorStyle): void {
    for (const r of this.receptors) r.mat.uniforms.uStyle!.value = RECEPTOR_STYLES.indexOf(style);
  }

  setFocus(on: boolean): void {
    this.focus = on;
    this.noteMat.uniforms.uSheen!.value = on ? 0 : 1;
    if (on) {
      for (const b of this.bursts) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
      }
      this.bursts.length = 0;
      this.pLife.fill(0);
    }
  }

  setPixelScale(heightPx: number): void {
    this.pMat.uniforms.uScale!.value = heightPx * (this.perspective === 'flat' ? 2.2 : 0.55);
  }

  /** Rival arrows strobe between danger red and white so they read as hostile */
  private attackColor(time: number): THREE.Color {
    return this.tmpC.set(THEME.accent.danger).lerp(this.attackWhite, 0.5 + 0.5 * Math.sin(time * 18));
  }

  private readonly attackWhite = new THREE.Color('#ffffff');

  private quantColor(q: number): THREE.Color {
    let c = this.quantColors.get(q);
    if (!c) {
      c = new THREE.Color(THEME.quant[q] ?? THEME.quant[192]);
      this.quantColors.set(q, c);
    }
    return c;
  }

  // --------------------------------------------------------------------------
  // Events
  // --------------------------------------------------------------------------

  press(lane: number): void {
    const r = this.receptors[lane]!;
    r.press = 1;
    this.beams[lane]!.level = 1;
  }

  hit(lane: number, grade: JudgmentGrade): void {
    if (grade === 'miss') return;
    const color = THEME.judgment[grade];
    const strong = grade === 'marvelous' || grade === 'perfect';
    const r = this.receptors[lane]!;
    r.flash = 1;
    r.flashColor.set(color);
    this.spawnBurst(lane, color, true, 0.9, strong ? 2.1 : 1.7, 0.24, strong ? 0.75 : 0.55);
    this.spray(lane, color, strong ? 22 : 10, strong ? 0.9 : 0.6);
  }

  holdDone(lane: number, ok: boolean): void {
    if (!ok) return;
    this.spawnBurst(lane, THEME.hold.body, true, 1.0, 2.4, 0.3, 0.9);
    this.spray(lane, THEME.hold.body, 20, 0.9);
  }

  mine(lane: number): void {
    this.spawnBurst(lane, THEME.mine, false, 1.5, 3.2, 0.35);
    this.spawnBurst(lane, '#ffffff', true, 0.8, 3.6, 0.4, 0.8);
    this.spray(lane, THEME.mine, 40, 1.6);
  }

  /** Celebration on milestones / full combo */
  fireworks(color: string, count = 160): void {
    for (let lane = 0; lane < 4; lane++) this.spray(lane, color, count / 4, 2.2);
  }

  private spawnBurst(lane: number, color: string, ring: boolean, from: number, to: number, life = 0.25, intensity = 1): void {
    if (this.focus) return;
    const mat = additive(glowFragment, { uColor: { value: new THREE.Color(color).multiplyScalar(intensity) }, uAlpha: { value: 1 }, uRing: { value: ring ? 1 : 0 } });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.position.set(LANE_X[lane]!, 0, 0.3);
    mesh.renderOrder = 5;
    this.group.add(mesh);
    this.bursts.push({ mesh, mat, born: this.time, life, from, to });
  }

  private spray(lane: number, color: string, count: number, power: number): void {
    if (this.focus) return;
    const c = this.tmpC.set(color);
    for (let k = 0; k < count; k++) {
      const i = this.pNext;
      this.pNext = (this.pNext + 1) % MAX_PARTICLES;
      const a = Math.random() * Math.PI * 2;
      const s = (1.5 + Math.random() * 4.5) * power;
      this.pPos[i * 3] = LANE_X[lane]! + (Math.random() - 0.5) * 0.4;
      this.pPos[i * 3 + 1] = (Math.random() - 0.5) * 0.4;
      this.pPos[i * 3 + 2] = 0.4;
      this.pVel[i * 3] = Math.cos(a) * s;
      this.pVel[i * 3 + 1] = Math.sin(a) * s - this.dir * 2.5 * power;
      this.pVel[i * 3 + 2] = Math.random() * 2;
      const mix = Math.random() * 0.4;
      this.pCol[i * 3] = c.r + (1 - c.r) * mix;
      this.pCol[i * 3 + 1] = c.g + (1 - c.g) * mix;
      this.pCol[i * 3 + 2] = c.b + (1 - c.b) * mix;
      this.pSize[i] = 0.06 + Math.random() * 0.12;
      this.pMax[i] = 0.35 + Math.random() * 0.45;
      this.pLife[i] = this.pMax[i]!;
    }
  }

  // --------------------------------------------------------------------------
  // Frame
  // --------------------------------------------------------------------------

  update(f: PlayfieldFrame): void {
    this.time = f.time;
    const speed = f.cmod * UNITS_PER_CMOD; // units per second
    const pulse = !this.focus && f.beat >= 0 ? Math.exp(-(f.beat - Math.floor(f.beat)) * 6) : 0;
    const energy = Math.min(1, f.combo / 200);
    this.noteMat.uniforms.uTime!.value = f.time;
    (this.mines.material as THREE.ShaderMaterial).uniforms.uTime!.value = f.time;
    this.laneMat.uniforms.uPulse!.value = pulse;
    this.laneMat.uniforms.uEnergy!.value = energy;

    // Receptors and beams
    this.receptors.forEach((r, i) => {
      const held = f.held[i]!;
      r.press = held ? Math.max(r.press, 0.6) : r.press * Math.exp(-f.dt * 14);
      r.flash *= Math.exp(-f.dt * 10);
      const s = 1 - 0.12 * r.press + 0.06 * pulse;
      r.root.scale.setScalar(s);
      // Focus mode: pulse is 0, so the lines stay steady; press and hits still answer
      const u = r.mat.uniforms;
      (u.uFlashColor!.value as THREE.Color).copy(r.flashColor);
      u.uFlash!.value = r.flash;
      u.uPress!.value = r.press;
      u.uPulse!.value = pulse;
      u.uTime!.value = f.time;
      const b = this.beams[i]!;
      b.level = this.focus ? 0 : held ? Math.max(b.level * Math.exp(-f.dt * 6), 0.18) : b.level * Math.exp(-f.dt * 9);
      b.mat.uniforms.uAlpha!.value = b.level * 0.45;
    });

    // Notes
    let n = 0;
    let m = 0;
    let h = 0;
    const activeHoldLanes = [false, false, false, false];
    for (const note of f.notes) {
      const d = ((note.time - f.songTime) / 1000 / f.rate) * speed;
      const isLong = note.type === 'hold' || note.type === 'roll';
      const tailD = isLong ? ((note.endTime! - f.songTime) / 1000 / f.rate) * speed : d;
      if (d > this.maxDistance) break;
      if (tailD < -2.5) continue;
      const rt = f.runtime(note);

      if (note.type === 'mine') {
        if (rt.resolved || m >= 128) continue;
        this.tmpQ.setFromEuler(new THREE.Euler(f.time * 1.3, f.time * 2.1, 0));
        this.tmpM.compose(this.tmpV.set(LANE_X[note.lane]!, this.dir * d, 0.1), this.tmpQ, this.tmpS.setScalar(1 + 0.1 * pulse));
        this.mines.setMatrixAt(m++, this.tmpM);
        continue;
      }

      const missed = rt.grade === 'miss';
      const hit = rt.grade !== undefined && !missed;

      if (isLong && h < MAX_HOLDS) {
        const hr = rt.hold!;
        const active = hr.active && !hr.result;
        if (hr.result === 'ok') continue;
        const startD = active ? Math.max(0, d) : d;
        const len = Math.max(0, tailD - startD);
        if (len > 0.001) {
          const hv = this.holdPool[h++]!;
          hv.mesh.visible = true;
          hv.mesh.position.set(LANE_X[note.lane]!, this.dir * startD, -0.02);
          hv.mesh.scale.set(0.62, len, 1);
          hv.mesh.rotation.z = this.dir < 0 ? Math.PI : 0;
          const u = hv.mat.uniforms;
          const dead = hr.result === 'ng' || missed;
          (u.uColor!.value as THREE.Color).set(note.type === 'roll' ? THEME.hold.roll : THEME.hold.body);
          u.uActive!.value = active && f.held[note.lane] ? 1 : active ? 0.35 : 0;
          u.uDead!.value = dead ? 1 : 0;
          u.uRoll!.value = note.type === 'roll' ? 1 : 0;
          u.uLength!.value = len;
          u.uTime!.value = f.time;
        }
        if (active) {
          activeHoldLanes[note.lane] = true;
          if (Math.random() < f.dt * 40) this.spray(note.lane, note.type === 'roll' ? THEME.hold.roll : THEME.hold.body, 1, 0.5);
        }
        // Head: stays on the receptor while active, hidden once dead and past
        if (hit && (active || hr.result === 'ng')) {
          if (!active) continue;
        }
      } else if (hit) {
        continue;
      }

      if (n >= MAX_NOTES) continue;
      const headD = isLong && rt.hold!.active ? Math.max(0, d) : d;
      this.tmpM.compose(this.tmpV.set(LANE_X[note.lane]!, this.dir * headD, 0.15), this.laneQ[note.lane]!, this.tmpS.setScalar(1));
      this.notes.setMatrixAt(n, this.tmpM);
      this.tmpM.compose(this.tmpV.set(LANE_X[note.lane]!, this.dir * headD, 0.0), this.laneQ[note.lane]!, this.tmpS.setScalar(1));
      this.outlines.setMatrixAt(n, this.tmpM);
      this.notes.setColorAt(n, note.attackFrom !== undefined ? this.attackColor(f.time) : this.quantColor(note.quant));
      this.fade.setX(n, missed ? 0.25 : 1);
      n++;
    }
    for (let i = h; i < MAX_HOLDS; i++) this.holdPool[i]!.mesh.visible = false;
    this.notes.count = n;
    this.outlines.count = n;
    this.mines.count = m;
    this.notes.instanceMatrix.needsUpdate = true;
    this.outlines.instanceMatrix.needsUpdate = true;
    this.mines.instanceMatrix.needsUpdate = true;
    if (this.notes.instanceColor) this.notes.instanceColor.needsUpdate = true;
    this.fade.needsUpdate = true;

    this.holdGlow.forEach((g, i) => {
      const target = !this.focus && activeHoldLanes[i] && f.held[i] ? 0.35 + 0.12 * Math.sin(f.time * 30) : 0;
      g.mat.uniforms.uAlpha!.value += (target - g.mat.uniforms.uAlpha!.value) * Math.min(1, f.dt * 20);
    });

    // Bursts
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i]!;
      const k = (f.time - b.born) / b.life;
      if (k >= 1 || k < 0) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mat.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const ease = 1 - Math.pow(1 - k, 3);
      b.mesh.scale.setScalar(b.from + (b.to - b.from) * ease);
      b.mat.uniforms.uAlpha!.value = 1 - k;
    }

    // Particles
    const drag = Math.exp(-f.dt * 2.2);
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i]! <= 0) {
        this.pAlpha[i] = 0;
        continue;
      }
      this.pLife[i] = this.pLife[i]! - f.dt;
      this.pVel[i * 3] = this.pVel[i * 3]! * drag;
      this.pVel[i * 3 + 1] = this.pVel[i * 3 + 1]! * drag + this.dir * 6 * f.dt;
      this.pPos[i * 3] = this.pPos[i * 3]! + this.pVel[i * 3]! * f.dt;
      this.pPos[i * 3 + 1] = this.pPos[i * 3 + 1]! + this.pVel[i * 3 + 1]! * f.dt;
      this.pPos[i * 3 + 2] = this.pPos[i * 3 + 2]! + this.pVel[i * 3 + 2]! * f.dt;
      this.pAlpha[i] = Math.max(0, this.pLife[i]! / this.pMax[i]!);
    }
    (this.pGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pGeo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.pGeo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.pGeo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }
}

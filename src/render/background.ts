import * as THREE from 'three';
import { THEME } from './theme';

// ============================================================================
// Fullscreen beat-synced background: synthwave sky + grid floor that advances
// one cell per beat (so it freezes during stops), horizon sun, combo energy,
// low-life danger tint, and the simfile background art blended underneath.
// ============================================================================

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uTime;
uniform float uBeat;
uniform float uPulse;
uniform float uEnergy;
uniform float uDanger;
uniform float uFlash;
uniform vec3 uFlashColor;
uniform vec3 uDeep;
uniform vec3 uHorizon;
uniform vec3 uCyan;
uniform vec3 uMagenta;
uniform sampler2D uImage;
uniform float uImageMix;
uniform float uImageAspect;
uniform float uFocus;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
  float horizon = -0.06;

  // Sky
  vec3 col = mix(uHorizon, uDeep, smoothstep(horizon, 0.55, p.y));

  // Song art, cover-fit, darkened
  if (uImageMix > 0.0) {
    vec2 iuv = vUv - 0.5;
    if (aspect > uImageAspect) iuv.y *= uImageAspect / aspect; else iuv.x *= aspect / uImageAspect;
    vec3 art = texture2D(uImage, iuv + 0.5, 4.0).rgb;
    col = mix(col, art * 0.45 + col * 0.4, uImageMix * smoothstep(horizon - 0.05, horizon + 0.2, p.y));
  }

  // Stars, slowly drifting, twinkling on the beat
  vec2 sp0 = (p + vec2(uTime * 0.004, 0.0)) * 70.0;
  vec2 cell = floor(sp0);
  float h = hash(cell);
  vec2 jitter = vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5;
  float d = length(fract(sp0) - 0.5 - jitter * 0.6);
  float star = step(0.985, h) * smoothstep(0.09, 0.0, d) * smoothstep(horizon, horizon + 0.25, p.y);
  col += star * (0.4 + 0.6 * uPulse * step(0.995, h)) * vec3(0.85, 0.9, 1.0);

  // Sun on the horizon with scanline cuts
  vec2 sp = p - vec2(0.0, horizon + 0.17);
  float r = length(sp);
  float sun = smoothstep(0.205, 0.195, r);
  float cuts = step(0.0, sin((sp.y + uTime * 0.02) * 120.0) + 0.6 + sp.y * 9.0);
  vec3 sunCol = mix(uMagenta, vec3(1.0, 0.82, 0.3), smoothstep(-0.2, 0.2, sp.y));
  col = mix(col, sunCol * (0.75 + 0.5 * uPulse), sun * cuts * (sp.y > -0.03 ? 1.0 : 0.0));
  col += sunCol * 0.35 * exp(-r * 6.0) * (0.6 + 0.4 * uPulse);

  // Perspective grid floor, one cell per beat
  if (p.y < horizon) {
    float depth = 0.32 / (horizon - p.y);
    float gz = depth + uBeat;
    float gx = p.x * depth * 1.6;
    float dz = abs(fract(gz + 0.5) - 0.5);
    float dx = abs(fract(gx + 0.5) - 0.5);
    float lineZ = 1.0 - smoothstep(0.0, fwidth(gz) * 1.4, dz);
    float lineX = 1.0 - smoothstep(0.0, fwidth(gx) * 1.4, dx);
    float fade = exp(-depth * 0.12) * smoothstep(horizon, horizon - 0.02, p.y);
    vec3 gridCol = mix(uMagenta, uCyan, smoothstep(-0.5, horizon, p.y));
    float g = max(lineZ, lineX) * fade * (0.35 + 0.8 * uPulse + 0.5 * uEnergy);
    col = uDeep * 0.6 + gridCol * g * 0.9;
    // floor reflection of the sun
    col += sunCol * 0.12 * exp(-abs(p.x) * 5.0) * fade;
  }

  // Horizon glow line
  col += mix(uMagenta, uCyan, 0.5) * exp(-abs(p.y - horizon) * 60.0) * (0.5 + uPulse * 0.8);


  // Hit flash and danger vignette
  col += uFlashColor * uFlash * 0.07;
  float vig = smoothstep(0.35, 1.05, length(p * vec2(0.8, 1.2)));
  col *= 1.0 - vig * 0.65;
  col = mix(col, vec3(0.9, 0.05, 0.15), vig * uDanger * (0.55 + 0.45 * sin(uTime * 6.0)));

  // Focus: a still, dark backdrop so only the playfield moves
  vec3 calm = mix(uDeep * 0.55, uHorizon * 0.35, smoothstep(0.6, -0.4, p.y)) * (1.0 - vig * 0.5);
  col = mix(col, calm, uFocus);
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Background {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;
  private readonly placeholder: THREE.Texture;
  private flash = 0;
  private flashColor = new THREE.Color();

  constructor() {
    this.placeholder = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.placeholder.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uRes: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uPulse: { value: 0 },
        uEnergy: { value: 0 },
        uDanger: { value: 0 },
        uFlash: { value: 0 },
        uFlashColor: { value: this.flashColor },
        uDeep: { value: new THREE.Color(THEME.bg.deep) },
        uHorizon: { value: new THREE.Color(THEME.bg.horizon) },
        uCyan: { value: new THREE.Color(THEME.accent.cyan) },
        uMagenta: { value: new THREE.Color(THEME.accent.magenta) },
        uImage: { value: this.placeholder },
        uImageMix: { value: 0 },
        uImageAspect: { value: 16 / 9 },
        uFocus: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  private imageToken = 0;

  setImage(url: string | null): void {
    const u = this.material.uniforms;
    const token = ++this.imageToken;
    u.uImageMix!.value = 0;
    if (u.uImage!.value !== this.placeholder) (u.uImage!.value as THREE.Texture).dispose();
    u.uImage!.value = this.placeholder;
    if (!url) return;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        // A later setImage() wins over a slow load
        if (token !== this.imageToken) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        u.uImage!.value = tex;
        u.uImageAspect!.value = tex.image.width / tex.image.height;
        u.uImageMix!.value = 0.35;
      },
      undefined,
      () => {
        /* missing art is fine */
      }
    );
  }

  setFocus(on: boolean): void {
    this.material.uniforms.uFocus!.value = on ? 1 : 0;
  }

  hit(color: THREE.ColorRepresentation, amount = 1): void {
    this.flash = Math.min(1, this.flash + amount);
    this.flashColor.set(color);
  }

  update(p: { width: number; height: number; time: number; beat: number; energy: number; danger: number; dt: number }): void {
    const u = this.material.uniforms;
    const frac = p.beat - Math.floor(p.beat);
    u.uRes!.value.set(p.width, p.height);
    u.uTime!.value = p.time;
    u.uBeat!.value = p.beat;
    u.uPulse!.value = p.beat >= 0 ? Math.exp(-frac * 5) : 0;
    u.uEnergy!.value += (p.energy - u.uEnergy!.value) * Math.min(1, p.dt * 3);
    u.uDanger!.value += (p.danger - u.uDanger!.value) * Math.min(1, p.dt * 4);
    this.flash *= Math.exp(-p.dt * 9);
    u.uFlash!.value = this.flash;
  }
}

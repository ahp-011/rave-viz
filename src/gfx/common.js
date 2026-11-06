import * as THREE from 'three';

// Shared uniforms: every shader material references these same objects,
// so updating .value once per frame drives all scenes.
export const U = {
  uTime: { value: 0 },
  uPhase: { value: 0 },   // flowing time: speeds up with mids/energy
  uTravel: { value: 0 },  // forward motion: speeds up with bass/beats
  uBass: { value: 0 }, uLowMid: { value: 0 }, uMid: { value: 0 }, uHigh: { value: 0 },
  uEnergy: { value: 0 }, uBeat: { value: 0 }, uHat: { value: 0 }, uDrop: { value: 0 },
  uHue: { value: 0 },
  uRes: { value: new THREE.Vector2(1, 1) },
  uPxScale: { value: 1 },
  uPalA: { value: new THREE.Vector3() }, uPalB: { value: new THREE.Vector3() },
  uPalC: { value: new THREE.Vector3() }, uPalD: { value: new THREE.Vector3() },
};

export const GLSL = /* glsl */ `
uniform float uTime, uPhase, uTravel, uBass, uLowMid, uMid, uHigh, uEnergy, uBeat, uHat, uDrop, uHue, uPxScale;
uniform vec2 uRes;
uniform vec3 uPalA, uPalB, uPalC, uPalD;
#define TAU 6.28318530718
vec3 pal(float t) { return uPalA + uPalB * cos(TAU * (uPalC * t + uPalD)); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float hash3(vec3 p) { p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
`;

export const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }
`;

// Full-screen background quad drawn first inside a 3D scene
export function bgQuad(fragBody) {
  const mat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: FS_VERT,
    fragmentShader: GLSL + fragBody,
    depthTest: false, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// iq-style cosine palettes: a + b·cos(2π(c·t + d))
export const PALETTES = [
  [[.5, .5, .5], [.5, .5, .5], [1, 1, 1], [0, .33, .67]],        // full rainbow
  [[.5, .5, .5], [.5, .5, .5], [2, 1, 0], [.5, .2, .25]],        // acid magenta / cyan
  [[.5, .5, .5], [.5, .5, .5], [1, 1, .5], [.8, .9, .3]],        // lime / violet
  [[.5, .5, .5], [.5, .5, .5], [1, .7, .4], [0, .15, .2]],       // sunset melt
  [[.6, .4, .7], [.5, .5, .4], [1, 1, 1], [.3, .55, .8]],        // ultraviolet
  [[.55, .5, .5], [.55, .5, .5], [1.5, 1, 1], [0, .2, .45]],     // hot neon
  [[.5, .5, .5], [.6, .5, .5], [1, 1, 1], [.6, .1, .3]],         // pink / teal
];

export class PaletteMixer {
  constructor() {
    this.cur = PALETTES[0].map(v => [...v]);
    this.target = PALETTES[0];
    this.idx = 0;
    this._apply();
  }
  next(i) {
    this.idx = i ?? (this.idx + 1 + Math.floor(Math.random() * (PALETTES.length - 1))) % PALETTES.length;
    this.target = PALETTES[this.idx];
  }
  update(dt) {
    const k = 1 - Math.exp(-dt / 0.6);
    for (let j = 0; j < 4; j++) for (let c = 0; c < 3; c++) this.cur[j][c] += (this.target[j][c] - this.cur[j][c]) * k;
    this._apply();
  }
  _apply() {
    U.uPalA.value.fromArray(this.cur[0]); U.uPalB.value.fromArray(this.cur[1]);
    U.uPalC.value.fromArray(this.cur[2]); U.uPalD.value.fromArray(this.cur[3]);
  }
}

// Default post/feedback settings; scenes override what they need
export const FX_DEFAULT = { feedback: 0.3, zoom: 0.003, rotate: 0.0, warp: 0, hueShift: 0.004, bloom: 0.7 };

import * as THREE from 'three';
import { U, GLSL, bgQuad, FX_DEFAULT } from '../gfx/common.js';
import { makeSparkles, makeBeams } from '../gfx/layers.js';
import { Ripple, Organism, Footage, Terrain } from './mono.js';

class Base {
  constructor(name, fx = {}) {
    this.name = name;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
    this.camera.position.z = 8;
    this.fx = { ...FX_DEFAULT, ...fx };
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  update() {}
}

// ── 1. LIQUID ─ domain-warped colour melt + glowing particles + beams ─────────
export class Liquid extends Base {
  constructor() {
    super('liquid', { feedback: .1, zoom: .003, warp: 0, hueShift: 0 });
    this.scene.add(bgQuad(/* glsl */ `
      void main() {
        vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
        vec2 p = uv * (2.2 - .6 * uBass);
        p *= rot(uPhase * .05);
        float t = uPhase * .25;
        vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
        vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 1.3), fbm(p + 3.5 * q + vec2(8.3, 2.8) - t * 1.1));
        float f = fbm(p + (3. + 2.5 * uBass) * r);
        vec3 col = pal(f * 1.6 + length(q) * .6 + uHue);
        col = pow(col, vec3(1.6)); // deepen: keep the melt saturated, with dark pockets
        col *= .05 + 1.15 * f * f;
        col += pal(f + uHue + .5) * pow(r.x, 3.) * (.4 + 1.2 * uMid);
        // contour lines that shimmer with hi-hats
        float cont = sin(f * 48. - uPhase * 5.);
        col += pal(f * 2. + uHue + .25) * smoothstep(.93, 1., cont) * (.25 + uHigh * 1.4);
        // shockwave ring on each beat
        float ring = abs(length(uv) - (1. - uBeat) * 1.4);
        col += pal(uHue + .1) * exp(-ring * 26.) * uBeat * .8;
        col *= .85;
        gl_FragColor = vec4(col, 1.);
      }`));
    this.beams = makeBeams({ count: 6 });
    this.sparks = makeSparkles({ count: 2200 });
    this.scene.add(this.beams, this.sparks);
  }
  update(f, dt, t) {
    this.beams.userData.update(f, U.uPhase.value);
    this.sparks.rotation.y += dt * (.05 + f.lowMid * .4);
    this.camera.position.z = 8 - f.bass * 2;
    this.camera.position.x = Math.sin(t * .1) * 1.5;
    this.camera.lookAt(0, 0, 0);
  }
}

// ── 2. KALEIDO ─ folded neon fractal mandala ─────────────────────────────────
export class Kaleido extends Base {
  constructor() {
    super('kaleido', { feedback: .3, zoom: -.006, rotate: .003, hueShift: .015, warp: 0 });
    this.scene.add(bgQuad(/* glsl */ `
      void main() {
        vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
        uv *= rot(uPhase * .12);
        float a = atan(uv.y, uv.x), r = length(uv);
        float N = 6. + 2. * floor(mod(uHue * 4., 3.));
        float seg = TAU / N;
        a = mod(a, seg); a = abs(a - seg * .5);
        uv = r * vec2(cos(a), sin(a));
        uv *= 1.3 - .45 * uBass;
        vec2 uv0 = uv;
        vec3 col = vec3(0.);
        for (float i = 0.; i < 4.; i++) {
          uv = fract(uv * (1.45 + .15 * sin(uPhase * .2))) - .5;
          uv *= rot(uPhase * .05 + i);
          float d = length(uv) * exp(-length(uv0));
          vec3 c = pal(length(uv0) + i * .4 + uPhase * .3 + uHue);
          d = sin(d * (8. + 4. * uLowMid) + uPhase * 1.5) / 8.;
          d = pow(.0085 * (1. + uHigh * .8) / max(abs(d), 1e-4), 1.25);
          col += c * d;
        }
        col *= 1. + uBeat * .8;
        col *= smoothstep(1.4, .1, r) * .9 + .1;
        gl_FragColor = vec4(min(col, 6.), 1.);
      }`));
  }
}

// ── 3. TUNNEL ─ hexagonal neon tunnel, light streaks flying past ─────────────
export class Tunnel extends Base {
  constructor() {
    super('tunnel', { feedback: .25, zoom: .012, hueShift: .01, warp: 0 });
    this.scene.add(bgQuad(/* glsl */ `
      void main() {
        vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
        uv *= rot(uPhase * .12 + sin(uPhase * .3) * .6);
        uv += .14 * vec2(sin(uPhase * .5), cos(uPhase * .37));
        float r = length(uv), a = atan(uv.y, uv.x);
        float sides = 6.;
        float seg = TAU / sides;
        float aa = mod(a, seg) - seg * .5;
        float rp = r * cos(aa) / cos(seg * .5);
        rp *= 1. + .12 * uBass * sin(a * 3. + uPhase * 2.);
        float z = .4 / max(rp, 1e-3) + uTravel;
        float u = a / TAU;
        float ring = abs(fract(z * 1.2) - .5);
        float lane = abs(fract(u * sides) - .5);
        vec3 col = pal(floor(z * 1.2) * .11 + uHue) * exp(-ring * (34. - 18. * uBeat)) * 1.1;
        col += pal(u + z * .04 + uHue + .5) * exp(-lane * 60.) * (.4 + uHigh * 1.8);
        float wall = fbm(vec2(u * 10., z * 1.5));
        col += pal(wall + uHue + .25) * smoothstep(.45, .8, wall) * (.25 + uMid * .9);
        // light streaks in random lanes
        float slots = 48.;
        float slot = floor(u * slots);
        float hs = hash1(slot * 7.13);
        float sx = abs(fract(u * slots) - .5);
        float zz = fract(z * .18 + hs * 10.);
        col += pal(hs + uHue) * step(.55, hs) * exp(-sx * 10.) * smoothstep(.12, 0., zz) * (.8 + 1.5 * uBass);
        col *= smoothstep(.0, .45, rp);
        col += pal(uHue + uTime * .03) * exp(-r * 9.) * (.25 + .7 * uBass + uDrop * 1.5);
        gl_FragColor = vec4(col, 1.);
      }`));
    this.sparks = makeSparkles({ count: 1200, spread: [14, 14, 50], stream: true, size: .45 });
    this.scene.add(this.sparks);
  }
  update(f, dt) {
    this.sparks.rotation.z += dt * (.1 + f.lowMid * .5);
  }
}

// ── 4. GEOMETRY ─ deforming wireframe forms with heavy feedback trails ──────
export class Geometry extends Base {
  constructor() {
    super('geometry', { feedback: .6, zoom: .008, rotate: .004, hueShift: .02, warp: .15, bloom: .9 });
    this.scene.add(bgQuad(/* glsl */ `
      void main() {
        vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
        float r = length(uv);
        vec3 col = pal(r * .6 - uPhase * .1 + uHue) * .07 * (1. - r * .5);
        gl_FragColor = vec4(col, 1.);
      }`));
    const vert = GLSL + /* glsl */ `
      uniform float uAmp, uOff;
      varying vec3 vC;
      void main() {
        vec3 dir = normalize(position);
        float n = noise(dir.xy * 2.3 + uPhase * .5) + noise(dir.yz * 2.3 - uPhase * .4) - 1.;
        float disp = 1. + uAmp * (uBass * .55 * n + .14 * sin(dir.y * 9. + uPhase * 3.) * uMid) + uBeat * .12;
        vec3 p = position * disp;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.5 + 4. * uHigh + 3. * uBeat) * uPxScale * (8. / max(1., -mv.z));
        vC = pal(dot(dir, vec3(.5, .3, .2)) + uHue + uOff + n * .4 + uPhase * .04);
      }`;
    const frag = /* glsl */ `varying vec3 vC; uniform float uGain; void main(){ gl_FragColor = vec4(vC * uGain, 1.); }`;
    const mat = (amp, off, gain) => new THREE.ShaderMaterial({
      uniforms: { ...U, uAmp: { value: amp }, uOff: { value: off }, uGain: { value: gain } },
      vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.outer = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(2.4, 3)), mat(1, 0, .7));
    this.inner = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.OctahedronGeometry(1.2, 1)), mat(.6, .5, .9));
    this.knot = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.TorusKnotGeometry(3.4, .12, 220, 6, 2, 3)), mat(.4, .25, .55));
    this.dots = new THREE.Points(new THREE.IcosahedronGeometry(2.4, 12), mat(1, .1, .6));
    this.dots.material.fragmentShader = /* glsl */ `varying vec3 vC; uniform float uGain;
      void main(){ vec2 c = gl_PointCoord - .5; gl_FragColor = vec4(vC * uGain * exp(-dot(c, c) * 14.), 1.); }`;
    this.group = new THREE.Group();
    this.group.add(this.outer, this.inner, this.knot, this.dots);
    this.scene.add(this.group);
  }
  update(f, dt) {
    const spin = .15 + f.lowMid * 1.2 + f.beatPulse * .8;
    this.outer.rotation.y += dt * spin * .6; this.outer.rotation.x += dt * spin * .25;
    this.dots.rotation.copy(this.outer.rotation);
    this.inner.rotation.y -= dt * spin * 1.4; this.inner.rotation.z += dt * spin * .5;
    this.knot.rotation.x += dt * spin * .3; this.knot.rotation.z -= dt * spin * .2;
    const s = 1 + f.beatPulse * .12;
    this.inner.scale.setScalar(s * (1 + f.bass * .6));
    this.camera.position.z = 8.5 - f.bass * 2.2;
  }
}

// ── 5. SWARM ─ 32k particles snap into formations on beats, then scatter ─────
export class Swarm extends Base {
  constructor() {
    super('swarm', { feedback: .35, zoom: .002, rotate: -.002, hueShift: .01, warp: 0 });
    this.scene.add(bgQuad(/* glsl */ `
      void main() {
        vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
        gl_FragColor = vec4(pal(length(uv) * .4 + uHue + .5) * .05, 1.);
      }`));
    const side = 32, N = side ** 3;
    const f0 = new Float32Array(N * 3), f1 = new Float32Array(N * 3), f2 = new Float32Array(N * 3), f3 = new Float32Array(N * 3);
    const seed = new Float32Array(N * 4);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      // cube grid
      const x = i % side, y = Math.floor(i / side) % side, z = Math.floor(i / side / side);
      f0.set([(x / (side - 1) - .5) * 4.2, (y / (side - 1) - .5) * 4.2, (z / (side - 1) - .5) * 4.2], i * 3);
      // fibonacci sphere
      const yy = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - yy * yy), th = golden * i;
      f1.set([Math.cos(th) * rr * 3, yy * 3, Math.sin(th) * rr * 3], i * 3);
      // torus
      const tu = (i / N) * Math.PI * 2 * 64, tv = (i % 97) / 97 * Math.PI * 2;
      f2.set([(3 + Math.cos(tv) * .9) * Math.cos(tu / 64), Math.sin(tv) * .9, (3 + Math.cos(tv) * .9) * Math.sin(tu / 64)], i * 3);
      // flat grid wall
      const gx = i % 256, gy = Math.floor(i / 256);
      f3.set([(gx / 255 - .5) * 11, (gy / 127 - .5) * 5.5, 0], i * 3);
      for (let j = 0; j < 4; j++) seed[i * 4 + j] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(f0, 3));
    geo.setAttribute('aF1', new THREE.BufferAttribute(f1, 3));
    geo.setAttribute('aF2', new THREE.BufferAttribute(f2, 3));
    geo.setAttribute('aF3', new THREE.BufferAttribute(f3, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.uW = { value: new THREE.Vector4(1, 0, 0, 0) };
    this.uSnap = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uW: this.uW, uSnap: this.uSnap },
      vertexShader: GLSL + /* glsl */ `
        attribute vec3 aF1, aF2, aF3; attribute vec4 aSeed;
        uniform vec4 uW; uniform float uSnap;
        varying vec3 vC;
        void main() {
          vec3 target = position * uW.x + aF1 * uW.y + aF2 * uW.z + aF3 * uW.w;
          float t = uPhase * .35;
          vec3 fr = vec3(sin(aSeed.x * TAU + t * (.3 + aSeed.y)), sin(aSeed.y * TAU + t * .7 * (.3 + aSeed.z)), cos(aSeed.z * TAU + t * (.2 + aSeed.w)));
          fr *= 2.5 + 5.5 * aSeed.w;
          fr += (vec3(noise(fr.xy * .4 + t), noise(fr.yz * .4 - t), noise(fr.zx * .4 + t)) - .5) * 3.;
          float s = smoothstep(0., 1., uSnap);
          vec3 p = mix(fr, target * (1. + uBass * .18), s);
          p += normalize(p + 1e-4) * uBeat * .5 * (1. - s) * aSeed.x;
          vec4 mv = modelViewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1. + 1.6 * aSeed.y) * (1. + uBass * .8) * (40. / max(1., -mv.z)) * uPxScale;
          vC = pal(aSeed.x * .35 + length(p) * .12 + uHue) * (.6 + .8 * s + uHat * aSeed.z);
        }`,
      fragmentShader: /* glsl */ `varying vec3 vC; void main(){ vec2 c = gl_PointCoord - .5; if (max(abs(c.x), abs(c.y)) > .5) discard; gl_FragColor = vec4(vC * .1, 1.); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    this.form = 0; this.beats = 0;
    this.w = [1, 0, 0, 0];
  }
  update(f, dt) {
    if (f.beat) {
      this.uSnap.value = 1;
      if (++this.beats % 8 === 0) this.form = (this.form + 1) % 4;
    }
    this.uSnap.value *= Math.exp(-dt / .38);
    const k = 1 - Math.exp(-dt / .15);
    for (let i = 0; i < 4; i++) this.w[i] += ((i === this.form ? 1 : 0) - this.w[i]) * k;
    this.uW.value.set(...this.w);
    this.points.rotation.y += dt * (.12 + f.lowMid * .8);
    this.points.rotation.x = Math.sin(U.uPhase.value * .1) * .4;
    this.camera.position.z = 9 - f.bass * 2;
  }
}

// 1–4 monochrome / footage set, 5–9 colour set
export const SCENES = [Ripple, Organism, Footage, Terrain, Kaleido, Tunnel, Liquid, Geometry, Swarm];

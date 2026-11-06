import * as THREE from 'three';
import { U, GLSL, bgQuad, FX_DEFAULT } from '../gfx/common.js';

// Monochrome / footage scenes: black ground, fine white-lavender particles,
// RGB fringing only from the post pass. Deliberately unlike the colour scenes.

class Base {
  constructor(name, fx = {}) {
    this.name = name;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, .1, 200);
    this.camera.position.z = 8;
    this.fx = { ...FX_DEFAULT, hueShift: 0, ...fx };
  }
  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  update() {}
}

const blackBg = () => bgQuad(/* glsl */ `
  void main() {
    vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
    gl_FragColor = vec4(vec3(.012, .012, .02) * (1. - length(uv) * .6), 1.);
  }`);

const pointFrag = /* glsl */ `
  varying vec3 vC; varying float vB;
  void main() {
    vec2 c = gl_PointCoord - .5;
    gl_FragColor = vec4(vC * vB * (1. - smoothstep(.38, .5, length(c))), 1.);
  }`;

function pointsMat(vertexShader, extra = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, ...extra },
    vertexShader: GLSL + vertexShader,
    fragmentShader: pointFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// ── RIPPLE ─ a vertical stack of particle ripple pools ─────────────────────
export class Ripple extends Base {
  constructor() {
    super('ripple', { feedback: .15, zoom: 0, warp: 0, bloom: .6 });
    this.scene.add(blackBg());
    const LENSES = 5, RINGS = 90, PER = 820;
    const data = [];
    for (let l = 0; l < LENSES; l++) {
      for (let r = 1; r <= RINGS; r++) {
        const rr = r / RINGS;
        const n = Math.max(16, Math.floor(PER * rr));
        for (let i = 0; i < n; i++) data.push(rr, (i + Math.random() * .6) / n, l, Math.random());
      }
    }
    const count = data.length / 4;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(new Float32Array(data), 4));
    this.count = count;
    this.points = new THREE.Points(geo, pointsMat(/* glsl */ `
      attribute vec4 aData;
      varying vec3 vC; varying float vB;
      const float LENSES = ${LENSES}.;
      void main() {
        float r = aData.x * 3.4, ang = aData.y * TAU, lens = aData.z, rnd = aData.w;
        float dir = mod(lens, 2.) < .5 ? 1. : -1.;
        float ph = uTravel * 2.2 * dir + lens * 1.7;
        float amp = .1 + uBass * .5 + uDrop * .35;
        float wave = sin(r * 5. - ph);
        float y = (lens - (LENSES - 1.) * .5) * 1.45;
        y += wave * amp * exp(-r * .3);
        y += dir * r * r * .085 * (1. + uLowMid);     // bowls alternate up / down → hourglass waists
        vec3 p = vec3(cos(ang) * r, y, sin(ang) * r);
        float tick = floor(uTime * 30.);
        p += (vec3(hash1(rnd * 91. + tick), hash1(rnd * 13. + tick), hash1(rnd * 37. + tick)) - .5) * .06 * uHat;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float band = pow(.5 + .5 * wave, 5.);
        float pulse = exp(-abs(r - (1. - uBeat) * 3.4) * 5.) * uBeat;
        vB = (.1 + .8 * band + 1.4 * pulse) * (.35 + .65 * rnd) * smoothstep(3.4, 2.6, r) * (.8 + .4 * uEnergy);
        gl_PointSize = max(1., 1.7 * uPxScale * (7. / max(1., -mv.z)));
        vC = mix(vec3(.85, .86, 1.), vec3(.5, .46, 1.), rnd * rnd);
      }`));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }
  update(f, dt, t) {
    this.points.rotation.y += dt * (.05 + f.lowMid * .3);
    this.points.rotation.z = Math.sin(U.uPhase.value * .07) * .12;
    this.camera.position.set(Math.sin(U.uPhase.value * .05) * 1.5, 1.6 + Math.sin(U.uPhase.value * .11) * 1.2, 8.2 - f.bass * 1.2);
    this.camera.lookAt(0, 0, 0);
  }
}

// ── ORGANISM ─ breathing, deforming particle sphere ────────────────────────
export class Organism extends Base {
  constructor() {
    super('organism', { feedback: .1, zoom: .001, warp: 0, bloom: .7 });
    this.scene.add(blackBg());
    const N = 150000, SHELLS = 6;
    const pos = new Float32Array(N * 3), data = new Float32Array(N * 4);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - ((i + .5) / N) * 2, rr = Math.sqrt(1 - y * y), th = golden * i;
      pos.set([Math.cos(th) * rr, y, Math.sin(th) * rr], i * 3);
      data.set([i % SHELLS, Math.random(), Math.random() < .07 ? 1 : 0, Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aData', new THREE.BufferAttribute(data, 4));
    this.points = new THREE.Points(geo, pointsMat(/* glsl */ `
      attribute vec4 aData;
      varying vec3 vC; varying float vB;
      void main() {
        vec3 dir = position;
        float shell = aData.x, rnd = aData.y, inner = aData.z;
        float t = uPhase * .3 + shell * .08;          // shells lag each other → layered skins
        float n = noise3(dir * (1.3 + uLowMid * .7) + vec3(t, t * .7, -t * .5));
        float n2 = noise3(dir * 4.2 - t * 1.4);
        float rad = 2.3 * (1. - shell * .03);
        rad *= 1. + (n - .5) * (.55 + uBass * 1.1) + (n2 - .5) * .14 * (.3 + uHigh * 2.) + uBeat * .07 + uDrop * .25;
        if (inner > .5) rad *= pow(rnd, .5);
        vec3 p = dir * rad;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        vB = inner > .5 ? .18 : (.22 + .55 * aData.w) * (1. + uBeat * .6);
        gl_PointSize = max(1., 1.5 * uPxScale * (8. / max(1., -mv.z)));
        vC = mix(vec3(.92, .92, 1.), vec3(.7, .72, 1.), shell / 6.);
      }`));
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }
  update(f, dt) {
    this.points.rotation.y += dt * (.08 + f.lowMid * .5);
    this.points.rotation.x += dt * (.03 + f.highMid * .2);
    this.camera.position.z = 7.5 - f.bass * 1.5;
  }
}

// ── FOOTAGE ─ your images / videos as B&W VHS with RGB split ───────────────
export class Footage extends Base {
  constructor() {
    super('footage', { feedback: .25, zoom: .002, warp: 0, bloom: .3 });
    this.clips = [];       // { tex, aspect, video? }
    this.idx = 0;
    this.beats = 0;
    this.uTex = { value: null };
    this.uHas = { value: 0 };
    this.uAspect = { value: 1 };
    const q = bgQuad(/* glsl */ `
      uniform sampler2D uTex; uniform float uHas, uAspect;
      float luma(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
      float src(vec2 uv) {
        if (uHas > .5) {
          float sa = uRes.x / uRes.y;
          vec2 s = sa > uAspect ? vec2(1., uAspect / sa) : vec2(sa / uAspect, 1.);
          vec2 c = (uv - .5) * s + .5;
          return luma(texture2D(uTex, clamp(c, 0., 1.)).rgb);
        }
        // no footage yet: drifting B&W smoke
        vec2 p = (uv - .5) * vec2(uRes.x / uRes.y, 1.) * 2.2;
        float f = fbm(p * 1.2 + 2. * vec2(fbm(p + uPhase * .15), fbm(p - uPhase * .12 + 4.)));
        return smoothstep(.38, .85, f);
      }
      void main() {
        vec2 uv = gl_FragCoord.xy / uRes;
        uv = (uv - .5) * (1. - uBass * .07 - uBeat * .04) + .5;
        float line = floor(uv.y * uRes.y / 3.);
        uv.x += (hash(vec2(line, floor(uTime * 20.))) - .5) * .0015 * (.3 + uHigh * 2.);
        if (hash(vec2(floor(uTime * 8.), 2.)) < uDrop * .6) uv.y = fract(uv.y + uDrop * .3);
        float o = .001 + .018 * uBeat * uBeat + .04 * uDrop;
        vec3 col = vec3(src(uv + vec2(o, o * .2)), src(uv), src(uv - vec2(o, o * .2)));
        col = smoothstep(.04, .96, col);
        col *= .9 + .1 * sin(gl_FragCoord.y * 1.4);
        col += (hash(gl_FragCoord.xy + fract(uTime) * 100.) - .5) * .035;
        col *= vec3(.95, .95, 1.05);
        gl_FragColor = vec4(col, 1.);
      }`);
    q.material.uniforms = { ...U, uTex: this.uTex, uHas: this.uHas, uAspect: this.uAspect };
    this.scene.add(q);
  }
  async addFile(file) {
    const url = URL.createObjectURL(file);
    if (file.type.startsWith('video/')) {
      const v = document.createElement('video');
      Object.assign(v, { src: url, muted: true, loop: true, playsInline: true });
      await v.play().catch(() => {});
      await new Promise(r => (v.readyState >= 1 ? r() : v.addEventListener('loadedmetadata', r, { once: true })));
      this.clips.push({ tex: new THREE.VideoTexture(v), aspect: v.videoWidth / v.videoHeight || 16 / 9, video: v });
    } else {
      const img = new Image();
      img.src = url;
      await img.decode();
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      this.clips.push({ tex, aspect: img.naturalWidth / img.naturalHeight });
    }
    this.show(this.clips.length - 1);
  }
  show(i) {
    if (!this.clips.length) return;
    this.idx = (i + this.clips.length) % this.clips.length;
    const c = this.clips[this.idx];
    this.uTex.value = c.tex; this.uAspect.value = c.aspect; this.uHas.value = 1;
  }
  update(f) {
    // cut to the next clip every 8 beats; the post glitch hides the cut
    if (f.beat && this.clips.length > 1 && ++this.beats % 8 === 0) { this.show(this.idx + 1); this.onCut?.(); }
  }
}

// ── TERRAIN ─ scrolling ridgelines of the live spectrum ────────────────────
export class Terrain extends Base {
  constructor() {
    super('terrain', { feedback: 0, zoom: 0, warp: 0, bloom: .5 });
    this.scene.add(blackBg());
    const COLS = 160, ROWS = 70;
    this.COLS = COLS; this.ROWS = ROWS;
    this.buf = new Uint8Array(COLS * ROWS);
    this.tex = new THREE.DataTexture(this.buf, COLS, ROWS, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.head = 0; this.acc = 0;
    this.uSpec = { value: this.tex }; this.uHead = { value: 0 }; this.uFrac = { value: 0 };

    const lineIdx = [], fillIdx = [], lineAttr = [], fillAttr = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        lineAttr.push(c / (COLS - 1), r, 1);
        if (c) lineIdx.push(r * COLS + c - 1, r * COLS + c);
        fillAttr.push(c / (COLS - 1), r, 1, c / (COLS - 1), r, 0);
        if (c) {
          const a = (r * COLS + c - 1) * 2, b = (r * COLS + c) * 2;
          fillIdx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    const vert = /* glsl */ `
      attribute vec3 aT;
      uniform sampler2D uSpec; uniform float uHead, uFrac, uLift;
      varying float vB;
      const float ROWS = ${ROWS}.;
      void main() {
        float age = aT.y;
        float row = mod(uHead - age + ROWS, ROWS);
        float u = aT.x;
        float bin = abs(u - .5) * 2.;                 // bass in the middle, treble at the edges
        float v = texture2D(uSpec, vec2(.02 + bin * .96, (row + .5) / ROWS)).r;
        float env = smoothstep(1., .55, bin);
        float h = v * v * v * 3. * env * (.7 + uBass * .6);
        float z = 3. - (age + uFrac) * .26;
        vec3 p = vec3((u - .5) * 13., aT.z > .5 ? h + uLift : -2., z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.);
        float fade = 1. - age / ROWS;
        vB = fade * fade * (.55 + .45 * v) * (1. + (age < 1.5 ? uBeat * 1.5 : 0.));
      }`;
    const mk = (attr, idx, frag, opts) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(attr.length), 3));
      g.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(attr), 3));
      g.setIndex(idx);
      const m = new THREE.ShaderMaterial({
        uniforms: { ...U, uSpec: this.uSpec, uHead: this.uHead, uFrac: this.uFrac, uLift: { value: opts.lift } },
        vertexShader: GLSL + vert, fragmentShader: GLSL + frag, ...opts.mat,
      });
      return { g, m };
    };
    const fill = mk(fillAttr, fillIdx, `varying float vB; void main(){ gl_FragColor = vec4(vec3(.012, .012, .02), 1.); }`,
      { lift: -.01, mat: { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } });
    const lines = mk(lineAttr, lineIdx, `varying float vB; void main(){ gl_FragColor = vec4(mix(vec3(.6, .55, 1.), vec3(1.), vB) * vB, 1.); }`,
      { lift: 0, mat: {} });
    this.fill = new THREE.Mesh(fill.g, fill.m);
    this.lines = new THREE.LineSegments(lines.g, lines.m);
    this.fill.frustumCulled = this.lines.frustumCulled = false;
    this.scene.add(this.fill, this.lines);
    this.camera.position.set(0, 3.2, 7.5);
    this.camera.lookAt(0, 0, -6);
  }
  update(f, dt, t, analyzer) {
    const spec = analyzer?.spectrum;
    this.acc += dt * 26;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.head = (this.head + 1) % this.ROWS;
      const row = this.head * this.COLS;
      for (let c = 0; c < this.COLS; c++) {
        let v = 0;
        if (spec && f.active) {
          // log-spaced bins 30 Hz → 14 kHz
          const hz = 30 * Math.pow(14000 / 30, c / (this.COLS - 1));
          const i = Math.min(spec.length - 1, Math.round(hz / (analyzer.binHz || 23.4)));
          const db = 20 * Math.log10(spec[i] + 1e-9);
          v = Math.min(1, Math.max(0, (db + 72) / 58)) * (1 + c / this.COLS * .5);
        }
        this.buf[row + c] = Math.min(255, v * 255);
      }
      this.tex.needsUpdate = true;
    }
    this.uHead.value = this.head;
    this.uFrac.value = this.acc;
    this.camera.position.x = Math.sin(U.uPhase.value * .08) * 1.2;
    this.camera.position.y = 2.9 - f.bass * .4;
    this.camera.position.z = 7;
    this.camera.lookAt(0, .3, -6);
  }
}

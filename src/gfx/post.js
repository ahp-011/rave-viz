import * as THREE from 'three';
import { FS_VERT } from './common.js';
import { CLUB_GLSL } from './club.js';

// Pipeline per frame:
//   scene ─► cur ─┐
//   prev feedback ┴─► feedback pass (zoom/rotate/warp/hue-shift, max-blend) ─► feed[n]
//   feed[n] ─► bright-pass + blur at 1/4 res ─► bloom
//   feed[n] + bloom ─► final (kaleido, glitch, chroma split, flash, vignette, tonemap) ─► screen

const HASH = `float h(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`;

const FEEDBACK_FRAG = /* glsl */ `
uniform sampler2D tCur, tPrev;
uniform float uFb, uZoom, uRot, uWarp, uHueShift, uTime;
varying vec2 vUv;
vec3 hueShift(vec3 c, float a) {
  const vec3 k = vec3(0.57735);
  float ca = cos(a);
  return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1. - ca);
}
void main() {
  vec2 p = vUv - .5;
  p *= 1. - uZoom;
  float c = cos(uRot), s = sin(uRot);
  p = mat2(c, -s, s, c) * p;
  p += uWarp * .004 * vec2(sin(p.y * 9. + uTime * .7), cos(p.x * 9. - uTime * .6));
  vec3 prev = texture2D(tPrev, p + .5).rgb;
  prev = max(hueShift(prev, uHueShift), 0.);
  vec3 cur = texture2D(tCur, vUv).rgb;
  gl_FragColor = vec4(max(cur, prev * uFb), 1.);
}`;

const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = vec3(0.);
  c += texture2D(tSrc, vUv + uTexel * vec2(-1., -1.)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1., -1.)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2(-1.,  1.)).rgb;
  c += texture2D(tSrc, vUv + uTexel * vec2( 1.,  1.)).rgb;
  c *= .25;
  float l = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(c * smoothstep(.9, 2., l), 1.);
}`;

const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * .227;
  c += texture2D(tSrc, vUv + uDir * 1.38).rgb * .316;
  c += texture2D(tSrc, vUv - uDir * 1.38).rgb * .316;
  c += texture2D(tSrc, vUv + uDir * 3.23).rgb * .07;
  c += texture2D(tSrc, vUv - uDir * 3.23).rgb * .07;
  gl_FragColor = vec4(c, 1.);
}`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D tFeed, tBloom;
uniform float uGlitch, uFlash, uKaleido, uChroma, uTime, uBass, uBloom, uSegs, uTransType, uLook, uBeat;
uniform vec2 uRes;
varying vec2 vUv;
${HASH}
bool is(float v, float k) { return abs(v - k) < .5; }
${CLUB_GLSL}
vec3 samp(vec2 uv, vec2 off) { return vec3(texture2D(tFeed, uv + off).r, texture2D(tFeed, uv).g, texture2D(tFeed, uv - off).b); }
vec3 sampB(vec2 uv, vec2 off) { return vec3(texture2D(tBloom, uv + off).r, texture2D(tBloom, uv).g, texture2D(tBloom, uv - off).b); }
void main() {
  vec2 uv = vUv;
  float asp = uRes.x / uRes.y;
  float g = uGlitch, tt = uTransType;
  // club: the whole room pumps a little on the kick
  uv = (uv - .5) * (1. - .012 * uBeat * uClub) + .5;

  // ── look modifiers (one per scene visit, never the same twice in a row) ──
  if (is(uLook, 1.)) uv.x = .5 - abs(uv.x - .5);                       // mirror
  if (is(uLook, 4.)) { vec2 grid = vec2(150. * asp, 150.); uv = (floor(uv * grid) + .5) / grid; } // pixel
  float kal = max(uKaleido, is(uLook, 2.) ? 1. : 0.);
  if (kal > .001) {
    vec2 p = (uv - .5) * vec2(asp, 1.);
    float a = atan(p.y, p.x) + uTime * .07, r = length(p);
    float seg = 6.28318 / uSegs;
    a = mod(a, seg); a = abs(a - seg * .5);
    vec2 k = r * vec2(cos(a), sin(a)) / vec2(asp, 1.) + .5;
    k = 1. - abs(1. - mod(k, 2.));
    uv = mix(uv, k, kal);
  }

  // ── transitions (5 kinds, rotated so consecutive cuts never match) ──
  if (g > .01) {
    if (is(tt, 0.)) {                                   // tear
      float t = floor(uTime * 24.);
      float rows = mix(6., 42., h(vec2(t, 3.)));
      float row = floor(uv.y * rows);
      if (h(vec2(row, t)) < g * .75) uv.x += (h(vec2(row, t + 1.)) - .5) * .3 * g;
      if (h(vec2(t, 7.)) < g * .35) uv.y += (h(vec2(t, 9.)) - .5) * .08 * g;
    } else if (is(tt, 1.)) {                            // pixel dissolve
      float n = mix(600., 8., g * g);
      vec2 grid = vec2(n * asp, n);
      uv = (floor(uv * grid) + .5) / grid;
    } else if (is(tt, 2.)) {                            // slit-scan slices
      float sl = floor(uv.x * 28.);
      uv.y = fract(uv.y + (h(vec2(sl, floor(uTime * 12.))) - .5) * .7 * g);
    } else if (is(tt, 3.)) {                            // zoom punch
      uv = (uv - .5) * (1. - .4 * g) + .5;
    } else {                                            // mirror fold
      uv.y = mix(uv.y, .5 - abs(uv.y - .5), step(.3, g));
      uv.x = mix(uv.x, 1. - uv.x, step(.5, h(vec2(floor(uTime * 16.), 1.))) * step(.5, g));
    }
  }

  vec2 d = uv - .5;
  float amt = uChroma * (1. + length(d) * 2.5) * (is(uLook, 5.) ? 2.5 : 1.);
  vec2 off = d * amt + vec2(amt * g * 3., 0.);
  vec3 c = samp(uv, off);
  if (is(tt, 3.) && g > .01) {                          // radial blur for the zoom punch
    for (float i = 1.; i < 6.; i++) c += samp(uv - d * i * .035 * g, off);
    c /= 6.;
  }
  c += sampB(uv, off) * uBloom * .35 * (1. + uBass * .5);
  c *= 1. + uFlash * .25;
  if (is(tt, 3.)) c += g * g * .8;                      // white burst
  c *= 1. - dot(d, d) * .85;
  if (is(tt, 0.) && g > .25 && h(floor(uv * vec2(14., 22.)) + floor(uTime * 20.)) < g * .12) c = vec3(1.2) - c;
  if (is(tt, 4.) && g > .6) c = vec3(1.) - c;
  if (uClub > .001) c = clubLights(vUv, c);

  float L = max(c.r, max(c.g, c.b));
  c *= (1. - exp(-L * 1.4)) / max(L, 1e-4);
  c = mix(vec3(dot(c, vec3(.299, .587, .114))), c, 1.15);
  if (is(uLook, 4.)) c = floor(c * 5. + .5) / 5.;                       // posterize with the pixel look
  if (is(uLook, 3.)) c = mix(c, vec3(1.) - c, step(.7, uBeat));         // invert strobe on kicks
  c = mix(c, vec3(1.), uStrobe);
  if (uClub > .001) c = mix(c, clubCrowd(vUv, c), uClub);
  c += (h(uv * uRes + fract(uTime)) - .5) * .012;
  gl_FragColor = vec4(c, 1.);
}`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.cur = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthBuffer: true, samples: 4 });
    this.feed = [new THREE.WebGLRenderTarget(1, 1, rtOpts), new THREE.WebGLRenderTarget(1, 1, rtOpts)];
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.i = 0;

    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
    this.mFeedback = mk(FEEDBACK_FRAG, {
      tCur: { value: null }, tPrev: { value: null }, uFb: { value: .6 }, uZoom: { value: 0 },
      uRot: { value: 0 }, uWarp: { value: 0 }, uHueShift: { value: 0 }, uTime: { value: 0 },
    });
    this.mBright = mk(BRIGHT_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.mBlur = mk(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mFinal = mk(FINAL_FRAG, {
      tFeed: { value: null }, tBloom: { value: null },
      uGlitch: { value: 0 }, uFlash: { value: 0 }, uKaleido: { value: 0 }, uChroma: { value: .003 },
      uTime: { value: 0 }, uBass: { value: 0 }, uBloom: { value: .9 }, uSegs: { value: 8 },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTransType: { value: 0 }, uLook: { value: 0 }, uBeat: { value: 0 },
      uClub: { value: 0 }, uBeamAng: { value: [0, 0, 0, 0, 0, 0] }, uBeamI: { value: [0, 0, 0, 0, 0, 0] },
      uColA: { value: new THREE.Vector3() }, uColB: { value: new THREE.Vector3() }, uLaserCol: { value: new THREE.Vector3() },
      uLaserRot: { value: 0 }, uLaserSpread: { value: 0 }, uLaserI: { value: 0 }, uLaserN: { value: 0 }, uStrobe: { value: 0 },
      uHands: { value: 0 }, uJump: { value: 0 }, uBeatPhase: { value: 0 }, uLightAmt: { value: 0 },
    });
  }

  setSize(w, h) {
    this.w = w; this.h = h;
    this.cur.setSize(w, h);
    this.feed.forEach(t => t.setSize(w, h));
    const bw = Math.max(1, w >> 1), bh = Math.max(1, h >> 1);
    this.bloomA.setSize(bw, bh);
    this.bloomB.setSize(bw, bh);
    this.bw = bw; this.bh = bh;
    this.mFinal.uniforms.uRes.value.set(w, h);
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(scene, camera, fx, fin) {
    const r = this.r;
    r.setRenderTarget(this.cur);
    r.clear();
    r.render(scene, camera);

    const prev = this.feed[this.i], next = this.feed[1 - this.i];
    this.i = 1 - this.i;
    const fu = this.mFeedback.uniforms;
    fu.tCur.value = this.cur.texture; fu.tPrev.value = prev.texture;
    fu.uFb.value = fx.feedback; fu.uZoom.value = fx.zoom; fu.uRot.value = fx.rotate;
    fu.uWarp.value = fx.warp; fu.uHueShift.value = fx.hueShift; fu.uTime.value = fin.time;
    this._pass(this.mFeedback, next);

    this.mBright.uniforms.tSrc.value = next.texture;
    this.mBright.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
    this._pass(this.mBright, this.bloomA);
    this.mBlur.uniforms.tSrc.value = this.bloomA.texture;
    this.mBlur.uniforms.uDir.value.set(1.6 / this.bw, 0);
    this._pass(this.mBlur, this.bloomB);
    this.mBlur.uniforms.tSrc.value = this.bloomB.texture;
    this.mBlur.uniforms.uDir.value.set(0, 1.6 / this.bh);
    this._pass(this.mBlur, this.bloomA);

    const u = this.mFinal.uniforms;
    u.tFeed.value = next.texture; u.tBloom.value = this.bloomA.texture;
    u.uGlitch.value = fin.glitch; u.uFlash.value = fin.flash; u.uKaleido.value = fin.kaleido;
    u.uChroma.value = fin.chroma; u.uTime.value = fin.time; u.uBass.value = fin.bass;
    u.uBloom.value = fx.bloom; u.uSegs.value = fin.segs;
    if (fin.club) {
      for (const key in fin.club) {
        const v = fin.club[key], tgt = u[key];
        if (!tgt) continue;
        if (tgt.value && tgt.value.isVector3) tgt.value.fromArray(v);
        else tgt.value = v;
      }
    }
    u.uTransType.value = fin.trans; u.uLook.value = fin.look; u.uBeat.value = fin.beat;
    this._pass(this.mFinal, null);
  }
}

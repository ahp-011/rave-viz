import * as THREE from 'three';
import { U, GLSL } from './common.js';

// Glowing square particles. Bass scales them, beats burst them outward,
// hi-hats make them sparkle and jitter. stream = fly toward the camera.
export function makeSparkles({ count = 2500, spread = [16, 12, 16], stream = false, size = 1 } = {}) {
  const pos = new Float32Array(count * 3), seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - .5) * spread[0];
    pos[i * 3 + 1] = (Math.random() - .5) * spread[1];
    pos[i * 3 + 2] = (Math.random() - .5) * spread[2];
    for (let j = 0; j < 4; j++) seed[i * 4 + j] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uStream: { value: stream ? 1 : 0 }, uDepth: { value: spread[2] }, uSize: { value: size } },
    vertexShader: GLSL + /* glsl */ `
      attribute vec4 aSeed;
      uniform float uStream, uDepth, uSize;
      varying vec3 vCol; varying float vA;
      void main() {
        vec3 p = position;
        if (uStream > .5) {
          p.z = mod(p.z + uTravel * (6. + aSeed.x * 6.), uDepth) - uDepth + 2.;
          p.xy *= 1. + .3 * sin(uPhase + aSeed.z * TAU);
        } else {
          p.y = mod(p.y + uPhase * (.3 + aSeed.x * .8) + 6., 12.) - 6.;
          p.x += sin(uPhase * .5 + aSeed.z * TAU) * .8;
          p.z += cos(uPhase * .4 + aSeed.w * TAU) * .8;
          p += normalize(p + 1e-4) * uBeat * (.4 + aSeed.x * 1.2);
        }
        float tick = floor(uTime * 30.);
        p += (vec3(hash1(aSeed.x * 91. + tick), hash1(aSeed.y * 37. + tick), hash1(aSeed.z * 53. + tick)) - .5) * .25 * uHat;
        vec4 mv = modelViewMatrix * vec4(p, 1.);
        gl_Position = projectionMatrix * mv;
        float tw = step(.75, fract(aSeed.w * 13. + uTime * (1. + aSeed.y * 3.)));
        gl_PointSize = uSize * (2. + aSeed.x * 7.) * (1. + uBass * 1.8 + tw * uHat * 2.5) * (260. / max(.5, -mv.z)) * uPxScale;
        gl_PointSize = min(gl_PointSize, 34. * uPxScale);
        vCol = pal(aSeed.y * .8 + uHue + uPhase * .05);
        vA = (.55 + .45 * tw * (.3 + uHigh)) * smoothstep(-40., -2., mv.z);
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - .5;
        float sq = step(max(abs(c.x), abs(c.y)), .17);
        float glow = exp(-length(c) * 7.);
        gl_FragColor = vec4(vCol * (sq * 1.1 + glow * .5) * vA + sq * .2 * vA, 1.);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

// Vertical light beams: soft gaussian columns that thicken with bass,
// drift sideways, and colour-cycle through the palette.
export function makeBeams({ count = 7, height = 40, depth = -4 } = {}) {
  const group = new THREE.Group();
  const geo = new THREE.PlaneGeometry(1, height);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...U, uI: { value: i / count }, uSeed: { value: Math.random() } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
      fragmentShader: GLSL + /* glsl */ `
        uniform float uI, uSeed; varying vec2 vUv;
        void main() {
          float x = abs(vUv.x - .5) * 2.;
          float core = exp(-x * x * 60.), halo = exp(-x * x * 6.);
          float flick = .75 + .25 * sin(uTime * 23. * (1. + uSeed) + uSeed * 40.) * uHigh;
          float fade = smoothstep(0., .25, vUv.y) * smoothstep(1., .6, vUv.y);
          vec3 col = pal(uI + uHue + uPhase * .03);
          float k = (.15 + uBass * .6 + uBeat * .3 + uDrop * 1.) * flick * fade;
          gl_FragColor = vec4((col * halo * .5 + mix(col, vec3(1.), .5) * core) * k, 1.);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.userData = { seed: Math.random(), speed: .1 + Math.random() * .25, x0: (Math.random() - .5) * 18, tilt: (Math.random() - .5) * .25 };
    m.position.z = depth - Math.random() * 6;
    m.rotation.z = m.userData.tilt;
    group.add(m);
  }
  group.userData.update = (f, phase) => {
    for (const m of group.children) {
      const d = m.userData;
      m.position.x = d.x0 + Math.sin(phase * d.speed + d.seed * 10) * 4;
      m.scale.x = .35 + f.bass * 1.6 + f.dropPulse * 3;
    }
  };
  return group;
}

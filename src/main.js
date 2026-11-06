import * as THREE from 'three';
import { AudioInput } from './audio/input.js';
import { Analyzer } from './audio/analyzer.js';
import { DebugOverlay } from './ui/debug.js';
import { Menu } from './ui/menu.js';
import { U, PaletteMixer, FX_DEFAULT } from './gfx/common.js';
import { Post } from './gfx/post.js';
import { SCENES } from './scenes/index.js';

// ── state ─────────────────────────────────────────────
const store = {
  get(k, d) { try { const v = localStorage.getItem('rv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rv.' + k, JSON.stringify(v)); } catch {} },
};
const state = {
  scene: 1,
  auto: store.get('auto', true),
  sensitivity: store.get('sens', 1),
  frozen: false,
  kaleido: false,
  source: 'no input',
  quality: 1,
};

// ── renderer ──────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.autoClear = false;
document.body.appendChild(renderer.domElement);
const post = new Post(renderer);

// ── audio ─────────────────────────────────────────────
const input = new AudioInput();
const analyzer = new Analyzer();
analyzer.sensitivity = state.sensitivity;
state.offset = store.get('offset', 0);
analyzer.syncOffset = state.offset / 1000;
const menu = new Menu(input);
const _onchange = input.onchange;
input.onchange = label => {
  _onchange(label);
  state.source = label;
  if (input.analyser && analyzer.analyser !== input.analyser) analyzer.attach(input.analyser);
};

input.onOnset = ev => analyzer.queueOnset(ev);

const overlay = new DebugOverlay();
overlay.setVisible(store.get('debug', false));

// ── scenes ────────────────────────────────────────────
const scenes = SCENES.map(S => new S());
const footage = scenes.find(s => s.name === 'footage');
footage.onCut = () => { glitch = Math.max(glitch, .6); };
menu.onFootage = async files => {
  for (const file of files) await footage.addFile(file);
  switchScene(scenes.indexOf(footage));
};
let active = scenes[0];
const palette = new PaletteMixer();
const fx = { ...FX_DEFAULT, ...active.fx };
let glitch = 0, flash = 0, kaleidoMix = 0, pendingScene = -1, lastSwitch = 0;

// Shuffle bags: every option comes up once before any repeats, and never the
// same one twice in a row, so scenes, cuts and looks keep changing.
class Bag {
  constructor(n) { this.n = n; this.q = []; this.last = -1; }
  next(exclude = -1) {
    if (!this.q.length) {
      this.q = [...Array(this.n).keys()];
      for (let i = this.q.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.q[i], this.q[j]] = [this.q[j], this.q[i]]; }
    }
    let i = this.q.findIndex(v => v !== this.last && v !== exclude);
    if (i < 0) i = 0;
    const v = this.q.splice(i, 1)[0];
    this.last = v;
    return v;
  }
}
const LOOKS = ['clean', 'mirror', 'kaleido', 'strobe', 'pixel', 'rgb echo'];
const TRANSITIONS = ['tear', 'pixel dissolve', 'slit-scan', 'zoom punch', 'mirror fold'];
const sceneBag = new Bag(SCENES.length), transBag = new Bag(TRANSITIONS.length), lookBag = new Bag(LOOKS.length);
let trans = 0, look = 0, pendingLook = -1;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h);
  const pr = renderer.getPixelRatio() * state.quality;
  const rw = Math.max(2, Math.round(w * pr)), rh = Math.max(2, Math.round(h * pr));
  post.setSize(rw, rh);
  U.uRes.value.set(rw, rh);
  U.uPxScale.value = rh / 1080;
  scenes.forEach(s => s.resize(w, h));
}
window.addEventListener('resize', resize);
resize();

function switchScene(n, { glitchAmt = 1 } = {}) {
  if (n === state.scene - 1 && pendingScene < 0) return;
  pendingScene = n;
  pendingLook = lookBag.next();
  trans = transBag.next();
  glitch = Math.max(glitch, glitchAmt);
  lastSwitch = performance.now() / 1000;
}
// new look on the same scene, with its own transition
function reroll() {
  pendingLook = lookBag.next();
  trans = transBag.next();
  glitch = Math.max(glitch, .8);
}
const randomOther = () => sceneBag.next(state.scene - 1);

// ── keyboard ──────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
  const k = e.key;
  if (k >= '1' && k <= '9' && +k <= scenes.length) switchScene(+k - 1);
  else if (k === 'ArrowRight') switchScene((state.scene) % scenes.length);
  else if (k === 'ArrowLeft') switchScene((state.scene - 2 + scenes.length) % scenes.length);
  else if (k === 'a' || k === 'A') store.set('auto', state.auto = !state.auto);
  else if (k === 'c' || k === 'C') palette.next();
  else if (k === 'k' || k === 'K') state.kaleido = !state.kaleido;
  else if (k === 'g' || k === 'G') { trans = transBag.next(); glitch = 1; }
  else if (k === 'l' || k === 'L') reroll();
  else if (k === 'f' || k === 'F') {
    document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
  }
  else if (k === 'h' || k === 'H') { overlay.setVisible(!overlay.visible); store.set('debug', overlay.visible); }
  else if (k === 'm' || k === 'M') menu.toggle();
  else if (k === 'Escape') menu.setOpen(false);
  else if (k === 'p' || k === 'P') input.togglePlayback();
  else if (k === 'ArrowUp' || k === 'ArrowDown') {
    const s = state.sensitivity * (k === 'ArrowUp' ? 1.1 : 1 / 1.1);
    state.sensitivity = analyzer.sensitivity = Math.min(4, Math.max(0.25, s));
    input.setSensitivity(state.sensitivity);
    store.set('sens', state.sensitivity);
  }
  else if (k === ' ') state.frozen = !state.frozen;
  else if (k === 't' || k === 'T') analyzer.tap(performance.now() / 1000);
  else if (k === 'b' || k === 'B') analyzer.resync(performance.now() / 1000);
  else if (k === '[' || k === ']') {
    state.offset = Math.max(-200, Math.min(300, (state.offset || 0) + (k === ']' ? 10 : -10)));
    analyzer.syncOffset = state.offset / 1000;
    store.set('offset', state.offset);
  }
  else return;
  e.preventDefault();
});

let idle;
window.addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => document.body.classList.add('idle'), 2000);
});

// ── loop ──────────────────────────────────────────────
let last = performance.now(), beatCount = 0;
let fpsAcc = 0, fpsN = 0, fpsT = 0;

function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;
  const t = nowMs / 1000;
  const f = analyzer.update(dt, t);

  // drive shared uniforms
  U.uTime.value = t;
  U.uBass.value = f.bass; U.uLowMid.value = f.lowMid; U.uMid.value = (f.lowMid + f.highMid) / 2;
  U.uHigh.value = f.treble; U.uEnergy.value = f.energy;
  U.uBeat.value = f.beatPulse; U.uHat.value = f.hatPulse; U.uDrop.value = f.dropPulse;
  U.uPhase.value += dt * (0.3 + U.uMid.value * 1.3 + f.energy * 0.6);
  U.uTravel.value += dt * (0.5 + f.bass * 2.2 + f.beatPulse * 1.5);
  U.uHue.value += dt * (0.012 + 0.05 * f.energy) + (f.beat ? 0.015 : 0);

  if (f.beat) {
    flash = Math.max(flash, 0.3 + f.bass * 0.3);
    if (++beatCount % 64 === 0) palette.next(); // fresh colours every 16 bars
    if (state.auto && beatCount % 32 === 0 && pendingScene < 0) reroll(); // new look every 8 bars
  }
  if (f.drop) {
    flash = 1;
    palette.next();
    if (state.auto) {
      switchScene(randomOther());
    } else { trans = transBag.next(); glitch = Math.max(glitch, 0.5); }
  }
  // with auto on and no drop for a while, keep it moving anyway
  if (state.auto && f.active && t - lastSwitch > 45) switchScene(randomOther(), { glitchAmt: 0.7 });

  // swap scene at the peak of the glitch
  if (pendingScene >= 0 && glitch > 0.5) {
    active = scenes[pendingScene];
    state.scene = pendingScene + 1;
    pendingScene = -1;
  }
  if (pendingLook >= 0 && glitch > 0.5) { look = pendingLook; pendingLook = -1; }
  glitch *= Math.exp(-dt / 0.22);
  flash *= Math.exp(-dt / 0.09);
  kaleidoMix += ((state.kaleido ? 1 : 0) - kaleidoMix) * (1 - Math.exp(-dt / 0.4));
  palette.update(dt);

  // ease post settings toward the active scene's
  const ke = 1 - Math.exp(-dt / 0.5);
  for (const key in fx) fx[key] += (active.fx[key] - fx[key]) * ke;
  const fxNow = {
    ...fx,
    zoom: fx.zoom * (1 + f.bass * 1.5) + f.beatPulse * 0.006,
    rotate: fx.rotate * (1 + f.lowMid * 2),
    hueShift: fx.hueShift * (1 + f.energy * 2),
  };

  if (!state.frozen) {
    active.update(f, dt, t, analyzer);
    post.render(active.scene, active.camera, fxNow, {
      time: t, glitch, flash, kaleido: kaleidoMix, bass: f.bass,
      chroma: 0.002 + 0.01 * f.beatPulse + 0.004 * f.treble + 0.012 * glitch,
      segs: 6 + 2 * (Math.floor(U.uHue.value * 2) % 3),
      trans, look, beat: f.beatPulse,
    });
  }

  // auto-quality: drop render resolution if we can't hold ~55 fps
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 2) {
    const fps = fpsN / fpsAcc;
    if (!state.frozen && !document.hidden && t - fpsT > 3) {
      if (fps < 52 && state.quality > 0.5) { state.quality = Math.max(0.5, state.quality * 0.85); resize(); fpsT = t; }
      else if (fps > 59 && state.quality < 1) { state.quality = Math.min(1, state.quality * 1.08); resize(); fpsT = t; }
    }
    fpsAcc = 0; fpsN = 0;
  }

  overlay.draw(analyzer, { ...state, scene: `${state.scene} ${active.name}/${LOOKS[look]}`, }, dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.rv = { state, analyzer, input, U };

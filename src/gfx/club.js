// CLUB MODE — puts you on the dancefloor.
// The active scene becomes the LED wall behind the DJ; in front of it:
//   • 6 moving-head spotlights on a truss, sweeping through haze in patterns
//   • a laser fan from behind the crowd, snapping to the beat
//   • strobes on drops and build-ups
// Everything is drawn in the final post pass (screen space, cheap).

export const BEAMS = 6;
export const LASERS = 16;

export const CLUB_GLSL = /* glsl */ `
uniform float uClub, uBeamAng[${BEAMS}], uBeamI[${BEAMS}];
uniform vec3 uColA, uColB, uLaserCol;
uniform float uLaserRot, uLaserSpread, uLaserI, uLaserN, uStrobe, uHands, uJump, uBeatPhase, uLightAmt;

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float haze(vec2 p) {
  vec2 q = p * vec2(1.6, 2.4) + vec2(uTime * .04, uTime * .015);
  return .25 + .75 * (vnoise(q) * .6 + vnoise(q * 2.3 - uTime * .03) * .4);
}

// additive light: spotlights, lasers, fixture glare (in HDR, before tonemap)
vec3 clubLights(vec2 uv, vec3 c) {
  float asp = uRes.x / uRes.y;
  vec2 P = vec2((uv.x - .5) * asp, uv.y);
  float hz = haze(P);
  vec3 add = vec3(0.);

  for (int i = 0; i < ${BEAMS}; i++) {
    float fi = float(i);
    vec2 src = vec2(((fi + .5) / ${BEAMS}. - .5) * asp * .92, 1.03);
    float a = uBeamAng[i];
    vec2 d = vec2(sin(a), -cos(a));
    vec2 q = P - src;
    float along = dot(q, d);
    float perp = abs(q.x * d.y - q.y * d.x);
    float w = .004 + along * .085;
    float cone = exp(-(perp * perp) / (w * w)) * smoothstep(0., .04, along) / (1. + along * .7);
    vec3 col = mod(fi, 2.) < .5 ? uColA : uColB;
    add += col * cone * uBeamI[i] * hz * 1.3;
    add += mix(col, vec3(1.), .6) * exp(-length(q) * 55.) * uBeamI[i] * 2.5;  // lens glare at the fixture
  }

  if (uLaserI > .01) {
    vec2 src = vec2(0., .2);
    vec2 q = P - src;
    float px = 1.4 / uRes.y;
    for (int k = 0; k < ${LASERS}; k++) {
      float fk = float(k);
      if (fk >= uLaserN) break;
      float a = uLaserRot + (uLaserN > 1. ? (fk / (uLaserN - 1.) - .5) : 0.) * uLaserSpread;
      vec2 d = vec2(sin(a), cos(a));
      float along = dot(q, d);
      if (along <= 0.) continue;
      float perp = abs(q.x * d.y - q.y * d.x);
      float core = exp(-(perp * perp) / (px * px));
      float glow = exp(-perp / (px * 10.)) * .18 * (.4 + .6 * hz);
      add += uLaserCol * (core + glow) * uLaserI;
    }
    add += uLaserCol * exp(-length(q) * 70.) * uLaserI * 2.;
  }

  // haze itself catches some of the light → room feels smoky
  add += mix(uColA, uColB, .5) * hz * .05 * uLightAmt;
  return c * mix(1., .72, uClub) + add * uClub;
}

`;

const SCHEMES = [
  [[1, .15, .75], [.1, .8, 1]],     // magenta / cyan
  [[1, .2, .1], [1, .95, .9]],      // red / white
  [[.25, .35, 1], [.6, .2, 1]],     // blue / violet
  [[1, .6, .15], [.85, .2, 1]],     // amber / purple
  [[.1, 1, .6], [.2, .5, 1]],       // mint / blue
  [[1, 1, 1], [.6, .75, 1]],        // white / ice
];
const LASER_COLS = [[.1, 1, .25], [1, .1, .15], [.15, .9, 1], [1, .2, .9], [.35, .4, 1], [1, .85, .2]];

// Drives the lights from the music: patterns, colours, laser moves, strobes.
export class ClubDirector {
  constructor() {
    this.enabled = true;
    this.strobeOn = true;
    this.pattern = 0;
    this.tm = 0;
    this.beats = 0;
    this.scheme = 0;
    this.laserCol = 0;
    this.laserRot = 0; this.laserRotTarget = 0;
    this.laserSpread = .8;
    this.dropUntil = 0;
    this.strobe = 0;
    this.hands = .2; this.jump = .3;
    this.bassSlow = 0; this.trebSlow = 0; this.energySlow = 0; this.build = 0;
    this.u = {
      uClub: 1, uBeamAng: new Array(BEAMS).fill(0), uBeamI: new Array(BEAMS).fill(0),
      uColA: [1, .15, .75], uColB: [.1, .8, 1], uLaserCol: [.1, 1, .25],
      uLaserRot: 0, uLaserSpread: .8, uLaserI: 0, uLaserN: 8, uStrobe: 0,
      uHands: .2, uJump: .3, uBeatPhase: 0, uLightAmt: 1,
    };
    this.mix = 1;
  }

  _nextPattern() { this.pattern = (this.pattern + 1 + Math.floor(Math.random() * 4)) % 5; }

  update(f, dt, now) {
    const u = this.u;
    const k = s => 1 - Math.exp(-dt / s);
    this.mix += ((this.enabled ? 1 : 0) - this.mix) * k(.3);
    u.uClub = this.mix;
    this.bassSlow += (f.bass - this.bassSlow) * k(2);
    this.trebSlow += (Math.max(f.treble, f.highMid) - this.trebSlow) * k(2);
    this.energySlow += (f.energy - this.energySlow) * k(1.5);
    const dropping = now < this.dropUntil;

    // build-up: highs climbing while the bass has pulled out
    const buildT = Math.min(1, Math.max(0, (this.trebSlow - .3) * 2.5)) * Math.min(1, Math.max(0, (.4 - this.bassSlow) * 3.5)) * (f.active ? 1 : 0);
    this.build += (buildT - this.build) * k(1);

    if (f.drop) {
      this.dropUntil = now + 16 * (60 / (f.bpm || 128));
      this.scheme = (this.scheme + 1 + Math.floor(Math.random() * (SCHEMES.length - 1))) % SCHEMES.length;
      this.laserCol = (this.laserCol + 1) % LASER_COLS.length;
      this._nextPattern();
      this.strobeBurst = now + 1.2;
    }
    if (f.beat) {
      this.beats++;
      if (this.beats % 16 === 0) this._nextPattern();
      if (this.beats % 32 === 0) this.scheme = (this.scheme + 1) % SCHEMES.length;
      if (this.beats % 16 === 8) this.laserCol = (this.laserCol + 1) % LASER_COLS.length;
      // lasers snap to a new position on every beat (or every other at lower energy)
      if (f.energy > .55 || dropping || this.beats % 2 === 0) this.laserRotTarget = (Math.random() - .5) * 1.1;
    }

    // ── moving heads ──
    const energy = dropping ? 1 : Math.min(1, this.energySlow * 1.25);
    this.tm += dt * (.35 + energy * 1.1);
    const tm = this.tm;
    for (let i = 0; i < BEAMS; i++) {
      const c = i / (BEAMS - 1) - .5;
      let a, inten = 1;
      switch (this.pattern) {
        case 0: a = c * 1.3 * (.6 + .4 * Math.sin(tm)); break;                       // fan breathing
        case 1: a = (i < BEAMS / 2 ? 1 : -1) * (.45 + .3 * Math.sin(tm * 1.3)); break;  // cross
        case 2: a = .75 * Math.sin(tm * 1.1 + i * .18); break;                        // sweep together
        case 3: a = c * .9; inten = (this.beats % BEAMS) === i || (this.beats + 3) % BEAMS === i ? 1 : .15; break; // chase
        default: a = .55 * Math.sin(tm * 1.7 + i * 1.3) + .2 * Math.sin(tm * 3.1 + i); // ballyhoo
      }
      const base = .25 + .75 * energy;
      u.uBeamAng[i] += (a - u.uBeamAng[i]) * k(this.pattern === 3 ? .15 : .08);
      u.uBeamI[i] = base * inten * (.55 + .45 * f.beatPulse) * (1 - this.build * .5);
    }

    // ── lasers: on when it's going off, off in breakdowns ──
    const laserT = dropping ? 1 : Math.max(0, Math.min(1, (this.energySlow - .4) * 3)) * (f.locked ? 1 : .5);
    u.uLaserI += (laserT * (.75 + .25 * f.hatPulse) - u.uLaserI) * k(.12);
    this.laserRot += (this.laserRotTarget - this.laserRot) * k(.06);
    u.uLaserRot = this.laserRot + Math.sin(tm * .7) * .15;
    const spreadT = .5 + energy * 1.2 + (dropping ? .4 : 0);
    this.laserSpread += (spreadT - this.laserSpread) * k(.3);
    u.uLaserSpread = this.laserSpread;
    u.uLaserN = dropping ? 16 : energy > .6 ? 12 : 7;

    // ── strobe (max ~12 Hz; toggle with S) ──
    let strobe = 0;
    if (this.strobeOn) {
      if (now < (this.strobeBurst || 0)) strobe = (Math.floor(now * 12) % 2) ? .85 : 0;
      else if (this.build > .45) {
        const rate = 2 + this.build * 8; // speeds up as the build-up rises
        strobe = (Math.floor(now * rate) % 2) ? .25 + this.build * .4 : 0;
      }
    }
    u.uStrobe = strobe * this.mix;

    // ── crowd ──
    const handsT = dropping ? .95 : Math.min(.85, Math.max(.08, energy * 1.1 - .2 + this.build * .4));
    this.hands += (handsT - this.hands) * k(.6);
    u.uHands = this.hands;
    const jumpT = f.active ? (dropping ? 1 : .2 + .8 * energy) : 0;
    this.jump += (jumpT - this.jump) * k(.4);
    u.uJump = this.jump;
    u.uBeatPhase = f.beatPhase;
    u.uLightAmt = .4 + .6 * energy;

    const [A, B] = SCHEMES[this.scheme];
    for (let j = 0; j < 3; j++) {
      u.uColA[j] += (A[j] - u.uColA[j]) * k(.4);
      u.uColB[j] += (B[j] - u.uColB[j]) * k(.4);
      u.uLaserCol[j] += (LASER_COLS[this.laserCol][j] - u.uLaserCol[j]) * k(.1);
    }
    return u;
  }
}

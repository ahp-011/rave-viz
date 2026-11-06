// CLUB MODE — puts you on the dancefloor.
// The active scene becomes the LED wall behind the DJ; in front of it:
//   • 6 moving-head spotlights on a truss, sweeping through haze in patterns
//   • a laser fan from behind the crowd, snapping to the beat
//   • strobes on drops and build-ups
//   • a crowd silhouette that bounces on the beat and throws hands up on drops
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

float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float sdSeg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * t) - r; }
float smin(float a, float b, float k) { float hh = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, hh) - k * hh * (1. - hh); }

// one person, local coords (feet ~ y=-.1, head top ~ y=.36). Returns SDF; writes phone-screen SDF.
float person(vec2 q, float s1, float s2, float s3, float s4, out float phone) {
  phone = 1e3;
  float d = sdBox(q - vec2(0., .06), vec2(.048 + .01 * s2, .16), .035);              // torso
  d = smin(d, sdSeg(q, vec2(-.058 - .01 * s2, .205), vec2(.058 + .01 * s2, .205), .034), .03); // shoulders
  d = smin(d, sdSeg(q, vec2(0., .22), vec2(0., .27), .018), .02);                     // neck
  vec2 hq = q - vec2(.004 * (s3 - .5), .305);
  d = smin(d, length(hq * vec2(1., .88)) - .043, .015);                              // head
  if (s1 > .78) d = min(d, length(q - vec2(.02 - .04 * s3, .35)) - .022);            // bun / hair
  if (s4 < uHands) {
    float t = 6.28318 * uBeatPhase + s1 * 6.;
    for (int side = 0; side < 2; side++) {
      float sg = side == 0 ? -1. : 1.;
      vec2 sh = vec2(sg * (.06 + .01 * s2), .215);
      // upper arm up and out, forearm bending in, waving on the beat
      float a1 = sg * (.35 + .25 * s3) + .18 * sin(t + sg) * sg;
      float a2 = a1 - sg * (.25 + .3 * s2) + .25 * sin(t * .5 + s3 * 3.);
      if (side == 1 && s3 > .72) { a1 = .12; a2 = -.05; }                              // straight-arm point
      vec2 el = sh + .105 * vec2(sin(a1), cos(a1));
      vec2 hd = el + .1 * vec2(sin(a2), cos(a2));
      d = min(d, sdSeg(q, sh, el, .017));
      d = min(d, sdSeg(q, el, hd, .014));
      d = min(d, length(q - hd) - .017);
      if (side == 1 && s1 < .14) {                                                   // filming on a phone
        vec2 pq = q - hd - vec2(0., .028);
        d = min(d, sdBox(pq, vec2(.015, .025), .004));
        phone = sdBox(pq, vec2(.011, .02), .003);
      }
    }
  }
  return d;
}

// crowd silhouettes (after tonemap): three depth rows, rim light from the rig, phone screens
vec3 clubCrowd(vec2 uv, vec3 c) {
  float asp = uRes.x / uRes.y;
  vec2 P = vec2((uv.x - .5) * asp, uv.y);
  if (P.y > .6) return c;
  vec3 light = mix(uColA, uColB, .5) * uLightAmt;

  for (int row = 0; row < 3; row++) {
    float fr = float(row);
    float n = row == 0 ? 22. : row == 1 ? 15. : 10.;
    float sc = row == 0 ? .42 : row == 1 ? .6 : .82;
    float base = row == 0 ? .17 : row == 1 ? .08 : -.06;
    // farther rows fade into the lit haze
    vec3 sil = row == 0 ? light * .07 + .015 : row == 1 ? light * .025 + .006 : vec3(.003);
    float cell = asp * 1.15 / n;
    for (int i = 0; i < 22; i++) {
      float fi = float(i);
      if (fi >= n) break;
      float s1 = h(vec2(fi, fr + 1.)), s2 = h(vec2(fi + 7., fr + 3.)), s3 = h(vec2(fi + 3., fr + 9.)), s4 = h(vec2(fi + 11., fr + 5.));
      float x = ((fi + .5 + (s1 - .5) * .8) / n - .5) * asp * 1.15;
      if (abs(P.x - x) > .25 * sc) continue;                     // cheap reject
      float ph = uBeatPhase + s2 * .12;                          // not everyone lands at once
      float jump = uJump * pow(abs(sin(3.14159 * ph)), 2.) * (.5 + .5 * s3) * .04 * sc;
      vec2 q = (P - vec2(x, base + jump)) / sc;
      q.x += sin(uTime * 1.3 + s1 * 9.) * .008;                  // sway
      q.y /= .9 + .18 * s2;
      float phone;
      float d = person(q, s1, s2, s3, s4, phone);
      float px = 1.2 / uRes.y / sc;
      float a = smoothstep(px, -px, d);
      float rim = smoothstep(-px * 4., 0., d) * a * smoothstep(.12, .3, q.y);
      c = mix(c, sil, a);
      c += light * rim * (.18 + .35 * uBeat) * (row == 2 ? 1. : .5);
      float scr = smoothstep(px, -px, phone);
      c = mix(c, vec3(.78, .86, 1.) * (.85 + .15 * uBeat), scr);
    }
  }
  c *= mix(1., smoothstep(-.06, .18, P.y) * .75 + .25, uClub);    // floor falls into darkness
  return c;
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

// Per-frame audio feature extraction.
//
// All detectors are time-based (dt-aware), not frame-count based, so they
// behave the same at 60, 120 or 144 Hz.
//
// Output (this.f), all smoothed values in 0..1:
//   bass, lowMid, highMid, treble, energy
//   beat (true on the frame a kick/onset fires), beatPulse (1 → 0 decay)
//   hat  (true on high-frequency transients),   hatPulse
//   drop (true on the frame a drop fires),       dropPulse
//   bpm, bpmConfidence, beatPhase (0..1 since last beat, based on BPM)

const BANDS = {
  bass:    [20, 150],
  lowMid:  [150, 600],
  highMid: [600, 3000],
  treble:  [3000, 14000],
};
const BAND_KEYS = Object.keys(BANDS);

const expAlpha = (dt, tau) => 1 - Math.exp(-dt / tau);
const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// Running mean/variance with exponential forgetting (time constant tau)
class EmaStats {
  constructor(tau) { this.tau = tau; this.mean = 0; this.var = 0; this.init = false; }
  push(x, dt) {
    if (!this.init) { this.mean = x; this.var = 0; this.init = true; return; }
    const a = expAlpha(dt, this.tau);
    const d = x - this.mean;
    this.mean += a * d;
    this.var = (1 - a) * (this.var + a * d * d);
  }
  get std() { return Math.sqrt(this.var); }
}

// Auto-gain: maps a raw level into 0..1 between an adaptive floor and peak.
class AutoGain {
  constructor(minPeak) {
    this.minPeak = minPeak;
    this.peak = minPeak;
    this.lo = 0;
  }
  push(x, dt, sens) {
    this.peak = Math.max(x, this.peak * Math.exp(-dt / 6), this.minPeak / sens);
    // floor follows valleys: drops instantly, rises slowly, capped so sustained bass still reads
    if (x < this.lo) this.lo = x;
    else this.lo += (x - this.lo) * expAlpha(dt, 10);
    this.lo = Math.min(this.lo, this.peak * 0.45);
    const n = clamp01((x - this.lo) / (this.peak - this.lo + 1e-9));
    // sensitivity as a curve: >1 lifts quiet parts, <1 makes it pickier
    return Math.pow(n, 1 / sens);
  }
}

// Attack/release envelope follower
class Envelope {
  constructor(attack, release) { this.a = attack; this.r = release; this.v = 0; }
  push(x, dt) {
    this.v += (x - this.v) * expAlpha(dt, x > this.v ? this.a : this.r);
    return this.v;
  }
}

// Onset detector on a flux signal with an adaptive mean + k·std threshold
class OnsetDetector {
  constructor({ tau, k, minInterval }) {
    this.stats = new EmaStats(tau);
    this.k = k;
    this.minInterval = minInterval;
    this.last = -1e9;
    this.threshold = 0;
  }
  push(x, dt, now, sens) {
    const k = this.k / Math.sqrt(sens);
    this.threshold = this.stats.mean + k * this.stats.std + 1e-4;
    const fired = this.stats.init && x > this.threshold && now - this.last >= this.minInterval;
    if (fired) this.last = now;
    this.stats.push(x, dt); // update after the test so the spike doesn't mask itself
    return fired;
  }
}

export class Analyzer {
  constructor() {
    this.sensitivity = 1;
    this.analyser = null;

    this.agc = {
      bass: new AutoGain(0.004), lowMid: new AutoGain(0.002),
      highMid: new AutoGain(0.001), treble: new AutoGain(0.0005),
      energy: new AutoGain(0.01),
    };
    this.env = {
      bass: new Envelope(0.02, 0.16), lowMid: new Envelope(0.03, 0.2),
      highMid: new Envelope(0.025, 0.18), treble: new Envelope(0.01, 0.1),
      energy: new Envelope(0.04, 0.3),
    };
    this.beatDet = new OnsetDetector({ tau: 1.2, k: 1.6, minInterval: 0.25 });
    this.hatDet = new OnsetDetector({ tau: 0.6, k: 1.4, minInterval: 0.06 });

    this.beatTimes = [];
    this.bpm = 0;
    this.bpmConfidence = 0;

    // drop detection: 10 Hz history of raw bass + rms energy, 20 s long
    this.dropHist = [];
    this.dropAcc = 0;
    this.lastDrop = -1e9;
    this.dropCooldown = 12;

    // for the debug overlay
    this.fluxHistory = new Float32Array(240);
    this.thrHistory = new Float32Array(240);
    this.beatHistory = new Uint8Array(240);
    this.histIdx = 0;

    this.f = {
      bass: 0, lowMid: 0, highMid: 0, treble: 0, energy: 0,
      raw: { bass: 0, lowMid: 0, highMid: 0, treble: 0, energy: 0 },
      beat: false, beatPulse: 0, hat: false, hatPulse: 0,
      drop: false, dropPulse: 0,
      bpm: 0, bpmConfidence: 0, beatPhase: 0,
      active: false,
    };
  }

  attach(analyser) {
    this.analyser = analyser;
    const n = analyser.frequencyBinCount;
    this.db = new Float32Array(n);
    this.mag = new Float32Array(n);
    this.logMag = new Float32Array(n);
    this.prevLog = new Float32Array(n);
    this.time = new Float32Array(analyser.fftSize);
    const hz = analyser.context.sampleRate / analyser.fftSize;
    this.ranges = {};
    for (const k of BAND_KEYS) {
      const [lo, hi] = BANDS[k];
      this.ranges[k] = [Math.max(1, Math.round(lo / hz)), Math.min(n - 1, Math.round(hi / hz))];
    }
    this.binHz = hz;
  }

  update(dt, now) {
    const f = this.f;
    f.beat = f.hat = f.drop = false;
    f.beatPulse *= Math.exp(-dt / 0.12);
    f.hatPulse *= Math.exp(-dt / 0.06);
    f.dropPulse *= Math.exp(-dt / 1.2);
    if (!this.analyser) return f;

    const sens = this.sensitivity;
    this.analyser.getFloatFrequencyData(this.db);
    this.analyser.getFloatTimeDomainData(this.time);

    const { db, mag, logMag, prevLog } = this;
    for (let i = 0; i < db.length; i++) {
      const m = db[i] > -160 ? Math.pow(10, db[i] / 20) : 0;
      mag[i] = m;
      logMag[i] = Math.log1p(1000 * m); // log compression keeps flux level-independent
    }

    // time-domain RMS
    let s = 0;
    for (let i = 0; i < this.time.length; i++) s += this.time[i] * this.time[i];
    const rms = Math.sqrt(s / this.time.length);
    f.active = rms > 1e-4;

    // band levels (RMS of magnitudes) + spectral flux per region
    const raw = {};
    let bassFlux = 0, trebleFlux = 0;
    for (const k of BAND_KEYS) {
      const [a, b] = this.ranges[k];
      let acc = 0;
      for (let i = a; i <= b; i++) acc += mag[i] * mag[i];
      raw[k] = Math.sqrt(acc / (b - a + 1));
    }
    {
      // kick region: up to ~180 Hz; flux = sum of positive log-magnitude rises
      const [a] = this.ranges.bass;
      const b = Math.round(180 / this.binHz);
      for (let i = a; i <= b; i++) { const d = logMag[i] - prevLog[i]; if (d > 0) bassFlux += d; }
      bassFlux /= (b - a + 1);
      const [c, e] = this.ranges.treble;
      for (let i = c; i <= e; i++) { const d = logMag[i] - prevLog[i]; if (d > 0) trebleFlux += d; }
      trebleFlux /= (e - c + 1);
    }
    prevLog.set(logMag);
    raw.energy = rms;

    // normalise + smooth
    for (const k of [...BAND_KEYS, 'energy']) {
      const n = f.active ? this.agc[k].push(raw[k], dt, sens) : 0;
      f.raw[k] = n;
      f[k] = this.env[k].push(n, dt);
    }

    // beats (kick-ish onsets), gated so noise in silence doesn't fire
    if (this.beatDet.push(bassFlux, dt, now, sens) && f.raw.bass > 0.2) {
      f.beat = true;
      f.beatPulse = 1;
      this._registerBeat(now);
    }
    if (this.hatDet.push(trebleFlux, dt, now, sens) && f.raw.treble > 0.15) {
      f.hat = true;
      f.hatPulse = 1;
    }

    // beat phase from BPM (useful for smooth, on-grid motion)
    if (this.bpm > 0) {
      const period = 60 / this.bpm;
      f.beatPhase = ((now - this.beatDet.last) / period) % 1;
    }

    this._updateDrop(dt, now, raw.bass, rms, f);

    // overlay history
    const j = this.histIdx = (this.histIdx + 1) % this.fluxHistory.length;
    this.fluxHistory[j] = bassFlux;
    this.thrHistory[j] = this.beatDet.threshold;
    this.beatHistory[j] = f.beat ? 1 : 0;

    f.bpm = this.bpm;
    f.bpmConfidence = this.bpmConfidence;
    return f;
  }

  _registerBeat(now) {
    const t = this.beatTimes;
    t.push(now);
    while (t.length && now - t[0] > 12) t.shift();
    if (t.length < 5) return;

    // histogram of beat intervals (consecutive + skip-one), folded into 85–175 BPM
    const scores = new Float32Array(91); // 85..175
    let total = 0;
    for (let skip = 1; skip <= 2; skip++) {
      for (let i = skip; i < t.length; i++) {
        const iv = (t[i] - t[i - skip]) / skip;
        if (iv < 0.25 || iv > 1.5) continue;
        let b = 60 / iv;
        while (b < 85) b *= 2;
        while (b >= 175) b /= 2;
        const w = skip === 1 ? 1 : 0.5;
        for (let c = 0; c < scores.length; c++) {
          const d = (85 + c) - b;
          scores[c] += w * Math.exp(-(d * d) / 4.5);
        }
        total += w;
      }
    }
    let best = 0;
    for (let c = 1; c < scores.length; c++) if (scores[c] > scores[best]) best = c;
    const cand = 85 + best;
    // confidence: how dominant the peak is relative to all evidence
    this.bpmConfidence = clamp01(scores[best] / (total * 0.9 + 1e-9));
    if (!this.bpm || Math.abs(cand - this.bpm) > 6) this.bpm = cand;
    else this.bpm += (cand - this.bpm) * 0.25;
  }

  _updateDrop(dt, now, bassRaw, rms, f) {
    // accumulate into 100 ms buckets
    this.dropAcc += dt;
    this._bAcc = (this._bAcc || 0) + bassRaw * dt;
    this._eAcc = (this._eAcc || 0) + rms * dt;
    if (this.dropAcc < 0.1) return;
    this.dropHist.push([this._bAcc / this.dropAcc, this._eAcc / this.dropAcc]);
    this.dropAcc = this._bAcc = this._eAcc = 0;
    const H = this.dropHist;
    if (H.length > 200) H.shift();
    if (H.length < 100) return; // need ≥10 s of context

    const mean = (from, to, idx) => {
      let s = 0;
      for (let i = from; i < to; i++) s += H[i][idx];
      return s / (to - from);
    };
    const n = H.length;
    const recentB = mean(n - 5, n, 0),  recentE = mean(n - 5, n, 1);    // last 0.5 s
    const beforeB = mean(n - 80, n - 15, 0), beforeE = mean(n - 80, n - 15, 1); // 8 s → 1.5 s ago
    const sens = this.sensitivity;
    const bassRatio = 2.0 / Math.sqrt(sens);
    const energyRatio = 1.35 / Math.sqrt(sens);
    this.dropScore = recentB / (beforeB + 1e-6);

    if (
      now - this.lastDrop > this.dropCooldown &&
      beforeE > 0.002 &&                 // not just "track started from silence"
      recentB > beforeB * bassRatio &&   // bass came back hard
      recentE > beforeE * energyRatio && // and overall it got louder
      f.raw.bass > 0.5
    ) {
      this.lastDrop = now;
      f.drop = true;
      f.dropPulse = 1;
    }
  }

  /** Full magnitude spectrum, for the overlay */
  get spectrum() { return this.mag; }
}

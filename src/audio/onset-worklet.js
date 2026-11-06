// AudioWorklet source for sample-accurate onset detection.
//
// Runs on the audio thread, independent of the render frame rate. Every
// 256 samples (~5.8 ms) it measures low-band (kick) and high-band (hat)
// energy, computes a log-energy rise (onset strength), compares it with an
// adaptive mean + k·std threshold and posts {kind, t, strength} with the
// AudioContext time of the hop where the onset started.

export const ONSET_WORKLET = /* js */ `
function biquad(type, f0, q) {
  const w = 2 * Math.PI * f0 / sampleRate, c = Math.cos(w), a = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; }
  else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  const a0 = 1 + a;
  const k = { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: -2 * c / a0, a2: (1 - a) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  return x => {
    const y = k.b0 * x + k.b1 * k.x1 + k.b2 * k.x2 - k.a1 * k.y1 - k.a2 * k.y2;
    k.x2 = k.x1; k.x1 = x; k.y2 = k.y1; k.y1 = y;
    return y;
  };
}

class Detector {
  constructor(tau, k, refractory, hop) {
    this.alpha = 1 - Math.exp(-(hop / sampleRate) / tau);
    this.k = k; this.refractory = refractory;
    this.mean = 0; this.var = 0; this.n = 0;
    this.hist = [0, 0, 0, 0];
    this.last = -1;
    this.armed = true;
    this.peak = -30;                                 // recent loud level (log energy), slow decay
    this.peakDecay = (hop / sampleRate) / 8;         // ~1 log unit per 8 s
  }
  // returns onset strength (>0) if an onset fires on this hop
  push(logE, t, sens, gate) {
    const h = this.hist;
    const ref = (h[0] + h[1] + h[2]) / 3;           // average of the previous ~17 ms
    h.unshift(logE); h.pop();
    const odf = Math.max(0, logE - ref);
    this.peak = Math.max(logE, this.peak - this.peakDecay);
    const thr = this.mean + (this.k / Math.sqrt(sens)) * Math.sqrt(this.var) + 0.5 / sens;
    // only accept hits close to the recent loud level: in a breakdown the
    // low end drops away and tiny wobbles must not count as kicks
    const loudEnough = logE > this.peak - 2.5 - (sens - 1);
    let fired = 0;
    if (this.n > 170 && gate && loudEnough && odf > thr && this.armed && t - this.last >= this.refractory) {
      fired = odf / thr; this.last = t; this.armed = false;
    }
    if (odf < thr * 0.5) this.armed = true;           // re-arm once the attack has passed
    const d = odf - this.mean;
    this.mean += this.alpha * d;
    this.var = (1 - this.alpha) * (this.var + this.alpha * d * d);
    this.n++;
    return fired;
  }
}

class OnsetProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hop = 256;
    this.lp1 = biquad('lp', 150, 0.707); this.lp2 = biquad('lp', 150, 0.707);
    this.hp1 = biquad('hp', 7000, 0.707);
    this.kick = new Detector(1.5, 2.2, 0.22, this.hop);
    this.hat = new Detector(0.8, 2.0, 0.05, this.hop);
    this.i = 0; this.eL = 0; this.eH = 0; this.eAll = 0;
    this.sens = 1;
    this.port.onmessage = e => { if (e.data && e.data.sens) this.sens = e.data.sens; };
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    if (inp && inp.length) {
      const a = inp[0], b = inp[1] || inp[0];
      for (let j = 0; j < a.length; j++) {
        const x = (a[j] + b[j]) * 0.5;
        const l = this.lp2(this.lp1(x));
        const h = this.hp1(x);
        this.eL += l * l; this.eH += h * h; this.eAll += x * x;
        if (++this.i === this.hop) {
          const t = currentTime + (j + 1) / sampleRate;
          const gate = this.eAll / this.hop > 1e-7;    // ignore pure silence / noise floor
          const ks = this.kick.push(Math.log(this.eL / this.hop + 1e-10), t, this.sens, gate);
          if (ks) this.port.postMessage({ kind: 'kick', t, strength: ks });
          const hs = this.hat.push(Math.log(this.eH / this.hop + 1e-10), t, this.sens, gate);
          if (hs) this.port.postMessage({ kind: 'hat', t, strength: hs });
          this.i = 0; this.eL = 0; this.eH = 0; this.eAll = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('onset-processor', OnsetProcessor);
`;

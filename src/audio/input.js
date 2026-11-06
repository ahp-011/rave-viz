// Audio source management: mic / line-in, dropped files, browser-tab capture.
// Everything feeds one AnalyserNode. Only file playback is routed to the
// speakers. Live inputs are never monitored, which avoids feedback.

export class AudioInput {
  constructor() {
    this.ctx = null;
    this.analyser = null;
    this.source = null;       // current AudioNode feeding the analyser
    this.stream = null;       // MediaStream for mic / tab
    this.mediaEl = null;      // <audio> for files
    this.label = 'no input';
    this.onchange = null;
  }

  _ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0; // we do our own smoothing; flux needs raw frames
      this.analyser.minDecibels = -110;
      this.analyser.maxDecibels = -10;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  _teardown() {
    if (this.source) { try { this.source.disconnect(); } catch {} this.source = null; }
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.bufferSrc) { try { this.bufferSrc.stop(); } catch {} this.bufferSrc = null; }
    if (this.mediaEl) {
      this.mediaEl.pause();
      URL.revokeObjectURL(this.mediaEl.src);
      this.mediaEl.removeAttribute('src');
      this.mediaEl = null;
    }
  }

  _set(label) {
    this.label = label;
    this.onchange && this.onchange(label);
  }

  async listInputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter(d => d.kind === 'audioinput');
  }

  async useMic(deviceId) {
    const ctx = this._ensureContext();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        // Raw signal: browser "voice" processing would duck and pump the music.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: 2 },
      },
    });
    this._teardown();
    this.stream = stream;
    this.source = ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    const track = stream.getAudioTracks()[0];
    this._set('mic: ' + (track?.label || 'default'));
  }

  async useTab() {
    const ctx = this._ensureContext();
    // Chrome requires video:true to offer tab audio. We drop the video track right away.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      systemAudio: 'include',
      preferCurrentTab: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
    const audioTracks = stream.getAudioTracks();
    stream.getVideoTracks().forEach(t => t.stop());
    if (!audioTracks.length) {
      stream.getTracks().forEach(t => t.stop());
      throw new Error('No audio shared. Pick a *tab* and tick "Share tab audio".');
    }
    this._teardown();
    this.stream = new MediaStream(audioTracks);
    this.source = ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.analyser);
    audioTracks[0].addEventListener('ended', () => this._set('tab capture ended'));
    this._set('tab: ' + (audioTracks[0].label || 'shared audio'));
  }

  async useFile(file) {
    const ctx = this._ensureContext();
    this._teardown();
    const el = new Audio();
    el.src = URL.createObjectURL(file);
    el.loop = true;
    el.crossOrigin = 'anonymous';
    this.mediaEl = el;
    this.source = ctx.createMediaElementSource(el);
    this.source.connect(this.analyser);
    this.source.connect(ctx.destination); // you hear files
    await el.play();
    this._set('file: ' + file.name);
  }

  // Built-in synthetic techno loop (128 BPM): 16 s groove → 10 s breakdown → drop.
  // Lets you test everything with zero setup.
  async useDemo() {
    const ctx = this._ensureContext();
    this._teardown();
    if (!this.demoBuffer) this.demoBuffer = makeDemoBuffer(ctx);
    const src = ctx.createBufferSource();
    src.buffer = this.demoBuffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0.8;
    src.connect(gain);
    gain.connect(this.analyser);
    gain.connect(ctx.destination);
    src.start();
    this.bufferSrc = src;
    this.source = gain;
    this._set('demo: 128 BPM loop (drop at 0:26)');
  }

  togglePlayback() {
    if (this.bufferSrc) { this.ctx.state === 'running' ? this.ctx.suspend() : this.ctx.resume(); return; }
    if (!this.mediaEl) return;
    this.mediaEl.paused ? this.mediaEl.play() : this.mediaEl.pause();
  }
}

function makeDemoBuffer(ctx) {
  const sr = ctx.sampleRate, dur = 42, n = Math.floor(sr * dur);
  const buf = ctx.createBuffer(2, n, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const beat = 60 / 128, bar = beat * 4;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const chords = [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
  let hp = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const full = t < 16 || t >= 26;
    const riser = t >= 22 && t < 26 ? (t - 22) / 4 : 0;
    const bt = t % beat;
    let s = 0;
    // pad (always), chord changes per bar
    const ch = chords[Math.floor(t / bar) % 4];
    const padAmp = full ? 0.05 : 0.09;
    for (const f of ch) s += padAmp * Math.sin(2 * Math.PI * f * t + Math.sin(2 * Math.PI * 0.3 * t));
    // white noise, high-passed, for hats + riser
    const w = rnd(); hp = 0.9 * (hp + w - prev); prev = w;
    if (full) {
      const f = 48 + 130 * Math.exp(-bt * 32);
      s += 0.85 * Math.sin(2 * Math.PI * f * bt) * Math.exp(-bt * 6.5);           // kick
      const ht = (t + beat / 2) % beat; s += 0.22 * hp * Math.exp(-ht * 45);        // open-ish offbeat hat
      const st = t % (beat / 4); s += 0.07 * hp * Math.exp(-st * 140);             // 16th ticks
      const bassEnv = Math.min(1, bt / 0.08) * Math.exp(-(bt - 0.08) * 3);
      s += 0.2 * Math.sin(2 * Math.PI * (ch[0] / 4) * t) * (bt > 0.08 ? bassEnv : 0); // offbeat sub
      if (Math.floor(t / beat) % 2 === 1) s += 0.25 * hp * Math.exp(-bt * 22);       // clap on 2 & 4
    }
    if (riser) s += 0.25 * riser * riser * hp;
    const v = Math.tanh(s * 0.9);
    L[i] = v; R[i] = v;
  }
  return buf;
}

// Small 2D-canvas debug overlay (toggle with H). Drawn on its own canvas so
// it never touches the WebGL output.

const W = 340, H = 246;

export class DebugOverlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'debug';
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = W * dpr;
    this.canvas.height = H * dpr;
    this.canvas.style.width = W + 'px';
    this.canvas.style.height = H + 'px';
    this.g = this.canvas.getContext('2d');
    this.g.scale(dpr, dpr);
    document.body.appendChild(this.canvas);
    this.visible = true;
    this.fps = 60;
    this.beatFlash = 0;
    this.dropFlash = 0;
  }

  setVisible(v) {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  draw(an, state, dt) {
    if (dt > 0) this.fps += (1 / dt - this.fps) * 0.05;
    const f = an.f;
    if (f.beat) this.beatFlash = 1;
    if (f.drop) this.dropFlash = 1;
    this.beatFlash *= Math.exp(-dt / 0.15);
    this.dropFlash *= Math.exp(-dt / 1.5);
    if (!this.visible) return;

    const g = this.g;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(12,13,15,0.78)';
    g.fillRect(0, 0, W, H);
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    g.textBaseline = 'top';

    // ── band bars ───────────────────────────────────────
    const bars = [
      ['BASS', f.bass, f.raw.bass],
      ['LMID', f.lowMid, f.raw.lowMid],
      ['HMID', f.highMid, f.raw.highMid],
      ['TREB', f.treble, f.raw.treble],
      ['RMS',  f.energy, f.raw.energy],
    ];
    const bx = 10, by = 10, bw = 22, bh = 80, gap = 12;
    bars.forEach(([name, v, r], i) => {
      const x = bx + i * (bw + gap);
      g.fillStyle = '#222428';
      g.fillRect(x, by, bw, bh);
      g.fillStyle = 'rgba(190,170,255,0.35)';
      g.fillRect(x, by + bh * (1 - r), bw, bh * r); // raw (unsmoothed)
      g.fillStyle = '#e8e8ea';
      g.fillRect(x, by + bh * (1 - v), bw, 2 + (bh - 2) * v); // smoothed
      g.fillStyle = '#8a8c92';
      g.fillText(name, x - 1, by + bh + 4);
    });

    // ── beat / hat / drop lamps ─────────────────────────
    const lx = 190;
    const lamp = (y, label, v, col) => {
      g.fillStyle = `rgba(${col},${0.15 + 0.85 * v})`;
      g.beginPath(); g.arc(lx + 6, y + 6, 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#b8bac0';
      g.fillText(label, lx + 18, y + 1);
    };
    lamp(10, 'BEAT', this.beatFlash, '255,255,255');
    lamp(28, 'HAT', f.hatPulse, '200,190,255');
    lamp(46, 'DROP', this.dropFlash, '170,120,255');

    g.fillStyle = '#e8e8ea';
    g.font = '20px ui-monospace, Menlo, Consolas, monospace';
    g.fillText(f.bpm ? f.bpm.toFixed(0) : '--', lx + 70, 8);
    g.font = '10px ui-monospace, Menlo, Consolas, monospace';
    g.fillStyle = '#8a8c92';
    g.fillText('BPM', lx + 70, 32);
    g.fillText(`conf ${(f.bpmConfidence * 100).toFixed(0)}%`, lx + 70, 46);

    // beat-phase bar
    g.fillStyle = '#222428';
    g.fillRect(lx, 66, 140, 4);
    g.fillStyle = '#9b87ff';
    g.fillRect(lx, 66, 140 * f.beatPhase, 4);

    // ── flux + adaptive threshold history ───────────────
    const gx = 10, gy = 116, gw = 320, gh = 50;
    g.fillStyle = '#18191c';
    g.fillRect(gx, gy, gw, gh);
    const N = an.fluxHistory.length;
    let max = 1e-6;
    for (let i = 0; i < N; i++) max = Math.max(max, an.fluxHistory[i], an.thrHistory[i]);
    const plot = (arr, color) => {
      g.strokeStyle = color; g.lineWidth = 1; g.beginPath();
      for (let i = 0; i < N; i++) {
        const v = arr[(an.histIdx + 1 + i) % N];
        const x = gx + (i / (N - 1)) * gw, y = gy + gh - (v / max) * (gh - 2);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke();
    };
    plot(an.fluxHistory, '#d8d8dc');
    plot(an.thrHistory, '#9b87ff');
    g.fillStyle = '#ffffff';
    for (let i = 0; i < N; i++) {
      if (an.beatHistory[(an.histIdx + 1 + i) % N]) g.fillRect(gx + (i / (N - 1)) * gw - 0.5, gy, 1.5, 6);
    }
    g.fillStyle = '#6c6e74';
    g.fillText('kick flux / threshold', gx + 2, gy + gh + 2);

    // ── log spectrum ────────────────────────────────────
    const sx = 10, sy = 182, sw = 320, sh = 30;
    const spec = an.spectrum;
    if (spec) {
      g.fillStyle = '#9a9ca2';
      const n = spec.length, cols = 80;
      for (let c = 0; c < cols; c++) {
        const a = Math.floor(Math.pow(n, c / cols)), b = Math.max(a + 1, Math.floor(Math.pow(n, (c + 1) / cols)));
        let m = 0;
        for (let i = a; i < b && i < n; i++) m = Math.max(m, spec[i]);
        const v = Math.max(0, Math.min(1, (20 * Math.log10(m + 1e-9) + 90) / 70));
        g.fillRect(sx + c * (sw / cols), sy + sh * (1 - v), sw / cols - 1, sh * v);
      }
    }

    // ── status line ─────────────────────────────────────
    g.fillStyle = '#8a8c92';
    const src = state.source.length > 30 ? state.source.slice(0, 29) + '…' : state.source;
    g.fillText(
      `${this.fps.toFixed(0)}fps q${state.quality.toFixed(2)} sens ${state.sensitivity.toFixed(2)} ${state.scene} auto:${state.auto ? 'on' : 'off'}${state.kaleido ? ' K' : ''}${state.frozen ? ' HOLD' : ''}`,
      10, H - 22
    );
    g.fillText(src, 10, H - 11);
  }
}

// Hidden source menu. Toggle with M (or Esc to close). It opens on its own at startup,
// because browsers need a click before audio can start.

export class Menu {
  constructor(input) {
    this.input = input;
    const el = this.el = document.createElement('div');
    el.id = 'menu';
    el.innerHTML = `
      <div class="title">INPUT</div>
      <button data-act="demo">▶ Play demo track</button>
      <button data-act="mic">Mic / line-in</button>
      <select data-act="device" title="Input device"><option value="">default device</option></select>
      <button data-act="tab">Capture tab audio</button>
      <button data-act="file">Load audio file…</button>
      <input type="file" accept="audio/*" hidden data-role="audio">
      <div class="title">FOOTAGE</div>
      <button data-act="footage">Add images / videos…</button>
      <input type="file" accept="image/*,video/*" multiple hidden data-role="footage">
      <div class="status" data-role="status">no input. Pick one, or drop audio / images / videos anywhere</div>
      <div class="keys">
        <span>M</span> menu &nbsp; <span>H</span> debug &nbsp; <span>F</span> fullscreen<br>
        <span>1–9</span> / <span>← →</span> scene &nbsp; <span>A</span> auto-switch<br>
        <span>C</span> colours &nbsp; <span>L</span> new look &nbsp; <span>K</span> kaleido &nbsp; <span>G</span> cut fx<br>
        <span>↑ ↓</span> sensitivity &nbsp; <span>Space</span> hold &nbsp; <span>P</span> pause
      </div>`;
    document.body.appendChild(el);

    this.status = el.querySelector('[data-role=status]');
    this.select = el.querySelector('select');
    this.fileInput = el.querySelector('[data-role=audio]');
    this.footInput = el.querySelector('[data-role=footage]');
    this.onFootage = null;

    el.addEventListener('click', e => {
      const act = e.target.dataset?.act;
      if (act === 'demo') this._run(() => input.useDemo());
      if (act === 'mic') this._run(() => input.useMic(this.select.value || undefined)).then(() => this.refreshDevices());
      if (act === 'tab') this._run(() => input.useTab());
      if (act === 'file') this.fileInput.click();
      if (act === 'footage') this.footInput.click();
    });
    this.select.addEventListener('change', () => this._run(() => input.useMic(this.select.value || undefined)));
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files[0];
      if (file) this._run(() => input.useFile(file));
      this.fileInput.value = '';
    });
    this.footInput.addEventListener('change', () => {
      const files = [...this.footInput.files];
      this.footInput.value = '';
      if (files.length) this._footage(files);
    });

    // drag & drop anywhere
    window.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('dragging'); });
    window.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('dragging'); });
    window.addEventListener('drop', e => {
      e.preventDefault();
      document.body.classList.remove('dragging');
      const files = [...(e.dataTransfer?.files || [])];
      const file = files.find(f => f.type.startsWith('audio/') || /\.(mp3|wav|flac|ogg|m4a|aac|opus)$/i.test(f.name));
      if (file) this._run(() => input.useFile(file));
      const foot = files.filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
      if (foot.length) this._footage(foot);
    });

    input.onchange = label => { this.status.textContent = label; this.status.classList.remove('err'); };
    this.refreshDevices();
    this.setOpen(true);
  }

  async _run(fn) {
    try {
      this.status.textContent = 'connecting…';
      this.status.classList.remove('err');
      await fn();
      this.setOpen(false);
    } catch (err) {
      console.error(err);
      const blocked = err?.name === 'NotAllowedError' || err?.name === 'SecurityError' || !navigator.mediaDevices;
      this.status.textContent = blocked
        ? 'Access was blocked. Inside Claude, mic and tab capture are not allowed: use the demo track or drop a file. Locally, allow the permission in the address bar.'
        : (err?.message || String(err));
      this.status.classList.add('err');
    }
  }

  async _footage(files) {
    try {
      await this.onFootage?.(files);
      this.status.textContent = `added ${files.length} footage file${files.length > 1 ? 's' : ''} (scene 3)`;
      this.status.classList.remove('err');
    } catch (err) {
      this.status.textContent = 'Could not load that footage: ' + (err?.message || err);
      this.status.classList.add('err');
    }
  }

  async refreshDevices() {
    try {
      const devices = await this.input.listInputDevices();
      const cur = this.select.value;
      this.select.innerHTML = '<option value="">default device</option>' +
        devices.filter(d => d.deviceId && d.deviceId !== 'default')
          .map((d, i) => `<option value="${d.deviceId}">${(d.label || 'input ' + (i + 1)).replace(/</g, '&lt;')}</option>`).join('');
      this.select.value = cur;
    } catch {}
  }

  setOpen(v) {
    this.open = v;
    this.el.classList.toggle('open', v);
  }
  toggle() { this.setOpen(!this.open); }
}

import * as THREE from 'three';

// Stage-1 test scene: one white square per band, all in the final palette.
// It shows at a glance that each band, the beat, hats and drops are reacting.
export class CalibrationScene {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    this.camera.position.set(0, 0, 10);
    this.bg = new THREE.Color();

    const geo = new THREE.PlaneGeometry(1, 1);
    this.squares = ['bass', 'lowMid', 'highMid', 'treble'].map((key, i) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
      m.position.x = (i - 1.5) * 2.2;
      m.userData.key = key;
      this.scene.add(m);
      return m;
    });

    // a single violet beam: brightens on drops
    this.beam = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 30),
      new THREE.MeshBasicMaterial({ color: 0x9b7bff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.beam.position.z = -2;
    this.scene.add(this.beam);
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  update(f, dt, t) {
    for (const sq of this.squares) {
      const v = f[sq.userData.key];
      const s = 0.25 + v * 1.4;
      sq.scale.set(s, s, 1);
      sq.rotation.z += dt * (0.2 + f.lowMid) * (sq.position.x > 0 ? -1 : 1);
      sq.material.opacity = 0.35 + 0.65 * v;
    }
    // hats: tiny jitter on the treble square
    const tq = this.squares[3];
    tq.position.y = (Math.random() - 0.5) * 0.15 * f.hatPulse;

    this.beam.scale.x = 1 + f.bass * 4 + f.dropPulse * 12;
    this.beam.material.opacity = 0.15 + 0.3 * f.bass + 0.5 * f.dropPulse;
    this.beam.position.x = Math.sin(t * 0.2) * 6;

    // charcoal background, lifts slightly on the beat
    const base = 0.105 + 0.06 * f.beatPulse;
    this.bg.setRGB(base, base * 1.02, base * 1.06, THREE.SRGBColorSpace);
    this.scene.background = this.bg;
  }
}

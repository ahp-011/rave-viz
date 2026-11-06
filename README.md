# rave-viz

Minimal, audio-reactive visuals for live AV. Vite + Three.js + Web Audio.

## Run

```bash
npm install
npm run dev
```

Open the printed URL in **Chrome** (best support for tab-audio capture). Run `npm run build` to make a static `dist/` you can serve offline.

## Inputs (menu: M)
- **Mic / line-in**: pick your audio interface in the dropdown. Browser voice processing (echo cancel / noise suppression / AGC) is switched off.
- **Capture tab audio**: choose a *Chrome Tab* and tick **"Share tab audio"**.
- **File**: drag-and-drop anywhere, or use the menu. Files loop; P pauses.
- **Footage**: drop images or videos (or use the menu) for scene 3. They're shown B&W with RGB split, cutting every 8 beats.

## Keys
| key | action |
|---|---|
| M / Esc | open / close input menu |
| H | debug overlay (bands, kick flux vs threshold, BPM, beat/hat/drop lamps) |
| ↑ / ↓ | sensitivity (also lowers/raises beat & drop thresholds) |
| 1–9 / ← → | scene: 1 ripple, 2 organism, 3 footage, 4 terrain, 5 kaleido, 6 tunnel, 7 liquid, 8 geometry, 9 swarm |
| C / K / G | new colours / kaleidoscope mirror / manual glitch |
| A | auto-switch scene on drops |
| F | fullscreen |
| Space | hold frame |
| T | tap tempo (3+ taps) — locks the beat grid to your taps |
| B | "beat is now" — snap the grid to the kick you hear |
| [ / ] | sync offset −/+ 10 ms (if flashes feel late on a projector or Bluetooth speaker, press ]) |

## Beat sync
Kicks and hi-hats are detected on the audio thread (AudioWorklet, ~6 ms resolution), independent of frame rate. Once the tempo is known, a beat clock locks on (overlay shows LOCKED) and fires beats on the predicted grid, phase-corrected by every real kick, so flashes land on the beat rather than after it. In breakdowns without a kick it unlocks after ~2 beats.

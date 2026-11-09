# rave-viz — the club, at home

**▶ Open it: https://ahp-011.github.io/rave-viz/**

Not everyone can get to a club. Maybe it's late, maybe it's far, maybe it's just not your night out. But the music is still playing.

**rave-viz turns your room into the dancefloor.** Put on your favourite track (YouTube, Spotify, a file, or whatever's playing in the room), and your screen becomes the club: spotlights sweeping through haze, lasers snapping on the beat, strobes when the drop hits, and visuals that move with every kick, hi-hat and build-up.

You're at home. It feels like the party.

No install, no account, no app. It runs in your browser, on your laptop, TV or projector.

---

## Start the party (30 seconds)

1. Start your music in a Chrome tab (YouTube, Spotify Web, SoundCloud…).
2. Open **https://ahp-011.github.io/rave-viz/** in another tab.
3. Click **Capture tab audio**, pick your music tab and switch on **"Also share tab audio"**.
4. Press **F** for fullscreen. Turn the lights off. Turn it up.

Other ways in (press **M** for the menu):
- **Mic / line-in**: for music playing out loud in the room, or a DJ controller / audio interface.
- **Drop an audio file** anywhere on the page.
- **Play demo track**: a built-in techno loop with a drop, so you can try it right away.

## What makes it feel like a club

- **It's locked to the beat.** Kicks are detected on the audio thread with ~6 ms precision, and a beat clock locks onto the tempo, so flashes land *on* the kick, not after it.
- **It knows when the drop is coming.** Build-ups bring rising strobes; the drop brings a burst of light, a scene change, new colours and the full laser fan.
- **Club lighting (X):** six moving-head spotlights on a truss sweep through drifting haze in changing patterns (fan, cross, sweep, chase, ballyhoo). A laser fan snaps to the beat and opens up as the energy rises, and strobes hit on drops. Your visuals become the LED wall behind the DJ.
- **It never gets repetitive.** There are 9 scenes, 5 transitions and 6 looks, and each one plays before any repeats, so no two cuts in a row look the same.

### The scenes
| # | Scene | Vibe |
|---|---|---|
| 1 | Ripple | stacked pools of particles that ripple with the bass |
| 2 | Organism | a breathing sphere of 150k particles that swells on the drop |
| 3 | Footage | your own images/videos in black & white with RGB split, cutting on the beat |
| 4 | Terrain | the live spectrum as rolling ridgelines flying toward you |
| 5 | Kaleido | a neon mandala that zooms with the bass |
| 6 | Tunnel | flying through a hexagonal neon tunnel |
| 7 | Liquid | melting colour with light beams and sparks |
| 8 | Geometry | warping wireframes with rainbow trails |
| 9 | Swarm | 32k particles that snap into shapes on every beat |

## Controls

| key | action |
|---|---|
| **F** | fullscreen |
| **M** / Esc | input menu |
| **X** | club lighting on/off |
| **S** | strobes on/off |
| **1–9** / ← → | pick a scene |
| **A** | auto-switch scenes on drops |
| **L** | new look · **C** new colours · **K** kaleidoscope · **G** transition |
| **↑ / ↓** | sensitivity (quiet room ↔ loud room) |
| **T** | tap tempo · **B** "the beat is now" |
| **[ / ]** | sync −/+ 10 ms (press **]** if the flashes feel late on a TV, projector or Bluetooth speaker) |
| **Space** | freeze frame · **P** pause file/demo |
| **H** | debug overlay (levels, BPM, beat lock) |

> ⚠️ **Flashing lights.** Club mode includes strobes (max 12 flashes/second). Press **S** to turn them off if you or anyone watching is sensitive to flashing light.

## Tips
- **Chrome** works best (tab-audio capture). On a TV or projector, share your screen or plug in via HDMI.
- If it flashes on things that aren't kicks, press **↓**. If it misses kicks, press **↑**.
- Press **H** to see the beat lock: it says **LOCKED** once it has the groove.

## Run it yourself

```bash
npm install
npm run dev
```

Built with Vite, Three.js (WebGL) and the Web Audio API (AudioWorklet onset detection). There's no backend: everything runs in your browser. Every push to `main` redeploys GitHub Pages automatically.

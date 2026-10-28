# Vectoria 2

A browser port of [Vectoria](https://github.com/DanielKetterer/Vectoria), the vector-field puzzle game. It's plain JavaScript and Canvas 2D, with no build step and no dependencies.

Push, pull and spin a field of dots into the goal zones. You use divergence in Push-Pull zones and curl in Spin zones, and you avoid the traps.

## Run it

ES modules don't load from `file://`, so serve the folder over http:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

### Host it on GitHub Pages (free)

1. In the repo, go to **Settings > Pages**.
2. Under "Build and deployment", set **Source** to *Deploy from a branch*.
3. Set **Branch** to `main`, folder `/ (root)`, and save.

The game will be live at `https://danielketterer.github.io/Vectoria-2/` a minute or two later.

## Controls

| Input | Action |
|---|---|
| Left mouse (hold/drag) | Push in Push-Pull zones, counterclockwise spin in Spin zones, push in Both zones |
| Right mouse (hold/drag) | Pull in Push-Pull zones, clockwise spin in Spin zones, clockwise spin in Both zones |
| Touch (each finger) | Acts as left or right, chosen by the on-screen L/R toggle (or `T`) |
| `V` / `H` / `C` | Toggle the vector, divergence and curl overlays |
| `N` | Next level, after completing one |
| `R` | Restart |
| `Esc` / `Q` | Back to menu |

Beating all five levels unlocks Level Select. Best times, stars and the unlock are saved in the browser's localStorage.

## Layout

```
index.html          canvas + styles
src/config.js       constants (physics, zones, star thresholds)
src/map.js          PNG -> zone grid + textured render
src/physics.js      World: dots, flow fields, sources, fixed-step simulation (no DOM)
src/input.js        Pointer Events -> force sources (mouse, each finger, pen)
src/render.js       world, overlays, HUD, buttons
src/effects.js      win-screen fireworks and confetti
src/storage.js      localStorage scores and unlock
src/main.js         loop + screen state machine
assets/levels/      level1-5.png, tutorial1-2.png (unchanged from the original)
assets/textures/    zone textures (unchanged)
```

Levels are still flat-color PNGs, so the original level art drops in as-is:

| Color | Zone |
|---|---|
| magenta `#FF00FF` | movement only |
| yellow `#FFFF00` | push/pull and spin |
| teal `#00FFFF` | push/pull only |
| blue `#0000FF` | spin only |
| green `#00FF00` | goal (dots stop) |
| black `#000000` | wall |
| red `#FF0000` | trap (dots stop) |

Each channel is matched within +/-50. Any other color is passable, has no actions, and spawns no dots.

## What changed from the pygame version

The physics is a line-for-line port. A headless test drove the same held input through both versions on every level, and dot positions matched to within 1e-8 px. The differences are deliberate:

- **Fixed timestep.** The simulation runs at 60 ticks/sec whatever the monitor's refresh rate. Before, physics advanced once per rendered frame.
- **One impulse per source per tick.** The original applied force in the mouse-motion handler *and* in the per-frame drag block. Moving the mouse therefore pushed harder than holding still. Now position only sets *where* the force acts, not how much of it there is.
- **Multiple sources superpose.** Input is a list of sources, one per active pointer, and their fields add. Two fingers on a tablet already give two-player local co-op. This list is also where networked players will plug in.
- **Quick taps always register.** A click shorter than one tick still applies one impulse.
- **The motion-event crash is gone.** `play_state.py` read `evt.button` on `MOUSEMOTION` events, which don't have that attribute. That raised an AttributeError when dragging through a yellow zone.
- **Times are simulated time** (ticks / 60), not wall-clock. They're fair across machines, and a backgrounded tab doesn't run up the timer.
- **Tutorial completions no longer overwrite level 1 and 2 scores.** In the original they wrote into the same slots.
- **Completion and failure are exclusive.** Input locks on either one, and dots keep settling.
- **Overlays show the summed, signed field.** Pulling now shows negative divergence (blue). The original drew the divergence overlay unsigned. A pure curl field no longer amplifies rounding noise into random colors.
- **Unmatched-color pixels draw their own color.** Examples are the white areas in level 4. In pygame they left the previous frame showing through.

Star thresholds default to `[2, 5, 10]` seconds for every level. That's what the Python game fell back to, since `stars.csv` was never committed. Tune them per level in `src/config.js`.

The sandbox / level editor (`combined2.py`) isn't ported yet.

## Next: networked two-player

`src/physics.js` has no DOM dependencies, and `World.step(sources)` takes plain `{x, y, button, held}` objects. A remote player's input can be fed in exactly like a local finger. The planned path is:

1. A host/guest protocol over `BroadcastChannel`, tested in two tabs with no network.
2. The same protocol over WebRTC data channels, with free serverless signaling (Trystero or PeerJS).

# Vectoria 2

A browser port of [Vectoria](https://github.com/DanielKetterer/Vectoria), the vector-field puzzle game. It's plain JavaScript and Canvas 2D, with no build step. The only dependency is [Trystero](https://github.com/dmotz/trystero), which loads from a CDN, and only when you open Multiplayer.

Push, pull and spin a field of dots into the goal zones. You use divergence in Push-Pull zones and curl in Spin zones, and you avoid the traps. You can play alone, or with a partner on another device in co-op.

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
| `Esc` / `Q` | Back to menu (in multiplayer: host to lobby, guest leaves) |

Beating all five levels unlocks Level Select. Best times, stars and the unlock are saved in the browser's localStorage.

## Multiplayer (co-op and versus)

Choose **3. Multiplayer** from the menu.

1. **The host** picks *Host a game*. They get a 4-character room code and an invite link.
2. **The partner** either opens the invite link, or picks *Join a game* and types the code.
3. The host picks **Co-op** or **Versus** (or presses `M`), then a level or map. The host can also start before the partner arrives; a late joiner drops straight into the current level.

Both players act on the same dots at the same time, and their fields add together. The host is **Orange** and the guest is **Violet**. You can see each other's cursors as rings in your color, with **+** for left/push and **-** for right/pull. Esc returns the host to the lobby and takes the guest out of the game. Multiplayer runs don't change the solo high scores.

**Co-op:** you share the normal levels and their goal. Either player can press **N** (next) or **R** (restart).

**Versus:** each player has their own goal, and a dot that reaches a goal stays there and counts for that player.
- A player wins the moment their goal holds a strict majority of all dots.
- Otherwise, whoever has more when the 2:00 clock runs out wins; equal counts are a draw.
- Traps just take dots out of play; there's no failure state.
- Restart is a **rematch**, available to either player, but only once the match is over, so nobody can wipe a match they're losing.

Versus maps live at `assets/levels/versus<N>.png`. Register each one in `VERSUS_MAP_COUNT` / `VERSUS_MAP_NAMES` in `src/config.js`.

The test map, **Open Field** (`versus1.png`), is a teal field (push/pull) inside a wall, with Violet's goal at the top and Orange's at the bottom. It has 398 dots, so 200 wins outright.

Balance note, measured: the fields don't weaken with distance, so one player pulling unopposed from just in front of their own goal reaches a majority in about one second (63 ticks). Real matches turn into a tug of war once both players act, but it's a fast, twitchy game on this map. The levers, if it plays badly, are:
- distance falloff for versus forces
- action zones that only cover each player's half
- goal mouths narrowed by walls

### How it works without a server

- **Host-authoritative simulation.** The host runs the only simulation and feeds it both players' force sources. The guest sends its pointer input (about 30 times a second, a few dozen bytes each). The host streams back a binary snapshot of the dots (about 30 times a second, roughly 4 KB each). The guest draws those snapshots, smoothing between the last two, and draws its own cursor locally so it feels instant.
- **Peer-to-peer connection.** Players connect directly over WebRTC data channels. Trystero handles the one-time handshake through public Nostr relays. After that, game traffic goes straight between the two browsers. There's no account, no API key, and no server of our own; GitHub Pages serves the static files.
- **The one weak spot is restrictive networks.** On some corporate, school or cellular networks, two browsers can't connect directly. That case needs a TURN relay server: add a `turnConfig` to the `joinRoom` call in `src/net/transport.js`. Cloudflare offers TURN with a free tier.

### Testing on one machine

Add `?net=local` to the URL. Multiplayer then connects tabs within the same browser using `BroadcastChannel`, with no network involved. Open the host in one tab and the invite link in another. Switching tabs is fine: the simulation clock runs in a Web Worker, so the host keeps simulating while its tab is in the background.

The protocol was tested end to end in headless Chromium two ways:

- **Over `BroadcastChannel`:** lobby, invite link, typed code, simultaneous input from both players, quick taps, next/restart from either side, the shared win screen, a third player being turned away, and either player leaving.
- **Over real Trystero/WebRTC:** two separate browser profiles connected through the public relays.

Both tests ran on one machine, so cross-network NAT traversal still needs a real-world try.

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
src/main.js         loop + screen state machine, multiplayer session (host/guest)
src/net/transport.js  Trystero (WebRTC) and BroadcastChannel transports, one interface
src/net/snapshot.js   binary world snapshots + the guest's interpolated view
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
| orange `#FF8000` | versus: Orange's goal, player 1 / host (dots stop) |
| purple `#8000FF` | versus: Violet's goal, player 2 / guest (dots stop) |

Each channel is matched within +/-50. Any other color is passable, has no actions, and spawns no dots. Dots never spawn inside a player goal. The two goal colors are at least 127 away from every other zone color in some channel, so they can't be confused. In-game they're drawn as checkered flags in each player's color, labeled "Orange goal" / "Violet goal", and the player's own goal is marked "(you)".

## What changed from the pygame version

The physics is a line-for-line port. A headless test drove the same held input through both versions on every level, and dot positions matched to within 1e-8 px. The differences are deliberate:

- **Fixed timestep.** The simulation runs at 60 ticks/sec whatever the monitor's refresh rate. Before, physics advanced once per rendered frame.
- **One impulse per source per tick.** The original applied force in the mouse-motion handler *and* in the per-frame drag block. Moving the mouse therefore pushed harder than holding still. Now position only sets *where* the force acts, not how much of it there is.
- **Multiple sources superpose.** Input is a list of sources, one per active pointer, and their fields add. Two fingers on a tablet already give two-player local co-op. Networked players plug into the same list.
- **Quick taps always register.** A click shorter than one tick still applies one impulse.
- **The motion-event crash is gone.** `play_state.py` read `evt.button` on `MOUSEMOTION` events, which don't have that attribute. That raised an AttributeError when dragging through a yellow zone.
- **Times are simulated time** (ticks / 60), not wall-clock. They're fair across machines, and a backgrounded tab doesn't run up the timer.
- **Tutorial completions no longer overwrite level 1 and 2 scores.** In the original they wrote into the same slots.
- **Completion and failure are exclusive.** Input locks on either one, and dots keep settling.
- **Overlays show the summed, signed field.** Pulling now shows negative divergence (blue). The original drew the divergence overlay unsigned. A pure curl field no longer amplifies rounding noise into random colors.
- **Unmatched-color pixels draw their own color.** Examples are the white areas in level 4. In pygame they left the previous frame showing through.

Star thresholds default to `[2, 5, 10]` seconds for every level. That's what the Python game fell back to, since `stars.csv` was never committed. Tune them per level in `src/config.js`.

## Ideas not built yet

- **More versus maps**, and a balance pass (see the balance note above).
- **More than two players.** The source list already handles any number of players. The lobby and protocol assume one guest.
- **The sandbox / level editor** from `combined2.py`.

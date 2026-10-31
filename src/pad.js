// Touch action pad: one thumb picks the action on the pad, the other thumb
// applies it on the field (the PUBG-style split). It stands in for the mouse
// buttons: "+" is the left button (push, or spin counterclockwise), "-" is
// the right button (pull, or spin clockwise). In yellow zones, which allow
// both, "+" pushes and "-" spins clockwise, exactly as with a mouse.
//
// Tap an action to latch it. Press and hold the other one for a momentary
// switch: it reverts when you let go. Either way the change applies live to
// fingers already on the field.

const HOLD_MS = 280;            // a press longer than this is a hold, not a tap
const SIDE_KEY = 'vectoria.padSide';

export function wantsPad(params) {
  if (params.get('pad') === '1') return true;
  if (params.get('pad') === '0') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function setupPad(input, onTool) {
  const pad = document.getElementById('pad');
  const body = document.body;
  body.classList.add('touch');
  try {
    if (localStorage.getItem(SIDE_KEY) === 'right') body.classList.add('pad-right');
  } catch (_) { /* storage unavailable: default side */ }

  const acts = [...pad.querySelectorAll('.act')];
  const tools = Object.fromEntries([...pad.querySelectorAll('[data-tool]')].map((b) => [b.dataset.tool, b]));
  const presses = new Map(); // pointerId -> { btn, prev, at, el }

  const showAction = () => {
    for (const el of acts) el.classList.toggle('on', Number(el.dataset.btn) === input.touchButton);
  };

  for (const el of acts) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      const btn = Number(el.dataset.btn);
      presses.set(e.pointerId, { btn, prev: input.touchButton, at: performance.now(), el });
      el.classList.add('held');
      input.setTouchButton(btn);
      showAction();
    });
    const release = (e) => {
      const p = presses.get(e.pointerId);
      if (!p) return;
      presses.delete(e.pointerId);
      p.el.classList.remove('held');
      // A hold was a momentary switch: go back to what was latched before,
      // unless another press on the pad has taken over since.
      const held = performance.now() - p.at > HOLD_MS;
      if (held && p.prev !== p.btn && presses.size === 0 && input.touchButton === p.btn) {
        input.setTouchButton(p.prev);
        showAction();
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }

  for (const [name, el] of Object.entries(tools)) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (el.disabled) return;
      if (name === 'swap') {
        const right = body.classList.toggle('pad-right');
        try { localStorage.setItem(SIDE_KEY, right ? 'right' : 'left'); } catch (_) { /* ignore */ }
        return;
      }
      onTool(name);
    });
  }
  pad.addEventListener('contextmenu', (e) => e.preventDefault());

  showAction();
  let lastKey = '';

  // Called every frame; touches the DOM only when something changed.
  return function syncPad({ playing, overlays, canRestart, exitLabel }) {
    const key = [playing, overlays.vectors, overlays.divergence, overlays.curl, canRestart, exitLabel, input.touchButton].join('|');
    if (key === lastKey) return;
    lastKey = key;
    body.classList.toggle('playing', playing);
    tools.vectors.classList.toggle('on', overlays.vectors);
    tools.divergence.classList.toggle('on', overlays.divergence);
    tools.curl.classList.toggle('on', overlays.curl);
    tools.restart.disabled = !canRestart;
    tools.exit.textContent = exitLabel;
    showAction();
  };
}

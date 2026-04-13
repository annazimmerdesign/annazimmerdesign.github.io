// cursor-displace.js
// Applies a subtle displacement / heat-shimmer effect as the cursor moves.
// Two layers:
//   1. An SVG filter (feTurbulence + feDisplacementMap) applied to a fixed
//      grain overlay — the grain itself distorts, not the text.
//   2. A very light CSS transform on paragraph elements near the cursor,
//      making text feel like it's being viewed through old glass or a photocopy.

(function () {
  // ---- Grain overlay ----
  // A fixed full-viewport SVG that sits over the page at low opacity.
  // The feTurbulence seed shifts on mousemove, giving the grain a living quality.

  const svgNS = 'http://www.w3.org/2000/svg';

  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.setAttribute('id', 'grain-overlay');
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0;
    width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 10;
    opacity: 0.28;
  `;

  const defs = document.createElementNS(svgNS, 'defs');
  const filter = document.createElementNS(svgNS, 'filter');
  filter.setAttribute('id', 'grain-filter');
  filter.setAttribute('x', '0%');
  filter.setAttribute('y', '0%');
  filter.setAttribute('width', '100%');
  filter.setAttribute('height', '100%');
  filter.setAttribute('color-interpolation-filters', 'sRGB');

  const turbulence = document.createElementNS(svgNS, 'feTurbulence');
  turbulence.setAttribute('type', 'fractalNoise');
  turbulence.setAttribute('baseFrequency', '0.68');
  turbulence.setAttribute('numOctaves', '4');
  turbulence.setAttribute('seed', '2');
  turbulence.setAttribute('stitchTiles', 'stitch');
  turbulence.setAttribute('result', 'noise');

  const colorMatrix = document.createElementNS(svgNS, 'feColorMatrix');
  colorMatrix.setAttribute('type', 'saturate');
  colorMatrix.setAttribute('values', '0');

  filter.appendChild(turbulence);
  filter.appendChild(colorMatrix);
  defs.appendChild(filter);
  overlay.appendChild(defs);

  const rect = document.createElementNS(svgNS, 'rect');
  rect.setAttribute('width', '100%');
  rect.setAttribute('height', '100%');
  rect.setAttribute('filter', 'url(#grain-filter)');
  rect.setAttribute('fill', '#1c1208');
  overlay.appendChild(rect);

  document.body.appendChild(overlay);

  // ---- Text displacement ----
  // Paragraphs and entries within ~200px of cursor get a very slight
  // CSS transform that shifts and skews — like viewing through old glass.
  // Magnitude is intentionally small; this should feel environmental, not dramatic.

  const TEXT_RADIUS = 220;       // px — how close cursor must be to affect element
  const MAX_TRANSLATE = 0.7;     // px — maximum offset
  const MAX_SKEW = 0.12;         // degrees
  const DECAY = 0.08;            // lerp factor for smooth return

  // Track current displacement per element
  const elementStates = new WeakMap();

  function getOrInitState(el) {
    if (!elementStates.has(el)) {
      elementStates.set(el, { tx: 0, ty: 0, sx: 0, targetTx: 0, targetTy: 0, targetSx: 0 });
    }
    return elementStates.get(el);
  }

  let mouseX = -9999, mouseY = -9999;
  let rafId = null;
  let seed = 2;
  let lastSeedX = -1, lastSeedY = -1;

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;

    // Shift turbulence seed slowly as cursor moves across grid cells (32px)
    const gx = Math.floor(mouseX / 32);
    const gy = Math.floor(mouseY / 32);
    if (gx !== lastSeedX || gy !== lastSeedY) {
      lastSeedX = gx; lastSeedY = gy;
      seed = (seed + 1) % 99;
      turbulence.setAttribute('seed', seed);
    }

    if (!rafId) rafId = requestAnimationFrame(tick);
  });

  function tick() {
    rafId = null;

    const candidates = document.querySelectorAll(
      '.entry p, .text-block p, .log-entry p, .entry-date, .log-date, .nav-list li a'
    );

    candidates.forEach(el => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = mouseX - cx;
      const dy = mouseY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const state = getOrInitState(el);

      if (dist < TEXT_RADIUS) {
        // influence falls off with distance
        const influence = 1 - dist / TEXT_RADIUS;
        // direction away from cursor (text appears to recoil slightly)
        const angle = Math.atan2(dy, dx);
        state.targetTx = -Math.cos(angle) * MAX_TRANSLATE * influence;
        state.targetTy = -Math.sin(angle) * MAX_TRANSLATE * influence;
        state.targetSx = (dx / TEXT_RADIUS) * MAX_SKEW * influence;
      } else {
        state.targetTx = 0;
        state.targetTy = 0;
        state.targetSx = 0;
      }

      // lerp toward target
      state.tx += (state.targetTx - state.tx) * DECAY;
      state.ty += (state.targetTy - state.ty) * DECAY;
      state.sx += (state.targetSx - state.sx) * DECAY;

      // only apply if meaningfully non-zero (avoid thrashing style for distant els)
      const mag = Math.abs(state.tx) + Math.abs(state.ty) + Math.abs(state.sx);
      if (mag > 0.005) {
        el.style.transform = `translate(${state.tx.toFixed(3)}px, ${state.ty.toFixed(3)}px) skewX(${state.sx.toFixed(3)}deg)`;
      } else if (el.style.transform) {
        el.style.transform = '';
      }
    });

    // keep ticking while any element still has residual displacement
    rafId = requestAnimationFrame(tick);
  }

  // kick off the decay loop immediately (handles return-to-zero when mouse is still)
  rafId = requestAnimationFrame(tick);
})();
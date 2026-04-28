// cursor-displace.js
// Word-level cursor displacement + subtle animated grain.
// Grain shifts seed on movement giving illusion of particle disturbance.
// No overlay translation — individual grain character changes, not position.

(function () {

  // ---- Grain overlay ----

  const svgNS = 'http://www.w3.org/2000/svg';
  const overlay = document.createElementNS(svgNS, 'svg');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0;
    width: 100vw; height: 100vh;
    pointer-events: none; z-index: 5;
    will-change: auto;
  `;

  const defs = document.createElementNS(svgNS, 'defs');
  const grainFilter = document.createElementNS(svgNS, 'filter');
  grainFilter.setAttribute('id', 'grain-filter');
  grainFilter.setAttribute('x', '0%');
  grainFilter.setAttribute('y', '0%');
  grainFilter.setAttribute('width', '100%');
  grainFilter.setAttribute('height', '100%');

  const turbulence = document.createElementNS(svgNS, 'feTurbulence');
  turbulence.setAttribute('type', 'fractalNoise');
  turbulence.setAttribute('baseFrequency', '0.68');
  turbulence.setAttribute('numOctaves', '3');
  turbulence.setAttribute('seed', '8');
  turbulence.setAttribute('stitchTiles', 'stitch');

  const saturate = document.createElementNS(svgNS, 'feColorMatrix');
  saturate.setAttribute('type', 'saturate');
  saturate.setAttribute('values', '0');

  grainFilter.appendChild(turbulence);
  grainFilter.appendChild(saturate);
  defs.appendChild(grainFilter);
  overlay.appendChild(defs);

  const grainRect = document.createElementNS(svgNS, 'rect');
  grainRect.setAttribute('width', '100%');
  grainRect.setAttribute('height', '100%');
  grainRect.setAttribute('fill', '#1c1208');
  grainRect.setAttribute('filter', 'url(#grain-filter)');
  grainRect.setAttribute('opacity', '0.14');
  overlay.appendChild(grainRect);

  document.body.appendChild(overlay);

  // grain state — only seed shifts, nothing translates
  let grainSeed = 8;
  let lastSeedX = -999, lastSeedY = -999;
  const SEED_CELL = 40; // px — grain shifts when cursor crosses a cell boundary

  // ---- Word wrapping ----

  function wrapWords(el) {
    if (el._wordsWrapped) return;
    el._wordsWrapped = true;
    const text = el.textContent;
    el.innerHTML = text.split(/(\s+)/).map(token => {
      if (/^\s+$/.test(token)) return token;
      return `<span class="word-unit" style="display:inline-block;">${token}</span>`;
    }).join('');
  }

  window.wrapAllParagraphs = function() {
    document.querySelectorAll(
      '.entry p, .text-block p, .log-entry p, .entry-date, .log-date, .doc-caption, .node-label, .node-id, .photo-caption'
    ).forEach(wrapWords);
  };

  document.addEventListener('DOMContentLoaded', window.wrapAllParagraphs);
  document.addEventListener('contentLoaded', window.wrapAllParagraphs);
  setTimeout(window.wrapAllParagraphs, 800);

  // ---- Word displacement ----

  const WORD_RADIUS = 100;
  const MAX_SCATTER = 3.5;
  const DECAY = 0.14;

  const wordStates = new WeakMap();

  function getWordState(el) {
    if (!wordStates.has(el)) {
      wordStates.set(el, { tx: 0, ty: 0, targetTx: 0, targetTy: 0 });
    }
    return wordStates.get(el);
  }

  const remoteCursorPositions = {};
  let localX = -9999, localY = -9999;
  let wordRaf = null;

  // ---- Unified mousemove ----

  document.addEventListener('mousemove', e => {
    localX = e.clientX;
    localY = e.clientY;

    // shift grain seed when cursor crosses cell boundary
    const cx = Math.floor(e.clientX / SEED_CELL);
    const cy = Math.floor(e.clientY / SEED_CELL);
    if (cx !== lastSeedX || cy !== lastSeedY) {
      lastSeedX = cx;
      lastSeedY = cy;
      grainSeed = (grainSeed + 1) % 200;
      turbulence.setAttribute('seed', grainSeed);
    }

    if (!wordRaf) wordRaf = requestAnimationFrame(tickWords);
  });

  function tickWords() {
    wordRaf = null;

    const allCursors = [
      { x: localX, y: localY },
      ...Object.values(remoteCursorPositions)
    ];

    document.querySelectorAll('.word-unit').forEach(word => {
      const r = word.getBoundingClientRect();
      if (r.width === 0 || r.bottom < 0 || r.top > window.innerHeight) return;

      const wx = r.left + r.width / 2;
      const wy = r.top + r.height / 2;
      const state = getWordState(word);
      state.targetTx = 0;
      state.targetTy = 0;

      for (const cursor of allCursors) {
        const dx = wx - cursor.x;
        const dy = wy - cursor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < WORD_RADIUS && dist > 0) {
          const influence = 1 - dist / WORD_RADIUS;
          state.targetTx += (dx / dist) * MAX_SCATTER * influence;
          state.targetTy += (dy / dist) * MAX_SCATTER * influence;
        }
      }

      const mag = Math.sqrt(state.targetTx**2 + state.targetTy**2);
      if (mag > MAX_SCATTER) {
        state.targetTx = (state.targetTx / mag) * MAX_SCATTER;
        state.targetTy = (state.targetTy / mag) * MAX_SCATTER;
      }

      state.tx += (state.targetTx - state.tx) * DECAY;
      state.ty += (state.targetTy - state.ty) * DECAY;

      const total = Math.abs(state.tx) + Math.abs(state.ty);
      if (total > 0.02) {
        word.style.transform = `translate(${state.tx.toFixed(2)}px,${state.ty.toFixed(2)}px)`;
      } else if (word.style.transform) {
        word.style.transform = '';
      }
    });

    wordRaf = requestAnimationFrame(tickWords);
  }

  wordRaf = requestAnimationFrame(tickWords);

  // ---- Remote cursors ----

  const remoteCursorDots = {};

  window.renderRemoteCursor = function(socketId, normX, normY) {
    const x = normX * window.innerWidth;
    const y = normY * window.innerHeight;
    remoteCursorPositions[socketId] = { x, y };

    if (!remoteCursorDots[socketId]) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position: fixed; width: 3px; height: 3px;
        background: rgba(232,220,200,0.35); border-radius: 50%;
        pointer-events: none; z-index: 9998;
        transition: left 0.08s linear, top 0.08s linear;
      `;
      document.body.appendChild(dot);
      remoteCursorDots[socketId] = dot;
    }
    remoteCursorDots[socketId].style.left = (x - 1.5) + 'px';
    remoteCursorDots[socketId].style.top  = (y - 1.5) + 'px';
  };

  window.removeRemoteCursor = function(socketId) {
    delete remoteCursorPositions[socketId];
    if (remoteCursorDots[socketId]) {
      remoteCursorDots[socketId].remove();
      delete remoteCursorDots[socketId];
    }
  };

})();
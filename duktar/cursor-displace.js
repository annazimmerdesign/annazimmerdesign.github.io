// cursor-displace.js
// Word-level cursor displacement — words scatter slightly when cursor approaches.
// No opacity changes, pure positional recoil. "Words scared of the cursor."
// Remote cursors from other visitors rendered as faint dots with same effect.

(function () {

  // ---- Word wrapping ----
  // Split paragraph text into individual word spans so we can animate per-word.

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
  }

  // wrap on load and after any dynamic content injection
  document.addEventListener('DOMContentLoaded', wrapAllParagraphs);
  document.addEventListener('contentLoaded', wrapAllParagraphs);
  setTimeout(wrapAllParagraphs, 800); // catch dynamically injected content

  // ---- Word displacement ----

  const WORD_RADIUS = 100;      // px — how close cursor must be to a word
  const MAX_SCATTER = 3.5;      // px — max displacement
  const DECAY = 0.12;           // lerp speed back to rest

  const wordStates = new WeakMap();

  function getWordState(el) {
    if (!wordStates.has(el)) {
      wordStates.set(el, { tx: 0, ty: 0, targetTx: 0, targetTy: 0 });
    }
    return wordStates.get(el);
  }

  let cursors = []; // all active cursor positions (local + remote)
  let localX = -9999, localY = -9999;
  let rafId = null;

  document.addEventListener('mousemove', e => {
    localX = e.clientX;
    localY = e.clientY;
    if (!rafId) rafId = requestAnimationFrame(tick);
  });

  function tick() {
    rafId = null;

    // build combined cursor list
    const allCursors = [{ x: localX, y: localY }, ...Object.values(remoteCursorPositions)];

    document.querySelectorAll('.word-unit').forEach(word => {
      const r = word.getBoundingClientRect();
      if (r.width === 0) return;
      const wx = r.left + r.width / 2;
      const wy = r.top + r.height / 2;

      const state = getWordState(word);
      state.targetTx = 0;
      state.targetTy = 0;

      // accumulate repulsion from all cursors
      for (const cursor of allCursors) {
        const dx = wx - cursor.x;
        const dy = wy - cursor.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < WORD_RADIUS && dist > 0) {
          const influence = (1 - dist / WORD_RADIUS);
          // repel away from cursor
          state.targetTx += (dx / dist) * MAX_SCATTER * influence;
          state.targetTy += (dy / dist) * MAX_SCATTER * influence;
        }
      }

      // clamp
      const mag = Math.sqrt(state.targetTx ** 2 + state.targetTy ** 2);
      if (mag > MAX_SCATTER) {
        state.targetTx = (state.targetTx / mag) * MAX_SCATTER;
        state.targetTy = (state.targetTy / mag) * MAX_SCATTER;
      }

      state.tx += (state.targetTx - state.tx) * DECAY;
      state.ty += (state.targetTy - state.ty) * DECAY;

      if (Math.abs(state.tx) + Math.abs(state.ty) > 0.02) {
        word.style.transform = `translate(${state.tx.toFixed(2)}px, ${state.ty.toFixed(2)}px)`;
      } else {
        word.style.transform = '';
      }
    });

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  // ---- Remote cursors ----

  const remoteCursorPositions = {};
  const remoteCursorDots = {};

  window.renderRemoteCursor = function(socketId, normX, normY) {
    const x = normX * window.innerWidth;
    const y = normY * window.innerHeight;
    remoteCursorPositions[socketId] = { x, y };

    if (!remoteCursorDots[socketId]) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position: fixed;
        width: 3px;
        height: 3px;
        background: rgba(232,220,200,0.35);
        border-radius: 50%;
        pointer-events: none;
        z-index: 9998;
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
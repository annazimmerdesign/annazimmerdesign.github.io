// cursor-displace.js
// Word-level cursor displacement + remote cursor support.

(function () {

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
      '.entry p, .text-block p, .log-entry p, .entry-date, .log-date, .doc-caption, .node-label, .node-id, .photo-caption, .about-para'
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

  document.addEventListener('mousemove', e => {
    localX = e.clientX;
    localY = e.clientY;
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
        position: fixed; width: 96px; height: 96px;
        background: radial-gradient(circle, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.12) 12%, transparent 12%);
        border-radius: 50%;
        pointer-events: none; z-index: 9998;
        transform: translate(-50%, -50%);
        filter: blur(8px);
        transition: left 0.09s linear, top 0.09s linear;
      `;
      document.body.appendChild(dot);
      remoteCursorDots[socketId] = dot;
    }
    remoteCursorDots[socketId].style.left = x + 'px';
    remoteCursorDots[socketId].style.top  = y + 'px';
  };

  window.removeRemoteCursor = function(socketId) {
    delete remoteCursorPositions[socketId];
    if (remoteCursorDots[socketId]) {
      remoteCursorDots[socketId].remove();
      delete remoteCursorDots[socketId];
    }
  };

})();
// cursor-displace.js
// Local cursor displacement effect — small pixel radius around cursor only.
// Text elements within ~80px of cursor get a subtle translate + skew.
// Remote cursors from other visitors are rendered as glitch traces.

(function () {

  // ---- Local text displacement ----

  const TEXT_RADIUS = 80;
  const MAX_TRANSLATE = 0.8;
  const MAX_SKEW = 0.15;
  const DECAY = 0.1;

  const elementStates = new WeakMap();

  function getOrInitState(el) {
    if (!elementStates.has(el)) {
      elementStates.set(el, { tx: 0, ty: 0, sx: 0, targetTx: 0, targetTy: 0, targetSx: 0 });
    }
    return elementStates.get(el);
  }

  let mouseX = -9999, mouseY = -9999;
  let rafId = null;

  document.addEventListener('mousemove', e => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    if (!rafId) rafId = requestAnimationFrame(tick);
  });

  function tick() {
    rafId = null;

    const candidates = document.querySelectorAll(
      '.entry p, .text-block p, .log-entry p, .entry-date, .log-date, .nav-list li a, .meta-key, .meta-val, .doc-caption'
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
        const influence = 1 - dist / TEXT_RADIUS;
        const angle = Math.atan2(dy, dx);
        state.targetTx = -Math.cos(angle) * MAX_TRANSLATE * influence;
        state.targetTy = -Math.sin(angle) * MAX_TRANSLATE * influence;
        state.targetSx = (dx / TEXT_RADIUS) * MAX_SKEW * influence;
      } else {
        state.targetTx = 0;
        state.targetTy = 0;
        state.targetSx = 0;
      }

      state.tx += (state.targetTx - state.tx) * DECAY;
      state.ty += (state.targetTy - state.ty) * DECAY;
      state.sx += (state.targetSx - state.sx) * DECAY;

      const mag = Math.abs(state.tx) + Math.abs(state.ty) + Math.abs(state.sx);
      if (mag > 0.005) {
        el.style.transform = `translate(${state.tx.toFixed(3)}px, ${state.ty.toFixed(3)}px) skewX(${state.sx.toFixed(3)}deg)`;
      } else if (el.style.transform) {
        el.style.transform = '';
      }
    });

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  // ---- Local glitch on cursor movement ----
  // Small radius glitch — only elements within 80px of cursor

  const GLITCH_RADIUS = 80;
  const GLITCH_DURATION = 100;
  const glitching = new WeakSet();
  let lastGlitchPos = { x: -999, y: -999 };

  document.addEventListener('mousemove', e => {
    const dx = e.clientX - lastGlitchPos.x;
    const dy = e.clientY - lastGlitchPos.y;
    if (Math.sqrt(dx*dx + dy*dy) < 12) return;
    lastGlitchPos = { x: e.clientX, y: e.clientY };

    const candidates = document.querySelectorAll(
      '.entry p, .log-entry p, .entry-date, .log-date, .nav-list li a, .meta-key, .meta-val'
    );

    candidates.forEach(el => {
      if (glitching.has(el)) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.sqrt((cx - e.clientX)**2 + (cy - e.clientY)**2);
      if (dist > GLITCH_RADIUS) return;

      glitching.add(el);
      const orig = el.style.transform || '';
      const shift = (Math.random() - 0.5) * 4;
      el.style.transform = `${orig} translateX(${shift}px)`;
      el.style.opacity = '0.65';

      setTimeout(() => {
        el.style.transform = orig;
        el.style.opacity = '';
        setTimeout(() => glitching.delete(el), 40);
      }, GLITCH_DURATION);
    });
  });

  // ---- Remote cursors ----
  // Other visitors' cursor positions are broadcast via socket.
  // Each remote cursor renders as a small glitch trace on the page.

  const remoteCursors = {};

  window.renderRemoteCursor = function(socketId, normX, normY) {
    const x = normX * window.innerWidth;
    const y = normY * window.innerHeight;

    // glitch text elements near the remote cursor position
    const candidates = document.querySelectorAll(
      '.entry p, .log-entry p, .entry-date, .log-date, .meta-key, .meta-val'
    );

    candidates.forEach(el => {
      if (glitching.has(el)) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.sqrt((cx - x)**2 + (cy - y)**2);
      if (dist > GLITCH_RADIUS) return;

      glitching.add(el);
      const orig = el.style.transform || '';
      const shift = (Math.random() - 0.5) * 3;
      el.style.transform = `${orig} translateX(${shift}px)`;
      el.style.opacity = '0.7';

      setTimeout(() => {
        el.style.transform = orig;
        el.style.opacity = '';
        setTimeout(() => glitching.delete(el), 40);
      }, 80);
    });

    // show a faint cursor dot
    if (!remoteCursors[socketId]) {
      const dot = document.createElement('div');
      dot.style.cssText = `
        position: fixed;
        width: 4px;
        height: 4px;
        background: rgba(232,220,200,0.4);
        border-radius: 50%;
        pointer-events: none;
        z-index: 9998;
        transition: left 0.1s linear, top 0.1s linear;
      `;
      document.body.appendChild(dot);
      remoteCursors[socketId] = dot;
    }
    remoteCursors[socketId].style.left = (x - 2) + 'px';
    remoteCursors[socketId].style.top  = (y - 2) + 'px';
  };

  window.removeRemoteCursor = function(socketId) {
    if (remoteCursors[socketId]) {
      remoteCursors[socketId].remove();
      delete remoteCursors[socketId];
    }
  };

})();
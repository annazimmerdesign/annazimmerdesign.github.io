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

  // ---- Persistent cursor trail canvas ----
  // Faint traces from all cursors accumulate permanently on a fixed canvas.
  // Saved per-page to Supabase site_state, restored on every visit.

  const trailCanvas = document.createElement('canvas');
  trailCanvas.style.cssText = `
    position: fixed; top: 0; left: 0;
    width: 100vw; height: 100vh;
    pointer-events: none; z-index: 9997;
    mix-blend-mode: multiply;
  `;
  document.body.appendChild(trailCanvas);

  function resizeTrailCanvas() {
    const tmp = document.createElement('canvas');
    tmp.width = trailCanvas.width;
    tmp.height = trailCanvas.height;
    tmp.getContext('2d').drawImage(trailCanvas, 0, 0);
    trailCanvas.width = window.innerWidth;
    trailCanvas.height = window.innerHeight;
    trailCanvas.getContext('2d').drawImage(tmp, 0, 0);
  }
  resizeTrailCanvas();
  window.addEventListener('resize', resizeTrailCanvas);

  const trailCtx = trailCanvas.getContext('2d');
  const prevTrailPos = {};

  function drawTrail(id, x, y) {
    const prev = prevTrailPos[id];
    if (prev) {
      trailCtx.beginPath();
      trailCtx.moveTo(prev.x, prev.y);
      trailCtx.lineTo(x, y);
      trailCtx.strokeStyle = 'rgba(0, 0, 0, 0.018)';
      trailCtx.lineWidth = 6;
      trailCtx.lineCap = 'round';
      trailCtx.stroke();
    }
    prevTrailPos[id] = { x, y };
  }

  // local cursor draws trail too
  document.addEventListener('mousemove', e => {
    drawTrail('_local', e.clientX, e.clientY);
  });

  // ---- Supabase trail persistence ----

  const _SUPA_URL = 'https://dkszxyudruaqtlhininm.supabase.co';
  const _SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U';
  const _SUPA_HEADERS = {
    'apikey': _SUPA_KEY,
    'Authorization': `Bearer ${_SUPA_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=minimal'
  };
  const _TRAIL_KEY = `trail_${window.location.pathname.split('/').pop() || 'index'}`;

  let _trailSaveTimer = null;
  function scheduleTrailSave() {
    if (_trailSaveTimer) return;
    _trailSaveTimer = setTimeout(async () => {
      _trailSaveTimer = null;
      // downsample to 512x512 to keep payload small
      const small = document.createElement('canvas');
      small.width = 512; small.height = 512;
      small.getContext('2d').drawImage(trailCanvas, 0, 0, 512, 512);
      const b64 = small.toDataURL('image/png');
      try {
        const check = await fetch(`${_SUPA_URL}/rest/v1/site_state?key=eq.${_TRAIL_KEY}&select=id`, { headers: _SUPA_HEADERS });
        const existing = await check.json();
        const payload = JSON.stringify({ key: _TRAIL_KEY, value: b64 });
        if (existing.length) {
          await fetch(`${_SUPA_URL}/rest/v1/site_state?key=eq.${_TRAIL_KEY}`, { method: 'PATCH', headers: _SUPA_HEADERS, body: payload });
        } else {
          await fetch(`${_SUPA_URL}/rest/v1/site_state`, { method: 'POST', headers: _SUPA_HEADERS, body: payload });
        }
      } catch(e) { console.warn('Trail save failed:', e); }
    }, 8000);
  }

  async function loadTrail() {
    try {
      const res = await fetch(`${_SUPA_URL}/rest/v1/site_state?key=eq.${_TRAIL_KEY}&select=value`, { headers: _SUPA_HEADERS });
      const rows = await res.json();
      if (rows.length && rows[0].value) {
        const img = new Image();
        img.onload = () => trailCtx.drawImage(img, 0, 0, trailCanvas.width, trailCanvas.height);
        img.src = rows[0].value;
      }
    } catch(e) { console.warn('Trail load failed:', e); }
  }
  loadTrail();

  let _trailMoveCount = 0;
  document.addEventListener('mousemove', () => {
    if (++_trailMoveCount % 20 === 0) scheduleTrailSave();
  });

  // ---- Remote cursors — trail only, no dot ----

  window.renderRemoteCursor = function(socketId, normX, normY) {
    const x = normX * window.innerWidth;
    const y = normY * window.innerHeight;
    remoteCursorPositions[socketId] = { x, y };
    drawTrail(socketId, x, y);
    scheduleTrailSave();
  };

  window.removeRemoteCursor = function(socketId) {
    delete remoteCursorPositions[socketId];
    delete prevTrailPos[socketId];
  };

})();
/**
 * sketch2.js — Dukhtar, Dispossessed
 * Live damage layer via Flask-SocketIO, Supabase as persistent fallback.
 */

const SOCKET_SERVER_URL = 'https://dukhtar-server.onrender.com';

const SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U';
const SUPABASE_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const GRID_W = 192;
const GRID_H = 192;
const BRUSH_RADIUS = 4;
const IMAGE_DAMAGE_THRESHOLD = 0.08;

let damageMap = new Float32Array(GRID_W * GRID_H);
let interactions = 0;
let connectedClients = 0;
let socketConnected = false;
let lastMouseGrid = { x: -1, y: -1 };
let lastDistortTime = 0;

// ---- Socket ----

let socket;

function initSocket() {
  socket = io(SOCKET_SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => {
    socketConnected = true;
    console.log('Socket connected:', socket.id);
  });

  socket.on('disconnect', () => {
    socketConnected = false;
    console.log('Socket disconnected — local mode');
  });

  socket.on('init', (data) => {
    if (data.damage_map) damageMap = new Float32Array(data.damage_map);
    interactions = data.interactions || 0;
    connectedClients = data.connected || 1;
    initCanvases();
    updateDisplay();
  });

  socket.on('damage_update', (data) => {
    if (data.affected) {
      for (const [idx, val] of data.affected) damageMap[idx] = val;
    }
    interactions = data.interactions || interactions;
    updateDisplay();

    document.querySelectorAll('.distort-canvas').forEach(canvas => {
      const r = canvas.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const gx = Math.floor((cx / window.innerWidth) * GRID_W);
      const gy = Math.floor((cy / window.innerHeight) * GRID_H);
      const dist = Math.sqrt((gx - data.gx) ** 2 + (gy - data.gy) ** 2);
      if (dist < BRUSH_RADIUS * 3) {
        const damage = getDamageAt(cx, cy);
        if (damage >= IMAGE_DAMAGE_THRESHOLD) distortCanvas(canvas, damage);
      }
    });
  });

  socket.on('presence', (data) => {
    connectedClients = data.connected || connectedClients;
    updatePresence();
  });

  socket.on('remote_cursor', (data) => {
    if (window.renderRemoteCursor) renderRemoteCursor(data.id, data.nx, data.ny);
  });

  socket.on('disconnect_peer', (data) => {
    if (window.removeRemoteCursor) removeRemoteCursor(data.id);
  });

  socket.on('connect_error', (err) => {
    console.warn('Socket failed, falling back to Supabase:', err.message);
    if (!socketConnected) loadFromSupabase();
  });
}

// ---- Supabase fallback ----

async function loadFromSupabase() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes,damage_map`,
      { headers: SUPABASE_HEADERS }
    );
    const data = await res.json();
    if (data && data[0]) {
      const row = data[0];
      interactions = row.passes || 0;
      if (row.damage_map) damageMap = new Float32Array(JSON.parse(row.damage_map));
      initCanvases();
      updateDisplay();
    }
  } catch (e) {
    console.warn('Supabase fallback failed — starting fresh:', e);
    initCanvases();
    updateDisplay();
  }
}

// ---- Damage helpers ----

function gridCoords(clientX, clientY) {
  return {
    gx: Math.floor((clientX / window.innerWidth) * GRID_W),
    gy: Math.floor((clientY / window.innerHeight) * GRID_H)
  };
}

function getDamageAt(clientX, clientY) {
  const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor((clientX / window.innerWidth) * GRID_W)));
  const gy = Math.max(0, Math.min(GRID_H - 1, Math.floor((clientY / window.innerHeight) * GRID_H)));
  return damageMap[gy * GRID_W + gx];
}

// ---- Canvas distortion ----
// Always redraws from original source so degradation is
// deterministic — same damage level always looks the same.

function distortCanvas(canvas, damage) {
  if (!canvas._loaded || !canvas._originalSrc) return;
  if (damage < IMAGE_DAMAGE_THRESHOLD) return;

  const fresh = new Image();
  fresh.onload = () => {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    // number of re-encoding passes — scales with damage, max ~100
    const passes = Math.floor(damage * 100);
    if (passes === 0) {
      ctx.drawImage(fresh, 0, 0, w, h);
      return;
    }

    // quality per pass — high enough that degradation is very gradual
    // at pass 1: q=0.92, pass 50: q=0.72, pass 100: q=0.52
    const quality = Math.max(0.35, 0.95 - passes * 0.006);

    // do the re-encoding chain synchronously on an offscreen canvas
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const octx = off.getContext('2d');
    octx.drawImage(fresh, 0, 0, w, h);

    // each iteration: export as JPEG at degrading quality, reimport
    let chain = Promise.resolve(off);

    const runPass = (sourceCanvas) => {
      return new Promise(resolve => {
        const dataURL = sourceCanvas.toDataURL('image/jpeg', quality);
        const img = new Image();
        img.onload = () => {
          const tmp = document.createElement('canvas');
          tmp.width = w; tmp.height = h;
          tmp.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(tmp);
        };
        img.src = dataURL;
      });
    };

    // chain the passes — but cap actual iterations at 12 for performance
    // we simulate 100 passes by lowering quality more aggressively per iteration
    const actualPasses = Math.min(12, passes);
    const passQuality = Math.max(0.3, 0.98 - (passes / 10) * 0.65);

    let p = Promise.resolve(off);
    for (let i = 0; i < actualPasses; i++) {
      p = p.then(c => {
        return new Promise(resolve => {
          const dataURL = c.toDataURL('image/jpeg', passQuality);
          const img = new Image();
          img.onload = () => {
            const tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            tmp.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(tmp);
          };
          img.src = dataURL;
        });
      });
    }

    p.then(final => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(final, 0, 0, w, h);
    });
  };
  fresh.src = canvas._originalSrc;
}

// ---- Canvas init ----

function initCanvases() {
  document.querySelectorAll('.distort-canvas').forEach((canvas, i) => {
    canvas._index = i;
    const ctx = canvas.getContext('2d');
    const src = canvas.dataset.src;
    if (!src) return;

    const img = new Image();
    img.onload = () => {
      const ratio = img.naturalHeight / img.naturalWidth;
      canvas.height = Math.round(canvas.width * ratio);
      canvas._loaded = true;
      canvas._originalSrc = src;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      setTimeout(() => {
      let maxDamage = 0;
      for (let i = 0; i < damageMap.length; i++) {
        if (damageMap[i] > maxDamage) maxDamage = damageMap[i];
      }
      if (maxDamage >= IMAGE_DAMAGE_THRESHOLD) distortCanvas(canvas, maxDamage);
      }, 300);
    };

    img.onerror = () => {
      canvas._loaded = true;
      canvas._originalSrc = src;
      ctx.fillStyle = '#2e1f12';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#5a4a3a';
      ctx.font = '11px Courier New';
      ctx.fillText(src || 'image not found', 10, canvas.height / 2);
    };

    img.src = src;
  });
}

// ---- Display ----

function updateDisplay() {
  distortText();
  const el = document.getElementById('interaction-count');
  if (el) el.textContent = interactions;
  const now = new Date();
  const estTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now);
  const modEl = document.getElementById('mod-date');
  if (modEl) modEl.textContent = estTime + ' EST';
}

function updatePresence() {
  const el = document.getElementById('presence-count');
  if (el) el.textContent = connectedClients;
}

// ---- Mouse ----

document.addEventListener('mousemove', e => {
  const { gx, gy } = gridCoords(e.clientX, e.clientY);
  if (gx === lastMouseGrid.x && gy === lastMouseGrid.y) return;
  lastMouseGrid = { x: gx, y: gy };

  if (socketConnected) {
    socket.emit('cursor_move', { gx, gy });
    socket.emit('cursor_position', { nx: e.clientX / window.innerWidth, ny: e.clientY / window.innerHeight });
  } else {
    for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
      for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > BRUSH_RADIUS) continue;
        const nx = gx + dx, ny = gy + dy;
        if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
        const idx = ny * GRID_W + nx;
        damageMap[idx] = Math.min(1.0, damageMap[idx] + 0.04 * (1 - dist / BRUSH_RADIUS));
      }
    }
    interactions++;
    updateDisplay();
  }

  // throttle canvas distortion to max once per 500ms to avoid thrashing
  const now = Date.now();
  if (now - lastDistortTime > 100) {
    lastDistortTime = now;
    document.querySelectorAll('.distort-canvas').forEach(canvas => {
      const r = canvas.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right &&
                     e.clientY >= r.top  && e.clientY <= r.bottom;
      if (inside) {
        const damage = getDamageAt(e.clientX, e.clientY);
        if (damage >= IMAGE_DAMAGE_THRESHOLD) distortCanvas(canvas, damage);
      }
    });
  }
});

// ---- Reset ----

async function resetArchive() {
  damageMap = new Float32Array(GRID_W * GRID_H);
  interactions = 0;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1`, {
      method: 'PATCH',
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ passes: 0, damage_map: null })
    });
  } catch (e) { console.warn('Reset failed:', e); }
  location.reload();
}

// ---- Boot ----

document.addEventListener('contentLoaded', () => {
  initSocket();
  setInterval(() => {
    fetch('https://dukhtar-server.onrender.com/health').catch(() => {});
  }, 4 * 60 * 1000);
});
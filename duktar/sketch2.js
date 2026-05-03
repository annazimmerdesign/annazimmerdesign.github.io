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

let damageMap = new Float32Array(GRID_W * GRID_H);
let interactions = 0;
let connectedClients = 0;
let socketConnected = false;
let lastMouseGrid = { x: -1, y: -1 };

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
  // register images now that socket is confirmed live
  setTimeout(registerImagesWithServer, 500);
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

  socket.on('image_update', (data) => {
    document.querySelectorAll('.distort-canvas').forEach(canvas => {
      const src = canvas.dataset.src || canvas.dataset.originalSrc;
      if (src && src.split('/').pop() === data.filename.split('/').pop()) {
        const img = new Image();
        img.onload = () => {
          canvas._originalSrc = data.data;
          const ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = data.data;
      }
    });
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

// Average damage within a pixel radius around a point.
// Used by distort-text so paragraphs respond to nearby cursor history,
// not just to cursors that land exactly on their center cell.
function getDamageNear(clientX, clientY, radiusPx = 120) {
  const gx = Math.floor((clientX / window.innerWidth) * GRID_W);
  const gy = Math.floor((clientY / window.innerHeight) * GRID_H);
  const gr = Math.max(1, Math.floor((radiusPx / window.innerWidth) * GRID_W));
  let total = 0, count = 0;
  for (let dy = -gr; dy <= gr; dy++) {
    for (let dx = -gr; dx <= gr; dx++) {
      const nx = Math.max(0, Math.min(GRID_W - 1, gx + dx));
      const ny = Math.max(0, Math.min(GRID_H - 1, gy + dy));
      total += damageMap[ny * GRID_W + nx];
      count++;
    }
  }
  return count ? total / count : 0;
}

// Canvas distortion handled server-side via databend

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

    // hover — light permanent bend pass for all visitors
let lastHoverEmit = 0;
canvas.addEventListener('mouseenter', () => {
  const now = Date.now();
  if (now - lastHoverEmit < 3000) return; // max once per 3 seconds per image
  lastHoverEmit = now;
  const filename = (canvas.dataset.src || '').split('/').pop();
  if (filename && socket && socketConnected) {
    socket.emit('image_click', { filename, type: 'hover' });
  }
});

// click — heavier permanent bend pass for all visitors  
canvas.addEventListener('click', () => {
  const filename = (canvas.dataset.src || '').split('/').pop();
  if (filename && socket && socketConnected) {
    socket.emit('image_click', { filename, type: 'click' });
  }
});
  });
}

function registerImagesWithServer() {
  document.querySelectorAll('.distort-canvas').forEach(canvas => {
    const src = canvas.dataset.src;
    if (src && socket && socketConnected) {
      const filename = src.split('/').pop();
      socket.emit('register_image', { filename });
    }
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
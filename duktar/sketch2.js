/**
 * sketch2.js — Dukhtar, Dispossessed
 * Live damage layer via Flask-SocketIO, Supabase as persistent fallback.
 * Change SOCKET_SERVER_URL to your PythonAnywhere URL when deploying.
 */

const SOCKET_SERVER_URL = 'https://dukhtar-server.onrender.com';

const SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U';
const SUPABASE_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

const GRID_W = 96;
const GRID_H = 96;
const BRUSH_RADIUS = 4;
const IMAGE_DAMAGE_THRESHOLD = 0.08;

let damageMap = new Float32Array(GRID_W * GRID_H);
let interactions = 0;
let connectedClients = 0;
let socketConnected = false;
let lastMouseGrid = { x: -1, y: -1 };
const insideCanvases = new Set();
const canvasStates = {};

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
    initCanvases({});
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

  socket.on('connect_error', (err) => {
    console.warn('Socket failed, falling back to Supabase:', err.message);
    if (!socketConnected) loadFromSupabase();
  });
}

// ---- Supabase fallback ----

async function loadFromSupabase() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes,damage_map,canvas1,canvas2,canvas3`,
      { headers: SUPABASE_HEADERS }
    );
    const data = await res.json();
    if (data && data[0]) {
      const row = data[0];
      interactions = row.passes || 0;
      if (row.damage_map) damageMap = new Float32Array(JSON.parse(row.damage_map));
      const saved = {};
      if (row.canvas1) saved[0] = row.canvas1;
      if (row.canvas2) saved[1] = row.canvas2;
      if (row.canvas3) saved[2] = row.canvas3;
      initCanvases(saved);
      updateDisplay();
    }
  } catch (e) {
    console.warn('Supabase fallback failed — starting fresh:', e);
    initCanvases({});
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

function distortCanvas(canvas, damage) {
  if (!canvas._loaded) return;
  if (damage < IMAGE_DAMAGE_THRESHOLD) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');
  const passes = Math.round(damage * 8);
  const scale = Math.max(0.5, 1 - passes * 0.025);
  octx.drawImage(canvas, 0, 0, w * scale, h * scale);
  octx.drawImage(off, 0, 0, w * scale, h * scale, 0, 0, w, h);
  const id = octx.getImageData(0, 0, w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * passes * 1.2;
    id.data[i] += n; id.data[i+1] += n; id.data[i+2] += n;
  }
  octx.putImageData(id, 0, 0);
  const quality = Math.max(0.4, 1 - damage * 0.6);
  const dataURL = off.toDataURL('image/jpeg', quality);
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    canvasStates[canvas._index] = dataURL;
  };
  img.src = dataURL;
}

function initCanvases(saved) {
  document.querySelectorAll('.distort-canvas').forEach((canvas, i) => {
    canvas._index = i;
    const ctx = canvas.getContext('2d');
    const src = canvas.dataset.src;
    const img = new Image();
    img.onload = () => {
      canvas._loaded = true;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const r = canvas.getBoundingClientRect();
      const damage = getDamageAt(r.left + r.width / 2, r.top + r.height / 2);
      if (damage >= IMAGE_DAMAGE_THRESHOLD) distortCanvas(canvas, damage);
    };
    img.onerror = () => {
      canvas._loaded = true;
      ctx.fillStyle = '#b0a090';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#3b2a1a';
      ctx.font = '11px Courier New';
      ctx.fillText(src || 'image not found', 10, canvas.height / 2);
    };
    img.src = saved[i] || src;
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
  } else {
    // local fallback
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

  document.querySelectorAll('.distort-canvas').forEach(canvas => {
    const r = canvas.getBoundingClientRect();
    const inside = e.clientX >= r.left && e.clientX <= r.right &&
                   e.clientY >= r.top  && e.clientY <= r.bottom;
    if (inside && !insideCanvases.has(canvas)) {
      insideCanvases.add(canvas);
      const damage = getDamageAt(e.clientX, e.clientY);
      if (damage >= IMAGE_DAMAGE_THRESHOLD) distortCanvas(canvas, damage);
    }
    if (!inside) insideCanvases.delete(canvas);
  });
});

// ---- Reset ----

async function resetArchive() {
  damageMap = new Float32Array(GRID_W * GRID_H);
  interactions = 0;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1`, {
      method: 'PATCH',
      headers: SUPABASE_HEADERS,
      body: JSON.stringify({ passes: 0, damage_map: null, canvas1: null, canvas2: null, canvas3: null })
    });
  } catch (e) { console.warn('Reset failed:', e); }
  location.reload();
}

// ---- Boot ----

document.addEventListener('contentLoaded', () => {
  initSocket();
  // socket 'init' event handles canvas setup once connected
  // connect_error falls back to Supabase
});
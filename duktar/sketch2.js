const SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

const GRID_W = 96;
const GRID_H = 96;
const BRUSH_RADIUS = 4;
const DAMAGE_PER_PASS = 0.04;
const MAX_DAMAGE = 1.0;
const IMAGE_DAMAGE_THRESHOLD = 0.08;

let damageMap = new Float32Array(GRID_W * GRID_H);
let interactions = 0;
let saveTimeout = null;
let lastMouseGrid = { x: -1, y: -1 };
const insideCanvases = new Set();
const canvasStates = {};

// ---- Supabase ----

async function loadState() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes%2Cdamage_map%2Ccanvas1%2Ccanvas2%2Ccanvas3`,
    { headers: HEADERS }
  );
  const data = await res.json();
  return data[0];
}

async function saveState() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({
      passes: interactions,
      damage_map: JSON.stringify(Array.from(damageMap)),
      canvas1: canvasStates[0] || null,
      canvas2: canvasStates[1] || null,
      canvas3: canvasStates[2] || null,
    })
  });
  console.log('saved:', res.status, 'interactions:', interactions);
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveState, 1500);
}

// ---- Damage map ----

function gridCoords(clientX, clientY) {
  return {
    gx: Math.floor((clientX / window.innerWidth) * GRID_W),
    gy: Math.floor((clientY / window.innerHeight) * GRID_H)
  };
}

function applyDamage(gx, gy) {
  for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
    for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > BRUSH_RADIUS) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
      const idx = ny * GRID_W + nx;
      damageMap[idx] = Math.min(MAX_DAMAGE, damageMap[idx] + DAMAGE_PER_PASS * (1 - dist / BRUSH_RADIUS));
    }
  }
}

function getDamageAt(clientX, clientY) {
  const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor((clientX / window.innerWidth) * GRID_W)));
  const gy = Math.max(0, Math.min(GRID_H - 1, Math.floor((clientY / window.innerHeight) * GRID_H)));
  return damageMap[gy * GRID_W + gx];
}

// ---- Canvas distortion — gradual, threshold-gated ----

function distortCanvas(canvas, damage) {
  if (!canvas._loaded) return;
  if (damage < IMAGE_DAMAGE_THRESHOLD) return;

  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;

  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const octx = off.getContext('2d');

  // conservative — damage 1.0 = 8 passes max
  const passes = Math.round(damage * 8);
  // gentle shrink — never below 50%
  const scale = Math.max(0.5, 1 - passes * 0.025);

  octx.drawImage(canvas, 0, 0, w * scale, h * scale);
  octx.drawImage(off, 0, 0, w * scale, h * scale, 0, 0, w, h);

  const id = octx.getImageData(0, 0, w, h);
  for (let i = 0; i < id.data.length; i += 4) {
    const n = (Math.random() - 0.5) * passes * 1.2;
    id.data[i] += n; id.data[i+1] += n; id.data[i+2] += n;
  }
  octx.putImageData(id, 0, 0);

  // quality never drops below 0.4
  const quality = Math.max(0.4, 1 - damage * 0.6);
  const dataURL = off.toDataURL('image/jpeg', quality);

  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    canvasStates[canvas._index] = dataURL;
    scheduleSave();
  };
  img.src = dataURL;
}

// ---- Init canvases ----

function initCanvases(saved) {
  document.querySelectorAll('.distort-canvas').forEach((canvas, i) => {
    canvas._index = i;
    const ctx = canvas.getContext('2d');
    const src = canvas.dataset.src;
    const img = new Image();
    img.onload = () => { canvas._loaded = true; ctx.drawImage(img, 0, 0, canvas.width, canvas.height); };
    img.onerror = () => {
      canvas._loaded = true;
      ctx.fillStyle = '#bec4cc';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#1a3a6b';
      ctx.font = '11px Courier New';
      ctx.fillText(src || 'image not found', 10, canvas.height / 2);
    };
    img.src = saved[i] || src;
  });
}

// ---- Update display ----

function updateDisplay() {
  distortText();
  document.getElementById('interaction-count').textContent = interactions;
  const now = new Date();
  const estTime = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(now);
  document.getElementById('mod-date').textContent = estTime + ' EST';
}

// ---- Mouse ----

document.addEventListener('mousemove', e => {
  const { gx, gy } = gridCoords(e.clientX, e.clientY);
  if (gx !== lastMouseGrid.x || gy !== lastMouseGrid.y) {
    lastMouseGrid = { x: gx, y: gy };
    applyDamage(gx, gy);
    interactions++;
    scheduleSave();
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
  canvasStates[0] = null; canvasStates[1] = null; canvasStates[2] = null;
  await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ passes: 0, damage_map: null, canvas1: null, canvas2: null, canvas3: null })
  });
  location.reload();
}

// ---- Boot ----

async function init() {
  const state = await loadState();
  const saved = {};
  if (state) {
    interactions = state.passes || 0;
    if (state.damage_map) damageMap = new Float32Array(JSON.parse(state.damage_map));
    if (state.canvas1) saved[0] = state.canvas1;
    if (state.canvas2) saved[1] = state.canvas2;
    if (state.canvas3) saved[2] = state.canvas3;
  }
  initCanvases(saved);
  updateDisplay();
}

document.addEventListener('contentLoaded', init);
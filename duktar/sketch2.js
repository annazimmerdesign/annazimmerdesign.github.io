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

let damageMap = new Float32Array(GRID_W * GRID_H);
let interactions = 0;
let saveTimeout = null;
let lastMouseGrid = { x: -1, y: -1 };
const insideCanvases = new Set();

// ---- Supabase ----

async function loadState() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes%2Cdamage_map`,
    { headers: HEADERS }
  );
  const data = await res.json();
  return data[0];
}

async function saveState() {
  await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({
      passes: interactions,
      damage_map: JSON.stringify(Array.from(damageMap))
    })
  });
}

function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveState, 1500);
}

// ---- Damage map ----

function gridCoords(clientX, clientY) {
  const gx = Math.floor((clientX / window.innerWidth) * GRID_W);
  const gy = Math.floor((clientY / window.innerHeight) * GRID_H);
  return { gx, gy };
}

function applyDamage(gx, gy) {
  for (let dy = -BRUSH_RADIUS; dy <= BRUSH_RADIUS; dy++) {
    for (let dx = -BRUSH_RADIUS; dx <= BRUSH_RADIUS; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > BRUSH_RADIUS) continue;
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
      const falloff = 1 - dist / BRUSH_RADIUS;
      const idx = ny * GRID_W + nx;
      damageMap[idx] = Math.min(MAX_DAMAGE, damageMap[idx] + DAMAGE_PER_PASS * falloff);
    }
  }
}

function getDamageAt(clientX, clientY) {
  const gx = Math.max(0, Math.min(GRID_W - 1, Math.floor((clientX / window.innerWidth) * GRID_W)));
  const gy = Math.max(0, Math.min(GRID_H - 1, Math.floor((clientY / window.innerHeight) * GRID_H)));
  return damageMap[gy * GRID_W + gx];
}

// ---- Canvas distortion — compounds on current state ----

function distortCanvas(canvas, damage) {
  const ctx = canvas.getContext('2d');
  if (!canvas._loaded) return;
  if (damage < 0.01) return;

  const w = canvas.width;
  const h = canvas.height;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  const shift = Math.floor(damage * 12);
  const noiseAmt = damage * 60;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * noiseAmt;
    data[i]     = Math.max(0, Math.min(255, data[i]     + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * 0.8));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 0.6));
  }

  if (shift > 0) {
    for (let y = 0; y < h; y++) {
      if (Math.random() > damage * 0.4) continue;
      const s = Math.floor((Math.random() - 0.5) * shift * 2);
      const rowCopy = new Uint8ClampedArray(w * 4);
      for (let x = 0; x < w; x++) {
        const src = ((x - s + w) % w) * 4;
        rowCopy[x * 4]     = data[y * w * 4 + src];
        rowCopy[x * 4 + 1] = data[y * w * 4 + src + 1];
        rowCopy[x * 4 + 2] = data[y * w * 4 + src + 2];
        rowCopy[x * 4 + 3] = data[y * w * 4 + src + 3];
      }
      for (let x = 0; x < w * 4; x++) {
        data[y * w * 4 + x] = rowCopy[x];
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

// ---- Text distortion ----

function distortText(damage) {
  const blocks = document.querySelectorAll('.text-block p');
  blocks.forEach(p => {
    if (!p._original) p._original = p.textContent;
    if (damage < 0.1) {
      p.textContent = p._original;
      return;
    }
    const chars = p._original.split('');
    const glitchChars = '░▒▓█▄▀■□▪▫∎∏∑∆∇∂∫≈≠≡±×÷';
    const corrupted = chars.map(c => {
      if (c === ' ') return c;
      if (Math.random() < damage * 0.15)
        return glitchChars[Math.floor(Math.random() * glitchChars.length)];
      return c;
    });
    p.textContent = corrupted.join('');
  });
}

// ---- Init canvases ----

function initCanvases() {
  document.querySelectorAll('.distort-canvas').forEach(canvas => {
    const src = canvas.dataset.src;
    const img = new Image();
    img.onload = () => {
      canvas._source = img;
      canvas._loaded = true;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      canvas._loaded = true;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#c0bbb2';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#888';
      ctx.font = '11px Courier New';
      ctx.fillText(src, 10, canvas.height / 2);
    };
    img.src = src;
  });
}

// ---- Update display ----

function updateDisplay() {
  const avgDamage = damageMap.reduce((a, b) => a + b, 0) / damageMap.length;
  distortText(avgDamage * 8);

  const integrity = Math.max(0, Math.round((1 - avgDamage * 8) * 100));
  document.getElementById('interaction-count').textContent = interactions;
  document.getElementById('integrity').textContent = integrity + '%';
  document.getElementById('mod-date').textContent = new Date().toISOString().split('T')[0];
}

// ---- Mouse handler ----

document.addEventListener('mousemove', (e) => {
  const { gx, gy } = gridCoords(e.clientX, e.clientY);

  if (gx !== lastMouseGrid.x || gy !== lastMouseGrid.y) {
    lastMouseGrid = { gx, gy };
    applyDamage(gx, gy);
    interactions++;
    scheduleSave();
    updateDisplay();
  }

  document.querySelectorAll('.distort-canvas').forEach(canvas => {
    const rect = canvas.getBoundingClientRect();
    const inside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top  && e.clientY <= rect.bottom;

    if (inside && !insideCanvases.has(canvas)) {
      insideCanvases.add(canvas);
      const damage = getDamageAt(e.clientX, e.clientY);
      distortCanvas(canvas, Math.max(damage, 0.05));
    }

    if (!inside) {
      insideCanvases.delete(canvas);
    }
  });
});

// ---- Boot ----

async function init() {
  initCanvases();

  const state = await loadState();
  if (state) {
    interactions = state.passes || 0;
    if (state.damage_map) {
      const parsed = JSON.parse(state.damage_map);
      damageMap = new Float32Array(parsed);
    }
  }

  updateDisplay();
}

init();
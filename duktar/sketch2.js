const SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U';

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

// damage map resolution — lower = faster, coarser damage
const GRID_W = 96;
const GRID_H = 96;
const BRUSH_RADIUS = 4; // grid cells
const DAMAGE_PER_PASS = 0.04;
const MAX_DAMAGE = 1.0;

let damageMap = new Float32Array(GRID_W * GRID_H);
let interactions = 0;
let saveTimeout = null;
let lastMouseGrid = { x: -1, y: -1 };

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

// debounced save — waits 1.5s after last interaction before writing
function scheduleSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveState, 1500);
}

// ---- Damage map helpers ----

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
  const { gx, gy } = gridCoords(clientX, clientY);
  const gxc = Math.max(0, Math.min(GRID_W - 1, gx));
  const gyc = Math.max(0, Math.min(GRID_H - 1, gy));
  return damageMap[gyc * GRID_W + gxc];
}

// ---- Canvas distortion ----

function distortCanvas(canvas, damage) {
  const ctx = canvas.getContext('2d');
  if (!canvas._loaded) return;

  const w = canvas.width;
  const h = canvas.height;

  // redraw original
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(canvas._source, 0, 0, w, h);

  if (damage < 0.01) return;

  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;

  // pixel shift + noise based on damage level
  const shift = Math.floor(damage * 12);
  const noiseAmt = damage * 60;

  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * noiseAmt;
    data[i]     = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise * 0.8));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise * 0.6));
  }

  // horizontal scan line displacement
  if (shift > 0) {
    for (let y = 0; y < h; y++) {
      if (Math.random() > damage * 0.4) continue;
      const s = Math.floor((Math.random() - 0.5) * shift * 2);
      const row = new Uint8ClampedArray(data.buffer, y * w * 4, w * 4);
      const shifted = new Uint8ClampedArray(w * 4);
      for (let x = 0; x < w; x++) {
        const src = ((x - s + w) % w) * 4;
        shifted[x * 4]     = row[src];
        shifted[x * 4 + 1] = row[src + 1];
        shifted[x * 4 + 2] = row[src + 2];
        shifted[x * 4 + 3] = row[src + 3];
      }
      for (let x = 0; x < w * 4; x++) {
        data[y * w * 4 + x] = shifted[x];
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
    const corrupted = chars.map(c => {
      if (c === ' ' || Math.random() > damage * 0.3) return c;
      const glitchChars = '░▒▓█▄▀■□▪▫∎∏∑∆∇∂∫≈≠≡±×÷';
      return Math.random() < damage * 0.15
        ? glitchChars[Math.floor(Math.random() * glitchChars.length)]
        : c;
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
    img.src = src;
  });
}

// ---- Update display ----

function updateDisplay(mouseX, mouseY) {
  const canvases = document.querySelectorAll('.distort-canvas');

  canvases.forEach(canvas => {
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    // get damage at canvas center position
    const damage = getDamageAt(centerX, centerY);
    distortCanvas(canvas, damage);
  });

  // average damage for text
  const avgDamage = damageMap.reduce((a, b) => a + b, 0) / damageMap.length;
  distortText(avgDamage * 8); // amplified so text reacts faster

  // update footer
  const integrity = Math.max(0, Math.round((1 - avgDamage * 8) * 100));
  document.getElementById('interaction-count').textContent = interactions;
  document.getElementById('integrity').textContent = integrity + '%';

  // update mod date
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
    updateDisplay(e.clientX, e.clientY);
  }
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

  updateDisplay(0, 0);
}

init();
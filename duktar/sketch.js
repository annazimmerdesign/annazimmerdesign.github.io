const SUPABASE_URL = 'https://dkszxyudruaqtlhininm.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrc3p4eXVkcnVhcXRsaGluaW5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzODcwNzEsImV4cCI6MjA5MDk2MzA3MX0.mjtPxo0yvpPedV0vTlJ4qIZ5vOYHTnkGlfSR27yx4-U';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

async function loadState() {
const res = await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1&select=passes%2Cimage_data`, { headers });  const data = await res.json();
  return data[0];
}

async function saveState(passes, imageData) {
  await fetch(`${SUPABASE_URL}/rest/v1/archive_state?id=eq.1`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ passes, image_data: imageData })
  });
}

new p5(function(p) {
  let img;
  let offscreen;
  let quality = 1.0;
  let passes = 0;
  let wasOutside = true;
  let ready = false;

  const MIN_QUALITY = 0.02;
  const DECAY = 0.08;

  p.preload = function() {
    img = p.loadImage('duktar.jpg');
  };

  p.setup = async function() {
    let cnv = p.createCanvas(420, 520);
    cnv.parent('sketch-container');
    p.noLoop();

    offscreen = document.createElement('canvas');
    offscreen.width = 420;
    offscreen.height = 520;

    // load persisted state
    const state = await loadState();
    if (state) {
      passes = state.passes || 0;
      const passesEl = document.getElementById('passes');
      if (passesEl) passesEl.textContent = passes;

      if (state.image_data) {
        p.loadImage(state.image_data, function(savedImg) {
          img = savedImg;
          ready = true;
          p.redraw();
        });
      } else {
        ready = true;
        p.redraw();
      }
    } else {
      ready = true;
      p.redraw();
    }
  };

  p.draw = function() {
    p.background(14, 13, 11);
    if (img) {
      p.image(img, 0, 0, 420, 520);
    }
  };

  p.mouseMoved = function() {
    if (!ready) return;

    const inside =
      p.mouseX >= 0 && p.mouseX <= p.width &&
      p.mouseY >= 0 && p.mouseY <= p.height;

    if (inside && wasOutside) {
      wasOutside = false;
      degradeOnce();
    }

    if (!inside) wasOutside = true;
  };

  function degradeOnce() {
    quality = Math.max(MIN_QUALITY, quality - DECAY);
    passes++;

    const passesEl = document.getElementById('passes');
    if (passesEl) passesEl.textContent = passes;

    const ctx = offscreen.getContext('2d');
    ctx.clearRect(0, 0, 420, 520);

    const source = img.canvas || img.elt;
    const scale = Math.max(0.1, 1 - passes * 0.05);
    const w = 420 * scale;
    const h = 520 * scale;

    ctx.drawImage(source, 0, 0, w, h);
    ctx.drawImage(offscreen, 0, 0, w, h, 0, 0, 420, 520);

    const imageData = ctx.getImageData(0, 0, 420, 520);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * passes * 2;
      data[i] += noise;
      data[i+1] += noise;
      data[i+2] += noise;
    }
    ctx.putImageData(imageData, 0, 0);

    encode();
  }

  function encode() {
    const dataURL = offscreen.toDataURL('image/jpeg', quality);

    p.loadImage(dataURL, async function(newImg) {
      img = newImg;
      p.redraw();
      await saveState(passes, dataURL);
    });
  }

}, document.getElementById('sketch-container'));
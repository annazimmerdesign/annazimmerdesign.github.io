new p5(function(p) {
  let img;
  let offscreen;
  let quality = 1.0;
  let passes = 0;
  let firstPass = true;
  let wasOutside = true;

  const MIN_QUALITY = 0.02;
  const DECAY = 0.08; 

  p.preload = function() {
    img = p.loadImage('duktar.jpg');
  };

  p.setup = function() {
    let cnv = p.createCanvas(420, 520);
    cnv.parent('sketch-container');
    p.noLoop();

    offscreen = document.createElement('canvas');
    offscreen.width = 420;
    offscreen.height = 520;
  };

  p.draw = function() {
    p.background(14, 13, 11);

    if (img) {
      p.image(img, 0, 0, 420, 520);
    }
  };

  p.mouseMoved = function() {
    const inside =
      p.mouseX >= 0 && p.mouseX <= p.width &&
      p.mouseY >= 0 && p.mouseY <= p.height;

    if (inside && wasOutside) {
      wasOutside = false;
      degradeOnce();
    }

    if (!inside) wasOutside = true;
  };
//just compression version... plateuas at 12 passes
// function degradeOnce() {
//   quality = Math.max(MIN_QUALITY, quality - DECAY);
//   passes++;

//   console.log("Pass:", passes, "Quality:", quality);

//   const passesEl = document.getElementById('passes');
//   if (passesEl) passesEl.textContent = passes;

//   const ctx = offscreen.getContext('2d');
//   ctx.clearRect(0, 0, 420, 520);

//   const source = img.canvas || img.elt;

//   ctx.drawImage(source, 0, 0, 420, 520);

//   encode();
// }

//redieces and reexpands then compresses... plataeus around 24 passes
function degradeOnce() {
  quality = Math.max(MIN_QUALITY, quality - DECAY);
  passes++;

  console.log("Pass:", passes, "Quality:", quality);

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

// extra noise..?
    const imageData = ctx.getImageData(0, 0, 420, 520);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * passes * 2;
    data[i] += noise;     // R
    data[i+1] += noise;   // G
    data[i+2] += noise;   // B
    }

    ctx.putImageData(imageData, 0, 0);
    //okay thattttt fixed it now the degradation efect is neverending...
    //even though it does eventualy just end up looking like perlin noise...
    //so we will need a fix for that eventually but this works find for prorotype 0.5
  encode();
}


  function encode() {
    const dataURL = offscreen.toDataURL('image/jpeg', quality);

    p.loadImage(dataURL, function(newImg) {
      img = newImg;
      p.redraw();
    });
  }

}, document.getElementById('sketch-container'));
// distort-text.js
// Deterministic archival text degradation.
// Every visitor at the same damage level sees the same corrupted text —
// the archive is on a fixed trajectory, not randomly degrading per session.
// Seeded LCG ensures identical output for identical (paragraph, damage) pairs.

const OCR_SUBS = {
  'a': ['o', 'e', 'ci'], 'b': ['h', 'li', 'k'], 'c': ['e', 'o'],
  'd': ['cl', 'ol'], 'e': ['c', 'a'], 'f': ['t', 'fi'],
  'g': ['q', 'y'], 'h': ['li', 'n'], 'i': ['l', '1'],
  'l': ['1', 'i'], 'm': ['rn', 'ni'], 'n': ['ri', 'ni'],
  'o': ['0', 'u'], 'p': ['q'], 'q': ['g', 'p'],
  'r': ['n', 'ri'], 's': ['5', 'z'], 't': ['f', '+'],
  'u': ['n', 'v'], 'v': ['u', 'y'], 'w': ['vv', 'vu'],
  'x': ['k'], 'y': ['v'], 'z': ['s', '2'],
};

const WORD_SUBS = {
  'child': ['subject', 'minor', 'ward'],
  'mother': ['female guardian', 'maternal unit'],
  'father': ['male guardian', 'paternal unit'],
  'name': ['designation', 'identifier'],
  'born': ['registered', 'documented'],
  'home': ['place of origin', 'domicile'],
  'family': ['unit', 'household'],
  'health': ['condition', 'status'],
  'good': ['satisfactory', 'adequate'],
  'normal': ['within parameters', 'standard'],
  'age': ['recorded age', 'estimated age'],
  'date': ['timestamp', 'recorded date'],
  'record': ['file', 'entry'],
  'document': ['record', 'filing'],
  'subject': ['individual', 'case'],
  'origin': ['provenance', 'source'],
  'unknown': ['unverified', 'redacted'],
};

// ---- Seeded LCG ----
// Returns a deterministic pseudo-random float [0,1) for a given seed.
// Advancing the seed with next() gives the next value in the sequence.

function lcg(seed) {
  return {
    seed,
    next() {
      this.seed = (this.seed * 9301 + 49297) % 233280;
      return this.seed / 233280;
    }
  };
}

// Generate a stable integer seed from a paragraph's text content.
// Same text always produces the same seed.
function textSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// How many corruption steps to apply at a given damage level.
// Damage is 0–1; steps increase non-linearly so early damage is subtle.
function stepsForDamage(damage) {
  return Math.floor(Math.pow(damage, 0.7) * 40);
}

// Apply exactly N corruption steps to a word array using a seeded RNG.
// This is deterministic: same words + same seed + same steps = same result.
function applyCorruptions(words, steps, rng) {
  const result = [...words];
  for (let s = 0; s < steps; s++) {
    const idx = Math.floor(rng.next() * result.length);
    const word = result[idx];
    const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();
    const roll = rng.next();

    // high steps: delete word
    if (steps > 20 && roll < 0.15) {
      result[idx] = '\u00a0'.repeat(word.length);
      continue;
    }

    // medium steps: bureaucratic substitution
    if (steps > 8 && WORD_SUBS[clean] && roll < 0.35) {
      const subs = WORD_SUBS[clean];
      result[idx] = subs[Math.floor(rng.next() * subs.length)];
      continue;
    }

    // OCR character corruption
    result[idx] = word.split('').map(c => {
      const lower = c.toLowerCase();
      if (OCR_SUBS[lower] && rng.next() < 0.55) {
        const opts = OCR_SUBS[lower];
        const sub = opts[Math.floor(rng.next() * opts.length)];
        return c === c.toUpperCase() ? sub.toUpperCase() : sub;
      }
      return c;
    }).join('');
  }

  // sentence reorder at high damage
  if (steps > 28 && rng.next() < 0.4) {
    const text = result.join('');
    const sentences = text.match(/[^.!?]+[.!?]*/g);
    if (sentences && sentences.length > 1) {
      const i = Math.floor(rng.next() * (sentences.length - 1));
      [sentences[i], sentences[i + 1]] = [sentences[i + 1], sentences[i]];
      return sentences.join(' ').split(/(\s+)/);
    }
  }

  return result;
}

// per-paragraph cache: stores the last damage level and resulting corrupted words
const paragraphCache = new WeakMap();

const DAMAGE_STEP = 0.001;

function distortText() {
  document.querySelectorAll('.entry p, .entry-text, .text-block p, .log-entry p, .about-para').forEach(p => {

    if (!paragraphCache.has(p)) {
      const original = p.textContent.trim();
      if (!original) return;
      paragraphCache.set(p, {
        original,
        originalWords: original.split(/(\s+)/),
        seed: textSeed(original),
        lastDamage: -1,
        lastSteps: -1,
      });
    }

    const cache = paragraphCache.get(p);
    const rect = p.getBoundingClientRect();

    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    // Use neighbourhood average so text responds to cursor history
    // within ~120px, not just the single cell at the paragraph center.
    const damage = typeof getDamageNear === 'function'
      ? getDamageNear(cx, cy, 120)
      : (typeof getDamageAt === 'function' ? getDamageAt(cx, cy) : 0);

    if (damage - cache.lastDamage < DAMAGE_STEP) return;

    const steps = stepsForDamage(damage);
    if (steps === cache.lastSteps) return;

    const rng = lcg(cache.seed + steps * 7919);
    const corrupted = applyCorruptions(cache.originalWords, steps, rng);

    cache.lastDamage = damage;
    cache.lastSteps = steps;
    p.textContent = corrupted.join('');
  });
}
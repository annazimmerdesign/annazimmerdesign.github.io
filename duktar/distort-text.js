// distort-text.js
// Gradual, persistent, localized archival text degradation
// Each paragraph accumulates damage independently based on local damage map position
// Changes are slow and subtle — one small corruption per threshold crossing

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
};

// per-paragraph state: tracks current corrupted text and last damage level applied
const paragraphState = new WeakMap();

// how much damage must accumulate before another corruption step fires
const DAMAGE_STEP = 0.05;
// how many characters/words to corrupt per step
const CHARS_PER_STEP = 2;

function ocrCorrupt(word) {
  return word.split('').map(c => {
    const lower = c.toLowerCase();
    if (OCR_SUBS[lower] && Math.random() < 0.6) {
      const sub = OCR_SUBS[lower][Math.floor(Math.random() * OCR_SUBS[lower].length)];
      return c === c.toUpperCase() ? sub.toUpperCase() : sub;
    }
    return c;
  }).join('');
}

function applyOneCorruption(words, damage) {
  // pick a random word index to corrupt
  const idx = Math.floor(Math.random() * words.length);
  const word = words[idx];
  const clean = word.replace(/[^a-zA-Z]/g, '').toLowerCase();

  const roll = Math.random();

  // high damage: delete word (replace with spaces)
  if (damage > 0.5 && roll < 0.25) {
    words[idx] = '\u00a0'.repeat(word.length);
    return;
  }

  // medium damage: bureaucratic substitution
  if (damage > 0.25 && WORD_SUBS[clean] && roll < 0.4) {
    const subs = WORD_SUBS[clean];
    words[idx] = subs[Math.floor(Math.random() * subs.length)];
    return;
  }

  // low damage: OCR letter corruption
  words[idx] = ocrCorrupt(word);
}

function distortText() {
    document.querySelectorAll('.entry p, .text-block p, .log-entry p').forEach(p => {    // init state for this paragraph
    if (!paragraphState.has(p)) {
      paragraphState.set(p, {
        original: p.textContent.trim(),
        words: p.textContent.trim().split(/(\s+)/),
        lastDamage: 0,
        corruptions: 0
      });
    }

    const state = paragraphState.get(p);
    const rect = p.getBoundingClientRect();

    // only process paragraphs currently in viewport
    if (rect.bottom < 0 || rect.top > window.innerHeight) return;

    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const damage = typeof getDamageAt === 'function' ? getDamageAt(cx, cy) : 0;

    // only corrupt if damage has grown enough since last corruption
    if (damage - state.lastDamage < DAMAGE_STEP) return;

    // apply one corruption step
    for (let i = 0; i < CHARS_PER_STEP; i++) {
      applyOneCorruption(state.words, damage);
    }

    // high damage: occasionally reorder two adjacent sentences
    if (damage > 0.6 && Math.random() < 0.05) {
      const text = state.words.join('');
      const sentences = text.match(/[^.!?]+[.!?]*/g);
      if (sentences && sentences.length > 1) {
        const i = Math.floor(Math.random() * (sentences.length - 1));
        [sentences[i], sentences[i + 1]] = [sentences[i + 1], sentences[i]];
        state.words = sentences.join(' ').split(/(\s+)/);
      }
    }

    state.lastDamage = damage;
    p.textContent = state.words.join('');
  });
}
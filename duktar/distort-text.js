// distort-text.js
// Archival text degradation — OCR errors, deletions, word substitution, sentence reordering
// Expects getDamageAt(cx, cy) to be available from sketch2.js

// OCR-style visual substitutions — letters that look alike when scanned
const OCR_SUBS = {
  'a': ['o', 'e', 'ci'],
  'b': ['h', 'li', 'k'],
  'c': ['e', 'o', 'c'],
  'd': ['cl', 'di', 'ol'],
  'e': ['c', 'a', 'ei'],
  'f': ['t', 'fi', 'f'],
  'g': ['q', 'gi', 'y'],
  'h': ['li', 'n', 'h'],
  'i': ['l', '1', 'i'],
  'l': ['1', 'i', 'li'],
  'm': ['rn', 'ni', 'in'],
  'n': ['ri', 'ni', 'n'],
  'o': ['0', 'u', 'c'],
  'p': ['pi', 'p', 'q'],
  'q': ['g', 'qi', 'p'],
  'r': ['n', 'ri', 'r'],
  's': ['5', 'si', 'z'],
  't': ['f', 'ti', '+'],
  'u': ['n', 'ui', 'v'],
  'v': ['u', 'vi', 'y'],
  'w': ['vv', 'wi', 'vu'],
  'x': ['xi', 'k', 'x'],
  'y': ['v', 'yi', 'y'],
  'z': ['s', 'zi', '2'],
};

// Words that get substituted — bureaucratic/wrong-register replacements
const WORD_SUBS = {
  'child': ['subject', 'minor', 'ward'],
  'mother': ['female guardian', 'maternal unit', 'parent'],
  'father': ['male guardian', 'paternal unit', 'parent'],
  'name': ['designation', 'identifier', 'label'],
  'born': ['registered', 'documented', 'recorded'],
  'home': ['place of origin', 'domicile', 'residence'],
  'family': ['unit', 'household', 'group'],
  'health': ['condition', 'status', 'state'],
  'good': ['satisfactory', 'acceptable', 'adequate'],
  'normal': ['within parameters', 'standard', 'typical'],
  'age': ['date of registration', 'recorded age', 'estimated age'],
  'date': ['timestamp', 'recorded date', 'filing date'],
};

function ocrCorrupt(word, intensity) {
  return word.split('').map(c => {
    const lower = c.toLowerCase();
    if (OCR_SUBS[lower] && Math.random() < intensity * 0.3) {
      const sub = OCR_SUBS[lower][Math.floor(Math.random() * OCR_SUBS[lower].length)];
      return c === c.toUpperCase() ? sub.toUpperCase() : sub;
    }
    return c;
  }).join('');
}

function degradeParagraph(text, damage) {
  if (damage <= 0) return text;

  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];

  // high damage: reorder sentences
  if (damage > 0.6 && sentences.length > 1 && Math.random() < damage * 0.4) {
    for (let i = sentences.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sentences[i], sentences[j]] = [sentences[j], sentences[i]];
    }
  }

  return sentences.map(sentence => {
    const words = sentence.split(/(\s+)/);
    return words.map((token, i) => {
      if (/^\s+$/.test(token)) return token;

      const clean = token.replace(/[^a-zA-Z]/g, '').toLowerCase();

      // word deletion — replaced with blank spaces preserving length
      if (damage > 0.2 && Math.random() < damage * 0.12) {
        return '\u00a0'.repeat(token.length);
      }

      // bureaucratic word substitution
      if (damage > 0.15 && WORD_SUBS[clean] && Math.random() < damage * 0.35) {
        const subs = WORD_SUBS[clean];
        return subs[Math.floor(Math.random() * subs.length)];
      }

      // OCR letter corruption
      if (damage > 0.05 && Math.random() < damage * 0.25) {
        return ocrCorrupt(token, damage);
      }

      return token;
    }).join('');
  }).join(' ');
}

function distortText() {
  document.querySelectorAll('.entry p, .text-block p').forEach(p => {
    if (!p._original) p._original = p.textContent.trim();

    const rect = p.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const damage = typeof getDamageAt === 'function' ? getDamageAt(cx, cy) : 0;

    if (damage < 0.02) {
      p.textContent = p._original;
      return;
    }

    p.textContent = degradeParagraph(p._original, damage);
  });
}
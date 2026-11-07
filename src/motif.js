// Utilitaires musicaux déterministes (partagés par le moteur et le storyboard).
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedOf = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

// Leitmotif : suite de degrés de gamme (0 = tonique, négatif = grave). Même clé => même mélodie.
export function makeMotif(key, { min = 6, spread = 3, lo = -2, hi = 7 } = {}) {
  const r = mulberry32(seedOf(key));
  const len = min + Math.floor(r() * spread);
  const m = [0];
  for (let i = 1; i < len; i++) m.push(Math.max(lo, Math.min(hi, m[i - 1] + Math.round((r() - 0.5) * 5))));
  return m;
}

export const CHARACTER_INSTRUMENTS = ['flute', 'bell', 'strings', 'brass', 'pluck'];

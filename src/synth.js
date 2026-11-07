// Synthèse pure (sans Web Audio) : testable hors navigateur.

// Corde pincée de Karplus-Strong : une salve de bruit rebouclée dans une ligne à retard filtrée.
// Retourne { data, nominalHz } : la hauteur réelle est sr / (N + 0.5) (le filtre moyenneur retarde d'un demi-échantillon) ;
// jouer le tampon avec playbackRate = f / nominalHz corrige l'écart.
export function karplusStrong(freq, sampleRate, seconds, { seed = 1, damping = 0.997, brightness = 0.6 } = {}) {
  const N = Math.max(2, Math.round(sampleRate / freq - 0.5));
  const len = Math.floor(seconds * sampleRate), out = new Float32Array(len);
  let r = seed >>> 0 || 1; // xorshift32 : déterministe
  const rnd = () => { r ^= r << 13; r >>>= 0; r ^= r >>> 17; r ^= r << 5; r >>>= 0; return r / 4294967296 * 2 - 1; };
  const line = new Float32Array(N);
  let prev = 0;
  for (let i = 0; i < N; i++) { const x = rnd(); prev = prev + (x - prev) * brightness; line[i] = prev; } // salve adoucie
  let k = 0;
  for (let i = 0; i < len; i++) {
    const cur = line[k], nxt = line[(k + 1) % N];
    out[i] = cur;
    line[k] = damping * 0.5 * (cur + nxt);
    k = (k + 1) % N;
  }
  let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < len; i++) out[i] /= peak;
  return { data: out, nominalHz: sampleRate / (N + 0.5) };
}

// Période estimée par autocorrélation (échantillons) sur la fenêtre [from, from+win).
export function estimatePeriod(data, from, win, minP, maxP) {
  let best = minP, bv = -Infinity;
  for (let p = minP; p <= maxP; p++) {
    let s = 0; for (let i = from; i < from + win; i++) s += data[i] * data[i + p];
    if (s > bv) { bv = s; best = p; }
  }
  return best;
}

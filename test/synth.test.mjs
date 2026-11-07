import assert from 'node:assert/strict';
import { karplusStrong, estimatePeriod } from '../src/synth.js';

const SR = 44100;
for (const f of [110, 220, 440, 880]) {
  const { data, nominalHz } = karplusStrong(f, SR, 1.5, { seed: 7 });
  assert.ok(data.every(Number.isFinite), 'valeurs finies');
  assert.ok(Math.max(...data.map(Math.abs)) <= 1 + 1e-6, 'normalisé');
  // la hauteur réelle est proche de la fréquence demandée (< 1,5 %) et corrigible exactement par playbackRate
  assert.ok(Math.abs(nominalHz / f - 1) < 0.015, `${f} Hz -> ${nominalHz.toFixed(1)}`);
  const p = estimatePeriod(data, 2000, 2000, Math.floor(SR / (f * 1.1)), Math.ceil(SR / (f * 0.9)));
  assert.ok(Math.abs(SR / p / nominalHz - 1) < 0.02, `période mesurée ${f} Hz : ${(SR / p).toFixed(1)} vs ${nominalHz.toFixed(1)}`);
  // la corde s'éteint : énergie en fin de note nettement inférieure au début
  const rms = (a, b) => Math.sqrt(data.slice(a, b).reduce((s, x) => s + x * x, 0) / (b - a));
  assert.ok(rms(data.length - 4000, data.length) < 0.6 * rms(0, 4000), `extinction à ${f} Hz`);
}
// déterminisme et variété
const a = karplusStrong(220, SR, 0.2, { seed: 3 }).data, b = karplusStrong(220, SR, 0.2, { seed: 3 }).data, c = karplusStrong(220, SR, 0.2, { seed: 4 }).data;
assert.deepEqual(a, b); assert.notDeepEqual(a, c);
// plus de brillance => plus d'énergie dans les aigus (différence première)
const hf = (d) => d.slice(1, 3000).reduce((s, x, i) => s + Math.abs(x - d[i]), 0);
assert.ok(hf(karplusStrong(220, SR, 0.2, { brightness: 1 }).data) > hf(karplusStrong(220, SR, 0.2, { brightness: 0.2 }).data));
console.log('OK — synth');

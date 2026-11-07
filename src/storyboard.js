// Mode 2 — analyse globale : storyboard musical d'un texte entier.
//   buildStoryboard(sentences, sentScore, { detectPlace }) -> plan
// Le plan est entièrement calculé à l'avance, phrase par phrase : la musique y est
// composée (introduction → développement → paroxysme → résolution) au lieu de réagir.

import { detectPlace as lexPlace, isHeading } from './analyzer.js';
import { Modulator } from './modulation.js';
import { makeMotif, seedOf, CHARACTER_INSTRUMENTS } from './motif.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

// Moyenne mobile triangulaire (rayon r).
function smooth(arr, r = 2) {
  return arr.map((_, i) => {
    let s = 0, w = 0;
    for (let k = -r; k <= r; k++) {
      const v = arr[i + k]; if (v === undefined) continue;
      const ww = r + 1 - Math.abs(k); s += v * ww; w += ww;
    }
    return s / w;
  });
}

// --- Personnages : noms propres (majuscule hors début de phrase, jamais vus en minuscules) ------
const WORD = /\p{L}[\p{L}'’-]*/gu;

export function detectCharacters(sentences, { minCount = 2, max = 4, extra = [] } = {}) {
  const lower = new Set(), mid = new Set(), count = new Map();
  const per = sentences.map((s) => {
    const words = s.match(WORD) ?? [];
    const found = [];
    words.forEach((w, idx) => {
      const key = w.toLowerCase();
      if (w === key) { lower.add(key); return; }
      const cap = w[0] === w[0].toUpperCase() && w.slice(1) === w.slice(1).toLowerCase();
      const shout = w.length >= 3 && w === w.toUpperCase();
      if (cap || shout) { found.push(key); if (cap && idx > 0) mid.add(key); }
    });
    return found;
  });
  for (const f of per) for (const k of new Set(f)) count.set(k, (count.get(k) ?? 0) + 1);
  const names = [...count.entries()]
    .filter(([k, c]) => c >= minCount && mid.has(k) && !lower.has(k) && !lexPlace(k))
    .sort((a, b) => b[1] - a[1]).slice(0, max)
    .map(([k, c]) => ({
      id: k, name: k[0].toUpperCase() + k.slice(1), count: c,
      motif: makeMotif('char:' + k, { min: 5, spread: 3, lo: 0, hi: 9 }),
      instrument: CHARACTER_INSTRUMENTS[Math.abs(seedOf(k)) % CHARACTER_INSTRUMENTS.length],
    }));
  const ids = new Set(names.map((n) => n.id));
  const perSentence = per.map((f) => [...new Set(f)].filter((k) => ids.has(k)));
  // Personnages déclarés par l'utilisateur (noms communs, minuscules : « loup », « chien »…), pluriels compris.
  for (const raw of extra) {
    const id = raw.trim().toLowerCase(); if (!id || ids.has(id)) continue;
    const re = new RegExp(`(?<![\\p{L}])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|x)?(?![\\p{L}])`, 'iu');
    let count = 0;
    sentences.forEach((sen, i) => { if (re.test(sen)) { count++; perSentence[i].push(id); } });
    if (!count) continue;
    ids.add(id);
    names.push({ id, name: id[0].toUpperCase() + id.slice(1), count, declared: true,
      motif: makeMotif('char:' + id, { min: 5, spread: 3, lo: 0, hi: 9 }),
      instrument: CHARACTER_INSTRUMENTS[Math.abs(seedOf(id)) % CHARACTER_INSTRUMENTS.length] });
  }
  return { characters: names, perSentence };
}

// --- Chapitres --------------------------------------------------------------------------------
function segment(sentences, sm) {
  const n = sentences.length;
  const heads = sentences.map((s, i) => (isHeading(s) ? i : -1)).filter((i) => i >= 0);
  let starts;
  if (heads.length) starts = heads[0] === 0 ? heads : [0, ...heads];
  else {
    const K = Math.max(1, Math.round(n / 14));
    starts = [0];
    for (let c = 1; c < K; c++) { // coupe au creux de tension le plus proche de la cible
      const target = Math.round((c * n) / K);
      let best = target, bv = Infinity;
      for (let i = Math.max(starts.at(-1) + 4, target - 3); i <= Math.min(n - 4, target + 3); i++) if (sm[i] < bv) { bv = sm[i]; best = i; }
      if (best > starts.at(-1) + 3) starts.push(best);
    }
  }
  return starts.map((a, k) => ({ start: a, end: (starts[k + 1] ?? n) - 1, title: heads.includes(a) ? sentences[a].replace(/^#+\s*/, '') : `Arc ${k + 1}` }));
}

export const PHASES = ['intro', 'developpement', 'paroxysme', 'resolution'];

// sentScore(i) -> { tension, valence, movement } pour UNE phrase ; opts.detect(sentence, i) -> id|null|undefined
export function buildStoryboard(sentences, sentScore, opts = {}) {
  const n = sentences.length;
  const raw = sentences.map((_, i) => sentScore(i));
  const tS = smooth(raw.map((r) => r.tension), 2);
  const mS = smooth(raw.map((r) => r.movement), 2);

  // lieux (dernier lieu mentionné, "défaut" tant qu'aucun)
  const place = []; let cur = 'defaut';
  sentences.forEach((s, i) => {
    const d = opts.detect ? opts.detect(s, i) : undefined;
    const p = d !== undefined ? d : lexPlace(s);
    if (p) cur = p;
    place.push(cur);
  });

  // chapitres, climax, phases, tension planifiée
  const chapters = segment(sentences, tS);
  const phase = new Array(n), plan = new Array(n);
  for (const ch of chapters) {
    const { start: a, end: b } = ch, len = b - a + 1;
    let c = a; for (let i = a; i <= b; i++) if (tS[i] > tS[c]) c = i;
    ch.peak = tS[c]; ch.climax = ch.peak >= 0.3 ? c : null;
    for (let i = a; i <= b; i++) {
      if (ch.climax === null) {
        phase[i] = i - a < 0.2 * len ? 'intro' : b - i < 0.15 * len ? 'resolution' : 'developpement';
        plan[i] = tS[i];
      } else if (i <= c - 2) {
        phase[i] = i - a < 0.2 * (c - a) ? 'intro' : 'developpement';
        // anticipation : la tension monte avant l'événement, selon une courbe en ^1.5
        plan[i] = Math.max(tS[i], ch.peak * 0.75 * (((i - a) / Math.max(1, c - a)) ** 1.5));
      } else if (i <= c + 1) {
        phase[i] = 'paroxysme'; plan[i] = Math.max(tS[i], ch.peak);
      } else {
        phase[i] = 'resolution';
        const prog = (i - c) / Math.max(1, b - c);
        plan[i] = Math.max(0.08, 0.5 * tS[i] + 0.5 * ch.peak * 0.5 * (1 - prog));
      }
      plan[i] = clamp(plan[i]);
    }
  }

  // valence planifiée : vote majoritaire sur ±3 phrases + hystérésis (pas de coq-à-l'âne)
  const valence = []; let prev = 'neutre';
  for (let i = 0; i < n; i++) {
    const cnt = {};
    for (let k = -3; k <= 3; k++) { const v = raw[i + k]?.valence; if (v && v !== 'neutre') cnt[v] = (cnt[v] ?? 0) + (k === 0 ? 1.5 : 1); }
    const [best, c] = Object.entries(cnt).sort((x, y) => y[1] - x[1])[0] ?? [null, 0];
    if (best && c >= 2) prev = best; else if (!best && i > 0 && phase[i] === 'resolution' && plan[i] < 0.2) prev = prev; // conserve
    valence.push(prev === 'menacant' && plan[i] >= 0.75 ? 'angoissant' : prev);
  }

  // modulations planifiées, avec la même persistance par lieu que le mode temps réel
  const mod = new Modulator(), mem = {}, offset = [], move = [];
  let curPlace = null;
  for (let i = 0; i < n; i++) {
    if (place[i] !== curPlace) { if (curPlace) mem[curPlace] = mod.offset; mod.reset(mem[place[i]] ?? 0); curPlace = place[i]; }
    move[i] = mod.update({ tension: plan[i], valence: valence[i] });
    // Résolution : le morceau boucle en revenant à la tonique du lieu (sinon il finirait dans une tonalité empruntée).
    if (!move[i] && mod.offset !== 0 && phase[i] === 'resolution' && phase[i - 1] === 'resolution' && place[i] === place[i - 1]) {
      mod.offset = 0; mod.cool = 3;
      move[i] = { kind: 'retour', label: 'retour à la tonique — résolution', semi: 0, offset: 0 };
    }
    offset[i] = mod.offset;
  }

  // personnages et leitmotifs : annoncés à leur entrée, puis rappelés après une absence
  const { characters, perSentence } = detectCharacters(sentences, { extra: opts.characters ?? [] });
  const last = {}, cues = perSentence.map(() => []);
  perSentence.forEach((ids, i) => ids.forEach((id) => { if (last[id] === undefined || i - last[id] > 6) cues[i].push(id); last[id] = i; }));

  return {
    n, chapters, characters, cues,
    plan: { tension: plan, movement: mS.map((x) => clamp(x)), valence, phase, place, offset, move },
    raw: { tension: tS },
  };
}

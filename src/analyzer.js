// Analyseur sémantique léger, 100 % local (lexiques + heuristiques).
// Remplaçable par un LLM / classifieur : seule la forme du retour compte.
//   analyzeWindow(sentences, i) -> { tension: 0..1, valence, movement: 0..1 }

import { PLACES, DEFAULT_PLACE } from './places.js';
import { EXTRA } from './lexicon-extra.js';

const strip = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Racines (sans accents) — correspondance en début de mot.
const LEX = {
  tension: ['sang', 'cri', 'hurl', 'epee', 'lame', 'mort', 'meurt', 'tue', 'peur', 'terreur', 'danger', 'menac',
    'ombre', 'tenebre', 'trembl', 'soudain', 'explos', 'griff', 'croc', 'monstre', 'fuir', 'fuy', 'traque', 'piege',
    'poursuiv', 'attaqu', 'frappa', 'battre', 'combat', 'panique', 'angoiss', 'frisson', 'glac', 'sinistre', 'cauchemar',
    'scream', 'blood', 'sword', 'death', 'fear', 'dark', 'suddenly'],
  calm: ['silence', 'paisible', 'doux', 'douce', 'calme', 'lentement', 'tranquille', 'serein', 'repos', 'berce',
    'murmur', 'brise', 'apaise', 'quiet', 'gentle', 'slowly'],
  joyeux: ['rire', 'rit', 'rieur', 'sourire', 'souri', 'joie', 'joyeu', 'lumiere', 'chant', 'fete', 'chaleur', 'danse',
    'heureu', 'dore', 'soleil', 'applaud', 'festin', 'laugh', 'smile', 'joy', 'sun'],
  melancolique: ['larme', 'pleur', 'seul', 'souvenir', 'adieu', 'perdu', 'tristesse', 'triste', 'gris', 'pluie',
    'nostalg', 'regret', 'deuil', 'vide', 'absence', 'soupir', 'sigh', 'tear', 'lonely', 'rain'],
  menacant: ['ombre', 'menac', 'sang', 'croc', 'tenebre', 'mort', 'lame', 'hurl', 'rampe', 'sinistre', 'cauchemar',
    'putride', 'ricane', 'predateur', 'grondement', 'dread', 'sinister', 'growl'],
  festif: ['fete', 'festin', 'danse', 'chope', 'violon', 'endiabl', 'tapage', 'ripaille', 'taverne', 'tavernier', 'musique', 'tavern', 'dance'],
  tragique: ['deuil', 'sacrific', 'agonie', 'funer', 'tombeau', 'adieu', 'destin', 'perit', 'trepas', 'cadavre', 'mourut', 'tomba', 'fatal', 'doomed'],
  onirique: ['reve', 'songe', 'etoile', 'feerique', 'flott', 'mirage', 'lune', 'lueur', 'enchant', 'magie', 'irreel', 'aerien', 'dream', 'star'],
  exotique: ['desert', 'orient', 'epice', 'bazar', 'caravane', 'sultan', 'oasis', 'souk', 'flamenc', 'dune', 'minaret', 'turban'],
  action: ['cour', 'bondi', 'fuit', 'fuy', 'galop', 'frappa', 'elanc', 'vite', 'precipit', 'saut', 'soudain', 'jaillit',
    'charg', 'poursuiv', 'combat', 'esquiv', 'run', 'ran', 'jump', 'fast'],
  statique: ['immobile', 'silence', 'attend', 'contempl', 'lentement', 'regarda', 'assis', 'songe', 'medit', 'dormi',
    'repos', 'pause', 'wait', 'still', 'stood'],
};

// Lexiques de base conservés à part : les ajustements (EXTRA + votes) se superposent sans les altérer.
const BASE_LEX = structuredClone(LEX);
let overrides = { add: {}, remove: {}, places: { add: {}, remove: {} } };
export const LEX_CATEGORIES = Object.keys(BASE_LEX);
export const getLexiconOverrides = () => overrides;
export function setLexicon(o = {}) {
  overrides = { add: o.add ?? {}, remove: o.remove ?? {}, places: { add: o.places?.add ?? {}, remove: o.places?.remove ?? {} } };
  for (const cat of LEX_CATEGORIES) {
    const rm = new Set(overrides.remove[cat] ?? []);
    LEX[cat] = [...BASE_LEX[cat].filter((st) => !rm.has(st)), ...(overrides.add[cat] ?? []).filter((st) => !BASE_LEX[cat].includes(st))];
  }
}
export function mergeOverrides(a = {}, b = {}) {
  const out = { add: {}, remove: {}, places: { add: {}, remove: {} } };
  const fold = (dst, src) => { for (const [cat, list] of Object.entries(src ?? {})) dst[cat] = [...new Set([...(dst[cat] ?? []), ...list])]; };
  for (const o of [a, b]) for (const k of ['add', 'remove']) { fold(out[k], o[k]); fold(out.places[k], o.places?.[k]); }
  return out;
}
export const normalizeWord = (w) => strip(w);
export const tokenize = (s) => tokens(s);
// Racines des lexiques qui ont déclenché sur une phrase, par catégorie (pour comprendre / corriger une analyse).
export function explainSentence(s) {
  const t = tokens(s), out = {};
  for (const [cat, stems] of Object.entries(LEX)) {
    const hit = [...new Set(stems.filter((st) => t.some((w) => w.startsWith(st))))];
    if (hit.length) out[cat] = hit;
  }
  return out;
}
setLexicon(EXTRA);

const tokens = (s) => strip(s).match(/[a-z']+/g) ?? [];
const count = (toks, stems) => toks.reduce((n, t) => n + (stems.some((st) => t.startsWith(st)) ? 1 : 0), 0);

export function splitSentences(text) {
  return (text.replace(/\r/g, '').match(/[^.!?…\n]+(?:[.!?…]+["»”)]*|\n|$)/g) ?? [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export function scoreSentence(s) {
  const t = tokens(s);
  const bangs = (s.match(/!/g) ?? []).length;
  const caps = (s.match(/\b[A-ZÀ-Ý]{3,}\b/g) ?? []).length;
  const tension = clamp(
    count(t, LEX.tension) * 0.34 + bangs * 0.15 + caps * 0.2 + (s.includes('?') ? 0.05 : 0) - count(t, LEX.calm) * 0.25,
  );
  const val = {
    joyeux: count(t, LEX.joyeux),
    festif: count(t, LEX.festif),
    melancolique: count(t, LEX.melancolique),
    menacant: count(t, LEX.menacant),
    tragique: count(t, LEX.tragique),
    onirique: count(t, LEX.onirique),
    exotique: count(t, LEX.exotique),
  };
  const movement = clamp(0.3 + count(t, LEX.action) * 0.3 - count(t, LEX.statique) * 0.2 + bangs * 0.1);
  return { tension, val, movement };
}

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const VAL_KEYS = ['joyeux', 'festif', 'melancolique', 'menacant', 'tragique', 'onirique', 'exotique', 'angoissant'];
const HEADING = /^\s*(#{1,3}\s|chapitre\b|chapter\b|partie\b|prologue\b|[ée]pilogue\b|acte\b)/i;
export const isHeading = (s) => HEADING.test(s) && s.length < 80;
const WEIGHTS = [1, 0.8, 0.6, 0.45, 0.3]; // phrase courante + 4 en avance (look-ahead)

// scoreFn(index) -> { tension, val, movement } | null : source de score alternative (ex. LLM) ;
// null => repli sur l'heuristique par mots-clés.
export function analyzeWindow(sentences, i, weights = WEIGHTS, scoreFn = null) {
  let wsum = 0, tAvg = 0, tMax = 0, mAvg = 0;
  const val = Object.fromEntries(VAL_KEYS.map((k) => [k, 0]));
  weights.forEach((w, k) => {
    const s = sentences[i + k];
    if (s === undefined) return;
    const r = (scoreFn && scoreFn(i + k)) || scoreSentence(s);
    wsum += w;
    tAvg += r.tension * w;
    tMax = Math.max(tMax, r.tension * w);
    mAvg += r.movement * w;
    for (const key of VAL_KEYS) val[key] += (r.val[key] ?? 0) * w;
  });
  if (!wsum) return { tension: 0, valence: 'neutre', movement: 0.3 };
  // Moyenne lissée + pic anticipé : la musique "voit venir" le danger sans sauter au mot près.
  const tension = clamp(0.6 * (tAvg / wsum) + 0.4 * tMax);
  const [best, score] = Object.entries(val).sort((a, b) => b[1] - a[1])[0];
  let valence = score >= 0.6 ? best : 'neutre';
  // Menace extrême => mode Locrien (« obscurité extrême, instabilité »).
  if (valence === 'menacant' && tension >= 0.75) valence = 'angoissant';
  return { tension, valence, movement: clamp(mAvg / wsum) };
}

// Mots (sans accents, minuscules) par lesquels le motif de base d'un lieu reconnaît la phrase.
export function placeMatches(sentence, id) {
  const p = PLACES[id]?.pattern; if (!p) return [];
  return [...sentence.matchAll(new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g'))].map((m) => strip(m[0]));
}

// Lieu mentionné dans la phrase : motif de base, moins les mots retirés, plus les mots ajoutés (votes).
export function detectPlace(sentence) {
  const { add, remove } = overrides.places, norm = strip(sentence);
  for (const [id, p] of Object.entries(PLACES)) {
    if (!p.pattern) continue;
    const rm = remove[id];
    if (rm?.length ? placeMatches(sentence, id).some((w) => !rm.includes(w)) : p.pattern.test(sentence)) return id;
    const ad = add[id];
    if (ad?.length && new RegExp('\\b(?:' + ad.join('|') + ')').test(norm)) return id;
  }
  return null;
}

// Lieu "courant" : dernière mention en remontant depuis la phrase i (utile après un saut ou une reprise).
// detect(sentence, index) -> id | null | undefined (undefined => heuristique par mots-clés).
export function placeAt(sentences, i, detect = null) {
  for (let k = Math.min(i, sentences.length - 1); k >= 0; k--) {
    const d = detect ? detect(sentences[k], k) : undefined;
    const p = d !== undefined ? d : detectPlace(sentences[k]);
    if (p) return p;
  }
  return DEFAULT_PLACE;
}

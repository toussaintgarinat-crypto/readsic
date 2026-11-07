// Ajustement des lexiques à partir de votes humains (comparaison mots-clés / LLM).
// Entrée : lignes { i, sentence, lex, llm, vote } (format de l'export JSON). Fonctions pures, hors setLexicon/evaluate.
import { explainSentence, tokenize, analyzeWindow, setLexicon, getLexiconOverrides, mergeOverrides, LEX_CATEGORIES } from './analyzer.js';

const STOP = new Set(('dans avec pour sans sous sur par que qui quoi dont mais donc car comme elle elles ils eux nous vous leur leurs cette cet ces son sa ses ' +
  'une des les aux est sont etait etaient avait avaient fait faire plus tout tous toute tres puis alors aussi encore meme quand apres avant entre vers chez ' +
  'the and with for that this from was were had have not but they their there which what when into over then than some very').split(/\s+/));

// Racine proposée : on coupe la terminaison (la correspondance du lexique se fait en début de mot).
export function stemOf(word) {
  const w = word;
  return w.length > 7 ? w.slice(0, -2) : w.length > 5 ? w.slice(0, -1) : w;
}

const candidates = (sentence, already) => {
  const set = new Set();
  for (const w of tokenize(sentence)) {
    if (w.length < 4 || STOP.has(w) || already.some((st) => w.startsWith(st))) continue;
    set.add(stemOf(w));
  }
  return set;
};

const bump = (map, key, i) => { const e = map.get(key) ?? { n: 0, rows: [] }; e.n++; e.rows.push(i); map.set(key, e); };

// Suggestions d'ajout / de retrait de racines. Seules les phrases où l'utilisateur a voté « LLM » comptent comme
// erreurs des mots-clés. Un mot n'est proposé que s'il est discriminant : pas plus fréquent dans les phrases où
// les deux analyses s'accordent que dans les phrases en erreur (sinon c'est un mot courant, pas un indice).
export function suggestLexicon(rows, { minSupport = 2, gap = 0.2 } = {}) {
  const wrong = rows.filter((r) => r.vote === 'llm');
  const agree = rows.filter((r) => Math.abs(r.llm.tension - r.lex.tension) < 0.15 && r.llm.valence === r.lex.valence);
  const countIn = (set, fn) => { const m = new Map(); for (const r of set) for (const k of fn(r)) m.set(k, (m.get(k) ?? 0) + 1); return m; };
  const add = new Map(), rem = new Map();

  for (const r of wrong) {
    const ex = explainSentence(r.sentence);
    // sous-estimation de la tension -> mots absents du lexique de tension
    if (r.llm.tension - r.lex.tension >= gap) for (const c of candidates(r.sentence, Object.values(ex).flat())) bump(add, `tension|${c}`, r.i);
    // sur-estimation de la tension -> racines de tension qui ont déclenché à tort
    if (r.lex.tension - r.llm.tension >= gap) for (const st of ex.tension ?? []) bump(rem, `tension|${st}`, r.i);
    // valence : le LLM voit autre chose
    if (r.lex.valence !== r.llm.valence) {
      if (r.llm.valence !== 'neutre' && LEX_CATEGORIES.includes(r.llm.valence)) for (const c of candidates(r.sentence, ex[r.llm.valence] ?? [])) bump(add, `${r.llm.valence}|${c}`, r.i);
      if (r.lex.valence !== 'neutre') for (const st of ex[r.lex.valence] ?? []) bump(rem, `${r.lex.valence}|${st}`, r.i);
    }
  }
  const inAgree = countIn(agree, (r) => candidates(r.sentence, []));
  const inAgreeStem = countIn(agree, (r) => Object.values(explainSentence(r.sentence)).flat());

  const out = { add: [], remove: [] };
  for (const [key, e] of add) {
    const [cat, stem] = key.split('|');
    if (e.n >= minSupport && (inAgree.get(stem) ?? 0) <= e.n / 2) out.add.push({ cat, stem, support: e.n, rows: e.rows });
  }
  for (const [key, e] of rem) {
    const [cat, stem] = key.split('|');
    if (e.n >= minSupport && (inAgreeStem.get(stem) ?? 0) < e.n) out.remove.push({ cat, stem, support: e.n, rows: e.rows });
  }
  const bySupport = (a, b) => b.support - a.support || a.stem.localeCompare(b.stem);
  out.add.sort(bySupport); out.remove.sort(bySupport);
  return out;
}

export function toOverrides(suggestions) {
  const o = { add: {}, remove: {} };
  for (const s of suggestions.add) (o.add[s.cat] ??= []).push(s.stem);
  for (const s of suggestions.remove) (o.remove[s.cat] ??= []).push(s.stem);
  return o;
}

// Effet d'un ajustement : écart de tension et accord de valence avec le LLM, avant / après, séparément sur les
// phrases votées (celles qui ont servi à l'ajuster : optimiste) et les autres (contrôle hors échantillon).
export function evaluateOverrides(rows, candidate) {
  const saved = getLexiconOverrides();
  const measure = (set) => {
    const s = set.map((r) => ({ r, a: analyzeWindow([r.sentence], 0, [1]) }));
    return {
      n: s.length,
      tensionMAE: s.length ? s.reduce((t, x) => t + Math.abs(x.a.tension - x.r.llm.tension), 0) / s.length : null,
      valenceAgree: s.length ? s.filter((x) => x.a.valence === x.r.llm.valence).length / s.length : null,
    };
  };
  const voted = rows.filter((r) => r.vote), held = rows.filter((r) => !r.vote);
  try {
    setLexicon(saved); const before = { voted: measure(voted), held: measure(held) };
    setLexicon(mergeOverrides(saved, candidate)); const after = { voted: measure(voted), held: measure(held) };
    return { before, after };
  } finally { setLexicon(saved); }
}

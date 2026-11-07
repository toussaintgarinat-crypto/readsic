import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setLexicon, getLexiconOverrides, analyzeWindow, explainSentence, mergeOverrides } from '../src/analyzer.js';
import { suggestLexicon, toOverrides, evaluateOverrides, stemOf } from '../src/lexicon-tuning.js';

assert.equal(stemOf('gouffres'), 'gouffre'.slice(0, 6)); // 8 lettres -> -2
assert.equal(stemOf('abime'), 'abime');

const lex = (sentence) => analyzeWindow([sentence], 0, [1]);
const row = (i, sentence, llm, vote = null) => ({ i, sentence, lex: lex(sentence), llm, vote });
const L = (tension, valence = 'neutre', movement = 0.3) => ({ tension, valence, movement, place: null });

// « gouffre » : mot absent du lexique, le LLM y voit du danger ; « bannière » : mot sans rapport ;
// « sang » est dans le lexique mais ici (« sang-froid ») le LLM voit du calme.
const rows = [
  row(0, 'Elle fixa le gouffre sans bouger.', L(0.8, 'angoissant'), 'llm'),
  row(1, 'Le gouffre s\'ouvrit sous ses pas.', L(0.85, 'angoissant'), 'llm'),
  row(2, 'Un gouffre immense bâillait devant eux.', L(0.7, 'menacant'), 'llm'),
  row(3, 'Il garda son sang-froid, sûr de lui.', L(0.1), 'llm'),
  row(4, 'Son sang-froid fit merveille ce jour-là.', L(0.1), 'llm'),
  row(5, 'La bannière flottait sur la place.', L(0.1)),
  row(6, 'La bannière claquait au vent.', L(0.1)),
  row(7, 'Le marchand vendait des pommes.', L(0.1)),
  row(8, 'Un cri retentit, le sang coula.', L(0.9, 'menacant'), 'tie'),
];
const sug = suggestLexicon(rows);
const adds = sug.add.map((s) => `${s.cat}:${s.stem}`);
assert.ok(adds.includes('tension:gouffr'), `ajout attendu, obtenu ${adds}`);
assert.ok(!adds.some((a) => /banni|march|pomm/.test(a)), 'mots neutres non proposés');
assert.ok(!adds.some((a) => /fixa|bouger|sous|devant/.test(a)), 'mots courants/vides écartés');
assert.ok(sug.remove.some((s) => s.cat === 'tension' && s.stem === 'sang'), 'faux positif « sang-froid » détecté');
assert.equal(sug.add.find((s) => s.stem === 'gouffr').support, 3);

// support minimal : une seule occurrence ne suffit pas
assert.ok(!suggestLexicon(rows.slice(0, 1)).add.length);
assert.ok(suggestLexicon(rows.slice(0, 1), { minSupport: 1 }).add.some((s) => s.stem === 'gouffr'));

// discriminance : un mot aussi fréquent dans les phrases où tout le monde s'accorde n'est pas un indice
const noisy = [
  ...rows.slice(0, 3).map((r) => ({ ...r, sentence: r.sentence + ' Enfin, la lumière.' })),
  ...[10, 11, 12, 13, 14, 15].map((i) => row(i, 'La lumière du matin était belle.', L(0.1))),
];
assert.ok(!suggestLexicon(noisy).add.some((s) => s.stem.startsWith('lumi')), 'mot fréquent écarté');

// application : les ajustements changent l'analyse, et reset restaure la base
const ov = toOverrides(sug);
assert.deepEqual(ov.add.tension, ['gouffr']);
const t0 = lex('Le gouffre béant.').tension;
const ev = evaluateOverrides(rows, ov);
assert.equal(getLexiconOverrides().add.tension, undefined, 'evaluateOverrides restaure l\'état');
assert.equal(lex('Le gouffre béant.').tension, t0);
assert.ok(ev.after.voted.tensionMAE < ev.before.voted.tensionMAE, 'moins d\'écart sur les phrases votées');
assert.equal(ev.before.held.n, 3);
setLexicon(ov);
assert.ok(lex('Le gouffre béant.').tension > t0);
assert.ok(!explainSentence('Il garda son sang-froid.').tension?.includes('sang'));
setLexicon({});
assert.equal(lex('Le gouffre béant.').tension, t0);
assert.deepEqual(mergeOverrides({ add: { tension: ['a'] } }, { add: { tension: ['a', 'b'] }, remove: { calm: ['c'] } }), { add: { tension: ['a', 'b'] }, remove: { calm: ['c'] }, places: { add: {}, remove: {} } });

// ---- lieux ----
import { detectPlace } from '../src/analyzer.js';
const P = (place) => ({ tension: 0.1, valence: 'neutre', movement: 0.3, place });
const prow = (i, sentence, place, vote = null) => ({ i, sentence, lex: { ...lex(sentence), place: detectPlace(sentence) }, llm: P(place), vote });
const prows = [
  prow(0, 'La fondrière s\'étendait à perte de vue.', 'marais', 'llm'),      // lieu non reconnu par les mots-clés
  prow(1, 'Ils contournèrent la fondrière en silence.', 'marais', 'llm'),
  prow(2, 'La brume du matin couvrait la ville.', null, 'llm'),               // faux positif : « brume » ≠ marécage ici
  prow(3, 'Une brume légère flottait sur les toits.', null, 'llm'),
  prow(4, 'Le marécage dormait sous la lune.', 'marais'),                     // accord
  prow(5, 'La taverne était pleine.', 'taverne'),
];
assert.equal(prows[0].lex.place, null); assert.equal(prows[2].lex.place, 'marais');
const ps = suggestLexicon(prows);
assert.ok(ps.placeAdd.some((x) => x.place === 'marais' && x.stem.startsWith('fondri') && x.support === 2), JSON.stringify(ps.placeAdd));
assert.ok(!ps.placeAdd.some((x) => /ville|silence|toits/.test(x.stem)), 'mots sans lien écartés');
assert.ok(ps.placeRemove.some((x) => x.place === 'marais' && x.word === 'brume' && x.support === 2), JSON.stringify(ps.placeRemove));
const pov = toOverrides(ps);
assert.ok(pov.places.add.marais && pov.places.remove.marais.includes('brume'));
const pev = evaluateOverrides(prows, pov);
assert.ok(pev.after.voted.placeAgree > pev.before.voted.placeAgree, 'accord de lieu amélioré sur les phrases votées');
assert.equal(pev.before.voted.placeAgree, 0); assert.equal(pev.after.voted.placeAgree, 1);
setLexicon(pov);
assert.equal(detectPlace('Une fondrière sans fond.'), 'marais'); assert.equal(detectPlace('La brume sur la ville.'), null);
assert.equal(detectPlace('Brume sur le marécage.'), 'marais', 'un autre mot du motif suffit encore');
setLexicon({});
assert.equal(detectPlace('La brume sur la ville.'), 'marais', 'réinitialisation');

// CLI de bout en bout
const dir = await mkdtemp(path.join(tmpdir(), 'tune-'));
const votes = path.join(dir, 'votes.json'), out = path.join(dir, 'extra.js');
await writeFile(votes, JSON.stringify({ version: 1, rows }));
const stdout = execFileSync('node', ['scripts/tune-lexicon.mjs', votes, '--write', '--out', out], { encoding: 'utf8' });
assert.match(stdout, /\+ \[tension\] gouffr/); assert.match(stdout, /- \[tension\] sang/);
const written = await import(out + '?' + Date.now());
assert.deepEqual(written.EXTRA.places, { add: {}, remove: {} }, 'format complet même sans suggestion de lieu');
assert.deepEqual(written.EXTRA.add.tension, ['gouffr']); assert.deepEqual(written.EXTRA.remove.tension, ['sang']);
assert.match(await readFile(out, 'utf8'), /export const EXTRA/);
console.log('OK — tuning');

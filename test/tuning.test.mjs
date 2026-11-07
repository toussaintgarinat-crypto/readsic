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
assert.deepEqual(mergeOverrides({ add: { tension: ['a'] } }, { add: { tension: ['a', 'b'] }, remove: { calm: ['c'] } }), { add: { tension: ['a', 'b'] }, remove: { calm: ['c'] } });

// CLI de bout en bout
const dir = await mkdtemp(path.join(tmpdir(), 'tune-'));
const votes = path.join(dir, 'votes.json'), out = path.join(dir, 'extra.js');
await writeFile(votes, JSON.stringify({ version: 1, rows }));
const stdout = execFileSync('node', ['scripts/tune-lexicon.mjs', votes, '--write', '--out', out], { encoding: 'utf8' });
assert.match(stdout, /\+ \[tension\] gouffr/); assert.match(stdout, /- \[tension\] sang/);
const written = await import(out + '?' + Date.now());
assert.deepEqual(written.EXTRA.add.tension, ['gouffr']); assert.deepEqual(written.EXTRA.remove.tension, ['sang']);
assert.match(await readFile(out, 'utf8'), /export const EXTRA/);
console.log('OK — tuning');

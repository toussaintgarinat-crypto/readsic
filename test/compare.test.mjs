import assert from 'node:assert/strict';
import { pearson, compareAnalyses, tally } from '../src/compare.js';

assert.ok(Math.abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
assert.ok(Math.abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12);
assert.equal(pearson([1, 1, 1], [1, 2, 3]), null, 'courbe constante : corrélation non définie');
assert.equal(pearson([1], [1]), null);

const S = (tension, valence, movement = 0.3, place = null) => ({ tension, valence, movement, place });
const lex = [S(0.1, 'neutre'), S(0.5, 'menacant', 0.3, 'marais'), S(0.2, 'joyeux'), S(0, 'neutre')];
const llm = [S(0.1, 'neutre'), S(0.9, 'angoissant', 0.8, 'marais'), S(0.2, 'joyeux'), null]; // dernière phrase pas encore analysée
const { rows, summary } = compareAnalyses(4, (i) => lex[i], (i) => llm[i]);

assert.equal(summary.covered, 3); assert.equal(summary.n, 4, 'les phrases manquantes ne comptent pas');
assert.ok(Math.abs(summary.tensionMAE - 0.4 / 3) < 1e-9);
assert.ok(Math.abs(summary.valenceAgree - 2 / 3) < 1e-9);
assert.equal(summary.placeAgree, 1);
const worst = [...rows].sort((a, b) => b.gap - a.gap)[0];
assert.equal(worst.i, 1, 'le plus gros désaccord est repéré');
assert.ok(worst.dT > 0 && !worst.valSame && worst.placeSame);
assert.equal(rows.find((r) => r.i === 0).gap, 0);

// lieu : « aucun » (null/undefined) est équivalent des deux côtés
const r2 = compareAnalyses(1, () => S(0.2, 'neutre', 0.3, undefined), () => S(0.2, 'neutre', 0.3, null));
assert.equal(r2.summary.placeAgree, 1);

// aucun recouvrement : pas de division par zéro
const r3 = compareAnalyses(2, () => S(0, 'neutre'), () => null);
assert.equal(r3.summary.covered, 0); assert.equal(r3.summary.tensionMAE, null); assert.equal(r3.summary.valenceAgree, null);

assert.deepEqual(tally({ 1: 'llm', 2: 'llm', 3: 'lex', 4: 'tie', 5: 'n/importe quoi' }), { lex: 1, llm: 2, tie: 1, total: 4 });
console.log('OK — compare');

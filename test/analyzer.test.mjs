import assert from 'node:assert/strict';
import { splitSentences, analyzeWindow, placeAt, detectPlace } from '../src/analyzer.js';
import { SAMPLE_TEXT } from '../src/sample.js';

const S = splitSentences(SAMPLE_TEXT);
assert.ok(S.length > 20, 'découpe en phrases');

const calm = analyzeWindow(['Elle marchait lentement dans le silence, une chanson aux lèvres.'], 0);
const hot = analyzeWindow(['Soudain, un cri ! Le sang, la lame, la peur !'], 0);
assert.ok(hot.tension > calm.tension + 0.4, `tension ${calm.tension} < ${hot.tension}`);
assert.ok(hot.movement > calm.movement);
assert.equal(analyzeWindow(['Elle sourit, pleine de joie, sous le soleil.'], 0).valence, 'joyeux');
assert.equal(analyzeWindow(['Une larme coula : seule, perdue dans un souvenir.'], 0).valence, 'melancolique');

assert.equal(detectPlace('La porte de la taverne claqua.'), 'taverne');
assert.equal(detectPlace('Le marécage s\'étendait devant elle.'), 'marais');
assert.equal(detectPlace('Il faisait beau.'), null);

// Persistance : après un saut en plein milieu du texte, le lieu courant est retrouvé en remontant.
const iBack = S.findIndex((s) => /Au matin/.test(s));
assert.equal(placeAt(S, iBack - 1), 'desert'); // le rêve se passe dans le désert
assert.equal(placeAt(S, iBack - 4), 'taverne');
const iSwamp = S.findIndex((s) => /retourner au marécage/.test(s));
assert.equal(placeAt(S, iSwamp + 2), 'marais');

// Le look-ahead anticipe le danger avant la phrase menaçante.
const iDanger = S.findIndex((s) => /Soudain, une ombre/.test(s));
assert.ok(analyzeWindow(S, iDanger - 2).tension > analyzeWindow(S, iDanger - 6).tension, 'look-ahead');
console.log('OK — analyzer');

// Nouvelles valences (modes du Drive)
assert.equal(analyzeWindow(['Elle rêva : une lune flottait sur un mirage d\'étoiles.'], 0).valence, 'onirique');
assert.equal(analyzeWindow(['Une caravane traversa les dunes du désert, vers un bazar d\'orient.'], 0).valence, 'exotique');
assert.equal(analyzeWindow(['Soudain, du sang, une lame, la mort, des ténèbres, la peur !'], 0).valence, 'angoissant');
assert.equal(analyzeWindow(['Le deuil, l\'adieu, le sacrifice : un destin funeste.'], 0).valence, 'tragique');
assert.equal(analyzeWindow(['Une danse endiablée, un festin et des chopes dans la fête.'], 0).valence, 'festif');

// Modulations (Drive : « Analyse des Modulations… »)
import { Modulator } from '../src/modulation.js';
import { MODES, VALENCE_MODE, PLACES, keyInfo } from '../src/places.js';
const m = new Modulator();
assert.equal(m.update({ tension: 0.1, valence: 'melancolique' }), null);
const up = m.update({ tension: 0.6, valence: 'menacant' });
assert.equal(up.kind, 'dominante'); assert.equal(up.offset, -5); // V = +7 ramené dans l'octave (-5)
for (let i = 0; i < 3; i++) assert.equal(m.update({ tension: 0.6, valence: 'menacant' }), null, 'cooldown');
const down = m.update({ tension: 0.1, valence: 'joyeux' });
assert.equal(down.kind, "relatifMajeur"); assert.equal(down.offset, -2); // -5+3 = -2
const m2 = new Modulator();
m2.update({ tension: 0.2, valence: 'neutre' });
assert.equal(m2.update({ tension: 0.85, valence: 'angoissant' }).kind, 'chromatique');
const m3 = new Modulator(); m3.apply('dominante'); m3.cool = 0;
let back = null; for (let i = 0; i < 4; i++) back = m3.update({ tension: 0.05, valence: 'neutre' }) ?? back;
assert.equal(back?.kind, 'retour'); assert.equal(m3.offset, 0);

// Cohérence des modes : 15 modes, 7 degrés, tonique à 0, croissants ; toute valence pointe vers un mode existant.
assert.equal(Object.keys(MODES).length, 15);
for (const [id, mo] of Object.entries(MODES)) { assert.equal(mo.iv.length, 7, id); assert.equal(mo.iv[0], 0); assert.deepEqual([...mo.iv].sort((a, b) => a - b), mo.iv, id); }
for (const v of Object.values(VALENCE_MODE)) assert.ok(v === null || MODES[v], v);
for (const p of Object.values(PLACES)) assert.ok(MODES[p.mode]);
assert.equal(keyInfo(2, 'aeolian').label, 'Ré mineur');
assert.match(keyInfo(2, 'aeolian').emotion, /gravité/);
console.log('OK — modulation & modes');

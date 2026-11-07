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
assert.equal(placeAt(S, iBack - 1), 'taverne');
const iSwamp = S.findIndex((s) => /retourner au marécage/.test(s));
assert.equal(placeAt(S, iSwamp + 2), 'marais');

// Le look-ahead anticipe le danger avant la phrase menaçante.
const iDanger = S.findIndex((s) => /Soudain, une ombre/.test(s));
assert.ok(analyzeWindow(S, iDanger - 2).tension > analyzeWindow(S, iDanger - 6).tension, 'look-ahead');
console.log('OK — analyzer');

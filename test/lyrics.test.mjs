import assert from 'node:assert/strict';
import { splitSentences, lyricTimings, assTime, assEscape, buildAss } from '../src/lyrics.js';

// formule identique à la lecture automatique (mots / mpm + 250 ms)
const S = splitSentences('Un deux trois quatre. Cinq six.\nSept.');
const { starts, end } = lyricTimings(S, 120);
assert.deepEqual(starts.map((x) => +x.toFixed(3)), [0, +(4 / 120 * 60 + 0.25).toFixed(3), +(4 / 120 * 60 + 0.25 + 2 / 120 * 60 + 0.25).toFixed(3)]);
assert.ok(Math.abs(end - (7 / 120 * 60 + 0.75)) < 1e-9);
assert.ok(starts.every((t, i) => i === 0 || t > starts[i - 1]), 'instants croissants');
assert.equal(lyricTimings(S, 120, 1.5).starts[0], 1.5, 'décalage');

assert.equal(assTime(0), '0:00:00.00'); assert.equal(assTime(61.234), '0:01:01.23'); assert.equal(assTime(3725.5), '1:02:05.50');
assert.equal(assEscape('a {b} \\c'), 'a b c'); assert.equal(assEscape('{}'), '\\h'); assert.equal(assEscape('l1\nl2'), 'l1\\Nl2');

const ass = buildAss(S, lyricTimings(S, 120), { title: 'Titre', info: ['info 0', '', 'info 2'] });
assert.equal((ass.match(/^Dialogue: 0,.*Style|^Dialogue: 0,.*,Lyric,/gm) ?? []).length, 3, 'une réplique par phrase');
assert.equal((ass.match(/,Info,/g) ?? []).length, 2, 'info seulement où fournie');
assert.match(ass, /,Title,,0,0,0,,Titre/);
assert.match(ass, /PlayResX: 1280/);
// la phrase courante est la 3e ligne du bloc, voisines en gris ; bords du texte comblés par des espaces insécables
const first = ass.split('\n').find((l) => l.includes(',Lyric,'));
assert.ok(first.startsWith('Dialogue: 0,0:00:00.00,'), first);
assert.match(first, /\\h\\N[^]*\\h\\N[^]*Un deux trois quatre\.\\N/);
console.log('OK — lyrics');

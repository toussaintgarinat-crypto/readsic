import assert from 'node:assert/strict';
import { splitSentences, analyzeWindow, scoreSentence } from '../src/analyzer.js';
import { buildStoryboard, detectCharacters, PHASES } from '../src/storyboard.js';
import { SAMPLE_TEXT } from '../src/sample.js';

const S = splitSentences(SAMPLE_TEXT);
const lex = (i) => analyzeWindow(S, i, [1]);
const sb = buildStoryboard(S, lex);
const { plan } = sb;

// chapitres : couvrent tout le texte sans trou ni recouvrement
assert.ok(sb.chapters.length >= 2, `chapitres=${sb.chapters.length}`);
assert.equal(sb.chapters[0].start, 0); assert.equal(sb.chapters.at(-1).end, S.length - 1);
sb.chapters.slice(1).forEach((c, k) => assert.equal(c.start, sb.chapters[k].end + 1));

// chaque chapitre à climax suit intro → développement → paroxysme → résolution, dans l'ordre
const ord = (p) => PHASES.indexOf(p);
let withClimax = 0;
for (const ch of sb.chapters) {
  for (let i = ch.start + 1; i <= ch.end; i++) assert.ok(ord(plan.phase[i]) >= ord(plan.phase[i - 1]) || ch.climax === null, `ordre phases ${i}`);
  if (ch.climax !== null) {
    withClimax++;
    assert.equal(plan.phase[ch.climax], 'paroxysme');
    assert.ok(plan.tension[ch.climax] >= plan.tension[ch.start], 'le paroxysme est plus tendu que le début');
    if (ch.end > ch.climax + 3) assert.equal(plan.phase[ch.end], 'resolution');
  }
}
assert.ok(withClimax >= 1);

// anticipation : la tension planifiée monte avant le pic ; résolution : elle retombe après
const ch = sb.chapters.find((c) => c.climax !== null && c.climax - c.start >= 4 && c.end - c.climax >= 3);
if (ch) {
  assert.ok(plan.tension[ch.climax - 2] >= sb.raw.tension[ch.climax - 2] - 1e-9, 'anticipation');
  assert.ok(plan.tension[ch.end] < plan.tension[ch.climax], 'résolution plus calme que le paroxysme');
}

// valeurs bornées, tableaux alignés
for (const k of ['tension', 'movement', 'valence', 'phase', 'place', 'offset', 'move']) assert.equal(plan[k].length, S.length, k);
assert.ok(plan.tension.every((x) => x >= 0 && x <= 1));
assert.ok(plan.offset.every((o) => Number.isInteger(o) && o >= -5 && o <= 6));

// personnages : Mara, leitmotif déterministe, annoncé à l'entrée
const mara = sb.characters.find((c) => c.id === 'mara');
assert.ok(mara && mara.count >= 3, 'Mara détectée');
assert.deepEqual(buildStoryboard(S, lex).characters[0].motif, sb.characters[0].motif, 'motif déterministe');
assert.ok(!sb.characters.some((c) => ['elle', 'puis', 'soudain', 'au'].includes(c.id)), 'pas de faux noms');
assert.ok(sb.cues[0].includes('mara') || sb.cues.slice(0, 3).some((c) => c.includes('mara')), 'annonce à la première apparition');
const announced = sb.cues.filter((c) => c.includes('mara')).length;
assert.ok(announced >= 2 && announced < S.length / 2, `rappels espacés (${announced})`);

// persistance planifiée : au retour dans un lieu, la tonalité mémorisée est reprise (sauf modulation immédiate)
let checked = 0;
for (let i = 1; i < S.length; i++) {
  const p = plan.place[i];
  if (p === plan.place[i - 1]) continue;
  const j = plan.place.slice(0, i).lastIndexOf(p);
  if (j < 0 || plan.move[i]) continue;
  assert.equal(plan.offset[i], plan.offset[j], `retour à ${p}`); checked++;
}
assert.ok(checked >= 1, 'au moins un retour de lieu vérifié');

// texte avec titres : un chapitre par titre
const T = splitSentences('Chapitre 1\nIl marchait. Il riait.\nChapitre 2\nLe sang. Un cri ! La peur !\n').filter(Boolean);
const sb2 = buildStoryboard(T, (i) => analyzeWindow(T, i, [1]));
assert.equal(sb2.chapters.length, 2); assert.match(sb2.chapters[1].title, /Chapitre 2/);

// noms : pas de nom pour un mot commun
assert.deepEqual(detectCharacters(splitSentences('Il pleut. Il fait beau. Il rit.')).characters, []);
// personnages déclarés (noms communs, pluriels) : leitmotif propre, annonce à l'entrée
const F = splitSentences('Le loup parle. Le chien répond. Les loups hurlent. Plus rien. Rien encore. Rien. Rien. Rien. Rien. Le chien revient.');
const dc = detectCharacters(F, { extra: ['loup', ' chien ', 'dragon'] });
assert.deepEqual(dc.characters.map((c) => c.id).sort(), ['chien', 'loup'], 'personnage absent ignoré');
assert.equal(dc.characters.find((c) => c.id === 'loup').count, 2, 'pluriel reconnu');
assert.deepEqual(dc.perSentence[2], ['loup']);
assert.ok(dc.characters.every((c) => c.declared && c.motif.length >= 5));
assert.notDeepEqual(dc.characters[0].motif, dc.characters[1].motif, 'un leitmotif par personnage');
const sbF = buildStoryboard(F, (i) => analyzeWindow(F, i, [1]), { characters: ['chien'] });
assert.deepEqual(sbF.characters.map((c) => c.id), ['chien']);
assert.ok(sbF.cues[1].includes('chien') && sbF.cues[9].includes('chien'), 'annonce, puis rappel après une longue absence');
// résolution : tout arc à climax modulé revient à la tonique du lieu avant sa fin
for (const c of sb.chapters) {
  if (c.climax === null || c.end - c.climax < 5) continue;
  const lastPhaseIdx = plan.phase.slice(c.start, c.end + 1).lastIndexOf('resolution');
  if (lastPhaseIdx < 1) continue;
  const end = c.start + lastPhaseIdx;
  if (plan.place[end] === plan.place[end - 1]) assert.equal(plan.offset[end], 0, `retour à la tonique en fin d'arc ${c.title}`);
}
// cas construit : montée en tension (modulation à la dominante) puis retombée longue => retour à 0
const Hs = splitSentences(['Calme.', 'Calme.', 'Calme.', 'Calme.', 'Calme.', 'Calme.', 'Le sang, la peur, un cri !', 'Le sang, la peur, la lame !', 'Le sang, la mort, un cri !', 'Calme.', 'Calme.', 'Calme.', 'Calme.', 'Calme.', 'Calme.', 'Calme.'].join(' '));
const sbH = buildStoryboard(Hs, (i) => analyzeWindow(Hs, i, [1]));
assert.ok(sbH.plan.offset.some((o) => o !== 0), 'une modulation a eu lieu');
assert.equal(sbH.plan.offset.at(-1), 0, 'le morceau finit à la tonique');
console.log('OK — storyboard');

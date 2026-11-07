import { splitSentences, analyzeWindow, placeAt } from './analyzer.js';
import { PLACES } from './places.js';
import { MusicEngine } from './engine.js';
import { Memory, hashText } from './memory.js';
import { SAMPLE_TEXT } from './sample.js';

const $ = (id) => document.getElementById(id);
const VAL_LABEL = { joyeux: 'joyeux', melancolique: 'mélancolique', menacant: 'menaçant', neutre: 'neutre' };

const engine = new MusicEngine();
let text, sentences, spans, memory, current = 0, auto = false, autoTimer = null;

function load(t) {
  text = t;
  sentences = splitSentences(text);
  memory = new Memory(hashText(text));
  current = Math.min(memory.data.position ?? 0, Math.max(0, sentences.length - 1));
  render();
  highlight();
  renderMemory();
  if (current > 0) {
    const pl = PLACES[memory.data.place]?.name ?? 'lieu inconnu';
    const r = $('resume'); r.hidden = false;
    r.textContent = `Reprise à la phrase ${current + 1} · ${pl} — la musique repartira de l'état mémorisé.`;
    setTimeout(() => (r.hidden = true), 6000);
  }
}

function render() {
  const reader = $('reader'); reader.innerHTML = '';
  spans = [];
  // Paragraphes : on regroupe d'après les sauts de ligne du texte source.
  const paras = text.split(/\n\s*\n/);
  let idx = 0;
  for (const para of paras) {
    const n = splitSentences(para).length;
    const p = document.createElement('p');
    for (let k = 0; k < n; k++, idx++) {
      const s = document.createElement('span');
      s.className = 's'; s.textContent = sentences[idx] + ' ';
      const i = idx; s.onclick = () => goTo(i, true);
      spans.push(s); p.appendChild(s);
    }
    reader.appendChild(p);
  }
}

function highlight() {
  spans.forEach((s, i) => {
    s.classList.toggle('now', i === current);
    s.classList.toggle('look', i > current && i <= current + 4);
  });
  spans[current]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function goTo(i, jumped = false) {
  current = Math.max(0, Math.min(sentences.length - 1, i));
  highlight();
  memory.setPosition(current);

  const a = analyzeWindow(sentences, current);
  const placeId = placeAt(sentences, current);

  if (engine.running) {
    if (placeId !== engine.placeId) changePlace(placeId);
    const dread = memory.updateDread(placeId, a.tension);
    // la mémoire du lieu pèse sur la tension : un marécage devenu dangereux le reste un peu
    const tension = Math.max(a.tension, dread * 0.6);
    engine.setTarget({ tension, valence: a.valence, movement: a.movement });
    if (jumped) engine.cur.tension = tension;
  }
  $('place').textContent = PLACES[placeId].name;
  $('valence').textContent = `Valence : ${VAL_LABEL[a.valence]}`;
  $('m-tension').style.width = `${Math.round(a.tension * 100)}%`;
  $('m-move').style.width = `${Math.round(a.movement * 100)}%`;
  renderMemory();
}

function changePlace(placeId) {
  const prev = engine.placeId;
  if (prev) memory.save(prev, engine.snapshot());
  const mem = memory.enter(placeId);
  // état mémorisé rechargé instantanément (leitmotif à la bonne position, gamme)
  engine.enterPlace(placeId, mem.motifIdx !== undefined ? mem : null);
}

function renderMemory() {
  const ul = $('memory'); ul.innerHTML = '';
  const entries = Object.entries(memory.data.places);
  if (!entries.length) { ul.innerHTML = '<li>Aucun lieu visité</li>'; return; }
  for (const [id, p] of entries) {
    const li = document.createElement('li');
    li.innerHTML = `<b>${PLACES[id].name}</b> — ${p.visits} visite${p.visits > 1 ? 's' : ''}, malaise ${Math.round((p.dread ?? 0) * 100)}%`;
    ul.appendChild(li);
  }
}

function scheduleAuto() {
  clearTimeout(autoTimer);
  if (!auto) return;
  const words = sentences[current].split(/\s+/).length;
  const ms = (words / Number($('wpm').value)) * 60000 + 250;
  autoTimer = setTimeout(() => {
    if (current >= sentences.length - 1) { toggleAuto(false); return; }
    goTo(current + 1); scheduleAuto();
  }, ms);
}

function toggleAuto(on = !auto) {
  auto = on;
  $('auto').textContent = `Lecture auto : ${auto ? 'on' : 'off'}`;
  scheduleAuto();
}

$('start').onclick = async () => {
  await engine.start();
  engine.onTick = null;
  $('start').disabled = true; $('start').textContent = '♪ Audio actif';
  $('auto').disabled = false;
  goTo(current, true);
};
$('auto').onclick = () => toggleAuto();
$('wpm').oninput = (e) => { $('wpmv').textContent = e.target.value; };
$('vol').oninput = (e) => engine.setVolume(Number(e.target.value) / 100);
$('clear').onclick = () => { memory.clear(); current = 0; renderMemory(); goTo(0, true); };
$('load').onclick = () => { const v = $('custom').value.trim(); if (v) { toggleAuto(false); load(v); goTo(0, true); } };
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goTo(current + 1);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goTo(current - 1);
  if (e.key === ' ') { e.preventDefault(); if (!$('auto').disabled) toggleAuto(); }
});

load(SAMPLE_TEXT);
window.__readsic = { engine, goTo, get memory() { return memory; } }; // pour debug/tests

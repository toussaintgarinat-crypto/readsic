import { splitSentences, analyzeWindow, placeAt } from './analyzer.js';
import { PLACES, MODES, VALENCE_MODE, VALENCE_LABEL, keyInfo } from './places.js';
import { Modulator } from './modulation.js';
import { MusicEngine } from './engine.js';
import { Memory, hashText } from './memory.js';
import { LlmScores, normalizeScores } from './llm-analyzer.js';
import { buildStoryboard } from './storyboard.js';
import { compareAnalyses, tally } from './compare.js';
import { detectPlace, setLexicon, mergeOverrides, getLexiconOverrides } from './analyzer.js';
import { suggestLexicon, toOverrides, evaluateOverrides } from './lexicon-tuning.js';
import { EXTRA } from './lexicon-extra.js';
import { SAMPLE_TEXT } from './sample.js';

const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { intro: 'introduction', developpement: 'développement', paroxysme: 'paroxysme', resolution: 'résolution' };
const PHASE_COLOR = { intro: '#4f6d8f', developpement: '#8f7a3a', paroxysme: '#b4443f', resolution: '#4f8f6a' };

const LEX_KEY = 'readsic.lexicon.v1';
const localOverrides = () => { try { return JSON.parse(localStorage.getItem(LEX_KEY) ?? '{}'); } catch { return {}; } };
setLexicon(mergeOverrides(EXTRA, localOverrides())); // ajustements de lexique (fichier + navigateur)

const engine = new MusicEngine();
let text, sentences, spans, memory, current = 0, auto = false, autoTimer = null;
const modulator = new Modulator();
let lastMove = null;
let llm = null;          // LlmScores quand la source "Claude" est active
let sb = null;           // storyboard (mode 2)
let mode = 'live';       // 'live' | 'cinema'
let llmAvailable = false;
let cmpLlm = null;       // scores LLM utilisés par la comparaison (indépendants de la source d'écoute)
let llmInfo = null;
let imported = null;     // analyse importée (JSON) : utilisable sans serveur LLM

// ---- sources d'analyse ------------------------------------------------------
const detectFn = () => (llm ? (_s, k) => llm.placeAt(k) : null);
const sentScore = (i) => llm?.sentScore(i) ?? analyzeWindow(sentences, i, [1]);
const liveAnalysis = (i) => analyzeWindow(sentences, i, undefined, llm ? (k) => llm.scoreAt(k) : null);

function load(t) {
  text = t;
  sentences = splitSentences(text);
  memory = new Memory(hashText(text));
  llm = null; sb = null; imported = null; mode = 'live';
  $('source').value = 'lex'; $('mode').value = 'live'; $('mode').options[1].disabled = true;
  $('storyboard').hidden = true; $('chars-card').hidden = true; $('compare').hidden = true; cmpLlm = null; $('llm-status').textContent = '—'; $('compose-status').textContent = '';
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

// ---- lecture ---------------------------------------------------------------
function goTo(i, jumped = false) {
  engine.unfade();
  current = Math.max(0, Math.min(sentences.length - 1, i));
  highlight();
  memory.setPosition(current);
  llm?.focus(current);

  const cinema = mode === 'cinema' && sb;
  let a, placeId, offset = 0;
  if (cinema) {
    const P = sb.plan;
    a = { tension: P.tension[current], valence: P.valence[current], movement: P.movement[current] };
    placeId = P.place[current]; offset = P.offset[current]; lastMove = P.move[current] ?? lastMove;
  } else {
    a = liveAnalysis(current);
    placeId = placeAt(sentences, current, detectFn());
  }

  if (engine.running) {
    if (placeId !== engine.placeId) changePlace(placeId, cinema ? offset : undefined);
    else if (cinema) engine.modulate(offset); // modulation planifiée
    if (cinema) {
      engine.setTarget(a);
      if (jumped) engine.cur.tension = a.tension;
      else for (const id of sb.cues[current]) { // leitmotifs annoncés à l'entrée des personnages
        const c = sb.characters.find((x) => x.id === id);
        if (c && engine.playLeitmotif(c)) $('flash').textContent = `♪ leitmotif de ${c.name}`;
      }
    } else {
      const dread = memory.updateDread(placeId, a.tension);
      // la mémoire du lieu pèse sur la tension : un marécage devenu dangereux le reste un peu
      const tension = Math.max(a.tension, dread * 0.6);
      engine.setTarget({ tension, valence: a.valence, movement: a.movement });
      if (jumped) { engine.cur.tension = tension; modulator.prevT = tension; modulator.prevV = a.valence; }
      else {
        const move = modulator.update({ tension, valence: a.valence });
        if (move) { engine.modulate(move.offset); lastMove = move; }
      }
    }
  }
  $('place').textContent = PLACES[placeId].name;
  renderTheory(placeId, a, cinema ? offset : modulator.offset);
  $('m-tension').style.width = `${Math.round(a.tension * 100)}%`;
  $('m-move').style.width = `${Math.round(a.movement * 100)}%`;
  moveCursor();
  renderMemory();
}

function changePlace(placeId, forcedOffset) {
  const prev = engine.placeId;
  if (prev) memory.save(prev, engine.snapshot());
  const mem = memory.enter(placeId);
  const offset = forcedOffset ?? mem.offset ?? 0; // le plan (mode 2) impose la tonalité ; sinon celle mémorisée
  modulator.reset(offset);
  if (forcedOffset === undefined) lastMove = null;
  // état mémorisé rechargé instantanément (leitmotif à la bonne position, gamme)
  engine.enterPlace(placeId, { ...(mem.motifIdx !== undefined ? mem : {}), offset });
}

const rootPc = (placeId, offset) => PLACES[placeId].pc + offset;

function renderTheory(placeId, a, off) {
  const place = PLACES[placeId];
  const modeId = VALENCE_MODE[a.valence] ?? place.mode;
  const mode = MODES[modeId];
  if (!engine.running) off = 0;
  const k = keyInfo(rootPc(placeId, off), modeId);
  $('valence').textContent = `Valence : ${VALENCE_LABEL[a.valence]}`;
  $('theory').innerHTML =
    `<b>${k.label}</b> · mode ${mode.name.toLowerCase()}<br>` +
    `<span class="muted">${mode.feel}${k.emotion ? ` — tonalité : ${k.emotion}` : ''}</span>` +
    (off ? `<br><span class="muted">transposé de ${off > 0 ? '+' : ''}${off} ½ ton (lieu : ${keyInfo(place.pc, place.mode).label})</span>` : '');
  $('move').textContent = lastMove ? `↝ ${lastMove.label}` : '—';
}

function renderMemory() {
  const ul = $('memory'); ul.innerHTML = '';
  const entries = Object.entries(memory.data.places);
  if (!entries.length) { ul.innerHTML = '<li>Aucun lieu visité</li>'; return; }
  for (const [id, p] of entries) {
    const li = document.createElement('li');
    const off = p.offset ? `, ${p.offset > 0 ? '+' : ''}${p.offset} ½ ton` : '';
    li.innerHTML = `<b>${PLACES[id].name}</b> — ${p.visits} visite${p.visits > 1 ? 's' : ''}, malaise ${Math.round((p.dread ?? 0) * 100)}%${off}`;
    ul.appendChild(li);
  }
}

// ---- LLM (source d'analyse) -------------------------------------------------
function llmStatus() {
  if (!llm) return;
  if (llm.imported) { $('llm-status').textContent = `Analyse importée : ${llm.done}/${sentences.length} phrases`; return; }
  $('llm-status').textContent = llm.error ? `LLM : ${llm.error} — repli sur les mots-clés` : `LLM : ${llm.done}/${sentences.length} phrases analysées${llm.running ? '…' : ''}`;
}

async function setSource(src) {
  if (src === 'llm') {
    llm = imported ?? new LlmScores(sentences, { onUpdate: llmStatus });
    llmStatus(); llm.focus(current); if (!llm.imported) llm.run();
  } else { llm = null; $('llm-status').textContent = '—'; }
  sb = null; mode = 'live'; $('mode').value = 'live'; $('mode').options[1].disabled = true;
  $('storyboard').hidden = true; $('chars-card').hidden = true; $('compose-status').textContent = '';
}

// ---- Comparaison mots-clés / LLM ---------------------------------------------
const lexAt = (i) => ({ ...analyzeWindow(sentences, i, [1]), place: detectPlace(sentences[i]) });
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
const f2 = (x) => (x === null ? '—' : x.toFixed(2));
const prefKey = () => `readsic.cmp.v1.${hashText(text)}.${llmInfo?.provider}.${llmInfo?.model}`;
const loadPrefs = () => { try { return JSON.parse(localStorage.getItem(prefKey()) ?? '{}'); } catch { return {}; } };
let cmpAll = false;
let voteRows = [];

const download = (name, obj) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

function exportVotes() {
  download(`readsic-votes-${hashText(text)}.json`, {
    version: 1, exportedAt: new Date().toISOString(), textId: hashText(text), provider: llmInfo?.provider, model: llmInfo?.model, rows: voteRows,
  });
}

function renderTuning() {
  const box = $('cmp-tuning'), minSupport = Math.max(1, Number($('cmp-minsup').value) || 2);
  const sug = suggestLexicon(voteRows, { minSupport });
  const items = [
    ...sug.add.map((s) => ({ ...s, kind: 'add' })), ...sug.remove.map((s) => ({ ...s, kind: 'remove' })),
    ...sug.placeAdd.map((s) => ({ ...s, kind: 'placeAdd' })), ...sug.placeRemove.map((s) => ({ ...s, kind: 'placeRemove' })),
  ];
  box.hidden = false; box.innerHTML = '';
  const votesLlm = voteRows.filter((r) => r.vote === 'llm').length;
  if (!items.length) {
    box.textContent = votesLlm
      ? `Rien d'assez étayé avec ${votesLlm} vote(s) « LLM » : il faut au moins ${minSupport} phrases où le même mot explique l'erreur. Votez sur plus de phrases ou baissez le support minimum.`
      : 'Votez « LLM » sur les phrases où il a raison contre les mots-clés : ce sont elles qui permettent de déduire des mots.';
    return;
  }
  const head = document.createElement('div'); head.className = 'muted';
  head.textContent = `Propositions déduites de ${votesLlm} vote(s) « LLM » (mots-clés et lieux) — décochez ce qui vous paraît faux :`;
  const ul = document.createElement('ul'), evalDiv = document.createElement('div'); evalDiv.className = 'muted';
  const checks = items.map((it) => {
    const li = document.createElement('li'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true;
    const ex = it.rows.slice(0, 2).map((i) => `« ${sentences[i].slice(0, 40)}… »`).join(', ');
    const plus = it.kind === 'add' || it.kind === 'placeAdd', isPlace = it.kind.startsWith('place');
    li.append(cb, ` ${plus ? '+ ajouter' : '− retirer'} `);
    const code = document.createElement('code'); code.textContent = it.stem ?? it.word;
    li.append(code, isPlace ? ` → lieu « ${PLACES[it.place].name} » (${it.support} phrases : ${ex})` : ` → ${it.cat} (${it.support} phrases : ${ex})`);
    cb.onchange = refresh; ul.appendChild(li); return { cb, it };
  });
  const pick = (kind) => checks.filter((c) => c.cb.checked && c.it.kind === kind).map((c) => c.it);
  const selected = () => toOverrides({ add: pick('add'), remove: pick('remove'), placeAdd: pick('placeAdd'), placeRemove: pick('placeRemove') });
  function refresh() {
    const ev = evaluateOverrides(voteRows, selected());
    const f = (x) => (x === null ? '—' : x.toFixed(2)), p = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`);
    const line = (k, l) => `${l} (n=${ev.before[k].n}) : écart de tension ${f(ev.before[k].tensionMAE)} → ${f(ev.after[k].tensionMAE)}, valence identique ${p(ev.before[k].valenceAgree)} → ${p(ev.after[k].valenceAgree)}, même lieu ${p(ev.before[k].placeAgree)} → ${p(ev.after[k].placeAgree)}`;
    evalDiv.innerHTML = '';
    for (const [k, l] of [['voted', 'Phrases votées, optimiste car elles ont servi à ajuster'], ['held', 'Autres phrases, contrôle hors échantillon']]) { const d = document.createElement('div'); d.textContent = line(k, l); evalDiv.appendChild(d); }
  }
  refresh();
  const bar = document.createElement('div'); bar.className = 'cmp-actions';
  const btn = (label, fn) => { const b = document.createElement('button'); b.className = 'ghost'; b.textContent = label; b.onclick = fn; bar.appendChild(b); };
  btn('Appliquer dans ce navigateur', () => { localStorage.setItem(LEX_KEY, JSON.stringify(mergeOverrides(localOverrides(), selected()))); setLexicon(mergeOverrides(EXTRA, localOverrides())); renderCompare(); });
  btn('Télécharger le patch (JSON)', () => download('readsic-lexicon-patch.json', selected()));
  btn('Réinitialiser les ajustements', () => { localStorage.removeItem(LEX_KEY); setLexicon(EXTRA); renderCompare(); });
  box.append(head, ul, evalDiv, bar);
  const note = document.createElement('div'); note.className = 'muted';
  note.textContent = 'Pour les inscrire dans le dépôt : exporter les votes puis `node scripts/tune-lexicon.mjs votes.json --write`.';
  box.appendChild(note);
}

async function openCompare() {
  const btn = $('compare-btn');
  btn.disabled = true;
  try {
    cmpLlm = llm ?? cmpLlm ?? new LlmScores(sentences, { onUpdate: (l) => ($('compose-status').textContent = l.error ? `LLM : ${l.error}` : `LLM : ${l.done}/${sentences.length} phrases analysées…`) });
    if (!cmpLlm.complete) { cmpLlm.focus(current); await cmpLlm.completeAll(); }
    if (!cmpLlm.complete) { $('compose-status').textContent = `Comparaison impossible : ${cmpLlm.error ?? 'analyse LLM incomplète'}.`; return; }
    $('compose-status').textContent = '';
    renderCompare();
  } finally { btn.disabled = !llmAvailable; }
}

function renderCompare() {
  const { rows, summary: m } = compareAnalyses(sentences.length, lexAt, (i) => {
    const s = cmpLlm.scores[i]; return s ? { tension: s.tension, valence: s.valence, movement: s.movement, place: s.place } : null;
  });
  const prefs = loadPrefs();
  voteRows = rows.map((r) => ({ i: r.i, sentence: sentences[r.i], lex: r.lex, llm: r.llm, vote: prefs[r.i] ?? null }));
  $('cmp-model').textContent = llmInfo ? `— ${llmInfo.provider} / ${llmInfo.model}` : '';
  const cell = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
  $('cmp-summary').innerHTML =
    cell(`${m.covered}/${m.n}`, 'phrases comparées') + cell(f2(m.tensionCorr), 'corrélation de tension') +
    cell(f2(m.tensionMAE), 'écart moyen de tension') + cell(pct(m.valenceAgree), 'même valence') +
    cell(pct(m.placeAgree), 'même lieu') + cell(`${pct(m.lexNeutral)} / ${pct(m.llmNeutral)}`, 'neutre : mots-clés / LLM');

  // courbes superposées
  const n = rows.length, x = (i) => (sentences.length > 1 ? (i / (sentences.length - 1)) * 600 : 0), y = (t) => 105 - t * 100;
  const line = (k) => `<path stroke="${k === 'lex' ? '#e0a84a' : '#5aa9e6'}" d="${rows.map((r, j) => `${j ? 'L' : 'M'}${x(r.i).toFixed(1)},${y(r[k].tension).toFixed(1)}`).join(' ')}"/>`;
  $('cmp-svg').innerHTML = n ? line('lex') + line('llm') : '';

  // tableau : plus gros désaccords d'abord
  const shown = [...rows].sort((a, b) => b.gap - a.gap).filter((r) => cmpAll || r.gap > 0.25).slice(0, cmpAll ? rows.length : 12);
  const tbl = $('cmp-table'); tbl.innerHTML = '';
  const t = tally(prefs);
  $('cmp-verdict').textContent = t.total
    ? `Votre verdict sur ${t.total} phrase(s) : mots-clés ${t.lex} · LLM ${t.llm} · égalité ${t.tie}.`
    : 'Cliquez sur la phrase pour l’écouter, puis votez : quelle analyse est la plus juste ?';
  if (!shown.length) tbl.innerHTML = '<tr><td class="muted">Aucun désaccord notable.</td></tr>';
  for (const r of shown) {
    const tr = document.createElement('tr'); tr.className = 'row';
    const td = (cls, txt) => { const c = document.createElement('td'); c.className = cls; c.textContent = txt; tr.appendChild(c); return c; };
    td('txt', sentences[r.i]);
    const desc = (a) => `${a.valence} · T ${a.tension.toFixed(2)} · M ${a.movement.toFixed(2)}${a.place ? ' · ' + PLACES[a.place]?.name : ''}`;
    td('num', 'mots-clés : ' + desc(r.lex)); td('num', 'LLM : ' + desc(r.llm));
    const vote = document.createElement('td');
    for (const [k, label] of [['lex', 'mots-clés'], ['tie', '='], ['llm', 'LLM']]) {
      const b = document.createElement('button'); b.className = 'ghost' + (prefs[r.i] === k ? ' on' : ''); b.textContent = label;
      b.onclick = (e) => { e.stopPropagation(); prefs[r.i] = k; try { localStorage.setItem(prefKey(), JSON.stringify(prefs)); } catch { /* quota */ } renderCompare(); };
      vote.appendChild(b);
    }
    tr.appendChild(vote);
    tr.onclick = () => goTo(r.i, true);
    tbl.appendChild(tr);
  }
  $('compare').hidden = false;
}

// ---- Mode 2 : storyboard ---------------------------------------------------
async function compose() {
  const btn = $('compose'), st = $('compose-status');
  btn.disabled = true;
  try {
    if (llm && !llm.complete) {
      st.textContent = 'Analyse LLM du texte entier…';
      const iv = setInterval(llmStatus, 300);
      const ok = await llm.completeAll(); clearInterval(iv); llmStatus();
      if (!ok) st.textContent = 'LLM indisponible : storyboard composé avec les mots-clés.';
    }
    sb = buildStoryboard(sentences, sentScore, { detect: detectFn(), characters: $('extra-chars').value.split(',').map((x) => x.trim()).filter(Boolean) });
    const climaxes = sb.chapters.filter((c) => c.climax !== null).length;
    if (!st.textContent.startsWith('LLM indisponible')) st.textContent = `${sb.chapters.length} arcs, ${climaxes} climax, ${sb.characters.length} personnage(s).`;
    $('mode').options[1].disabled = false; $('mode').value = 'cinema'; mode = 'cinema';
    renderStoryboard();
    goTo(current, true);
  } finally { btn.disabled = false; }
}

function renderStoryboard() {
  const W = 600, n = sb.n, x = (i) => (n > 1 ? (i / (n - 1)) * W : 0), y = (t) => 110 - t * 100;
  const P = sb.plan, hue = {};
  Object.keys(PLACES).forEach((id, k) => (hue[id] = `hsl(${(k * 47) % 360} 38% 42%)`));
  const run = (arr, fn) => { let out = '', s = 0; for (let i = 1; i <= n; i++) if (i === n || arr[i] !== arr[s]) { out += fn(s, i - 1); s = i; } return out; };
  let svg = `<path class="area" d="M0,110 ${P.tension.map((t, i) => `L${x(i).toFixed(1)},${y(t).toFixed(1)}`).join(' ')} L${W},110 Z"/>`;
  svg += run(P.phase, (a, b) => `<rect x="${x(a)}" y="116" width="${Math.max(1, x(b + 1 > n - 1 ? n - 1 : b + 1) - x(a))}" height="8" fill="${PHASE_COLOR[P.phase[a]]}"/>`);
  svg += run(P.place, (a, b) => `<rect x="${x(a)}" y="128" width="${Math.max(1, x(b + 1 > n - 1 ? n - 1 : b + 1) - x(a))}" height="8" fill="${hue[P.place[a]]}"><title>${PLACES[P.place[a]].name}</title></rect>`);
  sb.chapters.forEach((c, k) => {
    if (k) svg += `<line class="bound" x1="${x(c.start)}" x2="${x(c.start)}" y1="0" y2="140"/>`;
    svg += `<text x="${x(c.start) + 3}" y="9">${c.title.replace(/</g, '&lt;')}</text>`;
    if (c.climax !== null) svg += `<path class="climax" d="M${x(c.climax) - 4},${y(P.tension[c.climax]) - 2} h8 l-4,-8 z"/>`;
  });
  svg += `<line id="sb-cursor" class="cur" x1="0" x2="0" y1="0" y2="140"/>`;
  $('sb-svg').innerHTML = svg;
  $('sb-sub').textContent = '— tension planifiée, phases, lieux';
  $('sb-legend').innerHTML = Object.entries(PHASE_LABEL).map(([k, l]) => `<span><i style="background:${PHASE_COLOR[k]}"></i>${l}</span>`).join('') + '<span>▲ climax</span>';
  $('storyboard').hidden = false;

  const ul = $('chars'); ul.innerHTML = '';
  sb.characters.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<span><b>${c.name}</b> · ${c.instrument} · <code>${c.motif.join(' ')}</code></span>`;
    const b = document.createElement('button'); b.className = 'ghost'; b.textContent = '▶';
    b.onclick = () => engine.playLeitmotif(c);
    li.appendChild(b); ul.appendChild(li);
  });
  if (!sb.characters.length) ul.innerHTML = '<li>Aucun personnage détecté</li>';
  $('chars-card').hidden = false;
  moveCursor();
}

function moveCursor() {
  const c = $('sb-cursor'); if (!c || !sb) return;
  const xx = sb.n > 1 ? (current / (sb.n - 1)) * 600 : 0;
  c.setAttribute('x1', xx); c.setAttribute('x2', xx);
}

// ---- lecture automatique & commandes ------------------------------------------
function scheduleAuto() {
  clearTimeout(autoTimer);
  if (!auto) return;
  const words = sentences[current].split(/\s+/).length;
  const ms = (words / Number($('wpm').value)) * 60000 + 250;
  autoTimer = setTimeout(() => {
    if (current >= sentences.length - 1) { toggleAuto(false); engine.fadeOut(6); return; }
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
  $('auto').disabled = false; $('rec').disabled = false;
  goTo(current, true);
};
$('auto').onclick = () => toggleAuto();
$('rec').onclick = async () => {
  const b = $('rec');
  if (!engine.recorder) { if (engine.recordStart()) b.textContent = '■ Arrêter et télécharger'; return; }
  const blob = await engine.recordStop(); b.textContent = '● Enregistrer';
  if (blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `readsic-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
};
$('wpm').oninput = (e) => { $('wpmv').textContent = e.target.value; };
$('vol').oninput = (e) => engine.setVolume(Number(e.target.value) / 100);
$('clear').onclick = () => { memory.clear(); current = 0; renderMemory(); goTo(0, true); };
$('load').onclick = () => { const v = $('custom').value.trim(); if (v) { toggleAuto(false); load(v); goTo(0, true); } };
$('source').onchange = (e) => setSource(e.target.value);
$('mode').onchange = (e) => { mode = e.target.value; goTo(current, true); };
$('compose').onclick = () => compose();
$('import').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const obj = JSON.parse(await f.text());
    imported = new LlmScores(sentences, { onUpdate: llmStatus });
    imported.import(obj.scores ?? obj);
    llmInfo = { llm: true, provider: 'import', model: obj.source ?? f.name };
    llmAvailable = true; $('compare-btn').disabled = false;
    $('source').options[1].disabled = false; $('source').options[1].textContent = `Analyse importée (${f.name})`;
    $('source').value = 'llm'; await setSource('llm'); goTo(current, true);
  } catch (err) { imported = null; $('llm-status').textContent = `Import impossible : ${err.message}`; }
};
$('compare-btn').onclick = () => openCompare();
$('cmp-export').onclick = () => exportVotes();
$('cmp-tune').onclick = () => renderTuning();
$('cmp-all').onchange = (e) => { cmpAll = e.target.checked; renderCompare(); };
$('sb-svg').onclick = (e) => {
  if (!sb) return;
  const r = e.currentTarget.getBoundingClientRect();
  goTo(Math.round(((e.clientX - r.left) / r.width) * (sb.n - 1)), true);
};
document.addEventListener('keydown', (e) => {
  if (['TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') goTo(current + 1);
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') goTo(current - 1);
  if (e.key === ' ') { e.preventDefault(); if (!$('auto').disabled) toggleAuto(); }
});

load(SAMPLE_TEXT);
LlmScores.available().then((h) => {
  llmAvailable = h.llm; llmInfo = h;
  $('compare-btn').disabled = !h.llm;
  $('source').options[1].disabled = !h.llm;
  if (h.llm) $('source').options[1].textContent = `LLM : ${h.provider} / ${h.model}`;
  $('llm-status').textContent = h.llm ? `Analyse LLM disponible (${h.provider})` : 'Analyse LLM indisponible — configurer un fournisseur (voir README)';
});
window.__readsic = { importScores: (list, name) => { imported = new LlmScores(sentences, { onUpdate: llmStatus }); imported.import(list); llmInfo = { llm: true, provider: 'import', model: name ?? 'import' }; llmAvailable = true; $('compare-btn').disabled = false; $('source').options[1].disabled = false; $('source').value = 'llm'; return setSource('llm'); }, load, openCompare, getLexiconOverrides, engine, goTo, get memory() { return memory; }, get sb() { return sb; }, compose, setSource, get llm() { return llm; } }; // debug/tests

// Client navigateur de l'analyseur LLM (via /api/analyze). Les phrases sont analysées par lots,
// en avance de lecture ; tant qu'un lot n'est pas revenu, l'heuristique par mots-clés prend le relais.
import { hashText } from './memory.js';
import { PLACES, VALENCE_MODE } from './places.js';

const CHUNK = 8;

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(+x) ? +x : 0));

// Valide et borne une analyse fournie de l'extérieur (annotation manuelle, autre outil) :
// tableau d'un élément par phrase { tension, valence, movement, place }.
export function normalizeScores(list, n) {
  if (!Array.isArray(list)) throw new Error('format attendu : un tableau "scores" (ou le tableau seul)');
  if (list.length !== n) throw new Error(`${list.length} éléments pour ${n} phrases : l'analyse ne correspond pas à ce texte`);
  return list.map((r) => r && {
    tension: clamp01(r.tension), movement: clamp01(r.movement),
    valence: r.valence in VALENCE_MODE ? r.valence : 'neutre',
    place: r.place in PLACES && r.place !== 'defaut' ? r.place : null,
  });
}

export class LlmScores {
  constructor(sentences, { onUpdate = () => {} } = {}) {
    this.sentences = sentences;
    this.scores = new Array(sentences.length).fill(null);
    this.onUpdate = onUpdate;
    this.cursor = 0;
    this.running = false;
    this.error = null;
    this.key = 'readsic.llm.v1.' + hashText(sentences.join('\n'));
    try { const c = JSON.parse(localStorage.getItem(this.key) ?? 'null'); if (Array.isArray(c) && c.length === this.scores.length) this.scores = c; } catch { /* pas de cache */ }
  }

  // -> { llm: boolean, provider, model } ; jamais d'exception.
  static async available() {
    try { const d = await (await fetch('/api/health')).json(); return { llm: d.llm === true, provider: d.provider, model: d.model }; } catch { return { llm: false }; }
  }

  get done() { return this.scores.filter(Boolean).length; }
  get complete() { return this.done === this.scores.length; }

  // Score au format interne de l'analyseur, ou null (=> heuristique).
  scoreAt(i) {
    const s = this.scores[i]; if (!s) return null;
    return { tension: s.tension, movement: s.movement, val: s.valence === 'neutre' ? {} : { [s.valence]: 1.5 } };
  }
  // undefined = pas encore analysé ; null = aucun lieu ; sinon id de lieu.
  placeAt(i) { const s = this.scores[i]; return s ? s.place : undefined; }
  sentScore(i) { const s = this.scores[i]; return s ? { tension: s.tension, valence: s.valence, movement: s.movement } : null; }

  // Analyse fournie de l'extérieur : remplace l'appel au serveur.
  import(list) { this.scores = normalizeScores(list, this.sentences.length); this.imported = true; this.onUpdate(this); }

  focus(i) { this.cursor = i; }

  nextChunkStart() {
    const n = this.scores.length;
    for (let k = 0; k < n; k += CHUNK) {
      const start = (Math.floor(this.cursor / CHUNK) * CHUNK + k) % (Math.ceil(n / CHUNK) * CHUNK);
      if (start < n && this.scores.slice(start, start + CHUNK).some((x) => !x)) return start;
    }
    return -1;
  }

  async run() {
    if (this.running) return;
    this.running = true; this.error = null;
    try {
      for (let start = this.nextChunkStart(); start >= 0; start = this.nextChunkStart()) {
        const body = { sentences: this.sentences.slice(start, start + CHUNK), before: this.sentences.slice(Math.max(0, start - 3), start) };
        const r = await fetch('/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
        data.results.forEach((x, k) => { if (x) this.scores[start + k] = x; });
        // un lot où rien n'est revenu : on le marque pour ne pas boucler
        if (!this.scores.slice(start, start + CHUNK).some(Boolean)) throw new Error('lot sans résultat');
        try { localStorage.setItem(this.key, JSON.stringify(this.scores)); } catch { /* quota */ }
        this.onUpdate(this);
      }
    } catch (e) { this.error = e.message; this.onUpdate(this); }
    finally { this.running = false; this.onUpdate(this); }
  }

  // Attend que tout soit analysé (mode 2). Retourne false en cas d'erreur.
  async completeAll() {
    while (!this.complete) { await this.run(); if (this.error) return false; }
    return true;
  }
}

// Persistance spatiale et narrative : état musical de chaque lieu + position de lecture.
// localStorage si disponible, sinon simple mémoire volatile.

const KEY = 'readsic.memory.v1';

export class Memory {
  constructor(textId) {
    this.textId = textId;
    this.data = { textId, places: {}, position: 0, place: null };
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      if (raw && raw.textId === textId) this.data = raw;
    } catch { /* stockage indisponible */ }
  }

  get(placeId) { return this.data.places[placeId] ?? null; }

  // snap : { motifIdx, valence, movement } ; dread = "malaise" lentement accumulé dans ce lieu.
  save(placeId, snap) {
    const prev = this.get(placeId) ?? { visits: 0, dread: 0 };
    this.data.places[placeId] = { ...prev, ...snap, at: Date.now() };
    this.persist();
  }

  enter(placeId) {
    const p = this.get(placeId) ?? { visits: 0, dread: 0 };
    p.visits += 1;
    this.data.places[placeId] = p;
    this.data.place = placeId;
    this.persist();
    return p;
  }

  // Le malaise du lieu suit lentement la tension vécue : un marécage devenu dangereux le reste un peu.
  updateDread(placeId, tension, rate = 0.25) {
    const p = this.data.places[placeId];
    if (!p) return 0;
    p.dread = p.dread + (tension - p.dread) * rate;
    return p.dread;
  }

  setPosition(i) { this.data.position = i; this.persist(); }
  persist() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* ignore */ } }
  clear() { this.data = { textId: this.textId, places: {}, position: 0, place: null }; this.persist(); }
}

export function hashText(t) {
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

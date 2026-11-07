// Modulations narratives, d'après « Analyse des Modulations… » (Drive).
// Une modulation décale la tonique du lieu (en demi-tons, relativement à sa tonalité d'origine).
//   V  (+7)  : accentue la tension          IV (+5) : détente, suspension
//   ♭III (+3): relatif majeur, mélancolie → espoir
//   chromatique (+1) : montée dramatique    parallèle (0) : ombre → lumière (changement de mode)

export const MOVES = {
  dominante:     { semi: 7, label: 'V — accentue la tension' },
  chromatique:   { semi: 1, label: 'chromatique — montée dramatique' },
  sousDominante: { semi: 5, label: 'IV — détente, suspension' },
  relatifMajeur: { semi: 3, label: '♭III relatif majeur — mélancolie → espoir' },
  parallele:     { semi: 0, label: 'parallèle — ombre → lumière' },
};

const DARK = new Set(['melancolique', 'menacant', 'tragique', 'angoissant']);
const BRIGHT = new Set(['joyeux', 'festif']);
const COOLDOWN = 3; // phrases minimum entre deux modulations
const norm = (o) => { o = ((o % 12) + 12) % 12; return o > 6 ? o - 12 : o; };

export class Modulator {
  constructor(offset = 0) { this.reset(offset); }

  reset(offset = 0) { this.offset = offset; this.prevT = 0; this.prevV = 'neutre'; this.cool = 0; this.calm = 0; }

  // Appelé à chaque phrase. Retourne { kind, label, semi, offset } ou null.
  update({ tension, valence }) {
    const { prevT, prevV } = this;
    this.prevT = tension; this.prevV = valence;
    this.calm = tension < 0.12 ? this.calm + 1 : 0;
    if (this.cool > 0) { this.cool--; return null; }

    let kind = null;
    if (prevT < 0.55 && tension >= 0.55) kind = tension >= 0.8 && (valence === 'angoissant' || valence === 'tragique') ? 'chromatique' : 'dominante';
    else if (prevT >= 0.5 && tension < 0.3) kind = BRIGHT.has(valence) ? 'relatifMajeur' : 'sousDominante';
    else if (DARK.has(prevV) && BRIGHT.has(valence)) kind = 'parallele';

    if (kind) return this.apply(kind);
    if (this.offset !== 0 && this.calm >= 3) { // retour au calme : on revient à la tonique du lieu
      this.offset = 0; this.cool = COOLDOWN; this.calm = 0;
      return { kind: 'retour', label: 'retour à la tonique du lieu', semi: 0, offset: 0 };
    }
    return null;
  }

  apply(kind) {
    const mv = MOVES[kind];
    this.offset = norm(this.offset + mv.semi);
    this.cool = COOLDOWN;
    return { kind, label: mv.label, semi: mv.semi, offset: this.offset };
  }
}

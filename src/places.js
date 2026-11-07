// Théorie musicale issue des recherches du dossier Drive « projet musique » :
//  - « Modes de la gamme majeure naturelle pour do majeur » (15 modes + caractères)
//  - « emotion et gamme musicale » (émotion de chaque tonalité)
//  - « Analyse des Modulations… » (mouvements de tonalité et effet ressenti)

// Intervalles en demi-tons depuis la tonique.
export const MODES = {
  ionian:        { name: 'Ionien',            q: 'M', iv: [0, 2, 4, 5, 7, 9, 11], feel: 'joie pure, équilibre, lumière stable' },
  dorian:        { name: 'Dorien',            q: 'm', iv: [0, 2, 3, 5, 7, 9, 10], feel: 'mineur lumineux, groove chaud' },
  phrygian:      { name: 'Phrygien',          q: 'm', iv: [0, 1, 3, 5, 7, 8, 10], feel: 'mystère sombre, tension espagnole' },
  lydian:        { name: 'Lydien',            q: 'M', iv: [0, 2, 4, 6, 7, 9, 11], feel: 'onirique, lumineux, planant' },
  mixolydian:    { name: 'Mixolydien',        q: 'M', iv: [0, 2, 4, 5, 7, 9, 10], feel: 'fête détendue, joie vivante' },
  aeolian:       { name: 'Éolien',            q: 'm', iv: [0, 2, 3, 5, 7, 8, 10], feel: 'mélancolie naturelle, nostalgie douce' },
  locrian:       { name: 'Locrien',           q: 'm', iv: [0, 1, 3, 5, 6, 8, 10], feel: 'obscurité extrême, instabilité' },
  harmonicMinor: { name: 'Mineur harmonique', q: 'm', iv: [0, 2, 3, 5, 7, 8, 11], feel: 'tragique noble, dramatique, mystique' },
  ionianAug:     { name: 'Ionien augmenté',   q: 'M', iv: [0, 2, 4, 5, 8, 9, 11], feel: 'brillance irréelle, éclat étrange' },
  phrygianDom:   { name: 'Phrygien dominant', q: 'M', iv: [0, 1, 4, 5, 7, 8, 10], feel: 'flamenco, exotique, orientalisme intense' },
  melodicMinor:  { name: 'Mineur mélodique',  q: 'm', iv: [0, 2, 3, 5, 7, 9, 11], feel: 'élégance moderne, tension contrôlée' },
  lydianAug:     { name: 'Lydien augmenté',   q: 'M', iv: [0, 2, 4, 6, 8, 9, 11], feel: 'rêve étrange, flottement éthéré' },
  lydianDom:     { name: 'Lydien dominant',   q: 'M', iv: [0, 2, 4, 6, 7, 9, 10], feel: 'fête moderne, dominante lumineuse' },
  mixolydianb6:  { name: 'Mixolydien ♭6',     q: 'M', iv: [0, 2, 4, 5, 7, 8, 10], feel: 'blues mystique, nostalgie tendue' },
  altered:       { name: 'Altéré',            q: 'm', iv: [0, 1, 3, 4, 6, 8, 10], feel: 'extrême dissonance, chaos contrôlé' },
};

// Valence émotionnelle -> mode (null = gamme par défaut du lieu).
export const VALENCE_MODE = {
  joyeux: 'ionian',
  festif: 'mixolydian',
  melancolique: 'aeolian',
  menacant: 'phrygian',
  tragique: 'harmonicMinor',
  onirique: 'lydian',
  exotique: 'phrygianDom',
  angoissant: 'locrian',
  neutre: null,
};

export const VALENCE_LABEL = {
  joyeux: 'joyeux', festif: 'festif', melancolique: 'mélancolique', menacant: 'menaçant',
  tragique: 'tragique', onirique: 'onirique', exotique: 'exotique', angoissant: 'angoissant', neutre: 'neutre',
};

const PC_NAMES = ['Do', 'Do♯', 'Ré', 'Mi♭', 'Mi', 'Fa', 'Fa♯', 'Sol', 'La♭', 'La', 'Si♭', 'Si'];
export const pcName = (pc) => PC_NAMES[((pc % 12) + 12) % 12];

// Émotion de chaque tonalité (table « emotion et gamme musicale »), clé = "<pc><M|m>".
export const KEY_EMOTION = {
  '0M': 'joie, pureté, innocence, triomphe', '7M': 'sérénité, douceur, pastorale', '2M': 'majesté, victoire, brillance',
  '9M': 'allégresse, confiance, espoir', '4M': 'éclat, luminosité, exaltation', '5M': 'calme, pastoral, paix',
  '10M': 'noblesse, élégance, douceur',
  '9m': 'mélancolie, tristesse douce', '4m': 'introspection, nostalgie', '2m': 'gravité, sérieux, mystère',
  '7m': 'tragique, dramatique, intense', '0m': 'obscurité, tension, pathétique', '5m': 'mélancolie profonde, deuil',
  '11m': 'solitude, mélancolie passionnée',
};

export function keyInfo(rootPc, modeName) {
  const m = MODES[modeName];
  const id = `${((rootPc % 12) + 12) % 12}${m.q}`;
  return { label: `${pcName(rootPc)} ${m.q === 'M' ? 'majeur' : 'mineur'}`, emotion: KEY_EMOTION[id] ?? null, mode: m };
}

// Signature sonore par lieu. pc = classe de hauteur de la tonique (0 = Do).
export const PLACES = {
  marais:  { name: 'Marécage', pattern: /mar[ée]cage|marais|tourbi[èe]re|vase\b|brume|swamp|bayou/i,
             pc: 2, rootHz: 73.42, mode: 'aeolian', instrument: 'bell', tempo: 54, density: 0.35, cutoff: 700, reverb: 0.75, octave: 2 },        // Ré mineur : gravité, mystère
  taverne: { name: 'Taverne', pattern: /taverne|auberge|tavernier|chope|bi[èe]re|comptoir|tavern|\binn\b/i,
             pc: 7, rootHz: 98.0, mode: 'mixolydian', instrument: 'pluck', tempo: 118, density: 0.85, cutoff: 3600, reverb: 0.12, octave: 3 }, // Sol mixolydien : fête détendue
  foret:   { name: 'Forêt', pattern: /for[êe]t|\bbois\b|sentier|feuillage|sous-bois|clairi[èe]re|forest|woods/i,
             pc: 5, rootHz: 87.31, mode: 'ionian', instrument: 'flute', tempo: 70, density: 0.5, cutoff: 2400, reverb: 0.45, octave: 3 },       // Fa majeur : calme, pastoral, paix
  cite:    { name: 'Cité industrielle', pattern: /cit[ée]|usine|chemin[ée]e|forge|ruelle|faubourg|fonderie|\bcity\b|factory/i,
             pc: 0, rootHz: 65.41, mode: 'phrygian', instrument: 'brass', tempo: 88, density: 0.5, cutoff: 1500, reverb: 0.3, octave: 2 },      // Do : obscurité, tension
  mer:     { name: 'Mer', pattern: /\bmer\b|oc[ée]an|vagues?|rivage|navire|\bport\b|falaise|sea\b|shore/i,
             pc: 4, rootHz: 82.41, mode: 'lydian', instrument: 'strings', tempo: 60, density: 0.4, cutoff: 2000, reverb: 0.6, octave: 3 },      // Mi lydien : éclat, onirique
  chateau: { name: 'Château', pattern: /ch[âa]teau|donjon|remparts?|salle du tr[ôo]ne|castle|citadelle/i,
             pc: 5, rootHz: 87.31, mode: 'aeolian', instrument: 'brass', tempo: 66, density: 0.45, cutoff: 1800, reverb: 0.55, octave: 2 },    // Fa mineur : deuil, mélancolie profonde
  grotte:  { name: 'Grotte', pattern: /grotte|caverne|souterrain|galerie obscure|cave\b|cavern/i,
             pc: 11, rootHz: 61.74, mode: 'phrygian', instrument: 'bell', tempo: 48, density: 0.3, cutoff: 900, reverb: 0.9, octave: 2 },      // Si mineur : solitude
  desert:  { name: 'Désert', pattern: /d[ée]sert|dunes?\b|oasis|bazar|souk|caravane|sultan|minaret/i,
             pc: 4, rootHz: 82.41, mode: 'phrygianDom', instrument: 'pluck', tempo: 84, density: 0.55, cutoff: 2800, reverb: 0.35, octave: 3 }, // Mi phrygien dominant : flamenco, exotisme
  defaut:  { name: 'Lieu indéfini', pattern: null,
             pc: 0, rootHz: 130.81, mode: 'dorian', instrument: 'pluck', tempo: 72, density: 0.45, cutoff: 2600, reverb: 0.3, octave: 3 },
};

export const DEFAULT_PLACE = 'defaut';

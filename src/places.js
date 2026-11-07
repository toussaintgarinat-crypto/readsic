// Palettes sonores par lieu : la "signature" d'un décor récurrent.
// rootHz = fondamentale, mode = gamme par défaut, instrument = timbre du motif.

export const MODES = {
  pentaMaj: [0, 2, 4, 7, 9],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};

// La valence émotionnelle module la gamme du lieu sans changer sa palette.
export const VALENCE_MODE = {
  joyeux: 'pentaMaj',
  melancolique: 'aeolian',
  menacant: 'phrygian',
  neutre: null, // gamme par défaut du lieu
};

export const PLACES = {
  marais:   { name: 'Marécage',  pattern: /mar[ée]cage|marais|tourbi[èe]re|vase\b|brume|swamp|bayou/i,
              rootHz: 73.42,  mode: 'aeolian',    instrument: 'bell',    tempo: 54,  density: 0.35, cutoff: 700,  reverb: 0.75, octave: 2 },
  taverne:  { name: 'Taverne',   pattern: /taverne|auberge|tavernier|chope|bi[èe]re|comptoir|tavern|\binn\b/i,
              rootHz: 98.0,   mode: 'mixolydian', instrument: 'pluck',   tempo: 118, density: 0.85, cutoff: 3600, reverb: 0.12, octave: 3 },
  foret:    { name: 'Forêt',     pattern: /for[êe]t|\bbois\b|sentier|feuillage|sous-bois|clairi[èe]re|forest|woods/i,
              rootHz: 110.0,  mode: 'dorian',     instrument: 'flute',   tempo: 70,  density: 0.5,  cutoff: 2400, reverb: 0.45, octave: 3 },
  cite:     { name: 'Cité industrielle', pattern: /cit[ée]|usine|chemin[ée]e|forge|ruelle|faubourg|fonderie|\bcity\b|factory/i,
              rootHz: 65.41,  mode: 'phrygian',   instrument: 'brass',   tempo: 88,  density: 0.5,  cutoff: 1500, reverb: 0.3,  octave: 2 },
  mer:      { name: 'Mer',       pattern: /\bmer\b|oc[ée]an|vagues?|rivage|navire|\bport\b|falaise|sea\b|shore/i,
              rootHz: 82.41,  mode: 'lydian',     instrument: 'strings', tempo: 60,  density: 0.4,  cutoff: 2000, reverb: 0.6,  octave: 3 },
  chateau:  { name: 'Château',   pattern: /ch[âa]teau|donjon|remparts?|salle du tr[ôo]ne|castle|citadelle/i,
              rootHz: 87.31,  mode: 'aeolian',    instrument: 'brass',   tempo: 66,  density: 0.45, cutoff: 1800, reverb: 0.55, octave: 2 },
  grotte:   { name: 'Grotte',    pattern: /grotte|caverne|souterrain|galerie obscure|cave\b|cavern/i,
              rootHz: 61.74,  mode: 'phrygian',   instrument: 'bell',    tempo: 48,  density: 0.3,  cutoff: 900,  reverb: 0.9,  octave: 2 },
  defaut:   { name: 'Lieu indéfini', pattern: null,
              rootHz: 130.81, mode: 'dorian',     instrument: 'pluck',   tempo: 72,  density: 0.45, cutoff: 2600, reverb: 0.3,  octave: 3 },
};

export const DEFAULT_PLACE = 'defaut';

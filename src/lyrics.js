// Paroles synchronisées : instants d'affichage de chaque phrase et sous-titres ASS. Fonctions pures.
import { splitSentences } from './analyzer.js';

// Même formule que la lecture automatique de l'appli (app.js : mots / mpm + 250 ms) : les instants calculés
// coïncident avec ceux de la musique enregistrée.
export function lyricTimings(sentences, wpm = 170, offset = 0) {
  const starts = []; let t = offset;
  for (const s of sentences) { starts.push(t); t += (s.split(/\s+/).length / wpm) * 60 + 0.25; }
  return { starts, end: t };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  return `${Math.floor(cs / 360000)}:${pad(Math.floor(cs / 6000) % 60)}:${pad(Math.floor(cs / 100) % 60)}.${pad(cs % 100)}`;
}
// ASS : { } et \ sont spéciaux ; saut de ligne = \N ; espace insécable \h pour garder la hauteur du bloc.
export const assEscape = (s) => (s.replace(/[{}\\]/g, '') || '\\h').replace(/\n/g, '\\N');

// info[i] (facultatif) : texte discret affiché en bas pendant la phrase i (lieu, tonalité, tension…).
export function buildAss(sentences, { starts, end }, { title = '', info = [], width = 1280, height = 720 } = {}) {
  const out = [
    '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${width}`, `PlayResY: ${height}`, 'WrapStyle: 0', '',
    '[V4+ Styles]',
    'Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding',
    'Style: Lyric,DejaVu Serif,34,&H009CA0A8,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,90,90,40,1',
    'Style: Info,DejaVu Sans,22,&H009CA0A8,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,40,40,150,1',
    'Style: Title,DejaVu Sans,24,&H009CA0A8,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,40,40,30,1',
    '', '[Events]', 'Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text',
  ];
  const dim = '{\\fs34\\c&H8A8F9C&\\b0}', cur = '{\\fs50\\c&HFFFFFF&\\b1}';
  const line = (i) => assEscape(sentences[i] ?? '');
  if (title) out.push(`Dialogue: 0,${assTime(0)},${assTime(end)},Title,,0,0,0,,${assEscape(title)}`);
  sentences.forEach((_, i) => {
    const a = starts[i], b = starts[i + 1] ?? end;
    const text = `{\\fad(120,0)}${dim}${line(i - 2)}\\N${dim}${line(i - 1)}\\N${cur}${line(i)}\\N${dim}${line(i + 1)}\\N${dim}${line(i + 2)}`;
    out.push(`Dialogue: 0,${assTime(a)},${assTime(b)},Lyric,,0,0,0,,${text}`);
    if (info[i]) out.push(`Dialogue: 1,${assTime(a)},${assTime(b)},Info,,0,0,0,,${assEscape(info[i])}`);
  });
  return out.join('\n') + '\n';
}

export { splitSentences };

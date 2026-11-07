#!/usr/bin/env node
// Vidéo à paroles : texte synchronisé sur un rendu audio (+ forme d'onde). Nécessite ffmpeg.
//   node scripts/lyric-video.mjs texte.txt audio.mp3 sortie.mp4 [--wpm 170] [--offset 0.2] [--title "…"] [--timeline timeline.json]
// --timeline : chronologie de l'enregistrement (lieu, tonalité, tension par phrase) -> ligne d'information discrète.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { splitSentences, lyricTimings, buildAss } from '../src/lyrics.js';

const args = process.argv.slice(2), pos = [], opt = {};
for (let k = 0; k < args.length; k++) { if (args[k].startsWith('--')) opt[args[k].slice(2)] = args[++k]; else pos.push(args[k]); }
const [textFile, audio, out] = pos;
if (!textFile || !audio || !out) { console.error('usage : lyric-video.mjs texte.txt audio.mp3 sortie.mp4 [--wpm 170] [--offset s] [--title …] [--timeline f.json]'); process.exit(2); }

const sentences = splitSentences(fs.readFileSync(textFile, 'utf8'));
const wpm = Number(opt.wpm ?? 170);
const timeline = opt.timeline ? JSON.parse(fs.readFileSync(opt.timeline, 'utf8')) : null;

// Décalage : celui donné, sinon calé sur la chronologie mesurée (médiane de l'écart mesuré - calculé).
let offset = opt.offset !== undefined ? Number(opt.offset) : 0;
if (opt.offset === undefined && timeline) {
  const calc = lyricTimings(sentences, wpm).starts;
  const d = timeline.map((r) => r.t - calc[r.i]).sort((a, b) => a - b);
  offset = Math.max(0, d[Math.floor(d.length / 2)] - 0.2); // la mesure arrive en retard d'environ 0,2 s (échantillonnage)
}
const timings = lyricTimings(sentences, wpm, offset);
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio], { encoding: 'utf8' }));
timings.end = Math.min(timings.end, dur);

const info = timeline ? sentences.map((_, i) => { const r = timeline.find((x) => x.i === i); return r ? `${r.theory}  ·  tension ${r.tension.toFixed(2)}` : ''; }) : [];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrics-'));
const ass = path.join(dir, 'lyrics.ass');
fs.writeFileSync(ass, buildAss(sentences, timings, { title: opt.title ?? '', info }));

execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x0f1117:s=1280x720:r=25', '-i', audio, '-filter_complex',
  `[1:a]aformat=channel_layouts=mono,showwaves=s=1280x110:mode=cline:rate=25:colors=white[wv];[0:v][wv]overlay=0:600:format=auto[b];[b]subtitles=${ass}[v]`,
  '-map', '[v]', '-map', '1:a', '-t', String(dur), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '27', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { stdio: 'inherit' });
console.log(`écrit : ${out} (${dur.toFixed(1)} s, ${sentences.length} phrases, décalage ${offset.toFixed(2)} s)`);

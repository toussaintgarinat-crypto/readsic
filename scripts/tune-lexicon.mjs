#!/usr/bin/env node
// Lit un export de votes (JSON du panneau « Comparaison ») et propose des ajustements de lexique.
//   node scripts/tune-lexicon.mjs votes.json [--min-support 2] [--write] [--out src/lexicon-extra.js]
import { readFile, writeFile } from 'node:fs/promises';
import { suggestLexicon, toOverrides, evaluateOverrides } from '../src/lexicon-tuning.js';
import { mergeOverrides } from '../src/analyzer.js';
import { EXTRA } from '../src/lexicon-extra.js';

const args = process.argv.slice(2);
let file = null; const opts = {};
for (let k = 0; k < args.length; k++) {
  if (args[k] === '--write') opts.write = true;
  else if (args[k] === '--min-support' || args[k] === '--out') opts[args[k]] = args[++k];
  else if (!args[k].startsWith('--') && !file) file = args[k];
}
const opt = (name, d) => opts[name] ?? d;
if (!file) { console.error('usage : tune-lexicon.mjs votes.json [--min-support N] [--write] [--out fichier]'); process.exit(2); }

const data = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(data.rows)) { console.error('format inattendu : "rows" manquant'); process.exit(2); }
const rows = data.rows, voted = rows.filter((r) => r.vote === 'llm').length;
const sug = suggestLexicon(rows, { minSupport: Number(opt('--min-support', 2)) });
const ov = toOverrides(sug);
const ev = evaluateOverrides(rows, ov);
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)} %`), f = (x) => (x === null ? '—' : x.toFixed(2));

console.log(`${rows.length} phrases, ${rows.filter((r) => r.vote).length} votes dont ${voted} en faveur du LLM`);
console.log('\nAjouts :'); for (const s of sug.add) console.log(`  + [${s.cat}] ${s.stem}  (${s.support} phrases : ${s.rows.join(', ')})`);
console.log('Retraits :'); for (const s of sug.remove) console.log(`  - [${s.cat}] ${s.stem}  (${s.support} phrases : ${s.rows.join(', ')})`);
if (!sug.add.length && !sug.remove.length) console.log('  (rien de suffisamment étayé — voter sur plus de phrases ou baisser --min-support)');
for (const [k, l] of [['voted', 'phrases votées (optimiste)'], ['held', 'autres phrases (contrôle)']])
  console.log(`\n${l} : écart de tension ${f(ev.before[k].tensionMAE)} → ${f(ev.after[k].tensionMAE)} · valence identique au LLM ${pct(ev.before[k].valenceAgree)} → ${pct(ev.after[k].valenceAgree)} (n=${ev.before[k].n})`);

if (opts.write) {
  const out = opt('--out', new URL('../src/lexicon-extra.js', import.meta.url).pathname);
  const merged = mergeOverrides(EXTRA, ov);
  await writeFile(out, `// Ajustements des lexiques issus de vos votes (générés par \`node scripts/tune-lexicon.mjs <votes.json> --write\`).\n// add : racines ajoutées par catégorie ; remove : racines retirées (faux positifs).\nexport const EXTRA = ${JSON.stringify(merged, null, 2)};\n`);
  console.log(`\nÉcrit : ${out}`);
}

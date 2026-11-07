// Serveur local : fichiers statiques + proxy d'analyse LLM (la clé API reste côté serveur).
// Le fournisseur est interchangeable (voir providers.mjs) :
//   ANTHROPIC_API_KEY=... npm start                                                      (Anthropic)
//   LLM_PROVIDER=ollama LLM_MODEL=llama3.1 npm start                                     (modèle local, sans clé)
//   LLM_PROVIDER=openai LLM_API_KEY=... LLM_MODEL=gpt-4o-mini npm start                  (OpenAI)
//   LLM_BASE_URL=https://api.mistral.ai/v1 LLM_API_KEY=... LLM_MODEL=... npm start       (tout service compatible)
// Autres variables : PORT, HOST (défaut 127.0.0.1).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anthropicProvider, providerFromEnv, ProviderError } from './providers.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const VALENCES = ['neutre', 'joyeux', 'festif', 'melancolique', 'menacant', 'tragique', 'onirique', 'exotique', 'angoissant'];
export const PLACE_IDS = ['marais', 'taverne', 'foret', 'cite', 'mer', 'chateau', 'grotte', 'desert'];
const MAX_SENTENCES = 16, MAX_CHARS = 12000, MAX_BODY = 64 * 1024;
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const STATIC = /^\/(index\.html|style\.css|src\/[\w.-]+\.js)$/;

const SYSTEM = `Tu annotes un texte narratif, phrase par phrase, pour piloter une bande originale adaptative.
Pour chaque phrase numérotée, donne :
- tension : 0 (calme) à 1 (danger / paroxysme dramatique), en tenant compte du contexte et de ce que la phrase laisse présager ;
- valence : une valeur parmi ${VALENCES.join(', ')} (neutre si aucune ambiance nette ; angoissant = menace extrême ; festif = fête et réjouissance ; onirique = rêve, féerie ; exotique = orient, désert) ;
- movement : 0 (statique, contemplatif) à 1 (action rapide) ;
- place : le lieu où se déroule la phrase parmi ${PLACE_IDS.join(', ')}, ou "none" s'il n'est pas explicitement présent dans la phrase ou son contexte immédiat.
Tiens compte des négations et de l'ironie. Réponds uniquement avec le JSON demandé, avec un élément par phrase, dans l'ordre.`;

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          tension: { type: 'number' },
          valence: { type: 'string', enum: VALENCES },
          movement: { type: 'number' },
          place: { type: 'string', enum: [...PLACE_IDS, 'none'] },
        },
        required: ['i', 'tension', 'valence', 'movement', 'place'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

const clamp = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

export function validateRequest(body) {
  const s = body?.sentences;
  if (!Array.isArray(s) || s.length < 1 || s.length > MAX_SENTENCES) throw new HttpError(400, `sentences: 1 à ${MAX_SENTENCES} éléments attendus`);
  if (!s.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 1500)) throw new HttpError(400, 'sentences: chaînes non vides de 1500 caractères max');
  const before = Array.isArray(body.before) ? body.before.filter((x) => typeof x === 'string').slice(-3).map((x) => x.slice(0, 1500)) : [];
  if (s.join('').length + before.join('').length > MAX_CHARS) throw new HttpError(400, 'requête trop longue');
  return { sentences: s, before };
}

// Normalise la sortie du modèle : valeurs bornées, énumérations vérifiées, un élément par phrase (null si manquant).
export function normalizeResults(parsed, count) {
  const out = new Array(count).fill(null);
  for (const r of parsed?.results ?? []) {
    if (!Number.isInteger(r?.i) || r.i < 0 || r.i >= count) continue;
    out[r.i] = {
      tension: clamp(r.tension),
      valence: VALENCES.includes(r.valence) ? r.valence : 'neutre',
      movement: clamp(r.movement),
      place: PLACE_IDS.includes(r.place) ? r.place : null,
    };
  }
  return out;
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

// Extrait un objet JSON d'une réponse de modèle (tolère blocs ```json et texte autour).
export function extractJson(text) {
  const t = String(text ?? '').replace(/```(?:json)?/gi, '');
  try { return JSON.parse(t); } catch { /* essai suivant */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* illisible */ } }
  throw new HttpError(502, 'réponse du modèle illisible');
}

// provider : fournisseur LLM ; `client` (SDK Anthropic déjà construit) conservé comme raccourci.
export function createApp({ provider = null, client = null, model } = {}) {
  provider ??= client ? anthropicProvider({ client, ...(model ? { model } : {}) }) : providerFromEnv();

  async function analyze(body) {
    const { sentences, before } = validateRequest(body);
    const user = (before.length ? `Contexte (déjà lu) :\n${before.join(' ')}\n\n` : '') +
      `Phrases à annoter :\n${sentences.map((t, i) => `${i}. ${t}`).join('\n')}`;
    const text = await provider.complete({ system: SYSTEM, user, schema: SCHEMA });
    return { provider: provider.name, model: provider.model, results: normalizeResults(extractJson(text), sentences.length) };
  }

  const json = (res, status, obj) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { llm: provider.available(), provider: provider.name, model: provider.model ?? null });
      if (req.method === 'POST' && url.pathname === '/api/analyze') {
        if (!provider.available()) throw new HttpError(503, 'aucun fournisseur LLM configuré (voir README : LLM_PROVIDER / ANTHROPIC_API_KEY)');
        let size = 0; const chunks = [];
        for await (const c of req) { size += c.length; if (size > MAX_BODY) throw new HttpError(413, 'corps trop volumineux'); chunks.push(c); }
        let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON invalide'); }
        return json(res, 200, await analyze(body));
      }
      if (req.method === 'GET') {
        const p = url.pathname === '/' ? '/index.html' : url.pathname;
        if (!STATIC.test(p)) throw new HttpError(404, 'introuvable');
        const data = await readFile(path.join(ROOT, p));
        res.writeHead(200, { 'content-type': MIME[path.extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
        return res.end(data);
      }
      throw new HttpError(405, 'méthode non autorisée');
    } catch (e) {
      if (e instanceof HttpError) return json(res, e.status, { error: e.message });
      if (e instanceof ProviderError) return json(res, e.status, { error: e.message });
      if (e?.code === 'ENOENT') return json(res, 404, { error: 'introuvable' });
      console.error(e);
      return json(res, 500, { error: 'erreur interne' });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8080), host = process.env.HOST ?? '127.0.0.1';
  const provider = providerFromEnv();
  createApp({ provider }).listen(port, host, () => {
    console.log(`readsic : http://${host}:${port}  (analyse LLM : ${provider.available() ? `${provider.name} / ${provider.model}` : 'désactivée — voir README (ANTHROPIC_API_KEY ou LLM_PROVIDER)'})`);
  });
}

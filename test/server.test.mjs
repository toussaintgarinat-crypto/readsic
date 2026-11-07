// Test du proxy LLM contre un faux serveur "Messages API" (aucun appel réseau réel).
import assert from 'node:assert/strict';
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { createApp, normalizeResults, validateRequest, extractJson } from '../server.mjs';
import { providerFromEnv, openaiCompatibleProvider } from '../providers.mjs';

let lastRequest = null, mode = 'ok';
const upstream = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    lastRequest = { url: req.url, headers: req.headers, body: JSON.parse(b) };
    if (mode === 'ratelimit') { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } })); }
    const results = mode === 'bad'
      ? [{ i: 0, tension: 7, valence: 'bizarre', movement: -3, place: 'atlantide' }, { i: 99, tension: 1, valence: 'joyeux', movement: 1, place: 'mer' }]
      : [{ i: 0, tension: 0.9, valence: 'angoissant', movement: 0.8, place: 'marais' }, { i: 1, tension: 0.1, valence: 'neutre', movement: 0.2, place: 'none' }];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null,
      content: [{ type: 'text', text: JSON.stringify({ results }) }], usage: { input_tokens: 1, output_tokens: 1 } }));
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const client = new Anthropic({ apiKey: 'test-key', baseURL: `http://127.0.0.1:${upstream.address().port}`, maxRetries: 0 });

const app = createApp({ client });
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.address().port}`;
const post = (body) => fetch(base + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// santé
assert.deepEqual(await (await fetch(base + '/api/health')).json(), { llm: true, provider: 'anthropic', model: 'claude-haiku-5-5' });

// cas nominal
let r = await post({ sentences: ['Une ombre rampait.', 'Il attendit.'], before: ['Elle entra.'] });
assert.equal(r.status, 200);
const data = await r.json();
assert.deepEqual(data.results[0], { tension: 0.9, valence: 'angoissant', movement: 0.8, place: 'marais' });
assert.equal(data.results[1].place, null, '"none" -> null');
// requête envoyée à l'API : modèle, sortie JSON structurée, pas de clé dans le corps
assert.equal(lastRequest.url, '/v1/messages');
assert.match(lastRequest.headers.authorization ?? lastRequest.headers['x-api-key'] ?? '', /test-key/);
assert.equal(lastRequest.body.model, 'claude-haiku-5-5');
assert.equal(lastRequest.body.output_config.format.type, 'json_schema');
assert.match(lastRequest.body.messages[0].content, /0\. Une ombre rampait\.\n1\. Il attendit\./);
assert.match(lastRequest.body.messages[0].content, /Contexte[^]*Elle entra/);
assert.ok(!JSON.stringify(lastRequest.body).includes('test-key'));

// sortie du modèle non fiable : bornée / validée, éléments hors plage ignorés
mode = 'bad';
r = await post({ sentences: ['a.', 'b.'] });
const bad = await r.json();
assert.deepEqual(bad.results, [{ tension: 1, valence: 'neutre', movement: 0, place: null }, null]);

// erreurs
mode = 'ratelimit'; assert.equal((await post({ sentences: ['a.'] })).status, 429);
mode = 'ok';
assert.equal((await post({ sentences: [] })).status, 400);
assert.equal((await post({ sentences: ['x'.repeat(2000)] })).status, 400);
assert.equal((await post({ sentences: new Array(17).fill('a') })).status, 400);
assert.equal((await fetch(base + '/api/analyze', { method: 'POST', body: '{pas du json' })).status, 400);
assert.equal((await fetch(base + '/api/analyze', { method: 'PUT' })).status, 405);

// statique : liste blanche (le serveur et package.json ne sont pas servis)
assert.equal((await fetch(base + '/')).status, 200);
assert.equal((await fetch(base + '/src/app.js')).status, 200);
assert.equal((await fetch(base + '/server.mjs')).status, 404);
assert.equal((await fetch(base + '/package.json')).status, 404);
assert.equal((await fetch(base + '/src/../server.mjs')).status, 404);

// sans clé : santé = false, analyse = 503
const saved = { k: process.env.ANTHROPIC_API_KEY, t: process.env.ANTHROPIC_AUTH_TOKEN };
delete process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_AUTH_TOKEN;
const bare = createApp({ provider: providerFromEnv({}) }); await new Promise((r) => bare.listen(0, '127.0.0.1', r));
const bb = `http://127.0.0.1:${bare.address().port}`;
assert.equal((await (await fetch(bb + '/api/health')).json()).llm, false);
assert.equal((await fetch(bb + '/api/analyze', { method: 'POST', body: '{}' })).status, 503);
Object.assign(process.env, Object.fromEntries(Object.entries({ ANTHROPIC_API_KEY: saved.k, ANTHROPIC_AUTH_TOKEN: saved.t }).filter(([, v]) => v)));

// unitaires
assert.equal(normalizeResults({ results: [] }, 3).filter(Boolean).length, 0);
assert.throws(() => validateRequest({ sentences: 'non' }));

// ---- fournisseur alternatif : API compatible OpenAI (Ollama, OpenAI, Mistral, LM Studio…) ----
let oaMode = 'ok', oaSeen = [];
const oa = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = JSON.parse(b); oaSeen.push({ url: req.url, auth: req.headers.authorization, body });
    if (oaMode === 'noformat' && body.response_format) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end('{"error":"response_format non supporté"}'); }
    if (oaMode === 'unauthorized') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{}'); }
    const results = [{ i: 0, tension: 0.4, valence: 'onirique', movement: 0.1, place: 'foret' }];
    const content = oaMode === 'fenced' ? '```json\n' + JSON.stringify({ results }) + '\n```' : 'Voici : ' + JSON.stringify({ results });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
  });
});
await new Promise((r) => oa.listen(0, '127.0.0.1', r));
const oaBase = `http://127.0.0.1:${oa.address().port}/v1/`;
const oaApp = createApp({ provider: openaiCompatibleProvider({ baseUrl: oaBase, apiKey: 'sk-local', model: 'llama3.1', name: 'ollama' }) });
await new Promise((r) => oaApp.listen(0, '127.0.0.1', r));
const ob = `http://127.0.0.1:${oaApp.address().port}`;
const opost = () => fetch(ob + '/api/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sentences: ['Elle rêvait.'] }) });
assert.deepEqual(await (await fetch(ob + '/api/health')).json(), { llm: true, provider: 'ollama', model: 'llama3.1' });
let o = await (await opost()).json();
assert.deepEqual(o.results[0], { tension: 0.4, valence: 'onirique', movement: 0.1, place: 'foret' }); // même format, quel que soit le fournisseur
assert.equal(o.provider, 'ollama');
assert.equal(oaSeen[0].url, '/v1/chat/completions'); assert.equal(oaSeen[0].auth, 'Bearer sk-local');
assert.equal(oaSeen[0].body.model, 'llama3.1'); assert.match(oaSeen[0].body.messages[0].content, /schéma/);
oaMode = 'fenced'; assert.equal((await (await opost()).json()).results[0].valence, 'onirique');          // bloc ```json
oaMode = 'noformat'; oaSeen = []; assert.equal((await opost()).status, 200); assert.equal(oaSeen.length, 2); // repli sans response_format
oaMode = 'unauthorized'; assert.equal((await opost()).status, 401);

// configuration par variables d'environnement
assert.equal(providerFromEnv({ ANTHROPIC_API_KEY: 'k' }).name, 'anthropic');
const envOllama = providerFromEnv({ LLM_PROVIDER: 'ollama', LLM_MODEL: 'qwen2.5' });
assert.equal(envOllama.name, 'ollama'); assert.ok(envOllama.available(), 'local : pas de clé requise');
assert.equal(providerFromEnv({ LLM_BASE_URL: 'https://api.mistral.ai/v1', LLM_MODEL: 'm', LLM_API_KEY: 'k' }).name, 'openai-compatible');
assert.equal(providerFromEnv({ LLM_PROVIDER: 'openai', LLM_MODEL: 'gpt-4o-mini' }).available(), true);
assert.equal(providerFromEnv({ LLM_PROVIDER: 'ollama' }).available(), false, 'modèle obligatoire hors Anthropic');
assert.throws(() => providerFromEnv({ LLM_PROVIDER: 'inconnu' }), /inconnu/);
assert.deepEqual(extractJson('texte ```json\n{"a":1}\n``` fin'), { a: 1 });
assert.throws(() => extractJson('pas de json'));

[upstream, app, bare, oa, oaApp].forEach((s) => s.close());
console.log('OK — server');

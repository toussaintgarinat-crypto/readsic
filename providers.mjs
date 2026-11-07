// Fournisseurs LLM interchangeables pour l'analyse de texte.
// Interface : { name, model, available(), complete({ system, user, schema }) -> Promise<string> }
// Toute erreur est convertie en ProviderError(status, message) : le serveur n'a pas à connaître le fournisseur.
//
// Configuration (variables d'environnement) :
//   LLM_PROVIDER = anthropic | openai | ollama | lmstudio | openai-compatible   (défaut : openai-compatible si LLM_BASE_URL, sinon anthropic)
//   LLM_BASE_URL = ex. https://api.openai.com/v1, http://localhost:11434/v1, https://api.mistral.ai/v1 …
//   LLM_API_KEY  = clé (inutile pour les modèles locaux)
//   LLM_MODEL    = nom du modèle (obligatoire hors Anthropic)
// Anthropic : ANTHROPIC_API_KEY, ANTHROPIC_MODEL (défaut claude-haiku-5-5).
import Anthropic from '@anthropic-ai/sdk';

export class ProviderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---- Anthropic (SDK officiel) -------------------------------------------------------------
export function anthropicProvider({ client = null, model = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5' } = {}) {
  let sdk = client;
  return {
    name: 'anthropic', model,
    available: () => !!(client || process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    async complete({ system, user, schema }) {
      try {
        sdk ??= new Anthropic(); // lit ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
        const msg = await sdk.messages.create({
          model, max_tokens: 2048, system,
          output_config: { effort: 'low', format: { type: 'json_schema', schema } },
          messages: [{ role: 'user', content: user }],
        });
        if (msg.stop_reason === 'refusal') throw new ProviderError(422, 'analyse refusée par le modèle');
        return msg.content.find((b) => b.type === 'text')?.text ?? '';
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e instanceof Anthropic.RateLimitError) throw new ProviderError(429, 'limite de débit atteinte, réessayez');
        if (e instanceof Anthropic.AuthenticationError) throw new ProviderError(401, 'clé API invalide');
        if (e instanceof Anthropic.APIError) throw new ProviderError(502, `erreur API (${e.status})`);
        throw e;
      }
    },
  };
}

// ---- API « chat/completions » compatible OpenAI -----------------------------------------------
// Couvre OpenAI, Ollama, LM Studio, llama.cpp, vLLM, Mistral, Groq, Together, OpenRouter, etc.
export function openaiCompatibleProvider({ baseUrl, apiKey = '', model, name = 'openai-compatible', fetchImpl = fetch, timeoutMs = 60000 }) {
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  async function call(body) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }
  return {
    name, model,
    available: () => !!(baseUrl && model),
    async complete({ system, user, schema }) {
      // Le schéma est aussi donné dans le prompt : les serveurs qui ignorent response_format restent guidés.
      const sys = `${system}\n\nRéponds avec un unique objet JSON conforme à ce schéma, sans texte autour :\n${JSON.stringify(schema)}`;
      const base = { model, temperature: 0, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }] };
      try {
        // 1) JSON contraint ; 2) si le serveur refuse response_format, repli sans contrainte.
        let { res, data } = await call({ ...base, response_format: { type: 'json_object' } });
        if (res.status === 400) ({ res, data } = await call(base));
        if (res.status === 401 || res.status === 403) throw new ProviderError(401, 'clé API invalide ou accès refusé');
        if (res.status === 429) throw new ProviderError(429, 'limite de débit atteinte, réessayez');
        if (!res.ok) throw new ProviderError(502, `erreur fournisseur (${res.status})`);
        const text = data?.choices?.[0]?.message?.content;
        if (typeof text !== 'string') throw new ProviderError(502, 'réponse du fournisseur illisible');
        return text;
      } catch (e) {
        if (e instanceof ProviderError) throw e;
        if (e?.name === 'TimeoutError') throw new ProviderError(504, 'le modèle a mis trop de temps à répondre');
        throw new ProviderError(502, `fournisseur injoignable (${baseUrl})`);
      }
    },
  };
}

const PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
  ollama: { baseUrl: 'http://localhost:11434/v1' },
  lmstudio: { baseUrl: 'http://localhost:1234/v1' },
  'openai-compatible': {},
};

export function providerFromEnv(env = process.env) {
  const kind = (env.LLM_PROVIDER ?? (env.LLM_BASE_URL ? 'openai-compatible' : 'anthropic')).toLowerCase();
  if (kind === 'anthropic') return anthropicProvider({ model: env.LLM_MODEL ?? env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5' });
  const preset = PRESETS[kind];
  if (!preset) throw new Error(`LLM_PROVIDER inconnu : « ${kind} » (anthropic, openai, ollama, lmstudio, openai-compatible)`);
  return openaiCompatibleProvider({
    name: kind, model: env.LLM_MODEL,
    baseUrl: env.LLM_BASE_URL ?? preset.baseUrl ?? '',
    apiKey: env.LLM_API_KEY ?? (preset.keyEnv ? env[preset.keyEnv] : '') ?? '',
  });
}

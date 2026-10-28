// Cliente do modo IA. As rotas /api/ai/* executam um CLI de IA na máquina — Claude Code
// (`claude -p`) ou Antigravity (`agy -p`, Gemini 4 Argon) — no `npm run dev` pelo próprio
// Vite, ou no servidor do Telegram quando ele roda num PC com o CLI logado. Os tipos
// espelham server/src/aiCli.ts.

import { FLAGS, readJsonFlag, writeFlag } from '../store/storage';

export type AiProvider = 'claude' | 'antigravity';
export type AiEndpointKind = 'local' | 'server';

export interface AiSettings {
  endpoint: AiEndpointKind;
  provider: AiProvider;
  /** Claude: haiku/sonnet/opus. Antigravity: id do `agy models` (ex.: gemini-4-argon-medium). */
  model: string;
}

export interface AiModelOption { id: string; label: string }

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  claude: 'Claude Code',
  antigravity: 'Antigravity (Gemini)',
};

export const CLAUDE_MODELS: AiModelOption[] = [
  { id: 'haiku', label: 'Haiku — rápido' },
  { id: 'sonnet', label: 'Sonnet — equilibrado' },
  { id: 'opus', label: 'Opus — mais cuidadoso' },
];

// Usada até o servidor responder com a lista real da conta (`agy models`).
export const ANTIGRAVITY_FALLBACK_MODELS: AiModelOption[] = [
  { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)' },
  { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High)' },
  { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low)' },
  { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
  { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
];

export const DEFAULT_AI_MODEL: Record<AiProvider, string> = { claude: 'sonnet', antigravity: 'gemini-4-argon-medium' };

export const loadAiSettings = (): AiSettings => {
  const saved = readJsonFlag<Partial<AiSettings>>(FLAGS.aiSettings, {});
  // Preferências antigas não tinham provedor: eram sempre do Claude.
  const provider: AiProvider = saved.provider === 'antigravity' ? 'antigravity' : 'claude';
  const validClaude = CLAUDE_MODELS.some(option => option.id === saved.model);
  const model = provider === 'claude'
    ? (validClaude ? saved.model as string : DEFAULT_AI_MODEL.claude)
    : (saved.model && !validClaude ? saved.model : DEFAULT_AI_MODEL.antigravity);
  return { endpoint: saved.endpoint === 'server' ? 'server' : 'local', provider, model };
};
export const saveAiSettings = (settings: AiSettings) => writeFlag(FLAGS.aiSettings, JSON.stringify(settings));

/** Nome curto para botões e mensagens: "Claude" ou o modelo do Antigravity. */
export const aiDisplayName = (settings: Pick<AiSettings, 'provider' | 'model'>, models: AiModelOption[] = ANTIGRAVITY_FALLBACK_MODELS) => {
  if (settings.provider === 'claude') return `Claude ${settings.model.charAt(0).toUpperCase()}${settings.model.slice(1)}`;
  return models.find(option => option.id === settings.model)?.label.replace(/\s*\(.*\)$/, '') || settings.model;
};

// Modelos que pensam mais por item: lotes menores mostram resultado antes e ficam
// longe do timeout de 4 minutos por chamada.
export const batchSizeFor = (model: string) => (model === 'opus' || /high/.test(model) ? 25 : 40);

export interface AiServerConfig {
  url: string;
  token: string;
}

export interface AiProviderStatus {
  available: boolean;
  version?: string;
  error?: string;
  models?: AiModelOption[];
}

export interface AiStatus extends AiProviderStatus {
  /** Ausente em servidores antigos, que só conheciam o Claude. */
  providers?: Partial<Record<AiProvider, AiProviderStatus>>;
}

export const providerStatus = (status: AiStatus | null, provider: AiProvider): AiProviderStatus | null => {
  if (!status) return null;
  if (status.providers?.[provider]) return status.providers[provider] as AiProviderStatus;
  if (provider === 'claude') return status;
  return { available: false, error: status.error || 'Este servidor só conhece o Claude (atualize-o).' };
};

export interface AiMerchantInput {
  key: string;
  name: string;
  samples: string[];
  count: number;
  total: number;
  currentCategoryId?: string;
  rawCategory?: string;
}

export interface AiSuggestion {
  key: string;
  categoryId: string | null;
  newCategoryName: string | null;
  keyword: string;
  confidence: 'alta' | 'media' | 'baixa';
  reason: string;
}

export interface AiInsight {
  title: string;
  detail: string;
  tone: 'positivo' | 'atencao' | 'neutro';
}

const request = async <T,>(settings: AiSettings, server: AiServerConfig, path: string, body?: unknown): Promise<T> => {
  const useServer = settings.endpoint === 'server';
  if (useServer && (!server.url || !server.token)) throw new Error('Configure a URL e o token do servidor em Importação e backup.');
  const base = useServer ? `${server.url.trim().replace(/\/$/, '')}/api/ai` : '/api/ai';
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(useServer ? { Authorization: `Bearer ${server.token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error(useServer ? 'Não consegui falar com o servidor.' : 'Modo IA local indisponível: rode o app com "npm run dev" no computador com o CLI de IA.');
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(useServer ? 'O servidor não tem as rotas de IA (atualize-o).' : 'Modo IA local só existe no "npm run dev" (não no build/APK).');
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Falha na IA (${response.status}).`);
  return data;
};

export const getAiStatus = (settings: AiSettings, server: AiServerConfig) => request<AiStatus>(settings, server, '/status');

export const categorizeWithAi = (
  settings: AiSettings,
  server: AiServerConfig,
  payload: { merchants: AiMerchantInput[]; categories: Array<{ id: string; name: string; keywords?: string[] }>; allowNewCategories: boolean },
) => request<{ suggestions: AiSuggestion[]; provider?: AiProvider; model: string; durationMs: number }>(
  settings, server, '/categorize', { ...payload, provider: settings.provider, model: settings.model },
);

export const analyzeWithAi = (settings: AiSettings, server: AiServerConfig, payload: { summary: unknown; question?: string }) =>
  request<{ insights: AiInsight[]; answer?: string; provider?: AiProvider; model: string; durationMs: number }>(
    settings, server, '/insights', { ...payload, provider: settings.provider, model: settings.model },
  );

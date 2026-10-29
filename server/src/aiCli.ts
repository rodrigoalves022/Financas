import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Modo IA pelos CLIs instalados na máquina, usando a assinatura já logada — sem chave de
// API: Claude Code (`claude -p`) e Antigravity (`agy -p`, com os Gemini 4 Argon / 3.8 Flash).
// Usado pelo servidor de desenvolvimento do Vite (vite.config.ts) e pelo servidor do
// Telegram — só funciona onde o CLI estiver instalado e autenticado.

export const AI_PROVIDERS = ['claude', 'antigravity'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus'] as const;
export const DEFAULT_MODEL: Record<AiProvider, string> = { claude: 'sonnet', antigravity: 'gemini-4-argon-medium' };
export const PROVIDER_LABEL: Record<AiProvider, string> ={ claude: 'Claude CLI', antigravity: 'Antigravity CLI' };

// Classificação é texto puro: nenhuma ferramenta (arquivo, shell, web) é necessária.
const CLAUDE_DISALLOWED_TOOLS = 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,Agent,TodoWrite';
const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_MERCHANTS_PER_CALL = 80;

export const resolveProvider = (provider?: string): AiProvider => provider === 'antigravity' ? 'antigravity' : 'claude';

// O modelo entra na linha de comando: Claude só da lista fechada; no Antigravity a lista
// muda com o tempo (vem de `agy models`), então vale qualquer id com caracteres seguros.
export const resolveModel = (provider: AiProvider, model?: string): string => {
  if (provider === 'claude') return (CLAUDE_MODELS as readonly string[]).includes(model || '') ? model as string : DEFAULT_MODEL.claude;
  return model && /^[a-z0-9][a-z0-9.-]{1,60}$/i.test(model) ? model : DEFAULT_MODEL.antigravity;
};

const childEnv = () => {
  const env = { ...process.env };
  // Rodando a partir de uma sessão do Claude Code, essas variáveis fariam o CLI filho
  // se considerar aninhado.
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
};

// Pasta vazia e própria: o agente do Antigravity enxerga o diretório atual como projeto.
const workDir = () => {
  const dir = join(tmpdir(), 'financas-ia');
  mkdirSync(dir, { recursive: true });
  return dir;
};

interface ProcessResult { code: number | null; stdout: string; stderr: string }

// Um único comando em string com shell: no Windows o executável é um .cmd, que o Node
// não executa sem shell. Todas as partes são constantes ou vêm de lista/padrão fechado
// (modelo); o conteúdo do usuário vai pelo stdin, nunca pela linha de comando.
const runProcess = (command: string, input: string | null, timeoutMs: number, label: string) => new Promise<ProcessResult>((resolve, reject) => {
  const child = spawn(command, { shell: true, cwd: workDir(), env: childEnv(), windowsHide: true });
  let stdout = '';
  let stderr = '';
  const timer = setTimeout(() => {
    // Com shell, kill() só derruba o cmd.exe e o CLI ficaria órfão rodando.
    if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    else child.kill();
    reject(new Error(`O ${label} não respondeu em ${Math.round(timeoutMs / 1000)}s.`));
  }, timeoutMs);
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', error => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('close', code => {
    clearTimeout(timer);
    resolve({ code, stdout, stderr });
  });
  if (input !== null) child.stdin.end(input, 'utf8');
  else child.stdin.end();
});

const notInstalled = (text: string) => /not recognized|não é reconhecido|command not found|ENOENT/i.test(text);

// ─── Disponibilidade ─────────────────────────────────────────────────────────

export interface AiModelOption { id: string; label: string }

export interface ProviderStatus {
  available: boolean;
  version?: string;
  error?: string;
  /** Só no Antigravity: modelos que a conta logada oferece. */
  models?: AiModelOption[];
}

export interface AiStatusResponse extends ProviderStatus {
  providers: Record<AiProvider, ProviderStatus>;
}

const VERSION_COMMAND: Record<AiProvider, string> = { claude: 'claude --version', antigravity: 'agy --version' };
const INSTALL_HINT: Record<AiProvider, string> = {
  claude: 'Claude CLI não encontrado no PATH.',
  antigravity: 'Antigravity CLI (agy) não encontrado no PATH.',
};

// `agy models` consulta a conta (alguns segundos): guarda por 10 minutos.
let modelsCache: { at: number; models: AiModelOption[] } | null = null;
const listAntigravityModels = async (): Promise<AiModelOption[]> => {
  if (modelsCache && Date.now() - modelsCache.at < 600_000) return modelsCache.models;
  const result = await runProcess('agy models', null, 30_000, PROVIDER_LABEL.antigravity);
  const models = result.stdout.split(/\r?\n/).flatMap(line => {
    const [id, label] = line.split('\t').map(part => part.trim());
    return id && label && /^[a-z0-9][a-z0-9.-]+$/i.test(id) ? [{ id, label }] : [];
  });
  if (models.length) modelsCache = { at: Date.now(), models };
  return models;
};

const checkProvider = async (provider: AiProvider): Promise<ProviderStatus> => {
  try {
    const result = await runProcess(VERSION_COMMAND[provider], null, 20_000, PROVIDER_LABEL[provider]);
    if (result.code !== 0 || !result.stdout.trim()) {
      const detail = `${result.stderr} ${result.stdout}`.trim();
      return { available: false, error: notInstalled(detail) ? INSTALL_HINT[provider] : detail || `${PROVIDER_LABEL[provider]} não respondeu.` };
    }
    const status: ProviderStatus = { available: true, version: result.stdout.trim().split('\n')[0] };
    if (provider === 'antigravity') status.models = await listAntigravityModels().catch(() => []);
    return status;
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const checkAiProviders = async (): Promise<AiStatusResponse> => {
  const [claude, antigravity] = await Promise.all([checkProvider('claude'), checkProvider('antigravity')]);
  // Campos de topo mantidos para clientes antigos, que só conheciam o Claude.
  return { ...claude, providers: { claude, antigravity } };
};

// ─── Execução ────────────────────────────────────────────────────────────────

export interface AiRunResult {
  text: string;
  provider: AiProvider;
  model: string;
  durationMs: number;
}

const runClaudeCli = async (prompt: string, model: string, timeoutMs: number): Promise<string> => {
  const command = `claude -p --output-format json --model ${model} --no-session-persistence --disallowedTools ${CLAUDE_DISALLOWED_TOOLS}`;
  const result = await runProcess(command, prompt, timeoutMs, PROVIDER_LABEL.claude);

  if (result.code !== 0 && !result.stdout.trim()) {
    const detail = result.stderr.trim();
    if (notInstalled(detail)) throw new Error('Claude CLI não encontrado. Instale o Claude Code e rode "claude" uma vez para fazer login.');
    throw new Error(detail || `Claude CLI saiu com código ${result.code}.`);
  }

  let envelope: { result?: string; is_error?: boolean; subtype?: string };
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error('Resposta do Claude CLI em formato inesperado.');
  }
  if (envelope.is_error || typeof envelope.result !== 'string') {
    throw new Error(envelope.result || `Claude CLI terminou com erro (${envelope.subtype || 'desconhecido'}).`);
  }
  return envelope.result;
};

// O `agy -p` só lê o prompt da linha de comando — que no Windows corta em 8 mil
// caracteres —, a não ser no modo stream-json: aí cada linha do stdin é uma mensagem.
// --sandbox restringe o terminal do agente; o prompt já pede para não usar ferramentas.
const runAntigravityCli = async (prompt: string, model: string, timeoutMs: number): Promise<string> => {
  const command = `agy --input-format stream-json --output-format stream-json --model ${model} --disable-slash-commands --sandbox -p=`;
  const input = `${JSON.stringify({ event: 'user', message: { content: prompt } })}\n`;
  const result = await runProcess(command, input, timeoutMs, PROVIDER_LABEL.antigravity);

  let final: { status?: string; response?: string; error?: string } | undefined;
  for (const line of result.stdout.split(/\r?\n/).reverse()) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as { event?: string; result?: typeof final };
      if (parsed.event === 'result') {
        final = parsed.result;
        break;
      }
    } catch {
      // linha que não é JSON (aviso do CLI): ignora
    }
  }
  if (!final) {
    const detail = result.stderr.trim();
    if (notInstalled(detail)) throw new Error('Antigravity CLI não encontrado. Instale o Antigravity e rode "agy" uma vez para fazer login.');
    throw new Error(detail || `Antigravity CLI saiu com código ${result.code}.`);
  }
  if (final.status !== 'SUCCESS' || typeof final.response !== 'string') {
    throw new Error(final.error || `Antigravity CLI terminou com status ${final.status || 'desconhecido'}.`);
  }
  return final.response;
};

export const runAi = async (prompt: string, options: { provider?: string; model?: string; timeoutMs?: number } = {}): Promise<AiRunResult> => {
  const provider = resolveProvider(options.provider);
  const model = resolveModel(provider, options.model);
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const text = provider === 'antigravity'
    ? await runAntigravityCli(prompt, model, timeoutMs)
    : await runClaudeCli(prompt, model, timeoutMs);
  return { text, provider, model, durationMs: Date.now() - started };
};

/** Extrai o primeiro objeto JSON de uma resposta que pode vir com texto ou cercas de código. */
export const extractJson = <T>(text: string): T => {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('A IA não devolveu JSON.');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
};

export const clip = (value: unknown, max: number) => String(value ?? '').slice(0, max);

// ─── Categorização de estabelecimentos ───────────────────────────────────────

export interface AiMerchantInput {
  key: string;
  name: string;
  samples: string[];
  count: number;
  total: number;
  currentCategoryId?: string;
  rawCategory?: string;
}

export interface AiCategoryInput {
  id: string;
  name: string;
  keywords?: string[];
}

export interface AiSuggestion {
  key: string;
  categoryId: string | null;
  newCategoryName: string | null;
  keyword: string;
  confidence: 'alta' | 'media' | 'baixa';
  reason: string;
}

export interface AiCategorizeRequest {
  merchants: AiMerchantInput[];
  categories: AiCategoryInput[];
  provider?: string;
  model?: string;
  allowNewCategories?: boolean;
}

export interface AiCategorizeResponse {
  suggestions: AiSuggestion[];
  provider: AiProvider;
  model: string;
  durationMs: number;
}

const buildCategorizationPrompt = (request: AiCategorizeRequest) => {
  const categories = request.categories.map(category => {
    const examples = (category.keywords || []).slice(0, 8).map(keyword => clip(keyword, 30)).join(', ');
    return `- ${clip(category.id, 60)}: ${clip(category.name, 60)}${examples ? ` (ex.: ${examples})` : ''}`;
  }).join('\n');
  const merchants = request.merchants.slice(0, MAX_MERCHANTS_PER_CALL).map(merchant => ({
    key: clip(merchant.key, 80),
    nome: clip(merchant.name, 80),
    exemplos: merchant.samples.slice(0, 3).map(sample => clip(sample, 60)),
    compras: merchant.count,
    total: Math.round(merchant.total * 100) / 100,
    categoriaAtual: merchant.currentCategoryId ? clip(merchant.currentCategoryId, 60) : null,
    categoriaDoBanco: merchant.rawCategory ? clip(merchant.rawCategory, 40) : null,
  }));

  return `Você classifica estabelecimentos de faturas de cartão de crédito brasileiras (banco Inter).
Não use ferramentas. Responda apenas com o JSON pedido.

Categorias disponíveis (id: nome):
${categories}

Regras:
- "categoryId" deve ser um id da lista acima.${request.allowNewCategories ? `
- Se nenhuma categoria servir bem, use "categoryId": null e sugira "newCategoryName" curto (ex.: "Pets", "Presentes").` : `
- Se nenhuma categoria servir bem, use a categoria "outros" com confiança "baixa".`}
- Prefixos como PAG*, PG, TON, MP*, MERCADOPAGO, ZP, PINBANK, SUMUP, IZ são maquininhas: ignore e olhe o nome que vem depois.
- Marketplaces (Mercado Livre, Shopee, Amazon, AliExpress, Magalu) sem indicação do produto vão para compras online, se existir essa categoria.
- Nome que parece pessoa física (ex.: "Izabelafrancinela") não indica o ramo: use "categoriaDoBanco" como pista e confiança "baixa".
- "categoriaDoBanco" vem do próprio banco e costuma errar em lojas pequenas; não confie cegamente.
- "keyword": trecho curto e estável do nome que identifica o local para virar regra automática — sem cidade, sem número de loja, sem prefixo de maquininha. Ex.: "MERCADOLIVRE", "SUP LARANJEIRA", "UBER TRIP".
- "confidence": "alta", "media" ou "baixa". "reason": no máximo 12 palavras, em português.

Estabelecimentos:
${JSON.stringify(merchants)}

Formato da resposta (um item por estabelecimento, mesmo "key" recebido):
{"suggestions":[{"key":"...","categoryId":"...","newCategoryName":null,"keyword":"...","confidence":"alta","reason":"..."}]}`;
};

export const categorizeMerchants = async (request: AiCategorizeRequest): Promise<AiCategorizeResponse> => {
  const provider = resolveProvider(request.provider);
  if (!Array.isArray(request.merchants) || !request.merchants.length) return { suggestions: [], provider, model: resolveModel(provider, request.model), durationMs: 0 };
  if (!Array.isArray(request.categories) || !request.categories.length) throw new Error('Envie a lista de categorias.');

  const run = await runAi(buildCategorizationPrompt(request), { provider, model: request.model });
  const parsed = extractJson<{ suggestions?: Array<Partial<AiSuggestion>> }>(run.text);
  const validIds = new Set(request.categories.map(category => category.id));
  const validKeys = new Set(request.merchants.map(merchant => merchant.key));

  const suggestions: AiSuggestion[] = (parsed.suggestions || [])
    .filter(item => typeof item.key === 'string' && validKeys.has(item.key))
    .map(item => {
      const categoryId = typeof item.categoryId === 'string' && validIds.has(item.categoryId) ? item.categoryId : null;
      const newCategoryName = !categoryId && request.allowNewCategories && typeof item.newCategoryName === 'string' ? clip(item.newCategoryName.trim(), 40) || null : null;
      const confidence = item.confidence === 'alta' || item.confidence === 'media' || item.confidence === 'baixa' ? item.confidence : 'baixa';
      return {
        key: item.key as string,
        categoryId: categoryId || (newCategoryName ? null : validIds.has('outros') ? 'outros' : null),
        newCategoryName,
        keyword: clip(item.keyword || '', 60).trim(),
        confidence,
        reason: clip(item.reason || '', 120),
      };
    });
  return { suggestions, provider: run.provider, model: run.model, durationMs: run.durationMs };
};

// ─── Análise da fatura (dicas) ───────────────────────────────────────────────

export interface AiInsight {
  title: string;
  detail: string;
  tone: 'positivo' | 'atencao' | 'neutro';
}

export interface AiInsightsRequest {
  /** Resumo agregado (sem transações individuais) montado pelo app. */
  summary: unknown;
  question?: string;
  provider?: string;
  model?: string;
}

export interface AiInsightsResponse {
  insights: AiInsight[];
  answer?: string;
  provider: AiProvider;
  model: string;
  durationMs: number;
}

export const analyzeFinances = async (request: AiInsightsRequest): Promise<AiInsightsResponse> => {
  const summary = JSON.stringify(request.summary ?? {}).slice(0, 24_000);
  const question = clip(request.question || '', 400).trim();
  const prompt = `Você é um consultor financeiro pessoal, direto e prático, falando português do Brasil.
Não use ferramentas. Responda apenas com o JSON pedido.

Dados agregados do cartão de crédito e finanças do usuário (valores em R$):
${summary}

Tarefa: aponte de 4 a 6 dicas úteis e acionáveis (tendências, concentrações, assinaturas e recorrências,
parcelas que já comprometem as próximas faturas, metas estouradas, riscos, oportunidades de economia com
valores estimados). Nada genérico: cite números dos dados. Comece pelo que exige atenção.
${question ? `Além disso, responda à pergunta do usuário em "answer" (até 120 palavras): "${question}"` : 'Deixe "answer" vazio.'}

Formato:
{"insights":[{"title":"até 8 palavras","detail":"até 40 palavras","tone":"positivo|atencao|neutro"}],"answer":""}`;

  const run = await runAi(prompt, { provider: request.provider, model: request.model });
  const parsed = extractJson<{ insights?: Array<Partial<AiInsight>>; answer?: string }>(run.text);
  return {
    insights: (parsed.insights || []).slice(0, 8).map(item => ({
      title: clip(item.title, 80),
      detail: clip(item.detail, 400),
      tone: item.tone === 'positivo' || item.tone === 'atencao' ? item.tone : 'neutro',
    })),
    answer: parsed.answer ? clip(parsed.answer, 1500) : undefined,
    provider: run.provider,
    model: run.model,
    durationMs: run.durationMs,
  };
};

// ─── Roteamento HTTP compartilhado ───────────────────────────────────────────

export interface AiHttpResult { status: number; body: unknown }

/** Mesmo contrato para o middleware do Vite e para o Express do servidor. */
export const handleAiRequest = async (method: string, path: string, body: unknown): Promise<AiHttpResult | null> => {
  try {
    if (method === 'GET' && path === '/status') return { status: 200, body: await checkAiProviders() };
    if (method === 'POST' && path === '/categorize') return { status: 200, body: await categorizeMerchants(body as AiCategorizeRequest) };
    if (method === 'POST' && path === '/insights') return { status: 200, body: await analyzeFinances(body as AiInsightsRequest) };
    return null;
  } catch (error) {
    return { status: 502, body: { error: error instanceof Error ? error.message : String(error) } };
  }
};

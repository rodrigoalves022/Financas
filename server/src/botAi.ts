import { DEFAULT_MODEL, analyzeFinances, checkAiProviders, clip, extractJson, runAi, type AiProvider } from './aiCli.js';
import { geminiEnabled, parseWithGemini, toCommand, type AiParsedCommand } from './gemini.js';
import type { ParsedCommand } from './parser.js';
import type { Snapshot } from './types.js';

// IA do bot: entende frases fora do formato, responde perguntas sobre os gastos com o
// resumo que o app manda no snapshot, e gera as dicas da fatura. Prefere os CLIs desta
// máquina (assinatura, sem chave); sem eles, cai para a API do Gemini só na interpretação.
//
// BOT_AI: auto (padrão) | antigravity | claude | gemini | off
// BOT_AI_MODEL: modelo da interpretação (vazio = um rápido do provedor)

type BotAiMode = 'antigravity' | 'claude' | 'gemini' | 'off';

const CONFIGURED = (process.env.BOT_AI || 'auto').trim().toLowerCase();
const CONFIGURED_MODEL = process.env.BOT_AI_MODEL?.trim() || undefined;
// Interpretar uma frase precisa ser rápido; as dicas usam o modelo padrão, mais caprichado.
const FAST_MODEL: Record<AiProvider, string> = { antigravity: 'gemini-3.8-flash-medium', claude: 'haiku' };
const INTERPRET_TIMEOUT_MS = 90_000;

let resolved: { at: number; mode: BotAiMode } | null = null;

/** Qual IA o bot usa agora — no modo auto, o primeiro CLI disponível (revisto a cada 10 min). */
export const botAiMode = async (): Promise<BotAiMode> => {
  if (CONFIGURED === 'off') return 'off';
  if (CONFIGURED === 'gemini') return geminiEnabled ? 'gemini' : 'off';
  if (resolved && Date.now() - resolved.at < 600_000) return resolved.mode;
  const status = await checkAiProviders().catch(() => null);
  const order: AiProvider[] = CONFIGURED === 'claude' ? ['claude'] : CONFIGURED === 'antigravity' ? ['antigravity'] : ['antigravity', 'claude'];
  const provider = order.find(item => status?.providers[item]?.available);
  const mode: BotAiMode = provider || (geminiEnabled ? 'gemini' : 'off');
  resolved = { at: Date.now(), mode };
  return mode;
};

export const describeBotAi = async () => {
  const mode = await botAiMode();
  if (mode === 'off') return 'Desativada (sem CLI de IA nem GEMINI_API_KEY)';
  if (mode === 'gemini') return 'API do Gemini (só interpreta frases; dicas e perguntas precisam de um CLI)';
  return `${mode === 'antigravity' ? 'Antigravity CLI' : 'Claude CLI'} · ${CONFIGURED_MODEL || FAST_MODEL[mode]} (dicas: ${DEFAULT_MODEL[mode]})`;
};

export type BotAiReply =
  | { kind: 'command'; command: ParsedCommand }
  | { kind: 'answer'; text: string };

const summaryOf = (snapshot?: Snapshot) => snapshot?.financeSummary ? JSON.stringify(snapshot.financeSummary).slice(0, 16_000) : '';

/**
 * Chamado quando as regras fixas não entenderam a mensagem. Uma chamada só classifica a
 * intenção e, se for pergunta, já responde com os dados — evita duas idas ao CLI.
 * Qualquer falha devolve `null` e o bot mostra a ajuda, como se a IA não existisse.
 */
export const interpretWithAi = async (message: string, snapshot?: Snapshot): Promise<BotAiReply | null> => {
  const mode = await botAiMode();
  if (mode === 'off') return null;
  const names = snapshot?.allMemberNames ?? [];
  if (mode === 'gemini') {
    const command = await parseWithGemini(message, names);
    return command && command.kind !== 'unrecognized' ? { kind: 'command', command } : null;
  }

  const summary = summaryOf(snapshot);
  const prompt = `Você é o assistente de finanças pessoais de um bot do Telegram, em português do Brasil.
Não use ferramentas. Responda apenas com o JSON pedido.

O dono do bot controla o cartão de crédito e empresta dinheiro a conhecidos.
Pessoas cadastradas: ${names.length ? names.map(name => clip(name, 40)).join(', ') : '(nenhuma)'}
${summary ? `Resumo das finanças (valores em R$; meses no formato MM/AAAA):\n${summary}` : 'Resumo das finanças: indisponível (o app ainda não sincronizou).'}
${snapshot?.cardInvoice !== undefined ? `Fatura atual do cartão: R$ ${snapshot.cardInvoice.toFixed(2)} (${snapshot.currentMonth || 'mês atual'}).` : ''}

Classifique a mensagem em "kind":
- "registrar_divida": alguém passou a dever ao dono. Requer personName e amount; description opcional.
- "marcar_pago": alguém pagou o dono. Requer personName; amount só se for parcial.
- "racha": dividir uma conta. Requer amount (total) e personNames; includeOwner = true se o dono entra ("eu", "nós", "a gente").
- "consulta_geral": quem deve ao dono. "consulta_pessoa": saldo de uma pessoa (personName; detailed = true se pedir extrato).
- "consulta_fatura": fatura do cartão ou dívidas do próprio dono, sem pergunta específica.
- "desfazer": cancelar o último lançamento. "dicas": pede análise geral, dicas, onde economizar.
- "pergunta": qualquer outra pergunta sobre gastos, categorias, locais, parcelas, metas ou dívidas.
  Responda em "answer" com até 80 palavras, citando números do resumo. Se o resumo não tiver o dado, diga isso
  e sugira abrir o app. Não invente valores.
- "ajuda": pede instruções. "unrecognized": conversa fiada ou nada financeiro.

Regras: nomes compostos ("Paulo Vitor") ficam inteiros; vírgula separa pessoas no racha; "50 pila", "R$ 50" e
"50,00" viram 50; reconheça os cadastrados ignorando acentos e erros de digitação.

Mensagem: ${JSON.stringify(clip(message, 600))}

Formato:
{"kind":"...","personName":"","personNames":[],"amount":0,"description":"","includeOwner":false,"detailed":false,"answer":""}`;

  try {
    const run = await runAi(prompt, { provider: mode, model: CONFIGURED_MODEL || FAST_MODEL[mode], timeoutMs: INTERPRET_TIMEOUT_MS });
    const parsed = extractJson<AiParsedCommand & { answer?: string }>(run.text);
    if (parsed.kind === 'pergunta') {
      const answer = clip(parsed.answer || '', 1200).trim();
      return answer ? { kind: 'answer', text: answer } : null;
    }
    const command = toCommand(parsed);
    return command.kind === 'unrecognized' ? null : { kind: 'command', command };
  } catch (error) {
    console.warn('[bot-ai] Falha ao interpretar:', error instanceof Error ? error.message : error);
    // O CLI falhou (timeout, sessão expirada): a API do Gemini ainda pode salvar o comando.
    const command = geminiEnabled ? await parseWithGemini(message, names) : null;
    return command && command.kind !== 'unrecognized' ? { kind: 'command', command } : null;
  }
};

const TONE_EMOJI = { positivo: '✅', atencao: '⚠️', neutro: '💡' } as const;

/** Dicas da fatura em texto puro (sem Markdown: o texto da IA quebraria a formatação). */
export const generateTips = async (snapshot?: Snapshot): Promise<string> => {
  if (!snapshot?.financeSummary) return 'Ainda não recebi o resumo da fatura. Abra o app (versão atual) com a sincronização do Telegram ligada e tente de novo.';
  const mode = await botAiMode();
  if (mode === 'off' || mode === 'gemini') return 'As dicas precisam de um CLI de IA (Claude Code ou Antigravity) logado no computador onde o servidor roda.';
  const result = await analyzeFinances({ summary: snapshot.financeSummary, provider: mode, model: DEFAULT_MODEL[mode] });
  if (!result.insights.length) return 'A IA não encontrou nada relevante desta vez.';
  const month = (snapshot.financeSummary as { mesAnalisado?: string }).mesAnalisado;
  const header = `💡 Dicas${month ? ` — fatura ${month}` : ''} (${result.model}, ${Math.round(result.durationMs / 1000)}s)`;
  return [header, ...result.insights.map(item => `${TONE_EMOJI[item.tone]} ${item.title}\n${item.detail}`)].join('\n\n');
};

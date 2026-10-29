import { DEFAULT_MODEL, PROVIDER_LABEL, analyzeFinances, checkAiProviders, clip, extractJson, runAi, type AiProvider } from './aiCli.js';
import { geminiEnabled, parseWithGemini, toCommand, type AiParsedCommand } from './gemini.js';
import type { ParsedCommand } from './parser.js';
import type { Snapshot } from './types.js';

// IA do bot: entende frases fora do formato, responde perguntas sobre os gastos com o
// resumo que o app manda no snapshot, e gera as dicas da fatura. Prefere os CLIs desta
// máquina (assinatura, sem chave); sem eles, cai para a API do Gemini só na interpretação.
//
// BOT_AI: auto (padrão) | gemini | off | lista em ordem de preferência, cada item com modelo
//   opcional — "claude:opus,antigravity" usa o Opus e, se o Claude não estiver logado ou a
//   chamada falhar (limite da assinatura, timeout), o Antigravity com os modelos padrão.
// BOT_AI_MODEL: modelo da primeira IA da lista quando ela não traz um (formato antigo)

type BotAiMode = 'antigravity' | 'claude' | 'gemini' | 'off';
interface BotAiChoice { provider: AiProvider; model?: string }

const CONFIGURED = (process.env.BOT_AI || 'auto').trim().toLowerCase();
const CONFIGURED_MODEL = process.env.BOT_AI_MODEL?.trim() || undefined;
// Interpretar uma frase precisa ser rápido; as dicas usam o modelo padrão, mais caprichado.
// Um modelo escrito no BOT_AI vale para as duas coisas.
const FAST_MODEL: Record<AiProvider, string> = { antigravity: 'gemini-3.8-flash-medium', claude: 'haiku' };
const INTERPRET_TIMEOUT_MS = 90_000;
const AUTO_ORDER: BotAiChoice[] = [{ provider: 'antigravity' }, { provider: 'claude' }];

const parsedOrder = CONFIGURED.split(',').flatMap((item): BotAiChoice[] => {
  const [provider, model] = item.split(':').map(part => part.trim());
  return provider === 'claude' || provider === 'antigravity' ? [{ provider, model: model || undefined }] : [];
});
// Valor que não lista nenhum CLI (auto, ou digitado errado) segue a ordem automática.
const PREFERENCE = (parsedOrder.length ? parsedOrder : AUTO_ORDER)
  .map((choice, index) => index === 0 && !choice.model && CONFIGURED_MODEL ? { ...choice, model: CONFIGURED_MODEL } : choice);

const modelFor = (choice: BotAiChoice, purpose: 'interpret' | 'tips') =>
  choice.model || (purpose === 'interpret' ? FAST_MODEL : DEFAULT_MODEL)[choice.provider];

let resolved: { at: number; ready: BotAiChoice[] } | null = null;

/** CLIs da lista instalados e logados agora, na ordem de preferência (revisto a cada 10 min). */
const readyChoices = async (): Promise<BotAiChoice[]> => {
  if (CONFIGURED === 'off' || CONFIGURED === 'gemini') return [];
  if (resolved && Date.now() - resolved.at < 600_000) return resolved.ready;
  const status = await checkAiProviders().catch(() => null);
  const ready = PREFERENCE.filter(choice => status?.providers[choice.provider]?.available);
  resolved = { at: Date.now(), ready };
  return ready;
};

/** A IA que o bot tenta primeiro: o CLI preferido disponível, a API do Gemini, ou nenhuma. */
export const botAiMode = async (): Promise<BotAiMode> => {
  if (CONFIGURED === 'off') return 'off';
  const [first] = await readyChoices();
  return first?.provider || (geminiEnabled ? 'gemini' : 'off');
};

/** Tenta cada CLI na ordem; o próximo só entra se o anterior falhar. */
const withFallback = async <T>(choices: BotAiChoice[], task: (choice: BotAiChoice) => Promise<T>): Promise<T> => {
  let lastError: unknown = new Error('Nenhum CLI de IA disponível.');
  for (const choice of choices) {
    try {
      return await task(choice);
    } catch (error) {
      lastError = error;
      console.warn(`[bot-ai] ${PROVIDER_LABEL[choice.provider]} falhou:`, error instanceof Error ? error.message : error);
    }
  }
  throw lastError;
};

export const describeBotAi = async () => {
  const mode = await botAiMode();
  if (mode === 'off') return 'Desativada (sem CLI de IA nem GEMINI_API_KEY)';
  if (mode === 'gemini') return 'API do Gemini (só interpreta frases; dicas e perguntas precisam de um CLI)';
  const ready = await readyChoices();
  const missing = PREFERENCE.filter(choice => !ready.includes(choice)).map(choice => PROVIDER_LABEL[choice.provider]);
  return ready.map(choice => `${PROVIDER_LABEL[choice.provider]} · ${modelFor(choice, 'interpret')} (dicas: ${modelFor(choice, 'tips')})`).join(' → reserva: ')
    + (missing.length ? ` — fora do ar: ${missing.join(', ')}` : '');
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
    // O JSON é lido dentro da tentativa: resposta quebrada de uma IA também passa para a próxima.
    const parsed = await withFallback(await readyChoices(), async choice => {
      const run = await runAi(prompt, { provider: choice.provider, model: modelFor(choice, 'interpret'), timeoutMs: INTERPRET_TIMEOUT_MS });
      return extractJson<AiParsedCommand & { answer?: string }>(run.text);
    });
    if (parsed.kind === 'pergunta') {
      const answer = clip(parsed.answer || '', 1200).trim();
      return answer ? { kind: 'answer', text: answer } : null;
    }
    const command = toCommand(parsed);
    return command.kind === 'unrecognized' ? null : { kind: 'command', command };
  } catch {
    // Todos os CLIs falharam (já registrados no log): a API do Gemini ainda pode salvar o comando.
    const command = geminiEnabled ? await parseWithGemini(message, names) : null;
    return command && command.kind !== 'unrecognized' ? { kind: 'command', command } : null;
  }
};

const TONE_EMOJI = { positivo: '✅', atencao: '⚠️', neutro: '💡' } as const;

/** Dicas da fatura em texto puro (sem Markdown: o texto da IA quebraria a formatação). */
export const generateTips = async (snapshot?: Snapshot): Promise<string> => {
  if (!snapshot?.financeSummary) return 'Ainda não recebi o resumo da fatura. Abra o app (versão atual) com a sincronização do Telegram ligada e tente de novo.';
  const choices = await readyChoices();
  if (!choices.length) return 'As dicas precisam de um CLI de IA (Claude Code ou Antigravity) logado no computador onde o servidor roda.';
  const summary = snapshot.financeSummary;
  const result = await withFallback(choices, choice => analyzeFinances({ summary, provider: choice.provider, model: modelFor(choice, 'tips') }));
  if (!result.insights.length) return 'A IA não encontrou nada relevante desta vez.';
  const month = (snapshot.financeSummary as { mesAnalisado?: string }).mesAnalisado;
  const header = `💡 Dicas${month ? ` — fatura ${month}` : ''} (${result.model}, ${Math.round(result.durationMs / 1000)}s)`;
  return [header, ...result.insights.map(item => `${TONE_EMOJI[item.tone]} ${item.title}\n${item.detail}`)].join('\n\n');
};

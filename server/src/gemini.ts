import type { ParsedCommand } from './parser.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 6000;

export const geminiEnabled = Boolean(GEMINI_API_KEY);

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: ['registrar_divida', 'marcar_pago', 'racha', 'consulta_geral', 'consulta_pessoa', 'consulta_fatura', 'desfazer', 'dicas', 'unrecognized'],
    },
    personName: { type: 'string' },
    personNames: { type: 'array', items: { type: 'string' } },
    amount: { type: 'number' },
    description: { type: 'string' },
    includeOwner: { type: 'boolean' },
    detailed: { type: 'boolean' },
  },
  required: ['kind'],
};

const buildPrompt = (message: string, knownNames: string[]) => `
Você interpreta mensagens de um app de controle financeiro pessoal, em português do Brasil.
O dono do app empresta dinheiro para conhecidos e registra quem lhe deve.

Pessoas já cadastradas: ${knownNames.length ? knownNames.join(', ') : '(nenhuma)'}

Classifique a mensagem em uma das intenções:
- "registrar_divida": alguém passou a dever dinheiro ao dono (ex: "emprestei para fulano", ou apenas "[Nome] [Valor] [Descrição]"). Requer personName e amount. description é opcional.
- "marcar_pago": alguém pagou parte ou tudo que devia ao dono (ex: "fulano pagou", "fulano me deu 50"). Requer personName. amount é opcional e usado apenas se citar valor parcial.
- "racha": dividir uma conta entre pessoas. Requer amount (valor total) e personNames. includeOwner = true se o próprio dono entra na divisão (palavras como "eu", "nós", "a gente").
- "consulta_geral": quer saber quem deve, no geral (ex: "quem me deve?").
- "consulta_pessoa": quer o saldo de uma pessoa. Requer personName. detailed = true se pedir extrato/detalhes/lista.
- "consulta_fatura": quer saber da própria fatura do cartão ou das dívidas dele.
- "desfazer": quer cancelar o último lançamento.
- "dicas": pede análise, dicas ou onde economizar.
- "unrecognized": conversa fiada, saudação, ou nada financeiro.

Regras rigorosas:
- Entenda formatos ultra-curtos como "Daniel 50 Bebida" ou "Joao 20" como "registrar_divida".
- Mensagens indicando que alguém te pagou/entregou dinheiro são "marcar_pago".
- Identifique os nomes dos cadastrados (ignorando acentos/erros de digitação).
- Nomes compostos são comuns ("Paulo Vitor", "Ana Clara"): mantenha o nome inteiro, nunca corte no primeiro sobrenome nem separe em duas pessoas.
- No racha, a vírgula separa pessoas: "racha 150 Paulo Vitor, Bruno Henrique" são 2 pessoas, não 4.
- Valores numéricos: "50 pila", "R$ 50", "50,00" devem virar 50.
- Se a mensagem não se referir a finanças/dividas/pagamentos, devolva "unrecognized".

Mensagem: ${JSON.stringify(message)}
`.trim();

export interface AiParsedCommand {
  kind: string;
  personName?: string;
  personNames?: string[];
  amount?: number;
  description?: string;
  includeOwner?: boolean;
  detailed?: boolean;
}

/** Converte a classificação da IA (Gemini ou CLIs) em comando, validando os campos. */
export const toCommand = (parsed: AiParsedCommand): ParsedCommand => {
  switch (parsed.kind) {
    case 'registrar_divida':
      if (!parsed.personName || !parsed.amount || parsed.amount <= 0) return { kind: 'unrecognized' };
      return {
        kind: 'registrar_divida',
        personName: parsed.personName,
        amount: parsed.amount,
        description: parsed.description,
      };
    case 'marcar_pago':
      if (!parsed.personName) return { kind: 'unrecognized' };
      return {
        kind: 'marcar_pago',
        personName: parsed.personName,
        amount: parsed.amount && parsed.amount > 0 ? parsed.amount : undefined,
      };
    case 'racha':
      if (!parsed.amount || parsed.amount <= 0 || !parsed.personNames?.length) return { kind: 'unrecognized' };
      return {
        kind: 'racha',
        amount: parsed.amount,
        personNames: parsed.personNames,
        includeOwner: Boolean(parsed.includeOwner),
        description: parsed.description,
      };
    case 'consulta_geral':
      return { kind: 'consulta_geral' };
    case 'consulta_fatura':
      return { kind: 'consulta_fatura' };
    case 'dicas':
      return { kind: 'dicas' };
    case 'ajuda':
      return { kind: 'ajuda' };
    case 'consulta_pessoa':
      if (!parsed.personName) return { kind: 'consulta_geral' };
      return { kind: 'consulta_pessoa', personName: parsed.personName, detailed: Boolean(parsed.detailed) };
    case 'desfazer':
      return { kind: 'desfazer' };
    default:
      return { kind: 'unrecognized' };
  }
};

/**
 * Só é chamado quando as regras fixas não entenderam a mensagem — o regex resolve o
 * caso comum de graça e instantaneamente, e o plano gratuito do Gemini tem limite baixo
 * de requisições por minuto. Qualquer falha (sem chave, timeout, cota, JSON inválido)
 * devolve `null` e o bot cai no texto de ajuda, como se a IA não existisse.
 */
export const parseWithGemini = async (message: string, knownNames: string[]): Promise<ParsedCommand | null> => {
  if (!GEMINI_API_KEY) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(message, knownNames) }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0 },
      }),
    });

    if (!response.ok) {
      console.warn(`[gemini] Resposta ${response.status} — usando fallback.`);
      return null;
    }

    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;

    return toCommand(JSON.parse(text) as AiParsedCommand);
  } catch (error) {
    console.warn('[gemini] Falha ao interpretar:', error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
};

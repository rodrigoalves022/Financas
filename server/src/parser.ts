export type ParsedCommand =
  | { kind: 'registrar_divida'; personName: string; amount: number; description?: string }
  | { kind: 'marcar_pago'; personName: string; amount?: number }
  | { kind: 'racha'; amount: number; personNames: string[]; includeOwner: boolean; description?: string }
  | { kind: 'consulta_fatura' }
  | { kind: 'consulta_geral' }
  | { kind: 'consulta_pessoa'; personName: string; detailed: boolean }
  | { kind: 'desfazer' }
  | { kind: 'dicas' }
  | { kind: 'ajuda' }
  | { kind: 'unrecognized' };

export const HELP_TEXT = [
  '👋 *Assistente de Finanças no Telegram*',
  'Você pode enviar mensagens em texto livre ou usar comandos com barra */*.',
  '',
  '💸 *1. Registrar cobrança (alguém te deve)*',
  'Envie o nome, valor e o motivo:',
  '• *Carlos 45 almoço*',
  '• *Paulo Vitor 30 uber* (nome composto funciona)',
  '• *Paulo Vitor, 30, uber* (vírgula deixa explícito)',
  '',
  '✅ *2. Registrar pagamento (alguém te pagou)*',
  'Para quitar tudo ou dar baixa parcial:',
  '• *pago Carlos* (quita o valor total)',
  '• *pago Bruno Henrique 20* (abate R$ 20 do saldo)',
  '',
  '🍻 *3. Rachar uma conta*',
  'Separe os nomes por *vírgula*:',
  '• *racha 150 Paulo Vitor, Bruno Henrique* (2 partes: R$ 75 cada)',
  '• *racha 150 eu, Paulo Vitor, Bruno Henrique* (3 partes: cobra R$ 50 de cada)',
  '',
  '💳 *4. Consultar sua fatura do cartão*',
  '• *fatura* ou *quanto eu devo*',
  '',
  '📊 *5. Consultar quem te deve*',
  '• *quem me deve* (resumo de todos os devedores)',
  '• *saldo Carlos* (saldo total da pessoa)',
  '• *extrato Carlos* (detalhes e datas das pendências)',
  '',
  '↩️ *6. Corrigir lançamento*',
  '• *desfazer* (cancela a última ação)',
  '',
  '📎 *7. Mandar a fatura*',
  'Envie o arquivo *CSV* ou *OFX* da fatura aqui no chat (no app do banco: exportar fatura).',
  'O app importa sozinho, sem duplicar, e eu te aviso o resultado.',
  '',
  '💡 *8. Dicas e perguntas livres (IA)*',
  '• *dicas* (leitura da fatura com onde economizar)',
  '• *quanto gastei com mercado esse mês?*',
  '• *paguei o almoço do Daniel, 45 pila* (frases fora do formato também valem)',
].join('\n');

// Aceita "50", "50.90" ou "50,90" (formato BR).
const parseAmount = (raw: string): number | null => {
  const cleaned = raw.replace('R$', '').trim();
  if (!cleaned) return null;
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
};

// Valor que não engole o separador seguinte — importante agora que a vírgula também
// separa campos ("Paulo Vitor, 50, almoço") além de ser decimal ("50,90").
const AMOUNT = String.raw`\d+(?:[.,]\d+)*`;
// Nome com até 4 palavras, em repetição preguiçosa: sem isso "Daniel 50 uber 2 pessoas"
// seria lido como nome "Daniel 50 uber" e valor 2.
const NAME = String.raw`\S+(?:\s+\S+){0,3}?`;

// Tira a pontuação que sobra quando a vírgula é usada como separador de campos.
const cleanName = (value: string) => value.trim().replace(/[,;.]+$/, '').trim();

const OWNER_WORDS = new Set(['eu', 'mim', 'meu', 'minha']);

export const parseCommand = (text: string): ParsedCommand => {
  const trimmed = text.trim();

  if (/^\/?(ajuda|help|start|comandos)$/i.test(trimmed)) return { kind: 'ajuda' };
  if (/^\/?(desfazer|desfaz|undo|cancelar)$/i.test(trimmed)) return { kind: 'desfazer' };
  if (/^\/?(dicas?|analis(e|ar)|an[aá]lise\s+da\s+fatura)\s*\??$/i.test(trimmed)) return { kind: 'dicas' };

  // Consulta da própria fatura e dívidas: "fatura", "cartao", "quanto eu devo", "minhas dividas", "meus gastos"
  if (/^\/?(fatura|cart[aã]o|quanto\s+(eu\s+)?devo|minha\s+fatura|minhas\s+d[ií]vidas|meus\s+gastos)\s*\??$/i.test(trimmed)) {
    return { kind: 'consulta_fatura' };
  }

  // Consulta geral: "quem me deve", "quem ta devendo", "saldos", "resumo"
  if (/^\/?(quem\s+(me\s+)?(deve|ta\s+devendo|está\s+devendo)|saldos?|resumo|devedores)\s*\??$/i.test(trimmed)) {
    return { kind: 'consulta_geral' };
  }

  // Consulta por pessoa: "saldo Daniel" / "extrato Daniel" / "quanto Daniel me deve"
  const extratoMatch = trimmed.match(/^\/?(extrato|detalhe|detalhes)\s+(.+?)\s*\??$/i);
  if (extratoMatch) return { kind: 'consulta_pessoa', personName: extratoMatch[2].trim(), detailed: true };

  const saldoMatch = trimmed.match(/^\/?(?:saldo|quanto)\s+(?:o\s+|a\s+)?(.+?)(?:\s+me\s+deve)?\s*\??$/i);
  if (saldoMatch) return { kind: 'consulta_pessoa', personName: saldoMatch[1].trim(), detailed: false };

  // Racha: "racha 150 Paulo Vitor, Bruno Henrique" / "dividir 150 eu, Ana Clara"
  const rachaMatch = trimmed.match(new RegExp(String.raw`^\/?(?:racha|rachar|dividir|divide)\s+(${AMOUNT})\s+(.+)$`, 'i'));
  if (rachaMatch) {
    const amount = parseAmount(rachaMatch[1]);
    if (amount === null) return { kind: 'unrecognized' };
    // Com vírgula, ela manda: é o que permite nome composto. Sem vírgula nenhuma,
    // cai no espaço para não quebrar quem já usava "racha 150 Lucas Carlos".
    const raw = rachaMatch[2];
    const rawNames = (raw.includes(',') ? raw.split(',') : raw.split(/\s+/))
      .map(cleanName)
      .filter(Boolean);
    const includeOwner = rawNames.some(name => OWNER_WORDS.has(name.toLowerCase()));
    const personNames = rawNames.filter(name => !OWNER_WORDS.has(name.toLowerCase()));
    if (!personNames.length) return { kind: 'unrecognized' };
    return { kind: 'racha', amount, personNames, includeOwner };
  }

  const pagoMatch = trimmed.match(new RegExp(String.raw`^(?:\/pago|pago|paguei|recebi)\s+(${NAME})(?:[\s,]+(${AMOUNT}))?$`, 'i'));
  if (pagoMatch) {
    const [, personName, rawAmount] = pagoMatch;
    if (rawAmount) {
      const amount = parseAmount(rawAmount);
      if (amount === null) return { kind: 'unrecognized' };
      return { kind: 'marcar_pago', personName: cleanName(personName), amount };
    }
    return { kind: 'marcar_pago', personName: cleanName(personName) };
  }

  // "Paulo Vitor me deve 50 de cerveja" — nome antes do verbo. Precisa vir antes do
  // padrão genérico: agora que o nome aceita várias palavras, aquele leria o trecho
  // inteiro "Paulo Vitor me deve" como se fosse o nome.
  const naturalMatch = trimmed.match(new RegExp(String.raw`^(?:o\s+|a\s+)?(${NAME})\s+(?:me\s+)?deve\s+(${AMOUNT})(?:\s+(?:de\s+|do\s+|da\s+)?(.+))?$`, 'i'));
  if (naturalMatch) {
    const [, personName, rawAmount, description] = naturalMatch;
    const amount = parseAmount(rawAmount);
    if (amount === null) return { kind: 'unrecognized' };
    return { kind: 'registrar_divida', personName: cleanName(personName), amount, description: description?.trim() || undefined };
  }

  // Registro: "<nome> <valor> [descrição]", com "/deve" ou "deve" opcionais na frente.
  // A vírgula é aceita como separador: "Paulo Vitor, 50, almoço".
  const deveMatch = trimmed.match(new RegExp(String.raw`^(?:\/deve\s+|deve\s+)?(?!pago\b)(${NAME})[\s,]+(${AMOUNT})(?:[\s,]+(.+))?$`, 'i'));
  if (deveMatch) {
    const [, personName, rawAmount, description] = deveMatch;
    const amount = parseAmount(rawAmount);
    if (amount === null) return { kind: 'unrecognized' };
    return { kind: 'registrar_divida', personName: cleanName(personName), amount, description: description?.trim() || undefined };
  }

  return { kind: 'unrecognized' };
};

// ─── Fuzzy match de nomes ─────────────────────────────────────────────────────

export const normalizeName = (value: string) =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toUpperCase();

const levenshtein = (a: string, b: string): number => {
  const rows = Array.from({ length: b.length + 1 }, (_, i) => [i, ...Array<number>(a.length).fill(0)]);
  for (let col = 0; col <= a.length; col += 1) rows[0][col] = col;
  for (let row = 1; row <= b.length; row += 1) {
    for (let col = 1; col <= a.length; col += 1) {
      const cost = a[col - 1] === b[row - 1] ? 0 : 1;
      rows[row][col] = Math.min(rows[row - 1][col] + 1, rows[row][col - 1] + 1, rows[row - 1][col - 1] + cost);
    }
  }
  return rows[b.length][a.length];
};

export interface NameMatch {
  status: 'exact' | 'suggestion' | 'ambiguous' | 'unknown';
  name?: string;
  candidates: string[];
}

/**
 * Casa o nome digitado com os membros conhecidos. Erro de digitação vira sugestão;
 * empate vira pergunta; nada parecido exige confirmação antes de criar alguém novo
 * — sem isso, uma mensagem qualquer como "ok 2" criava um membro chamado "ok".
 */
export const matchPersonName = (input: string, knownNames: string[]): NameMatch => {
  const target = normalizeName(input);
  if (!target) return { status: 'unknown', candidates: [] };

  const exact = knownNames.find(name => normalizeName(name) === target);
  if (exact) return { status: 'exact', name: exact, candidates: [] };

  const tolerance = target.length <= 4 ? 1 : 2;
  const close = knownNames.filter(name => {
    const candidate = normalizeName(name);
    if (candidate.startsWith(target) || target.startsWith(candidate)) return true;
    return levenshtein(target, candidate) <= tolerance;
  });

  if (close.length === 1) return { status: 'suggestion', name: close[0], candidates: close };
  if (close.length > 1) return { status: 'ambiguous', candidates: close };
  return { status: 'unknown', candidates: [] };
};

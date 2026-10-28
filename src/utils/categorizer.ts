import type { Alias, CategorizationSource, Category, CategoryRule, RuleMatchType, Transaction } from '../types';
import { DEFAULT_CATEGORIES } from './constants';
import { normalizeText } from './formatters';
import { normalizeMerchant, parseMerchant } from './merchant';

export interface CategorizationResult {
  categoryId: string;
  source: CategorizationSource;
  /** Palavra-chave ou regra que decidiu, para explicar ao usuário. */
  keyword?: string;
}

export interface CategorizerContext {
  categories: Category[];
  rules?: CategoryRule[];
  aliases?: Alias[];
}

export const SOURCE_LABELS: Record<CategorizationSource, string> = {
  manual: 'Escolhida à mão',
  regra: 'Regra personalizada',
  'palavra-chave': 'Palavra-chave da categoria',
  dicionario: 'Dicionário inteligente',
  extrato: 'Categoria do extrato do banco',
  padrao: 'Sem correspondência',
  ia: 'Sugestão da IA',
};

/** Fontes fracas: a categoria pode estar errada e vale revisar (ou mandar para a IA). */
export const isLowConfidence = (source?: CategorizationSource) => source === 'extrato' || source === 'padrao';

// ─── Dicionário embutido ─────────────────────────────────────────────────────
// Conhecimento genérico de estabelecimentos brasileiros. Cada grupo aponta para
// uma lista de categorias candidatas: usa a primeira que existir no cadastro do
// usuário (ids do sistema antigo primeiro, depois os padrões). Fica no código e não
// nas categorias salvas porque estas vivem no IndexedDB de cada aparelho e nunca
// receberiam palavras novas de uma atualização do app.

interface DictionaryGroup {
  targets: string[];
  keywords: string[];
  /** Grupos com prioridade maior vencem palavras mais longas de outros grupos. */
  priority?: number;
}

const DICTIONARY: DictionaryGroup[] = [
  {
    priority: 2,
    targets: ['tarifas'],
    keywords: ['iof', 'juros', 'encargo', 'encargos', 'anuidade', 'tarifa', 'multa atraso', 'seguro fatura', 'protecao perda'],
  },
  {
    targets: ['pix-via-credito'],
    keywords: ['pix cred', 'pix credito', 'pix no credito'],
  },
  {
    targets: ['compras-online'],
    keywords: [
      'mercadolivre', 'mercado livre', 'mercadol', 'shopee', 'aliexpress', 'amazonmktplc', 'amazon mktplc', 'amazon marketplace',
      'amazon br', 'amzn mktp', 'magalu', 'magazine luiza', 'americanas', 'casas bahia', 'kabum', 'temu', 'submarino', 'olist', 'wish',
    ],
  },
  {
    targets: ['vestuario'],
    keywords: ['shein', 'renner', 'riachuelo', 'zara', 'c&a', 'cea', 'hering', 'marisa', 'dafiti', 'lojas avenida', 'pernambucanas', 'youcom', 'reserva', 'calcados', 'sapataria', 'boutique', 'moda'],
  },
  {
    targets: ['supermercado', 'alimentacao'],
    keywords: [
      'supermercado', 'supermerc', 'super mercado', 'mercado', 'mercearia', 'atacadao', 'assai', 'carrefour', 'pao de acucar', 'atacarejo',
      'hortifruti', 'sacolao', 'acougue', 'casa de carnes', 'frigorifico', 'comercial de alimentos', 'armazem',
    ],
  },
  {
    targets: ['delivery', 'alimentacao-restaurante', 'alimentacao'],
    keywords: ['ifood', 'ifd', 'rappi', 'ze delivery', 'zedelivery', '99food', 'ubereats', 'uber eats', 'aiqfome', 'delivery'],
  },
  {
    targets: ['alimentacao-restaurante', 'alimentacao'],
    keywords: [
      'restaurante', 'restaurant', 'lanchonete', 'lanches', 'padaria', 'panificadora', 'pastelaria', 'churrascaria', 'pizzaria', 'pizza',
      'hamburgueria', 'burger', 'acai', 'sorveteria', 'cafeteria', 'cafe', 'grill', 'bistro', 'espetinho', 'pamonharia', 'sushi', 'temakeria',
      'mcdonalds', 'mc donalds', 'burger king', 'subway', 'habibs', 'giraffas', 'outback', 'spoleto', 'bobs', 'cozinha', 'bolos', 'doceria', 'confeitaria',
    ],
  },
  {
    targets: ['bebida-alcoolica', 'lazer'],
    keywords: ['distribuidora*', 'bebidas*', 'adega', 'cervejaria', 'cervejao', 'cerveja', 'choperia', 'chopp', 'tabacaria', 'bar', 'boteco', 'buteco', 'pub', 'conveniencia'],
  },
  {
    targets: ['posto-de-gasolina', 'transporte'],
    keywords: ['posto', 'auto posto', 'combustivel', 'combustiveis', 'shell', 'ipiranga', 'petrobras', 'br mania', 'gasolina'],
  },
  {
    targets: ['transporte'],
    keywords: [
      'uber', 'uber trip', '99', '99app', '99 tecnologia', '99pop', 'cabify', 'indrive', 'buser', 'clickbus', 'estacionamento', 'estapar',
      'sem parar', 'conectcar', 'veloe', 'pedagio', 'metro', 'onibus', 'passagem', 'latam', 'gol linhas', 'azul linhas', 'localiza', 'movida',
      'unidas', 'oficina', 'auto pecas', 'autopecas', 'pneus', 'lava jato', 'detran', 'ipva',
    ],
  },
  {
    targets: ['farmacia-saude', 'saude'],
    keywords: [
      'farmacia', 'drogaria', 'drogasil', 'droga raia', 'raia', 'pague menos', 'panvel', 'ultrafarma', 'drogao', 'unimed', 'hapvida', 'amil',
      'laboratorio', 'clinica', 'hospital', 'odonto', 'dentista', 'consulta', 'exame', 'otica', 'psicolog',
    ],
  },
  {
    targets: ['academia', 'saude'],
    keywords: ['academia', 'smart fit', 'smartfit', 'bodytech', 'crossfit', 'bluefit', 'selfit', 'wellhub', 'gympass', 'totalpass'],
  },
  {
    targets: ['assinaturas-streaming', 'assinaturas'],
    keywords: [
      'netflix', 'spotify', 'amazon prime', 'prime video', 'primevideo', 'disney', 'hbo', 'globoplay', 'deezer', 'youtube', 'google one',
      'google storage', 'apple com bill', 'applecombill', 'icloud', 'paramount', 'crunchyroll', 'claro flex', 'chatgpt', 'openai', 'anthropic',
      'claude ai', 'microsoft', 'xbox', 'playstation', 'steam', 'amazon aws', 'aws', 'canva', 'adobe', 'dropbox',
    ],
  },
  {
    targets: ['casa-moradia', 'moradia'],
    keywords: [
      'aluguel', 'condominio', 'enel', 'equatorial', 'energia', 'saneago', 'sabesp', 'copasa', 'cemig', 'internet', 'vivo fibra', 'claro net',
      'tim live', 'iptu', 'leroy merlin', 'telhanorte', 'construcao', 'material de construcao', 'madeireira', 'ferragens', 'casa e video',
      'tok stok', 'tokstok', 'mobly', 'eletrica', 'vidracaria',
    ],
  },
  {
    targets: ['educacao'],
    keywords: ['faculdade', 'universidade', 'escola', 'colegio', 'curso', 'udemy', 'alura', 'hotmart', 'kiwify', 'livraria', 'livro', 'papelaria'],
  },
  {
    targets: ['entretenimento-lazer', 'lazer'],
    keywords: ['cinema', 'cinemark', 'ingresso', 'ingressos', 'sympla', 'eventim', 'teatro', 'show', 'parque', 'clube', 'pesque', 'pesqueiro', 'boliche', 'karaoke'],
  },
];

// Categorias do extrato do Inter → candidatas no cadastro.
const RAW_CATEGORY_MAP: Record<string, string[]> = {
  SUPERMERCADO: ['supermercado', 'alimentacao'],
  SUPERMERCADOS: ['supermercado', 'alimentacao'],
  RESTAURANTES: ['alimentacao-restaurante', 'alimentacao'],
  RESTAURANTE: ['alimentacao-restaurante', 'alimentacao'],
  BARES: ['bebida-alcoolica', 'lazer'],
  TRANSPORTE: ['transporte'],
  COMBUSTIVEL: ['posto-de-gasolina', 'transporte'],
  VESTUARIO: ['vestuario'],
  SAUDE: ['farmacia-saude', 'saude'],
  FARMACIA: ['farmacia-saude', 'saude'],
  EDUCACAO: ['educacao'],
  LAZER: ['entretenimento-lazer', 'lazer'],
  ENTRETENIMENTO: ['entretenimento-lazer', 'lazer'],
  ESPORTES: ['academia', 'entretenimento-lazer', 'lazer'],
  VIAGEM: ['entretenimento-lazer', 'lazer', 'transporte'],
  TURISMO: ['entretenimento-lazer', 'lazer'],
  CONSTRUCAO: ['casa-moradia', 'moradia'],
  CASA: ['casa-moradia', 'moradia'],
  MORADIA: ['casa-moradia', 'moradia'],
  COMPRAS: ['compras-online'],
  DEPARTAMENTO: ['compras-online'],
  ASSINATURAS: ['assinaturas-streaming', 'assinaturas'],
  SERVICOS: [],
  OUTROS: [],
};

// ─── Comparação de palavras-chave ────────────────────────────────────────────

const compact = (value: string) => value.replace(/ /g, '');

/** `text` e `keyword` já normalizados (normalizeText). */
export const keywordMatches = (text: string, keyword: string, mode: RuleMatchType = 'auto'): boolean => {
  if (!keyword || !text) return false;
  const padded = ` ${text} `;
  if (mode === 'word') return padded.includes(` ${keyword} `);
  if (mode === 'prefix') return text.startsWith(keyword);
  if (mode === 'contains') return compact(text).includes(compact(keyword));

  const multiWord = keyword.includes(' ');
  // Curtas viram palavra inteira: "cea" não pode casar com "merCEAria", nem "bar" com "BARueri".
  if (!multiWord && keyword.length <= 4) return padded.includes(` ${keyword} `);
  // Expressões com várias palavras ou médias: precisam começar em início de palavra
  // ("c&a" vira "C A" e não pode casar com "MC Alimentos"; "mercado" não casa com "superMERCADOpago").
  if (multiWord || keyword.length <= 7) return padded.includes(` ${keyword}`);
  // Longas são específicas o bastante para casar em qualquer trecho, inclusive grudadas
  // ("RESTAURANTE" dentro de "BARERESTAURANTE", "MERCADO LIVRE" em "MERCADOLIVRE").
  return compact(text).includes(compact(keyword));
};

// ─── Motor ───────────────────────────────────────────────────────────────────

interface CompiledKeyword {
  keyword: string;
  display: string;
  categoryId: string;
  mode: RuleMatchType;
  priority: number;
}

const byStrength = (a: CompiledKeyword, b: CompiledKeyword) => b.priority - a.priority || b.keyword.length - a.keyword.length;

// Chave inclui a categoria: "EMPORIO" que o usuário pôs em Bebidas é escolha dele,
// mesmo existindo "emporio" no pacote padrão de Alimentação.
const defaultKeywordKeys = new Set(DEFAULT_CATEGORIES.flatMap(category => category.keywords.map(keyword => `${category.id}|${normalizeText(keyword)}`)));

export const createCategorizer = ({ categories, rules = [], aliases = [] }: CategorizerContext) => {
  const categoryIds = new Set(categories.map(category => category.id));
  const resolveTarget = (targets: string[]) => targets.find(id => categoryIds.has(id));

  const ruleKeywords: CompiledKeyword[] = rules
    .filter(rule => categoryIds.has(rule.categoryId))
    .map(rule => ({ keyword: normalizeText(rule.keyword), display: rule.keyword, categoryId: rule.categoryId, mode: rule.matchType || 'auto', priority: 0 }))
    .filter(item => item.keyword)
    .sort(byStrength);

  // Palavras que o usuário colocou nas categorias (ou que vieram do sistema antigo)
  // valem mais que as do pacote padrão: em empate, "EMPORIO" do usuário vence o padrão.
  const userKeywords: CompiledKeyword[] = [];
  const builtinKeywords: CompiledKeyword[] = [];
  categories.forEach(category => {
    if (category.id === 'outros') return;
    category.keywords.forEach(raw => {
      const keyword = normalizeText(raw);
      if (!keyword) return;
      const target = defaultKeywordKeys.has(`${category.id}|${keyword}`) ? builtinKeywords : userKeywords;
      target.push({ keyword, display: raw, categoryId: category.id, mode: 'auto', priority: 1 });
    });
  });
  DICTIONARY.forEach(group => {
    const categoryId = resolveTarget(group.targets);
    if (!categoryId) return;
    // O dicionário sabe mais que as palavras genéricas das categorias padrão
    // (ex.: "supermercado" vai para a categoria Supermercado quando ela existe).
    // Sufixo "*" força casar em qualquer trecho ("bebidas*" pega "UAIBEBIDAS").
    group.keywords.forEach(raw => {
      const contains = raw.endsWith('*');
      const display = contains ? raw.slice(0, -1) : raw;
      builtinKeywords.push({ keyword: normalizeText(display), display, categoryId, mode: contains ? 'contains' : 'auto', priority: group.priority || 1.5 });
    });
  });
  userKeywords.sort(byStrength);
  builtinKeywords.sort(byStrength);

  const aliasByMerchant = new Map(aliases.map(alias => [normalizeMerchant(alias.original), normalizeText(alias.alias)]));

  const findIn = (list: CompiledKeyword[], texts: string[], fullText?: string) => {
    for (const item of list) {
      // Só regras "contém" do usuário olham a descrição inteira (com cidade).
      const candidates = item.mode === 'contains' && fullText ? [...texts, fullText] : texts;
      if (candidates.some(text => keywordMatches(text, item.keyword, item.mode))) return item;
    }
    return undefined;
  };

  return (description: string, rawCategory?: string): CategorizationResult => {
    const parsed = parseMerchant(description);
    const alias = aliasByMerchant.get(normalizeMerchant(description));
    const cleanTexts = [alias, parsed.name].filter((text): text is string => Boolean(text));
    // Palavras do usuário também olham o nome com a maquininha: o sistema antigo gravou
    // originais como "MP *LASKABAR" direto nas categorias.
    const userTexts = Array.from(new Set([...cleanTexts, parsed.label]));

    const rule = findIn(ruleKeywords, userTexts, parsed.full);
    if (rule) return { categoryId: rule.categoryId, source: 'regra', keyword: rule.display };

    const user = findIn(userKeywords, userTexts);
    if (user) return { categoryId: user.categoryId, source: 'palavra-chave', keyword: user.display };

    const builtin = findIn(builtinKeywords, cleanTexts);
    if (builtin) return { categoryId: builtin.categoryId, source: 'dicionario', keyword: builtin.display };

    const raw = normalizeText(rawCategory || '');
    if (raw && raw !== 'OUTROS') {
      const exact = categories.find(category => normalizeText(category.name) === raw);
      if (exact) return { categoryId: exact.id, source: 'extrato', keyword: rawCategory };
      const mapped = resolveTarget(RAW_CATEGORY_MAP[raw] || []);
      if (mapped) return { categoryId: mapped, source: 'extrato', keyword: rawCategory };
    }

    return { categoryId: categoryIds.has('outros') ? 'outros' : categories[0]?.id || 'outros', source: 'padrao' };
  };
};

/** Atalho para uma descrição só; para lotes, crie o categorizer uma vez com createCategorizer. */
export const categorize = (description: string, rawCategory: string | undefined, categories: Category[], rules?: CategoryRule[], aliases?: Alias[]) => {
  return createCategorizer({ categories, rules, aliases })(description, rawCategory).categoryId;
};

export interface RecategorizationChange {
  transaction: Transaction;
  from: string;
  to: string;
  result: CategorizationResult;
}

/**
 * Recalcula a categoria de todas as transações. Categorias escolhidas à mão ficam
 * intocadas, a menos que `force` seja usado — antes, criar qualquer regra apagava
 * silenciosamente as correções manuais feitas na tela de Fatura.
 */
export const recategorizeTransactions = (transactions: Transaction[], context: CategorizerContext, options: { force?: boolean } = {}) => {
  const run = createCategorizer(context);
  const changes: RecategorizationChange[] = [];
  const next = transactions.map(transaction => {
    if (transaction.type !== 'expense') return transaction;
    if (transaction.manualCategory && !options.force) return transaction;
    const result = run(transaction.description, transaction.rawCategory);
    // Sem regra e sem a categoria do banco, o motor só sabe dizer "Outros". Isso não
    // é motivo para desfazer uma categoria que já existe (lançamentos antigos não
    // guardaram a categoria do extrato).
    if (result.source === 'padrao' && !transaction.rawCategory && transaction.categoryId !== result.categoryId) return transaction;
    const unlock = options.force && transaction.manualCategory;
    if (result.categoryId === transaction.categoryId && transaction.categorySource === result.source && !unlock) return transaction;
    if (result.categoryId !== transaction.categoryId) changes.push({ transaction, from: transaction.categoryId, to: result.categoryId, result });
    return { ...transaction, categoryId: result.categoryId, categorySource: result.source, manualCategory: false };
  });
  return { transactions: next, changes };
};

import { toolRegistry } from '../registry';
import type { ToolContext } from '../types';
import { normalizeText, shiftMonth } from '../../utils/formatters';
import { DEFAULT_CATEGORIES } from '../../utils/constants';
import { createCategorizer, recategorizeTransactions } from '../../utils/categorizer';
import { applyAlias, getPurchaseTransactions } from '../../utils/analytics';
import { merchantKeyword, normalizeMerchant } from '../../utils/merchant';
import type { Category, CategoryRule, RuleMatchType, Transaction } from '../../types';

const keywordKey = (value: string) => normalizeText(value);
const defaultKeywordKeys = new Set(DEFAULT_CATEGORIES.flatMap(category => category.keywords.map(keywordKey)));

const slugify = (name: string) => name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Recategoriza tudo com o estado atual; categorias escolhidas à mão são preservadas. */
const recategorizeAll = (ctx: ToolContext, options: { force?: boolean } = {}) => {
  const { transactions, categories, categoryRules, aliases } = ctx.getState();
  const result = recategorizeTransactions(transactions, { categories, rules: categoryRules, aliases }, options);
  ctx.dispatch({ type: 'SET_TRANSACTIONS', payload: result.transactions });
  return result.changes.length;
};

/** O apelido entra no texto que o motor lê: ao criar/remover, recategoriza só aquele local. */
const recategorizeMerchant = (ctx: ToolContext, description: string) => {
  const key = normalizeMerchant(description);
  const { transactions, categories, categoryRules, aliases } = ctx.getState();
  const scope = transactions.filter(item => normalizeMerchant(item.description) === key);
  const result = recategorizeTransactions(scope, { categories, rules: categoryRules, aliases });
  const byId = new Map(result.transactions.filter((item, index) => item !== scope[index]).map(item => [item.id, item]));
  if (byId.size) ctx.dispatch({ type: 'SET_TRANSACTIONS', payload: ctx.getState().transactions.map(item => byId.get(item.id) || item) });
  return result.changes.length;
};

// Regras antigas também gravavam a palavra dentro da categoria. Ao editar/excluir a
// regra, essas cópias precisam sair junto (exceto palavras do pacote padrão).
const removeUserKeywords = (rows: Category[], keywords: string[]) => {
  const removable = new Set(keywords.map(keywordKey).filter(key => !defaultKeywordKeys.has(key)));
  if (!removable.size) return rows;
  return rows.map(category => ({ ...category, keywords: category.keywords.filter(keyword => !removable.has(keywordKey(keyword))) }));
};

// ─── Categorias ───────────────────────────────────────────────────────────────

toolRegistry.register<{ name: string; color?: string; keywords?: string[] }, { categoryId: string; created: boolean }>({
  id: 'criar_categoria',
  name: 'Criar nova categoria',
  description: 'Cadastra uma nova categoria personalizada no sistema',
  category: 'transacoes',
  execute: (params, ctx) => {
    const cleanName = params.name.trim();
    if (!cleanName) throw new Error('Informe o nome da categoria.');
    const { categories } = ctx.getState();
    const existing = categories.find(category => normalizeText(category.name) === normalizeText(cleanName));
    if (existing) return { categoryId: existing.id, created: false };
    let id = slugify(cleanName) || crypto.randomUUID();
    while (categories.some(category => category.id === id)) id = `${id}-2`;
    const newCategory: Category = { id, name: cleanName, color: params.color || '#64748b', keywords: params.keywords || [] };
    ctx.dispatch({ type: 'SET_CATEGORIES', payload: [...categories, newCategory] });
    return { categoryId: id, created: true };
  },
});

toolRegistry.register<{ categoryId: string; name?: string; color?: string; keywords?: string[] }, { changed: number }>({
  id: 'atualizar_categoria',
  name: 'Atualizar categoria e palavras-chave',
  description: 'Edita nome, cor e lista de palavras-chave de uma categoria',
  category: 'transacoes',
  execute: (params, ctx) => {
    const { categories } = ctx.getState();
    ctx.dispatch({
      type: 'SET_CATEGORIES',
      payload: categories.map(category => category.id !== params.categoryId ? category : {
        ...category,
        name: params.name?.trim() || category.name,
        color: params.color ?? category.color,
        keywords: params.keywords ?? category.keywords,
      }),
    });
    return { changed: params.keywords ? recategorizeAll(ctx) : 0 };
  },
});

toolRegistry.register<{ categoryId: string }, { moved: number }>({
  id: 'excluir_categoria',
  name: 'Excluir categoria',
  description: 'Remove uma categoria; lançamentos dela são recategorizados e regras/metas ligadas a ela saem junto',
  category: 'transacoes',
  execute: (params, ctx) => {
    if (params.categoryId === 'outros') throw new Error('A categoria "Outros" é usada como padrão e não pode ser excluída.');
    const { categories, transactions, categoryRules, budgets } = ctx.getState();
    if (!categories.some(category => category.id === params.categoryId)) return { moved: 0 };
    const affected = transactions.filter(item => item.categoryId === params.categoryId);
    ctx.dispatch({ type: 'SET_CATEGORIES', payload: categories.filter(category => category.id !== params.categoryId) });
    ctx.dispatch({ type: 'SET_CATEGORY_RULES', payload: categoryRules.filter(rule => rule.categoryId !== params.categoryId) });
    ctx.dispatch({ type: 'SET_BUDGETS', payload: budgets.filter(budget => budget.categoryId !== params.categoryId) });
    // Escolhas manuais apontando para a categoria removida perdem o sentido: liberam para as regras.
    ctx.dispatch({
      type: 'SET_TRANSACTIONS',
      payload: ctx.getState().transactions.map(item => item.categoryId === params.categoryId ? { ...item, manualCategory: false } : item),
    });
    recategorizeAll(ctx);
    return { moved: affected.length };
  },
});

// ─── Transação individual ─────────────────────────────────────────────────────

toolRegistry.register<{ transactionId: string; categoryId: string }, void>({
  id: 'atualizar_categoria_transacao',
  name: 'Atualizar categoria da transação',
  description: 'Altera a categoria de uma transação específica e protege a escolha contra regras automáticas',
  category: 'transacoes',
  execute: (params, ctx) => {
    ctx.dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: params.transactionId, patch: { categoryId: params.categoryId, manualCategory: true, categorySource: 'manual' } },
    });
  },
});

toolRegistry.register<{ transactionId: string; note: string; samePurchase?: boolean }, { updated: number }>({
  id: 'atualizar_nota_transacao',
  name: 'Atualizar nota da transação',
  description: 'Altera a observação de uma compra (ex.: "celular"); com samePurchase, vale para todas as parcelas dela',
  category: 'transacoes',
  execute: (params, ctx) => {
    const { transactions } = ctx.getState();
    const transaction = transactions.find(item => item.id === params.transactionId);
    if (!transaction) throw new Error('Transação não encontrada.');
    const note = params.note.trim();
    const ids = new Set((params.samePurchase ? getPurchaseTransactions(transaction, transactions) : [transaction]).map(item => item.id));
    ctx.dispatch({ type: 'SET_TRANSACTIONS', payload: transactions.map(item => ids.has(item.id) ? { ...item, note } : item) });
    return { updated: ids.size };
  },
});

interface AplicarLocalResult { ruleKeyword: string; updated: number }

toolRegistry.register<{ transactionId: string; categoryId: string; keyword?: string }, AplicarLocalResult>({
  id: 'aplicar_categoria_local',
  name: 'Aplicar categoria a todo o estabelecimento',
  description: 'Cria uma regra com o nome do local e recategoriza todas as compras dele (atuais e futuras)',
  category: 'transacoes',
  execute: (params, ctx) => {
    const { transactions, aliases } = ctx.getState();
    const transaction = transactions.find(item => item.id === params.transactionId);
    if (!transaction) throw new Error('Transação não encontrada.');
    const keyword = (params.keyword || merchantKeyword(transaction.description)).trim();
    const merchant = applyAlias(transaction.description, aliases);

    upsertRule(ctx, { keyword, categoryId: params.categoryId, matchType: 'auto', origin: 'manual' });

    // Variações do mesmo local que a palavra-chave não alcança (outra maquininha,
    // nome cortado) entram pelo agrupamento de estabelecimento.
    const sameMerchant = new Set(ctx.getState().transactions.filter(item => applyAlias(item.description, aliases) === merchant).map(item => item.id));
    ctx.dispatch({
      type: 'SET_TRANSACTIONS',
      payload: ctx.getState().transactions.map(item => sameMerchant.has(item.id)
        ? { ...item, categoryId: params.categoryId, categorySource: 'regra', manualCategory: false }
        : item),
    });
    const changed = recategorizeAll(ctx);
    return { ruleKeyword: keyword, updated: sameMerchant.size + changed };
  },
});

toolRegistry.register<{ original: string; alias: string }, void>({
  id: 'criar_alias',
  name: 'Criar alias de estabelecimento',
  description: 'Dá um apelido a um estabelecimento: vale para TODAS as compras dele. Para identificar uma compra só, use atualizar_nota_transacao',
  category: 'transacoes',
  execute: (params, ctx) => {
    const cleanOriginal = params.original.trim();
    const cleanAlias = params.alias.trim();
    if (!cleanOriginal) return;
    // Apelido vazio ou igual ao nome do extrato é o mesmo que voltar ao original.
    if (!cleanAlias || normalizeText(cleanAlias) === normalizeMerchant(cleanOriginal)) ctx.dispatch({ type: 'REMOVE_ALIAS', payload: cleanOriginal });
    else ctx.dispatch({ type: 'ADD_ALIAS', payload: { original: cleanOriginal, alias: cleanAlias } });
    recategorizeMerchant(ctx, cleanOriginal);
  },
});

toolRegistry.register<{ original: string }, void>({
  id: 'remover_alias',
  name: 'Remover alias de estabelecimento',
  description: 'Volta o estabelecimento ao nome original do extrato',
  category: 'transacoes',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'REMOVE_ALIAS', payload: params.original });
    recategorizeMerchant(ctx, params.original);
  },
});

toolRegistry.register<{ original: string; transactionIds: string[] }, { updated: number; note: string }>({
  id: 'converter_alias_em_observacao',
  name: 'Transformar alias em observação',
  description: 'Usa o texto do apelido como observação das compras escolhidas (com todas as parcelas) e volta o local ao nome original',
  category: 'transacoes',
  execute: (params, ctx) => {
    const key = normalizeMerchant(params.original);
    const { transactions, aliases } = ctx.getState();
    const alias = aliases.find(item => normalizeMerchant(item.original) === key);
    if (!alias) throw new Error('Esse local não tem apelido.');
    const chosen = transactions.filter(item => params.transactionIds.includes(item.id));
    const ids = new Set(chosen.flatMap(item => getPurchaseTransactions(item, transactions)).map(item => item.id));
    ctx.dispatch({ type: 'SET_TRANSACTIONS', payload: transactions.map(item => ids.has(item.id) ? { ...item, note: alias.alias } : item) });
    ctx.dispatch({ type: 'REMOVE_ALIAS', payload: params.original });
    recategorizeMerchant(ctx, params.original);
    return { updated: ids.size, note: alias.alias };
  },
});

// ─── Lançamento manual ────────────────────────────────────────────────────────

interface LancamentoManualParams {
  date: string;
  description: string;
  /** Valor total da compra; com parcelas, é dividido entre elas. */
  amount: number;
  categoryId: string;
  invoiceMonth: string;
  installments?: number;
  note?: string;
}

toolRegistry.register<LancamentoManualParams, { created: number }>({
  id: 'lancar_despesa_manual',
  name: 'Lançar despesa manual',
  description: 'Adiciona uma compra que não veio no extrato, opcionalmente parcelada nas faturas seguintes',
  category: 'transacoes',
  execute: (params, ctx) => {
    const description = params.description.trim();
    if (!description || params.amount <= 0 || !params.invoiceMonth) throw new Error('Preencha descrição, valor e mês da fatura.');
    const total = Math.round(params.amount * 100);
    const count = Math.max(1, Math.min(48, Math.floor(params.installments || 1)));
    const base = Math.floor(total / count);
    const groupId = crypto.randomUUID();
    const rows: Transaction[] = Array.from({ length: count }, (_, index) => ({
      id: `manual-${groupId}-${index + 1}`,
      date: params.date,
      description,
      // Os centavos que sobram da divisão ficam na primeira parcela.
      amount: (base + (index === 0 ? total - base * count : 0)) / 100,
      categoryId: params.categoryId,
      categorySource: 'manual',
      manualCategory: true,
      type: 'expense',
      source: 'manual',
      invoiceMonth: shiftMonth(params.invoiceMonth, index),
      installment: count > 1 ? `${index + 1}/${count}` : undefined,
      note: params.note?.trim() || undefined,
      status: 'ok',
    }));
    ctx.dispatch({ type: 'ADD_TRANSACTIONS', payload: rows });
    return { created: rows.length };
  },
});

toolRegistry.register<{ transactionId: string }, void>({
  id: 'excluir_transacao',
  name: 'Excluir lançamento manual',
  description: 'Remove um lançamento manual e as cobranças ligadas a ele',
  category: 'transacoes',
  execute: (params, ctx) => {
    const { transactions, receivables } = ctx.getState();
    const transaction = transactions.find(item => item.id === params.transactionId);
    if (!transaction) return;
    // Linhas importadas voltariam no próximo sync da pasta de faturas; só manuais saem.
    if (transaction.source !== 'manual') throw new Error('Só lançamentos manuais podem ser excluídos.');
    ctx.dispatch({ type: 'SET_RECEIVABLES', payload: receivables.filter(item => item.transactionId !== params.transactionId) });
    ctx.dispatch({ type: 'DELETE_TRANSACTION', payload: params.transactionId });
  },
});

// ─── Regras de categorização ──────────────────────────────────────────────────

interface RuleInput { keyword: string; categoryId: string; matchType?: RuleMatchType; origin?: CategoryRule['origin'] }

const upsertRule = (ctx: ToolContext, input: RuleInput) => {
  const keyword = input.keyword.trim();
  if (!keyword || !input.categoryId) throw new Error('Informe palavra-chave e categoria.');
  const { categoryRules } = ctx.getState();
  const existing = categoryRules.find(rule => keywordKey(rule.keyword) === keywordKey(keyword));
  const rule: CategoryRule = {
    id: existing?.id || crypto.randomUUID(),
    keyword,
    categoryId: input.categoryId,
    matchType: input.matchType || existing?.matchType || 'auto',
    origin: input.origin || existing?.origin || 'manual',
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  ctx.dispatch({ type: 'ADD_CATEGORY_RULE', payload: rule });
  return rule;
};

toolRegistry.register<RuleInput, { changed: number }>({
  id: 'criar_regra_categoria',
  name: 'Criar regra de categoria',
  description: 'Cria uma regra de categorização por palavra-chave e aplica às transações existentes e futuras',
  category: 'transacoes',
  execute: (params, ctx) => {
    upsertRule(ctx, params);
    return { changed: recategorizeAll(ctx) };
  },
});

toolRegistry.register<{ ruleId: string } & RuleInput, { changed: number }>({
  id: 'atualizar_regra_categoria',
  name: 'Atualizar regra de categoria',
  description: 'Edita uma regra existente de categorização',
  category: 'transacoes',
  execute: (params, ctx) => {
    const keyword = params.keyword.trim();
    if (!keyword || !params.categoryId) throw new Error('Informe palavra-chave e categoria.');
    const { categoryRules, categories } = ctx.getState();
    const previous = categoryRules.find(rule => rule.id === params.ruleId);
    ctx.dispatch({ type: 'UPDATE_CATEGORY_RULE', payload: { id: params.ruleId, patch: { keyword, categoryId: params.categoryId, matchType: params.matchType || 'auto' } } });
    if (previous) ctx.dispatch({ type: 'SET_CATEGORIES', payload: removeUserKeywords(categories, [previous.keyword]) });
    return { changed: recategorizeAll(ctx) };
  },
});

toolRegistry.register<{ ruleId: string }, { changed: number }>({
  id: 'excluir_regra_categoria',
  name: 'Excluir regra de categoria',
  description: 'Remove uma regra de categorização personalizada',
  category: 'transacoes',
  execute: (params, ctx) => {
    const { categoryRules, categories } = ctx.getState();
    const rule = categoryRules.find(item => item.id === params.ruleId);
    if (!rule) return { changed: 0 };
    ctx.dispatch({ type: 'DELETE_CATEGORY_RULE', payload: params.ruleId });
    ctx.dispatch({ type: 'SET_CATEGORIES', payload: removeUserKeywords(categories, [rule.keyword]) });
    return { changed: recategorizeAll(ctx) };
  },
});

toolRegistry.register<{ force?: boolean; transactionIds?: string[] } | undefined, { changed: number }>({
  id: 'reaplicar_todas_regras',
  name: 'Reaplicar todas as regras de categorização',
  description: 'Recategoriza as transações com as regras atuais. Com force, inclui as escolhidas à mão; com transactionIds, só essas.',
  category: 'transacoes',
  execute: (params, ctx) => {
    if (!params?.transactionIds) return { changed: recategorizeAll(ctx, { force: params?.force }) };
    const { transactions, categories, categoryRules, aliases } = ctx.getState();
    const ids = new Set(params.transactionIds);
    const run = createCategorizer({ categories, rules: categoryRules, aliases });
    let changed = 0;
    ctx.dispatch({
      type: 'SET_TRANSACTIONS',
      payload: transactions.map(item => {
        if (!ids.has(item.id)) return item;
        const result = run(item.description, item.rawCategory);
        if (result.categoryId !== item.categoryId) changed += 1;
        return { ...item, categoryId: result.categoryId, categorySource: result.source, manualCategory: false };
      }),
    });
    return { changed };
  },
});

export { upsertRule };

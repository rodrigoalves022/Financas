import type { Category, LegacyMigrationData, Member, MonthlyIncome, Transaction } from '../types';
import { DEFAULT_CATEGORIES } from '../utils/constants';
import { parseInvoiceFile } from '../utils/csvParser';
import { createCategorizer } from '../utils/categorizer';
import { getDebtBalance } from '../utils/analytics';
import { currentMonthISO, normalizeText, shiftMonth } from '../utils/formatters';
import type { FinanceAction, FinanceState } from './actions';
import { financeReducer } from './reducer';
import { DEFAULT_OWNER, FLAGS, readFlag, readJsonFlag, writeFlag } from './storage';

export interface StoreAccess {
  getState: () => FinanceState;
  dispatch: (action: FinanceAction) => void;
}

const MANIFEST_URL = '/faturas/manifest.json';

// Hash do conteúdo (djb2): antes a assinatura era só o tamanho do arquivo, e um CSV
// substituído por outro de mesmo tamanho passava como "já importado".
const contentHash = (content: string) => {
  let hash = 5381;
  for (let index = 0; index < content.length; index += 1) hash = ((hash << 5) + hash + content.charCodeAt(index)) | 0;
  return (hash >>> 0).toString(36);
};

export const fileSignature = (file: string, content: string) => `${file}#h${contentHash(content)}`;
const lengthSignature = (file: string, content: string) => `${file}#${content.length}`;

const parsingContext = (state: FinanceState) => ({ categories: state.categories, rules: state.categoryRules, aliases: state.aliases });

// ─── Faturas locais (public/faturas) ─────────────────────────────────────────

type LocalFaturas =
  | { status: 'ok'; files: Array<{ file: string; content: string }> }
  | { status: 'sem_manifesto' | 'invalido'; files: [] };

export const loadLocalFaturas = async (): Promise<LocalFaturas> => {
  const manifestResponse = await fetch(MANIFEST_URL, { cache: 'no-store' });
  if (!manifestResponse.ok) return { status: 'sem_manifesto', files: [] };
  // Um servidor sem fallback correto pode responder 200 com HTML (a própria index.html)
  // quando o manifest some do disco. Isso não é uma lista de faturas.
  let names: string[];
  try {
    const parsed = await manifestResponse.json();
    if (!Array.isArray(parsed)) throw new Error('not an array');
    names = parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return { status: 'invalido', files: [] };
  }
  const files: Array<{ file: string; content: string }> = [];
  for (const file of names) {
    const response = await fetch(`/faturas/${file}`, { cache: 'no-store' });
    if (response.ok) files.push({ file, content: await response.text() });
  }
  return { status: 'ok', files };
};

/** Importa só arquivos novos ou alterados de public/faturas. Devolve a mensagem de status. */
export const autoImportFaturas = async ({ getState, dispatch }: StoreAccess): Promise<string> => {
  if (readFlag(FLAGS.userCleared)) return 'Importação automática pausada após limpeza manual';
  const local = await loadLocalFaturas();
  if (local.status === 'sem_manifesto') return 'Sem manifesto em public/faturas';
  if (local.status === 'invalido') return 'manifest.json em public/faturas não é uma lista válida';

  const { processedFiles } = getState();
  const processedSet = new Set(processedFiles);
  const imported: Transaction[] = [];
  const entries: string[] = [];
  const upgraded: string[] = [];
  // Arquivo com assinatura diferente da registrada: o CSV foi corrigido depois do primeiro import.
  const changedFiles: string[] = [];

  for (const { file, content } of local.files) {
    const signature = fileSignature(file, content);
    const knownSignatures = processedFiles.filter(entry => entry.startsWith(`${file}#`));
    if (processedSet.has(signature)) continue;
    // Registrado com a assinatura antiga (tamanho) e ainda batendo: grava a nova sem
    // reimportar. Daqui em diante qualquer mudança de conteúdo é detectada.
    if (!knownSignatures.some(entry => entry.startsWith(`${file}#h`)) && processedSet.has(lengthSignature(file, content))) {
      upgraded.push(signature);
      continue;
    }
    // Arquivo registrado só pelo nome (importado pelo sistema antigo ou pela tela de
    // importação): sem assinatura para comparar, não mexe. Antes este teste valia para
    // todos — e como o nome também era gravado junto da assinatura, um CSV substituído
    // (ex.: fatura exportada de novo depois de fechar) nunca era reimportado.
    if (!knownSignatures.length && processedSet.has(file)) continue;
    if (knownSignatures.length) changedFiles.push(file);
    imported.push(...await parseInvoiceFile(file, content, parsingContext(getState())));
    entries.push(file, signature);
  }

  if (upgraded.length) dispatch({ type: 'ADD_PROCESSED_FILES', payload: upgraded });
  if (!entries.length) return 'Faturas locais já importadas';
  dispatch({ type: 'RESYNC_TRANSACTIONS', payload: { staleSourceFiles: changedFiles, incoming: imported } });
  // Troca as assinaturas antigas dos arquivos alterados pelas atuais.
  const changedSet = new Set(changedFiles);
  const kept = getState().processedFiles.filter(entry => !(entry.includes('#') && changedSet.has(entry.split('#')[0])));
  dispatch({ type: 'SET_PROCESSED_FILES', payload: Array.from(new Set([...kept, ...entries])) });
  const fileCount = entries.length / 2;
  return changedFiles.length
    ? `${fileCount} arquivo(s) importado(s) · ${changedFiles.length} atualizado(s): ${changedFiles.join(', ')}`
    : `${imported.length} transações importadas de ${fileCount} arquivo(s)`;
};

/**
 * "Corrigir faturas locais": reconcilia TODOS os arquivos do manifest, mesmo com a
 * assinatura batendo. Remove linhas que não existem mais nas versões atuais dos
 * arquivos sem tocar em categorização/vínculos das que continuam iguais.
 */
export const resyncLocalFaturas = async ({ getState, dispatch }: StoreAccess): Promise<string> => {
  const local = await loadLocalFaturas();
  if (local.status === 'sem_manifesto') return 'Sem manifesto em public/faturas.';
  if (local.status === 'invalido') return 'manifest.json em public/faturas não é uma lista válida (arquivo ausente ou corrompido).';
  if (!local.files.length) return 'Nenhuma fatura encontrada no manifesto.';

  const incoming: Transaction[] = [];
  const freshEntries: string[] = [];
  for (const { file, content } of local.files) {
    incoming.push(...await parseInvoiceFile(file, content, parsingContext(getState())));
    freshEntries.push(file, fileSignature(file, content));
  }

  const files = local.files.map(item => item.file);
  const staleSet = new Set(files);
  const state = getState();
  const beforeCount = state.transactions.filter(t => t.sourceFile && staleSet.has(t.sourceFile)).length;
  const resynced = financeReducer(state, { type: 'RESYNC_TRANSACTIONS', payload: { staleSourceFiles: files, incoming } });
  const afterCount = resynced.transactions.filter(t => t.sourceFile && staleSet.has(t.sourceFile)).length;

  dispatch({ type: 'SET_TRANSACTIONS', payload: resynced.transactions });
  // Limpa nomes/assinaturas antigas desses arquivos antes de gravar as atuais,
  // senão a lista de "arquivos processados" cresce para sempre a cada edição.
  const keptProcessed = getState().processedFiles.filter(entry => !staleSet.has(entry.split('#')[0]));
  dispatch({ type: 'SET_PROCESSED_FILES', payload: Array.from(new Set([...keptProcessed, ...freshEntries])) });

  const delta = afterCount - beforeCount;
  const deltaLabel = delta === 0 ? 'sem mudança no total de lançamentos' : delta > 0 ? `+${delta} lançamentos` : `${delta} lançamentos (duplicatas removidas)`;
  return `${files.length} arquivo(s) revisados: ${beforeCount} → ${afterCount} lançamentos (${deltaLabel}).`;
};

// ─── Banco antigo (public/migration/legacy-data.json) ────────────────────────

const deletedIds = (key: string) => new Set(readJsonFlag<string[]>(key, []));

export const runLegacyMigration = async ({ getState, dispatch }: StoreAccess): Promise<string | null> => {
  if (readFlag(FLAGS.userCleared)) return 'Importação automática pausada após limpeza manual';
  try {
    const response = await fetch('/migration/legacy-data.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const data = await response.json() as LegacyMigrationData;
    if (readFlag(FLAGS.legacyVersion) === data.schemaVersion) return null;

    const state = getState();
    const byIdCat = new Map(state.categories.map(item => [item.id, item]));
    data.categories.forEach(category => {
      const current = byIdCat.get(category.id);
      byIdCat.set(category.id, current
        ? { ...current, keywords: Array.from(new Set([...current.keywords, ...category.keywords])) }
        : category);
    });
    dispatch({ type: 'SET_CATEGORIES', payload: Array.from(byIdCat.values()) });

    if (data.categoryRules?.length) {
      const byIdRule = new Map(state.categoryRules.map(item => [item.id, item]));
      data.categoryRules.forEach(item => byIdRule.set(item.id, item));
      dispatch({ type: 'SET_CATEGORY_RULES', payload: Array.from(byIdRule.values()) });
    }

    const byOriginal = new Map(state.aliases.map(item => [normalizeText(item.original), item]));
    data.aliases.forEach(alias => byOriginal.set(normalizeText(alias.original), alias));
    dispatch({ type: 'SET_ALIASES', payload: Array.from(byOriginal.values()) });

    // Cada receita antiga vira uma entrada própria — antes elas eram agrupadas por mês,
    // o que fazia sumir entradas quando o mês já tinha mais de uma.
    const existingIncomeIds = new Set(state.monthlyIncomes.map(item => item.id).filter(Boolean));
    const legacyIncomes: MonthlyIncome[] = data.monthlyIncomes
      .map((item, index) => ({ ...item, id: item.id || `legacy-${item.month}-${index}`, source: 'legacy' as const }))
      .filter(item => !existingIncomeIds.has(item.id));
    dispatch({ type: 'SET_MONTHLY_INCOMES', payload: [...state.monthlyIncomes, ...legacyIncomes].sort((a, b) => a.month.localeCompare(b.month)) });

    const debtIds = new Set(state.debts.map(item => item.id));
    const removedDebts = deletedIds(FLAGS.deletedDebts);
    dispatch({ type: 'SET_DEBTS', payload: [...data.debts.filter(item => !debtIds.has(item.id) && !removedDebts.has(item.id)), ...state.debts] });

    if (data.budgets?.length) {
      const byCategory = new Map(state.budgets.map(item => [item.categoryId, item]));
      data.budgets.forEach(item => byCategory.set(item.categoryId, item));
      dispatch({ type: 'SET_BUDGETS', payload: Array.from(byCategory.values()) });
    }
    if (data.members?.length) {
      const byIdMember = new Map(state.members.map(item => [item.id, item]));
      const removedMembers = deletedIds(FLAGS.deletedMembers);
      data.members.filter(item => !removedMembers.has(item.id)).forEach(item => byIdMember.set(item.id, item));
      dispatch({ type: 'SET_MEMBERS', payload: Array.from(byIdMember.values()) });
    }
    if (data.receivables?.length) {
      const byIdRec = new Map(state.receivables.map(item => [item.id, item]));
      const removedRec = deletedIds(FLAGS.deletedReceivables);
      data.receivables.filter(item => !removedRec.has(item.id)).forEach(item => byIdRec.set(item.id, item));
      dispatch({ type: 'SET_RECEIVABLES', payload: Array.from(byIdRec.values()) });
    }

    dispatch({ type: 'ADD_TRANSACTIONS', payload: data.transactions });
    dispatch({ type: 'ADD_PROCESSED_FILES', payload: data.processedFiles });
    writeFlag(FLAGS.legacyVersion, data.schemaVersion);
    return `${data.transactions.length} transações migradas do banco antigo`;
  } catch {
    return 'Migração do banco antigo indisponível';
  }
};

// ─── Correções locais (síncronas, sobre o estado já carregado) ───────────────

const installmentParts = (installment?: string) => {
  const match = installment?.match(/(\d+)\/(\d+)/);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
};

const sourceMonthFromFile = (sourceFile?: string) => {
  const match = sourceFile?.match(/(20\d{2})[-_](0[1-9]|1[0-2])/);
  return match ? `${match[1]}-${match[2]}` : '';
};

const fixProjectionInstallmentDates = (rows: Transaction[]) => {
  const groups = new Map<string, Transaction[]>();
  rows.forEach(row => {
    const parts = installmentParts(row.installment);
    const sourceMonth = sourceMonthFromFile(row.sourceFile);
    if (!parts || !sourceMonth) return;
    const key = `${row.sourceFile}|${normalizeText(row.description)}|${row.amount.toFixed(2)}|${parts.total}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });

  const nextDates = new Map<string, string>();
  groups.forEach(group => {
    const anchor = group
      .filter(row => row.source !== 'projection')
      .map(row => ({ row, parts: installmentParts(row.installment), sourceMonth: sourceMonthFromFile(row.sourceFile) }))
      .filter((item): item is { row: Transaction; parts: { current: number; total: number }; sourceMonth: string } => Boolean(item.parts && item.sourceMonth))
      .sort((a, b) => a.parts.current - b.parts.current)[0];
    if (!anchor) return;

    group.filter(row => row.source === 'projection').forEach(row => {
      const parts = installmentParts(row.installment);
      if (!parts) return;
      const targetMonth = shiftMonth(anchor.sourceMonth, parts.current - anchor.parts.current);
      const day = row.date.substring(8, 10) || anchor.row.date.substring(8, 10) || '01';
      nextDates.set(row.id, `${targetMonth}-${day}`);
    });
  });

  if (!nextDates.size) return rows;
  return rows.map(row => {
    const nextDate = nextDates.get(row.id);
    return nextDate && nextDate !== row.date ? { ...row, date: nextDate } : row;
  });
};

/**
 * Garante exatamente um titular. Antes, se o titular fosse renomeado ("Rodrigo" →
 * "Rodrigo Silva"), o app criava um segundo "Rodrigo" titular a cada carregamento.
 */
export const ensureOwner = (members: Member[]): Member[] => {
  if (members.some(member => member.isOwner)) return members;
  const named = members.find(member => normalizeText(member.name) === normalizeText(DEFAULT_OWNER.name));
  if (named) return members.map(member => member.id === named.id ? { ...member, isOwner: true } : member);
  return [DEFAULT_OWNER, ...members];
};

/** Adiciona categorias padrão que ainda não existem (sem mexer nas que o usuário já tem). */
const withMissingDefaults = (categories: Category[]) => {
  const ids = new Set(categories.map(category => category.id));
  const names = new Set(categories.map(category => normalizeText(category.name)));
  const missing = DEFAULT_CATEGORIES.filter(category => !ids.has(category.id) && !names.has(normalizeText(category.name)));
  return missing.length ? [...categories, ...missing] : categories;
};

export const runLocalMigrations = ({ getState, dispatch }: StoreAccess) => {
  const state = getState();

  const members = ensureOwner(state.members);
  if (members !== state.members) dispatch({ type: 'SET_MEMBERS', payload: members });

  const categories = withMissingDefaults(state.categories);
  if (categories !== state.categories) dispatch({ type: 'SET_CATEGORIES', payload: categories });

  // Regras antigas viviam só como palavras-chave dentro das categorias.
  if (!getState().categoryRules.length && !readFlag(FLAGS.rulesBackfilled)) {
    const defaultKeys = new Set(DEFAULT_CATEGORIES.flatMap(category => category.keywords.map(keyword => `${category.id}|${normalizeText(keyword)}`)));
    const recovered = getState().categories.flatMap(category => category.keywords
      .filter(keyword => !defaultKeys.has(`${category.id}|${normalizeText(keyword)}`))
      .map(keyword => ({ id: crypto.randomUUID(), keyword, categoryId: category.id, createdAt: new Date().toISOString() })));
    if (recovered.length) dispatch({ type: 'SET_CATEGORY_RULES', payload: recovered });
    writeFlag(FLAGS.rulesBackfilled, 'true');
  }

  if (!readFlag(FLAGS.installmentDatesFixed)) {
    const fixed = fixProjectionInstallmentDates(getState().transactions);
    if (fixed !== getState().transactions) dispatch({ type: 'SET_TRANSACTIONS', payload: fixed });
    writeFlag(FLAGS.installmentDatesFixed, 'true');
  }

  // Titular nunca cobra a si mesmo.
  const ownerIds = new Set(getState().members.filter(member => member.isOwner).map(member => member.id));
  const receivables = getState().receivables;
  if (receivables.some(item => ownerIds.has(item.memberId))) {
    dispatch({ type: 'SET_RECEIVABLES', payload: receivables.filter(item => !ownerIds.has(item.memberId)) });
  }

  // Quem devia ao titular existia só como texto em Debt.counterparty, sem virar Member.
  // Só "a receber" com saldo aberto: contrapartes "a pagar" costumam ser banco/financeira,
  // e olhar dívidas quitadas faria renascer pessoas excluídas de propósito.
  const current = getState();
  const known = new Set(current.members.map(member => normalizeText(member.name)));
  const missing = new Map<string, string>();
  current.debts
    .filter(debt => debt.type === 'a_receber' && getDebtBalance(debt, current.transactions) > 0)
    .forEach(debt => {
      const key = normalizeText(debt.counterparty);
      if (key && !known.has(key) && !missing.has(key)) missing.set(key, debt.counterparty.trim());
    });
  if (missing.size) {
    const created: Member[] = Array.from(missing.values()).map(name => ({ id: crypto.randomUUID(), name, aliases: [] }));
    dispatch({ type: 'SET_MEMBERS', payload: [...current.members, ...created] });
  }

  if (!readFlag(FLAGS.incomeCleanup)) {
    const month = currentMonthISO();
    dispatch({
      type: 'SET_MONTHLY_INCOMES',
      payload: getState().monthlyIncomes
        .filter(item => item.month >= month || item.source === 'manual')
        .sort((a, b) => a.month.localeCompare(b.month)),
    });
    writeFlag(FLAGS.incomeCleanup, 'true');
  }
};

/**
 * Restaura linhas que versões antigas do parser descartavam: cobranças como IOF e
 * encargos, compras idênticas no mesmo dia (a segunda era tratada como duplicata) e
 * pagamentos/estornos da fatura. ADD_TRANSACTIONS só acrescenta o que ainda não existe.
 */
export const recoverMissingTransactions = async ({ getState, dispatch }: StoreAccess) => {
  if (readFlag(FLAGS.iofRecovered) || readFlag(FLAGS.userCleared)) return;
  try {
    const local = await loadLocalFaturas();
    if (local.status !== 'ok') return;
    const rows: Transaction[] = [];
    for (const { file, content } of local.files) rows.push(...await parseInvoiceFile(file, content, parsingContext(getState())));
    if (rows.length) dispatch({ type: 'ADD_TRANSACTIONS', payload: rows });
    writeFlag(FLAGS.iofRecovered, 'true');
  } catch {
    // Sem acesso às faturas locais (ex.: build sem public/faturas) — tenta de novo no próximo carregamento.
  }
};

/**
 * Lançamentos importados antes desta versão não guardaram a categoria que o banco
 * mandou no CSV. Relê as faturas locais uma vez para recuperá-la (pelo mesmo id),
 * o que dá ao motor de categorização a pista do banco quando nenhuma regra casa.
 */
export const backfillRawCategories = async ({ getState, dispatch }: StoreAccess) => {
  if (readFlag(FLAGS.rawCategoryBackfilled)) return;
  if (!getState().transactions.some(item => item.source === 'csv' && !item.rawCategory)) {
    writeFlag(FLAGS.rawCategoryBackfilled, 'true');
    return;
  }
  try {
    const local = await loadLocalFaturas();
    if (local.status !== 'ok') return;
    const rawById = new Map<string, string>();
    for (const { file, content } of local.files) {
      const rows = await parseInvoiceFile(file, content, parsingContext(getState()));
      rows.forEach(row => { if (row.rawCategory) rawById.set(row.id, row.rawCategory); });
    }
    let changed = false;
    const next = getState().transactions.map(item => {
      const raw = !item.rawCategory ? rawById.get(item.id) : undefined;
      if (!raw) return item;
      changed = true;
      return { ...item, rawCategory: raw };
    });
    if (changed) dispatch({ type: 'SET_TRANSACTIONS', payload: next });
    writeFlag(FLAGS.rawCategoryBackfilled, 'true');
  } catch {
    // Faturas locais indisponíveis (ex.: APK): tenta de novo no próximo carregamento.
  }
};

/**
 * Registra por que cada lançamento antigo tem a categoria atual, quando o motor
 * chega na mesma resposta. Os que divergem ficam sem origem: podem ser escolhas
 * manuais feitas antes de o app registrá-las, e aparecem na prévia de reclassificação
 * para o usuário decidir — nada é trocado automaticamente.
 */
export const backfillCategorySource = ({ getState, dispatch }: StoreAccess) => {
  const state = getState();
  if (!state.transactions.some(item => item.type === 'expense' && !item.categorySource && !item.manualCategory)) return;
  const run = createCategorizer({ categories: state.categories, rules: state.categoryRules, aliases: state.aliases });
  let changed = false;
  const next = state.transactions.map(item => {
    if (item.type !== 'expense' || item.categorySource || item.manualCategory) return item;
    const result = run(item.description, item.rawCategory);
    if (result.categoryId !== item.categoryId) return item;
    changed = true;
    return { ...item, categorySource: result.source };
  });
  if (changed) dispatch({ type: 'SET_TRANSACTIONS', payload: next });
};

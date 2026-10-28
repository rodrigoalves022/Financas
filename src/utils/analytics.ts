import type { Alias, Budget, Category, CategoryTotal, Debt, MerchantTotal, Member, MonthlyIncome, MonthlySummary, Receivable, Transaction } from '../types';
import { WEEKDAY_LABELS } from './constants';
import { currentMonthISO, daysBetween, formatBRL, formatMonth, normalizeText, shiftMonth, todayISO } from './formatters';
import { normalizeMerchant } from './merchant';

export const getDueMonth = (transaction: Transaction) => {
  if (transaction.source === 'projection') return transaction.date.substring(0, 7);
  if (transaction.invoiceMonth) return transaction.invoiceMonth;
  const match = transaction.sourceFile?.match(/(20\d{2})[-_](0[1-9]|1[0-2])/);
  if (match) return `${match[1]}-${match[2]}`;
  return transaction.date.substring(0, 7);
};

export const getInvoiceMonth = getDueMonth;
export const getAccountingMonth = getDueMonth;

const monthOf = getAccountingMonth;

const hasImportedSource = (transaction: Transaction) => transaction.source === 'csv' || transaction.source === 'ofx';

export const canonicalTransactions = (transactions: Transaction[]) => {
  const importedMonths = new Set(
    transactions
      .filter(hasImportedSource)
      .map(getAccountingMonth),
  );

  if (!importedMonths.size) return transactions;

  return transactions.filter(transaction => {
    const month = getAccountingMonth(transaction);
    if (!importedMonths.has(month)) return true;
    if (hasImportedSource(transaction)) return true;
    if (transaction.source === 'projection') return false;
    if (transaction.sourceFile) return false;
    return true;
  });
};

export const filterByMonth = (transactions: Transaction[], selectedMonth: string) => {
  const canonical = canonicalTransactions(transactions);
  return selectedMonth ? canonical.filter(item => monthOf(item) === selectedMonth) : canonical;
};

export const expenseTransactions = (transactions: Transaction[]) => {
  return canonicalTransactions(transactions).filter(item => item.type === 'expense');
};

const isRefund = (item: Transaction) => item.type === 'income' && item.creditKind === 'estorno';
const isPayment = (item: Transaction) => item.type === 'income' && item.creditKind === 'pagamento';

/** Valor da fatura como o banco mostra: compras − estornos, na base canônica do Painel. */
export const getInvoiceTotal = (transactions: Transaction[], month: string) => {
  const rows = filterByMonth(transactions, month);
  const gross = rows.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0);
  const refunds = rows.filter(isRefund).reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, gross - refunds);
};

/** Meses de fatura com despesa, já na base canônica. */
export const getInvoiceMonths = (transactions: Transaction[]) => {
  return Array.from(new Set(expenseTransactions(transactions).map(monthOf))).sort();
};

/** Mês padrão para abrir o app: a fatura importada mais recente (não uma projeção futura). */
export const getLatestInvoiceMonth = (transactions: Transaction[]) => {
  const real = transactions.filter(item => item.source !== 'projection').map(monthOf).sort();
  return real.at(-1) || '';
};

export const getMonthlySummaries = (transactions: Transaction[], incomes: MonthlyIncome[]): MonthlySummary[] => {
  const canonical = canonicalTransactions(transactions);
  const months = new Set<string>();
  canonical.forEach(item => months.add(monthOf(item)));
  incomes.forEach(item => months.add(item.month));

  return Array.from(months).sort().map(month => {
    const monthRows = canonical.filter(item => monthOf(item) === month);
    const expense = Math.max(0, monthRows.filter(item => item.type === 'expense').reduce((sum, item) => sum + item.amount, 0)
      - monthRows.filter(isRefund).reduce((sum, item) => sum + item.amount, 0));
    const monthIncomes = incomes.filter(item => item.month === month);
    const regularIncome = monthIncomes
      .filter(item => item.source !== 'adjustment')
      .reduce((sum, item) => sum + item.amount, 0);
    const hasAdjustment = monthIncomes.some(item => item.source === 'adjustment');
    const income = hasAdjustment ? Math.max(expense, regularIncome) : regularIncome;
    return { month, income, expense, balance: income - expense };
  });
};

export const getCategoryTotals = (transactions: Transaction[], categories: Category[]): CategoryTotal[] => {
  const expenses = expenseTransactions(transactions);
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  return categories.map(category => {
    const rows = expenses.filter(item => item.categoryId === category.id);
    const categoryTotal = rows.reduce((sum, item) => sum + item.amount, 0);
    return {
      id: category.id,
      name: category.name,
      color: category.color,
      total: categoryTotal,
      percent: total ? (categoryTotal / total) * 100 : 0,
      count: rows.length,
      averageTicket: rows.length ? categoryTotal / rows.length : 0,
    };
  }).filter(item => item.total > 0).sort((a, b) => b.total - a.total);
};

export const getMonthCategoryDiff = (transactions: Transaction[], categories: Category[], leftMonth: string, rightMonth: string) => {
  const left = getCategoryTotals(filterByMonth(transactions, leftMonth), categories);
  const right = getCategoryTotals(filterByMonth(transactions, rightMonth), categories);
  return categories.map(category => {
    const current = left.find(item => item.id === category.id)?.total || 0;
    const compare = right.find(item => item.id === category.id)?.total || 0;
    return {
      id: category.id,
      name: category.name,
      color: category.color,
      current,
      compare,
      diff: current - compare,
      percent: compare ? ((current - compare) / compare) * 100 : null,
    };
  }).filter(item => item.current > 0 || item.compare > 0).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
};

export interface HeatmapCell {
  date: string;
  day: number;
  total: number;
  count: number;
  intensity: number;
  /** Célula de preenchimento antes do primeiro dia, para alinhar com o dia da semana. */
  filler?: boolean;
}

/**
 * Calendário real das compras da fatura: uma fatura cruza dois meses do calendário
 * (ex.: 28/04 a 27/05), então agrupar só pelo "dia do mês" misturava datas diferentes.
 * As células começam no domingo da primeira semana para alinhar com os dias da semana.
 */
export const getDailyHeatmap = (transactions: Transaction[], selectedMonth: string): HeatmapCell[] => {
  const scoped = expenseTransactions(filterByMonth(transactions, selectedMonth)).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  if (!scoped.length) return [];
  const byDate = new Map<string, { total: number; count: number }>();
  scoped.forEach(item => {
    const current = byDate.get(item.date) || { total: 0, count: 0 };
    byDate.set(item.date, { total: current.total + item.amount, count: current.count + 1 });
  });
  const dates = Array.from(byDate.keys()).sort();
  // Parcelas antigas trazem a data da compra original; o calendário cobre só a janela recente.
  const last = dates.at(-1) as string;
  const windowStart = new Date(`${last}T12:00:00`);
  windowStart.setDate(windowStart.getDate() - 41);
  const first = dates.find(date => new Date(`${date}T12:00:00`) >= windowStart) || dates[0];
  const max = Math.max(...Array.from(byDate.values()).map(item => item.total), 1);

  const cells: HeatmapCell[] = [];
  const cursor = new Date(`${first}T12:00:00`);
  for (let pad = 0; pad < cursor.getDay(); pad += 1) cells.push({ date: `pad-${pad}`, day: 0, total: 0, count: 0, intensity: 0, filler: true });
  const end = new Date(`${last}T12:00:00`);
  while (cursor <= end) {
    const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    const entry = byDate.get(iso);
    cells.push({ date: iso, day: cursor.getDate(), total: entry?.total || 0, count: entry?.count || 0, intensity: entry ? entry.total / max : 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
};

export const merchantName = (description: string, aliases: Alias[] = []) => {
  return applyAlias(description, aliases);
};

export const getRecurringMerchants = (transactions: Transaction[], aliases: Alias[] = []) => {
  const groups = new Map<string, { merchant: string; months: Set<string>; amounts: number[]; total: number }>();
  expenseTransactions(transactions).forEach(item => {
    const merchant = merchantName(item.description, aliases);
    const current = groups.get(merchant) || { merchant, months: new Set<string>(), amounts: [], total: 0 };
    current.months.add(monthOf(item));
    current.amounts.push(item.amount);
    current.total += item.amount;
    groups.set(merchant, current);
  });
  return Array.from(groups.values())
    .map(item => {
      const average = item.total / item.amounts.length;
      const maxDeviation = Math.max(...item.amounts.map(amount => Math.abs(amount - average))) / Math.max(average, 1);
      return {
        merchant: item.merchant,
        months: item.months.size,
        count: item.amounts.length,
        average,
        total: item.total,
        confidence: item.months.size >= 3 && maxDeviation <= 0.2 ? 'confirmada' : 'suspeita',
      };
    })
    .filter(item => item.months >= 2)
    .sort((a, b) => b.months - a.months || b.total - a.total);
};

export const getTransactionAnomalies = (transactions: Transaction[], categories: Category[]) => {
  const expenses = expenseTransactions(transactions);
  const byCategory = new Map<string, Transaction[]>();
  expenses.forEach(item => byCategory.set(item.categoryId, [...(byCategory.get(item.categoryId) || []), item]));
  return expenses.flatMap(item => {
    const peers = byCategory.get(item.categoryId) || [];
    if (peers.length < 4) return [];
    const average = peers.reduce((sum, row) => sum + row.amount, 0) / peers.length;
    const variance = peers.reduce((sum, row) => sum + (row.amount - average) ** 2, 0) / peers.length;
    const deviation = Math.sqrt(variance);
    // Limiar adapta-se à volatilidade real da categoria em vez de um valor fixo:
    // categorias erráticas (ex: lazer) exigem um desvio maior pra soar alarme que
    // categorias estáveis (ex: assinaturas), com um piso relativo pra evitar ruído.
    const threshold = average + Math.max(deviation * 2.5, average * 0.5);
    if (item.amount <= threshold || item.amount < average * 1.3) return [];
    return [{
      ...item,
      categoryName: categories.find(category => category.id === item.categoryId)?.name || 'Outros',
      categoryAverage: average,
      multiple: item.amount / Math.max(average, 1),
    }];
  }).sort((a, b) => b.multiple - a.multiple);
};

export const getCategoryVolatility = (transactions: Transaction[], categories: Category[]) => {
  const today = currentMonthISO();
  const months = getInvoiceMonths(transactions).filter(month => month <= shiftMonth(today, 1));
  return categories.map(category => {
    const values = months.map(month => expenseTransactions(filterByMonth(transactions, month))
      .filter(item => item.categoryId === category.id)
      .reduce((sum, item) => sum + item.amount, 0));
    const average = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
    const variance = values.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / Math.max(values.length, 1);
    const deviation = Math.sqrt(variance);
    return {
      id: category.id,
      name: category.name,
      average,
      deviation,
      volatility: average ? deviation / average : 0,
    };
  }).filter(item => item.average > 0).sort((a, b) => b.volatility - a.volatility);
};

export const applyAlias = (description: string, aliases: Alias[]) => {
  const key = normalizeMerchant(description);
  const found = aliases.find(item => normalizeMerchant(item.original) === key);
  return found?.alias || key;
};

export const getMerchantTotals = (transactions: Transaction[], aliases: Alias[] = []): MerchantTotal[] => {
  const groups = new Map<string, MerchantTotal>();
  expenseTransactions(transactions).forEach(item => {
    const merchant = merchantName(item.description, aliases);
    const current = groups.get(merchant) || { merchant, total: 0, count: 0, averageTicket: 0, variants: [] };
    current.total += item.amount;
    current.count += 1;
    if (!current.variants.includes(item.description)) current.variants.push(item.description);
    groups.set(merchant, current);
  });
  return Array.from(groups.values())
    .map(item => ({ ...item, averageTicket: item.count ? item.total / item.count : 0, variants: item.variants.slice(0, 4) }))
    .sort((a, b) => b.total - a.total);
};

export const getWeekdayAverages = (transactions: Transaction[]) => {
  const expenses = expenseTransactions(transactions);
  return WEEKDAY_LABELS.map((label, index) => {
    const rows = expenses.filter(item => new Date(`${item.date}T12:00:00`).getDay() === index);
    const total = rows.reduce((sum, item) => sum + item.amount, 0);
    return { label, total, average: rows.length ? total / rows.length : 0, count: rows.length };
  });
};

export interface FutureInstallment {
  date: string;
  month: string;
  description: string;
  categoryId: string;
  amount: number;
  type: string;
  /** Observação da compra (ex.: "celular"), vinda de qualquer parcela dela. */
  note?: string;
  /** Parcela calculada a partir da última fatura em que a compra apareceu. */
  projected?: boolean;
}

const installmentParts = (installment?: string) => {
  const match = installment?.match(/(\d+)\/(\d+)/);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
};

/**
 * Duas linhas são a mesma compra quando são parcelas dela: mesmo local, mesma data de
 * compra, mesmo número de parcelas e valor ±R$ 1 (a 1ª parcela costuma ter centavos a mais).
 */
export const isSamePurchase = (a: Transaction, b: Transaction) => {
  if (a.id === b.id) return true;
  const partsA = installmentParts(a.installment);
  const partsB = installmentParts(b.installment);
  if (!partsA || !partsB || partsA.total !== partsB.total || partsA.current === partsB.current) return false;
  return a.type === b.type
    && a.date === b.date
    && Math.abs(a.amount - b.amount) <= 1
    && normalizeMerchant(a.description) === normalizeMerchant(b.description);
};

/** A linha e as outras parcelas da mesma compra. */
export const getPurchaseTransactions = (transaction: Transaction, transactions: Transaction[]) =>
  transactions.filter(item => isSamePurchase(transaction, item));

/** Agrupa linhas por compra (parcelas juntas), da mais recente para a mais antiga. */
export const groupPurchases = (transactions: Transaction[]) => {
  const pending = [...transactions].sort((a, b) => b.date.localeCompare(a.date));
  const groups: Transaction[][] = [];
  const assigned = new Set<string>();
  pending.forEach(item => {
    if (assigned.has(item.id)) return;
    const group = pending.filter(other => !assigned.has(other.id) && isSamePurchase(item, other));
    group.forEach(other => assigned.add(other.id));
    groups.push(group);
  });
  return groups;
};

/**
 * Parcelas novas (da próxima fatura importada) herdam a observação que você deu à
 * compra nas parcelas anteriores: "celular" em 3/10 continua em 4/10.
 */
export const inheritPurchaseNotes = (existing: Transaction[], incoming: Transaction[]) => {
  const noted = existing.filter(item => item.note?.trim() && item.installment);
  if (!noted.length) return incoming;
  return incoming.map(item => {
    if (item.note?.trim() || !item.installment) return item;
    const source = noted.find(other => isSamePurchase(item, other));
    return source ? { ...item, note: source.note } : item;
  });
};

/**
 * Parcelas a partir do mês atual: as que já estão em faturas importadas e as que
 * ainda vão cair, projetadas da última parcela vista (ex.: 2/12 em outubro gera
 * 3/12 em novembro... 12/12 em agosto). Antes só existiam as já importadas, então
 * "próximos meses" ficava zerado mesmo com parcelamentos em andamento.
 */
export const getFutureInstallments = (transactions: Transaction[]): FutureInstallment[] => {
  const todayMonth = currentMonthISO();
  const withInstallment = expenseTransactions(transactions).filter(item => installmentParts(item.installment));

  interface InstallmentGroup {
    merchant: string;
    date: string;
    total: number;
    baseAmount: number;
    items: Map<number, Transaction>;
    latestCurrent: number;
    latestItem: Transaction;
    note?: string;
  }

  const groups: InstallmentGroup[] = [];
  withInstallment.forEach(item => {
    const parts = installmentParts(item.installment)!;
    const merchant = normalizeMerchant(item.description);
    // Agrupa pelo estabelecimento normalizado, total de parcelas, data de compra e valor aproximado
    // (compras parceladas quase sempre têm centavos de sobra na 1ª parcela, ex: R$ 339,50 vs R$ 339,40).
    let group = groups.find(g =>
      g.merchant === merchant &&
      g.date === item.date &&
      g.total === parts.total &&
      Math.abs(g.baseAmount - item.amount) <= 1.00 &&
      !g.items.has(parts.current)
    );
    if (!group) {
      group = {
        merchant,
        date: item.date,
        total: parts.total,
        baseAmount: item.amount,
        items: new Map(),
        latestCurrent: parts.current,
        latestItem: item,
      };
      groups.push(group);
    }
    group.items.set(parts.current, item);
    if (!group.note && item.note?.trim()) group.note = item.note.trim();
    if (parts.current > group.latestCurrent) {
      group.latestCurrent = parts.current;
      group.latestItem = item;
    }
  });

  const groupNote = new Map<string, string | undefined>();
  groups.forEach(group => group.items.forEach(item => groupNote.set(item.id, group.note)));

  const actual: FutureInstallment[] = withInstallment
    .filter(item => monthOf(item) >= todayMonth)
    .map(item => ({
      date: item.date,
      month: monthOf(item),
      description: item.description,
      categoryId: item.categoryId,
      amount: item.amount,
      type: item.installment || 'Parcela',
      note: item.note?.trim() || groupNote.get(item.id),
    }));

  const projected: FutureInstallment[] = [];
  groups.forEach(group => {
    for (let next = group.latestCurrent + 1; next <= group.total; next += 1) {
      const month = shiftMonth(monthOf(group.latestItem), next - group.latestCurrent);
      if (month < todayMonth) continue;
      projected.push({
        date: group.latestItem.date,
        month,
        description: group.latestItem.description,
        categoryId: group.latestItem.categoryId,
        amount: group.latestItem.amount,
        type: `${next}/${group.total}`,
        note: group.note,
        projected: true,
      });
    }
  });

  return [...actual, ...projected].sort((a, b) => a.month.localeCompare(b.month) || a.date.localeCompare(b.date));
};

// ─── Extrato da fatura (como o banco mostra) ─────────────────────────────────

export type InvoiceStatus = 'paga' | 'parcial' | 'aberta' | 'sem_dados';

export interface InvoiceStatement {
  month: string;
  /** Compras da fatura. */
  gross: number;
  /** Estornos e créditos de compra. */
  refunds: number;
  /** Valor da fatura: compras − estornos. */
  total: number;
  /** Pagamentos feitos durante o ciclo além do que quitava a fatura anterior. */
  advance: number;
  /** Quanto ainda era preciso pagar no vencimento: total − antecipado. */
  toPay: number;
  /** Quanto do "a pagar" foi pago (pelos pagamentos do ciclo seguinte). */
  paidAmount: number;
  paidOn?: string;
  status: InvoiceStatus;
  /** Status detectado pelos pagamentos do extrato (false = marcado à mão ou sem dados). */
  auto: boolean;
  payments: Array<{ date: string; amount: number }>;
  lastPurchase?: string;
}

/** Data de vencimento da fatura do mês (dia limitado ao tamanho do mês). */
export const invoiceDueDate = (month: string, dueDay: number) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return `${month}-${String(Math.min(Math.max(1, dueDay), lastDay)).padStart(2, '0')}`;
};

/**
 * Reconstrói o extrato de cada fatura a partir das linhas do CSV, inclusive
 * pagamentos e estornos (valores negativos), como o banco mostra — por exemplo,
 * R$ 1.530,66 a pagar numa fatura de R$ 3.120,09 com R$ 1.589,43 pagos antes.
 *
 * Os pagamentos lançados no ciclo de uma fatura são classificados pela data:
 * - até o vencimento da fatura anterior: quitam a anterior (sobra é ignorada);
 * - depois dele: primeiro completam o que faltou da anterior (pagamento atrasado),
 *   o resto é pagamento antecipado da fatura atual.
 * Cada mês é calculado só com os vizinhos: uma diferença antiga (ex.: estorno que o
 * banco aplicou de outro jeito) não se propaga para os meses seguintes.
 */
export const getInvoiceStatements = (transactions: Transaction[], paidInvoiceMonths: string[] = [], dueDay = 7): InvoiceStatement[] => {
  const canonical = canonicalTransactions(transactions).filter(item => item.source !== 'projection');
  const byMonth = new Map<string, Transaction[]>();
  canonical.forEach(item => {
    const month = monthOf(item);
    byMonth.set(month, [...(byMonth.get(month) || []), item]);
  });

  const statements: InvoiceStatement[] = [];
  Array.from(byMonth.keys()).sort().forEach(month => {
    const rows = byMonth.get(month) || [];
    const expenses = rows.filter(item => item.type === 'expense');
    if (!expenses.length) return;
    const gross = expenses.reduce((sum, item) => sum + item.amount, 0);
    const refunds = rows.filter(isRefund).reduce((sum, item) => sum + item.amount, 0);
    const payments = rows.filter(isPayment).map(item => ({ date: item.date, amount: item.amount })).sort((a, b) => a.date.localeCompare(b.date));

    const previousDue = invoiceDueDate(shiftMonth(month, -1), dueDay);
    const onTime = payments.filter(item => item.date <= previousDue).reduce((sum, item) => sum + item.amount, 0);
    const late = payments.filter(item => item.date > previousDue);
    const lateTotal = late.reduce((sum, item) => sum + item.amount, 0);

    const previous = statements.at(-1);
    const chained = previous && previous.month === shiftMonth(month, -1) ? previous : undefined;
    let advance = 0;
    if (chained) {
      const stillOwed = Math.max(0, chained.toPay - onTime);
      const lateToPrevious = Math.min(lateTotal, stillOwed);
      chained.paidAmount = onTime + lateToPrevious;
      const settledBy = [...payments.filter(item => item.date <= previousDue), ...(lateToPrevious > 0 ? late : [])].at(-1);
      if (settledBy) chained.paidOn = settledBy.date;
      // Arredonda para centavos: somas de ponto flutuante deixavam "R$ 0,00" de antecipado.
      advance = Math.round((lateTotal - lateToPrevious) * 100) / 100;
    }

    const total = Math.max(0, gross - refunds);
    const firstInstallments = expenses.filter(item => !installmentParts(item.installment) || installmentParts(item.installment)!.current === 1);
    statements.push({
      month, gross, refunds, total, advance,
      toPay: Math.max(0, total - advance),
      paidAmount: 0,
      status: 'aberta',
      auto: false,
      payments,
      lastPurchase: firstInstallments.map(item => item.date).sort().at(-1),
    });
  });

  statements.forEach((statement, index) => {
    const next = statements[index + 1];
    const hasNextCycle = next && next.month === shiftMonth(statement.month, 1);
    if (statement.toPay <= 0.01) {
      statement.status = 'paga';
      statement.auto = true;
    } else if (hasNextCycle && next.payments.length) {
      statement.auto = true;
      // Tolerância de R$ 1 para centavos de IOF/arredondamento lançados depois.
      statement.status = statement.paidAmount >= statement.toPay - 1 ? 'paga' : statement.paidAmount > 0 ? 'parcial' : 'aberta';
    } else if (index < statements.length - 1) {
      statement.status = 'sem_dados';
    }
    if (statement.status !== 'paga' && paidInvoiceMonths.includes(statement.month)) {
      statement.status = 'paga';
      statement.auto = false;
    }
  });
  return statements;
};

export const getInvoiceStatement = (transactions: Transaction[], month: string, paidInvoiceMonths: string[] = [], dueDay = 7) =>
  getInvoiceStatements(transactions, paidInvoiceMonths, dueDay).find(item => item.month === month);

export const getPossibleDuplicates = (transactions: Transaction[]) => {
  const groups = new Map<string, Transaction[]>();
  expenseTransactions(transactions).forEach(item => {
    const key = `${monthOf(item)}|${item.date}|${normalizeMerchant(item.description)}|${item.amount.toFixed(2)}|${item.installment || ''}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return Array.from(groups.values()).filter(group => group.length > 1);
};

export const getDebtBalance = (debt: Debt, transactions: Transaction[]) => {
  const linkedPaid = transactions
    .filter(item => item.debtId === debt.id)
    .reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, debt.totalAmount - debt.paidAmount - linkedPaid);
};

/** Quanto as dívidas próprias ativas pedem por mês (parcela limitada ao saldo). */
export const getMonthlyDebtCommitment = (debts: Debt[], transactions: Transaction[]) => {
  return debts
    .filter(debt => debt.type === 'a_pagar')
    .reduce((sum, debt) => {
      const balance = getDebtBalance(debt, transactions);
      return balance > 0 ? sum + Math.min(debt.monthlyPayment || 0, balance) : sum;
    }, 0);
};

// Se a parcela não cobre nem os juros do saldo atual, o saldo nunca diminui:
// a folga (parcela - juros) só piora mês a mês, então basta checar o mês 0.
const neverPaysOff = (balance: number, payment: number, rate: number) => balance > 0 && payment <= balance * rate;

export const getDebtPayoffRows = (debt: Debt, extraPayment: number, transactions: Transaction[] = []) => {
  const rows: { month: number; base: number; extra: number }[] = [];
  // Usa o saldo real descontando pagamentos já vinculados via fatura
  const realBalance = getDebtBalance(debt, transactions);
  let baseBalance = realBalance;
  let extraBalance = realBalance;
  const rate = debt.interestRate / 100;
  const baseNeverPaysOff = neverPaysOff(realBalance, debt.monthlyPayment, rate);
  const extraNeverPaysOff = neverPaysOff(realBalance, debt.monthlyPayment + extraPayment, rate);
  for (let month = 0; month <= 36 && (baseBalance > 0 || extraBalance > 0); month += 1) {
    rows.push({ month, base: Math.max(0, baseBalance), extra: Math.max(0, extraBalance) });
    baseBalance = Math.max(0, baseBalance * (1 + rate) - debt.monthlyPayment);
    extraBalance = Math.max(0, extraBalance * (1 + rate) - debt.monthlyPayment - extraPayment);
  }
  return { rows, baseNeverPaysOff, extraNeverPaysOff };
};

export type PayoffStrategy = 'avalanche' | 'bola_de_neve';

export interface PayoffPlan {
  months: number | null;
  totalInterest: number;
  totalPaid: number;
  order: Array<{ id: string; name: string; payoffMonth: number | null }>;
  timeline: Array<{ month: number; balance: number }>;
}

/**
 * Simula quitar todas as dívidas próprias juntas. Cada mês aplica juros, paga as
 * parcelas e direciona o aporte extra — mais as parcelas liberadas de dívidas já
 * quitadas — para a dívida-alvo da estratégia:
 * - avalanche: maior juros primeiro (paga menos juros no total)
 * - bola de neve: menor saldo primeiro (vitórias rápidas)
 */
export const simulatePayoffPlan = (debts: Debt[], transactions: Transaction[], extraPayment: number, strategy: PayoffStrategy, horizon = 360): PayoffPlan => {
  const active = debts
    .filter(debt => debt.type === 'a_pagar')
    .map(debt => ({ id: debt.id, name: debt.counterparty, balance: getDebtBalance(debt, transactions), rate: (debt.interestRate || 0) / 100, payment: debt.monthlyPayment || 0 }))
    .filter(debt => debt.balance > 0);

  const budget = active.reduce((sum, debt) => sum + debt.payment, 0) + Math.max(0, extraPayment);
  const payoffMonth = new Map<string, number>();
  const timeline = [{ month: 0, balance: active.reduce((sum, debt) => sum + debt.balance, 0) }];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= horizon && active.some(debt => debt.balance > 0.005); month += 1) {
    active.forEach(debt => {
      if (debt.balance <= 0) return;
      const interest = debt.balance * debt.rate;
      debt.balance += interest;
      totalInterest += interest;
    });

    let available = budget;
    active.forEach(debt => {
      if (debt.balance <= 0) return;
      const pay = Math.min(debt.payment, debt.balance, available);
      debt.balance -= pay;
      available -= pay;
      totalPaid += pay;
    });

    const targets = active
      .filter(debt => debt.balance > 0.005)
      .sort((a, b) => strategy === 'avalanche' ? b.rate - a.rate || a.balance - b.balance : a.balance - b.balance || b.rate - a.rate);
    for (const debt of targets) {
      if (available <= 0) break;
      const pay = Math.min(debt.balance, available);
      debt.balance -= pay;
      available -= pay;
      totalPaid += pay;
    }

    active.forEach(debt => {
      if (debt.balance <= 0.005 && !payoffMonth.has(debt.id)) {
        debt.balance = 0;
        payoffMonth.set(debt.id, month);
      }
    });
    timeline.push({ month, balance: active.reduce((sum, debt) => sum + debt.balance, 0) });
  }

  const done = active.every(debt => payoffMonth.has(debt.id));
  return {
    months: done ? Math.max(0, ...Array.from(payoffMonth.values())) : null,
    totalInterest,
    totalPaid,
    order: active
      .map(debt => ({ id: debt.id, name: debt.name, payoffMonth: payoffMonth.get(debt.id) ?? null }))
      .sort((a, b) => (a.payoffMonth ?? Infinity) - (b.payoffMonth ?? Infinity)),
    timeline,
  };
};

export interface OwedItem {
  kind: 'receivable' | 'debt';
  id: string;
  description: string;
  remaining: number;
  date: string;
  origin: string;
}

export interface PersonOwing {
  memberId?: string;
  name: string;
  total: number;
  items: OwedItem[];
}

const cashSource = 'emprestimo_pix';

/**
 * Fonte única de "quem me deve", unindo as duas representações que o sistema tem:
 * `Receivable` (cobrança operacional, ligada a memberId) e `Debt` do tipo a_receber
 * (registro manual, ligado a um nome livre em counterparty).
 *
 * A deduplicação é essencial: parte dos `Debt` a_receber com origem cartao/emprestimo
 * são agregados históricos dos próprios recebíveis (ex.: nota "2 partes de divisoes em
 * aberto"). Sem descartá-los, o mesmo dinheiro seria contado duas vezes.
 */
export const getPeopleWhoOweMe = (
  receivables: Receivable[],
  debts: Debt[],
  members: Member[],
  transactions: Transaction[],
): PersonOwing[] => {
  const byKey = new Map<string, PersonOwing & { cardTotal: number; cashTotal: number }>();

  const entryFor = (key: string, name: string, memberId?: string) => {
    const current = byKey.get(key) || { memberId, name, total: 0, items: [], cardTotal: 0, cashTotal: 0 };
    if (!current.memberId && memberId) current.memberId = memberId;
    byKey.set(key, current);
    return current;
  };

  receivables
    .filter(item => item.status !== 'quitado')
    .forEach(item => {
      const member = members.find(person => person.id === item.memberId);
      if (!member?.name || member.isOwner) return;
      const remaining = Math.max(0, item.amount - item.paidAmount);
      if (remaining <= 0) return;

      const entry = entryFor(normalizeText(member.name), member.name, member.id);
      if (item.source === cashSource) entry.cashTotal += remaining;
      else entry.cardTotal += remaining;
      entry.total += remaining;
      entry.items.push({
        kind: 'receivable',
        id: item.id,
        description: item.description,
        remaining,
        date: item.date,
        origin: item.source,
      });
    });

  debts
    .filter(debt => debt.type === 'a_receber')
    .forEach(debt => {
      const remaining = getDebtBalance(debt, transactions);
      if (remaining <= 0) return;

      const key = normalizeText(debt.counterparty);
      const member = members.find(person => normalizeText(person.name) === key);
      if (member?.isOwner) return;

      const entry = entryFor(key, member?.name || debt.counterparty, member?.id);
      entry.total += remaining;
      entry.items.push({
        kind: 'debt',
        id: debt.id,
        description: debt.note || `Registro manual (${debt.origin})`,
        remaining,
        date: debt.startDate,
        origin: debt.origin,
      });
    });

  return Array.from(byKey.values())
    .filter(entry => entry.total > 0)
    .map(entry => ({
      memberId: entry.memberId,
      name: entry.name,
      total: entry.total,
      items: [...entry.items].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.total - a.total);
};

/** Contrapartida de `getPeopleWhoOweMe`: o que o titular deve, por pessoa/entidade. */
export const getPeopleIOwe = (debts: Debt[], transactions: Transaction[]) => {
  const byKey = new Map<string, { name: string; total: number; debts: Debt[] }>();
  debts
    .filter(debt => debt.type === 'a_pagar')
    .forEach(debt => {
      const remaining = getDebtBalance(debt, transactions);
      if (remaining <= 0) return;
      const key = normalizeText(debt.counterparty);
      const current = byKey.get(key) || { name: debt.counterparty, total: 0, debts: [] };
      current.total += remaining;
      current.debts.push(debt);
      byKey.set(key, current);
    });
  return Array.from(byKey.values()).sort((a, b) => b.total - a.total);
};

/** Dias desde a cobrança mais antiga em aberto da pessoa. */
export const oldestPendingDays = (person: PersonOwing) => {
  const oldest = person.items[0]?.date;
  return oldest ? Math.max(0, daysBetween(oldest, todayISO())) : 0;
};

export interface PersonCategoryBreakdown {
  memberId: string;
  memberName: string;
  categories: { categoryId: string; name: string; color: string; total: number }[];
  total: number;
}

// Cruza divisões de cartão (Receivable de origem "divisao") com a transação original
// para descobrir em quais categorias os gastos divididos de cada pessoa se concentram.
// Empréstimo/Pix fica de fora: não tem transação de cartão associada, logo não tem categoria.
export const getPersonCategoryBreakdown = (
  receivables: Receivable[],
  transactions: Transaction[],
  categories: Category[],
  members: Member[],
): PersonCategoryBreakdown[] => {
  const transactionById = new Map(transactions.map(item => [item.id, item]));
  const groups = new Map<string, Map<string, number>>();
  receivables
    .filter(item => item.source === 'divisao' && item.transactionId)
    .forEach(item => {
      const transaction = transactionById.get(item.transactionId as string);
      if (!transaction) return;
      const byCategory = groups.get(item.memberId) || new Map<string, number>();
      byCategory.set(transaction.categoryId, (byCategory.get(transaction.categoryId) || 0) + item.amount);
      groups.set(item.memberId, byCategory);
    });

  return Array.from(groups.entries()).map(([memberId, byCategory]) => {
    const member = members.find(item => item.id === memberId);
    const categoryRows = Array.from(byCategory.entries())
      .map(([categoryId, total]) => {
        const category = categories.find(item => item.id === categoryId);
        return { categoryId, name: category?.name || 'Outros', color: category?.color || '#94a3b8', total };
      })
      .sort((a, b) => b.total - a.total);
    return {
      memberId,
      memberName: member?.name || 'Desconhecido',
      categories: categoryRows,
      total: categoryRows.reduce((sum, category) => sum + category.total, 0),
    };
  }).filter(row => row.total > 0).sort((a, b) => b.total - a.total);
};

export interface BudgetStatus {
  categoryId: string;
  name: string;
  color: string;
  limit: number;
  spent: number;
  remaining: number;
  progress: number;
  /** Média dos últimos 3 meses anteriores, para sugerir/avaliar o teto. */
  average: number;
  level: 'ok' | 'alerta' | 'estourado';
}

export const getBudgetStatus = (budgets: Budget[], transactions: Transaction[], categories: Category[], month: string): BudgetStatus[] => {
  const totals = getCategoryTotals(filterByMonth(transactions, month), categories);
  const previousMonths = month ? [1, 2, 3].map(offset => shiftMonth(month, -offset)) : [];
  return budgets
    .map(budget => {
      const category = categories.find(item => item.id === budget.categoryId);
      const spent = totals.find(item => item.id === budget.categoryId)?.total || 0;
      const history = previousMonths.map(previous => getCategoryTotals(filterByMonth(transactions, previous), categories).find(item => item.id === budget.categoryId)?.total || 0);
      const progress = budget.monthlyLimit ? (spent / budget.monthlyLimit) * 100 : 0;
      return {
        categoryId: budget.categoryId,
        name: category?.name || budget.categoryId,
        color: category?.color || '#64748b',
        limit: budget.monthlyLimit,
        spent,
        remaining: budget.monthlyLimit - spent,
        progress,
        average: history.length ? history.reduce((sum, value) => sum + value, 0) / history.length : 0,
        level: (progress >= 100 ? 'estourado' : progress >= 80 ? 'alerta' : 'ok') as BudgetStatus['level'],
      };
    })
    .sort((a, b) => b.progress - a.progress);
};

export const getInsights = (transactions: Transaction[], categories: Category[], summaries: MonthlySummary[]) => {
  const expenses = expenseTransactions(transactions);
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const averageTicket = expenses.length ? total / expenses.length : 0;
  const weekdayAverages = getWeekdayAverages(transactions);
  const expensiveWeekday = weekdayAverages.find(item => item.average > averageTicket * 2);
  // Filtra apenas meses com despesa real para evitar média distorcida por meses sem dados
  const realSummaries = summaries.filter(item => item.expense > 0 && item.month <= shiftMonth(currentMonthISO(), 1));
  const averageMonthly = realSummaries.length ? realSummaries.reduce((sum, item) => sum + item.expense, 0) / realSummaries.length : 0;
  const outlierMonth = [...realSummaries].sort((a, b) => b.expense - a.expense).find(item => averageMonthly && item.expense > averageMonthly * 1.3);
  const categoryTotals = getCategoryTotals(transactions, categories);
  const highestTicket = [...categoryTotals].sort((a, b) => b.averageTicket - a.averageTicket)[0];

  return [
    outlierMonth ? `A fatura de ${formatMonth(outlierMonth.month)} (${formatBRL(outlierMonth.expense)}) ficou ${(((outlierMonth.expense / averageMonthly) - 1) * 100).toFixed(0)}% acima da média.` : '',
    expensiveWeekday ? `${expensiveWeekday.label} tem ticket médio acima de 2x a média geral.` : '',
    highestTicket ? `${highestTicket.name} tem o maior ticket médio: ${formatBRL(highestTicket.averageTicket)}.` : '',
    categoryTotals[0] ? `${categoryTotals[0].name} concentra ${categoryTotals[0].percent.toFixed(1)}% dos gastos.` : '',
  ].filter(Boolean);
};

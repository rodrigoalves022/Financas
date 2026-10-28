import type { Category, CategoryTotal, FixedExpense } from '../types';
import { shiftMonth } from './formatters';

// Contas fixas fora do cartão. Meses de calendário: o mês em que o dinheiro sai, que é
// comparado com a receita do mesmo mês e somado aos compromissos (fatura + dívidas).

const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
export const monthsBetween = (from: string, to: string) => monthIndex(to) - monthIndex(from);

/** Último mês em que a conta existe (parcela final ou encerramento); vazio = sem fim. */
export const fixedExpenseLastMonth = (expense: FixedExpense) => {
  const lastInstallment = expense.kind === 'parcelada' && expense.installments ? shiftMonth(expense.startMonth, expense.installments - 1) : '';
  if (lastInstallment && expense.endMonth) return lastInstallment < expense.endMonth ? lastInstallment : expense.endMonth;
  return lastInstallment || expense.endMonth || '';
};

export interface FixedExpenseMonth {
  expense: FixedExpense;
  month: string;
  amount: number;
  /** Conta variável sem o valor do mês lançado: `amount` é só estimativa. */
  pending: boolean;
  installment?: number;
  paid: boolean;
}

// Variável sem valor no mês: repete o último valor lançado antes dele, senão a estimativa cadastrada.
const estimateFor = (expense: FixedExpense, month: string) => {
  const previous = Object.keys(expense.values).filter(key => key < month).sort().at(-1);
  return previous ? expense.values[previous] : expense.amount || 0;
};

/** A conta num mês, ou null se ela não existe nele (antes do início, depois do fim ou antes de ser acompanhada). */
export const fixedExpenseInMonth = (expense: FixedExpense, month: string): FixedExpenseMonth | null => {
  if (!month || month < expense.startMonth || month < expense.trackedFrom) return null;
  const last = fixedExpenseLastMonth(expense);
  if (last && month > last) return null;
  const launched = expense.values[month];
  return {
    expense,
    month,
    amount: launched ?? (expense.kind === 'variavel' ? estimateFor(expense, month) : expense.amount),
    pending: expense.kind === 'variavel' && launched === undefined,
    installment: expense.kind === 'parcelada' ? monthsBetween(expense.startMonth, month) + 1 : undefined,
    paid: expense.paidMonths.includes(month),
  };
};

export const getFixedExpensesForMonth = (expenses: FixedExpense[], month: string) =>
  expenses.map(expense => fixedExpenseInMonth(expense, month)).filter((row): row is FixedExpenseMonth => Boolean(row));

/** Quanto as contas fixas pedem no mês (pagas ou não; variáveis sem lançamento entram pela estimativa). */
export const getFixedMonthlyTotal = (expenses: FixedExpense[], month: string) =>
  getFixedExpensesForMonth(expenses, month).reduce((sum, row) => sum + row.amount, 0);

/** Parcelada: quantas já foram pagas (as anteriores ao acompanhamento contam como pagas) e quanto falta. */
export const installmentProgress = (expense: FixedExpense) => {
  if (expense.kind !== 'parcelada' || !expense.installments) return null;
  let paid = 0;
  for (let index = 0; index < expense.installments; index += 1) {
    const month = shiftMonth(expense.startMonth, index);
    if (month < expense.trackedFrom || expense.paidMonths.includes(month)) paid += 1;
  }
  const remaining = expense.installments - paid;
  return { paid, remaining, remainingTotal: remaining * expense.amount, lastMonth: shiftMonth(expense.startMonth, expense.installments - 1) };
};

// ─── Gasto total: cartão + contas fixas ──────────────────────────────────────

/** Conta sem categoria entra nas análises sob este nome. */
export const FIXED_CATEGORY = { id: 'contas-fixas', name: 'Contas fixas', color: '#64748b' };

export interface SpendingCategoryTotal extends CategoryTotal {
  cardTotal: number;
  fixedTotal: number;
}

/** Meses com contas fixas até `lastMonth` — para somar "Todo o período". */
export const fixedExpenseMonths = (expenses: FixedExpense[], lastMonth: string) => {
  const first = expenses.map(expense => expense.startMonth > expense.trackedFrom ? expense.startMonth : expense.trackedFrom).sort()[0];
  const months: string[] = [];
  for (let month = first; month && month <= lastMonth; month = shiftMonth(month, 1)) months.push(month);
  return months;
};

/** Categorias do cartão somadas às contas fixas dos meses: cada conta entra na categoria dela. */
export const mergeFixedIntoCategories = (cardTotals: CategoryTotal[], expenses: FixedExpense[], months: string[], categories: Category[]): SpendingCategoryTotal[] => {
  const rows = new Map<string, SpendingCategoryTotal>(cardTotals.map(item => [item.id, { ...item, cardTotal: item.total, fixedTotal: 0 }]));
  months.forEach(month => getFixedExpensesForMonth(expenses, month).forEach(row => {
    const category = categories.find(item => item.id === row.expense.categoryId) || FIXED_CATEGORY;
    const current = rows.get(category.id)
      || { id: category.id, name: category.name, color: category.color, total: 0, percent: 0, count: 0, averageTicket: 0, cardTotal: 0, fixedTotal: 0 };
    rows.set(category.id, { ...current, total: current.total + row.amount, fixedTotal: current.fixedTotal + row.amount });
  }));
  const list = Array.from(rows.values()).filter(item => item.total > 0).sort((a, b) => b.total - a.total);
  const sum = list.reduce((total, item) => total + item.total, 0);
  return list.map(item => ({ ...item, percent: sum ? (item.total / sum) * 100 : 0 }));
};

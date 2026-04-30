import type { Alias, Category, CategoryTotal, Debt, MerchantTotal, MonthlyIncome, MonthlySummary, Transaction } from '../types';
import { WEEKDAY_LABELS } from './constants';
import { normalizeMerchant } from './formatters';

const monthOf = (date: string) => date.substring(0, 7);

export const filterByMonth = (transactions: Transaction[], selectedMonth: string) => {
  return selectedMonth ? transactions.filter(item => monthOf(item.date) === selectedMonth) : transactions;
};

export const expenseTransactions = (transactions: Transaction[]) => {
  return transactions.filter(item => item.type === 'expense');
};

export const getMonthlySummaries = (transactions: Transaction[], incomes: MonthlyIncome[]): MonthlySummary[] => {
  const months = new Set<string>();
  transactions.forEach(item => months.add(monthOf(item.date)));
  incomes.forEach(item => months.add(item.month));

  return Array.from(months).sort().map(month => {
    const expense = transactions
      .filter(item => item.type === 'expense' && monthOf(item.date) === month)
      .reduce((sum, item) => sum + item.amount, 0);
    const income = incomes
      .filter(item => item.month === month)
      .reduce((sum, item) => sum + item.amount, 0);
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

export const applyAlias = (description: string, aliases: Alias[]) => {
  const found = aliases.find(item => normalizeMerchant(item.original) === normalizeMerchant(description));
  return found?.alias || normalizeMerchant(description);
};

export const getMerchantTotals = (transactions: Transaction[], aliases: Alias[] = []): MerchantTotal[] => {
  const groups = new Map<string, MerchantTotal>();
  expenseTransactions(transactions).forEach(item => {
    const merchant = aliases.length ? applyAlias(item.description, aliases) : item.normalizedMerchant || normalizeMerchant(item.description);
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
  return WEEKDAY_LABELS.map((label, index) => {
    const rows = expenseTransactions(transactions).filter(item => new Date(`${item.date}T12:00:00`).getDay() === index);
    const total = rows.reduce((sum, item) => sum + item.amount, 0);
    return { label, total, average: rows.length ? total / rows.length : 0, count: rows.length };
  });
};

export const getFutureInstallments = (transactions: Transaction[]) => {
  const todayMonth = new Date().toISOString().substring(0, 7);
  return expenseTransactions(transactions)
    .filter(item => monthOf(item.date) >= todayMonth && item.installment)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(item => ({
      date: item.date,
      description: item.description,
      categoryId: item.categoryId,
      amount: item.amount,
      type: item.installment || 'Parcela',
    }));
};

export const getPossibleDuplicates = (transactions: Transaction[]) => {
  const groups = new Map<string, Transaction[]>();
  transactions.forEach(item => {
    const key = `${item.date}|${normalizeMerchant(item.description)}|${item.amount.toFixed(2)}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return Array.from(groups.values()).filter(group => group.length > 1).flat();
};

export const getDebtBalance = (debt: Debt, transactions: Transaction[]) => {
  const linkedPaid = transactions
    .filter(item => item.debtId === debt.id)
    .reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, debt.totalAmount - debt.paidAmount - linkedPaid);
};

export const getDebtPayoffRows = (debt: Debt, extraPayment: number) => {
  const rows: { month: number; base: number; extra: number }[] = [];
  let baseBalance = debt.totalAmount - debt.paidAmount;
  let extraBalance = baseBalance;
  const rate = debt.interestRate / 100;
  for (let month = 0; month <= 36 && (baseBalance > 0 || extraBalance > 0); month += 1) {
    rows.push({ month, base: Math.max(0, baseBalance), extra: Math.max(0, extraBalance) });
    baseBalance = Math.max(0, baseBalance * (1 + rate) - debt.monthlyPayment);
    extraBalance = Math.max(0, extraBalance * (1 + rate) - debt.monthlyPayment - extraPayment);
  }
  return rows;
};

export const getInsights = (transactions: Transaction[], categories: Category[], summaries: MonthlySummary[]) => {
  const expenses = expenseTransactions(transactions);
  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const averageTicket = expenses.length ? total / expenses.length : 0;
  const weekdayAverages = getWeekdayAverages(transactions);
  const expensiveWeekday = weekdayAverages.find(item => item.average > averageTicket * 2);
  const averageMonthly = summaries.length ? summaries.reduce((sum, item) => sum + item.expense, 0) / summaries.length : 0;
  const outlierMonth = summaries.find(item => averageMonthly && item.expense > averageMonthly * 1.3);
  const categoryTotals = getCategoryTotals(transactions, categories);
  const highestTicket = [...categoryTotals].sort((a, b) => b.averageTicket - a.averageTicket)[0];

  return [
    outlierMonth ? `Mes ${outlierMonth.month} gastou mais de 30% acima da media.` : '',
    expensiveWeekday ? `${expensiveWeekday.label} tem ticket medio acima de 2x a media geral.` : '',
    highestTicket ? `${highestTicket.name} tem o maior ticket medio: ${highestTicket.averageTicket.toFixed(2)}.` : '',
    categoryTotals[0] ? `${categoryTotals[0].name} concentra ${categoryTotals[0].percent.toFixed(1)}% dos gastos.` : '',
  ].filter(Boolean);
};

import type { Alias, Category, CategoryTotal, Debt, MerchantTotal, MonthlyIncome, MonthlySummary, Transaction } from '../types';
import { WEEKDAY_LABELS } from './constants';
import { normalizeMerchant } from './formatters';

export const getDueMonth = (transaction: Transaction) => {
  const match = transaction.sourceFile?.match(/(20\d{2})[-_](0[1-9]|1[0-2])/);
  if (transaction.source === 'projection') return transaction.date.substring(0, 7);
  if (match) return `${match[1]}-${match[2]}`;
  return transaction.date.substring(0, 7);
};

export const getInvoiceMonth = (transaction: Transaction) => {
  return getDueMonth(transaction);
};

export const getAccountingMonth = (transaction: Transaction) => {
  return getDueMonth(transaction);
};

const monthOf = getAccountingMonth;

export const filterByMonth = (transactions: Transaction[], selectedMonth: string) => {
  return selectedMonth ? transactions.filter(item => monthOf(item) === selectedMonth) : transactions;
};

export const expenseTransactions = (transactions: Transaction[]) => {
  return transactions.filter(item => item.type === 'expense');
};

export const getMonthlySummaries = (transactions: Transaction[], incomes: MonthlyIncome[]): MonthlySummary[] => {
  const months = new Set<string>();
  transactions.forEach(item => months.add(monthOf(item)));
  incomes.forEach(item => months.add(item.month));

  return Array.from(months).sort().map(month => {
    const expense = transactions
      .filter(item => item.type === 'expense' && monthOf(item) === month)
      .reduce((sum, item) => sum + item.amount, 0);
    const registeredIncome = incomes
      .filter(item => item.month === month)
      .reduce((sum, item) => sum + item.amount, 0);
    const income = registeredIncome;
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

export const getDailyHeatmap = (transactions: Transaction[], selectedMonth: string) => {
  const scoped = expenseTransactions(filterByMonth(transactions, selectedMonth));
  const groups = new Map<number, number>();
  scoped.forEach(item => {
    const day = Number(item.date.substring(8, 10));
    groups.set(day, (groups.get(day) || 0) + item.amount);
  });
  const max = Math.max(...Array.from(groups.values()), 1);
  // Use o maior entre os dias do mês da fatura e os dias reais das transações
  // para não perder compras feitas nos dias 29-31 do mês anterior
  const daysInMonth = selectedMonth
    ? new Date(Number(selectedMonth.substring(0, 4)), Number(selectedMonth.substring(5, 7)), 0).getDate()
    : 31;
  const maxRealDay = groups.size > 0 ? Math.max(...Array.from(groups.keys())) : 0;
  const totalDays = Math.max(daysInMonth, maxRealDay);
  return Array.from({ length: totalDays }, (_, index) => {
    const day = index + 1;
    const total = groups.get(day) || 0;
    return { day, total, intensity: total / max };
  });
};

export const getRecurringMerchants = (transactions: Transaction[], aliases: Alias[] = []) => {
  const groups = new Map<string, { merchant: string; months: Set<string>; amounts: number[]; total: number }>();
  expenseTransactions(transactions).forEach(item => {
    const merchant = aliases.length ? applyAlias(item.description, aliases) : item.normalizedMerchant || normalizeMerchant(item.description);
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
    if (item.amount < average * 2.5 || item.amount < average + 150) return [];
    return [{
      ...item,
      categoryName: categories.find(category => category.id === item.categoryId)?.name || 'Outros',
      categoryAverage: average,
      multiple: item.amount / Math.max(average, 1),
    }];
  }).sort((a, b) => b.multiple - a.multiple);
};

export const getCategoryVolatility = (transactions: Transaction[], categories: Category[]) => {
  const months = Array.from(new Set(transactions.map(item => monthOf(item)))).sort();
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

// getMonthProjection removida: fatura fechada tem valor definitivo;
// projeção linear não faz sentido no modelo de fatura mensal.

// getFinancialHealthScore removida: score financeiro não é objetivo do sistema.

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
    .filter(item => monthOf(item) >= todayMonth && item.installment)
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

export const getDebtPayoffRows = (debt: Debt, extraPayment: number, transactions: Transaction[] = []) => {
  const rows: { month: number; base: number; extra: number }[] = [];
  // Usa o saldo real descontando pagamentos já vinculados via fatura
  const realBalance = getDebtBalance(debt, transactions);
  let baseBalance = realBalance;
  let extraBalance = realBalance;
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
  // Filtra apenas meses com despesa real para evitar média distorcida por meses sem dados
  const realSummaries = summaries.filter(item => item.expense > 0);
  const averageMonthly = realSummaries.length ? realSummaries.reduce((sum, item) => sum + item.expense, 0) / realSummaries.length : 0;
  const outlierMonth = realSummaries.find(item => averageMonthly && item.expense > averageMonthly * 1.3);
  const categoryTotals = getCategoryTotals(transactions, categories);
  const highestTicket = [...categoryTotals].sort((a, b) => b.averageTicket - a.averageTicket)[0];

  return [
    outlierMonth ? `Mes ${outlierMonth.month} gastou mais de 30% acima da media.` : '',
    expensiveWeekday ? `${expensiveWeekday.label} tem ticket médio acima de 2x a média geral.` : '',
    highestTicket ? `${highestTicket.name} tem o maior ticket médio: ${highestTicket.averageTicket.toFixed(2)}.` : '',
    categoryTotals[0] ? `${categoryTotals[0].name} concentra ${categoryTotals[0].percent.toFixed(1)}% dos gastos.` : '',
  ].filter(Boolean);
};

import type { FinanceState } from '../store/actions';
import {
  filterByMonth, getBudgetStatus, getCategoryTotals, getDebtBalance, getFutureInstallments, getInvoiceTotal, getLatestInvoiceMonth, getMerchantTotals,
  getMonthlySummaries, getPeopleWhoOweMe, getRecurringMerchants,
} from './analytics';
import { getFixedExpensesForMonth, getFixedMonthlyTotal, installmentProgress } from './fixedExpenses';
import { formatMonth } from './formatters';

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Resumo que a IA lê para dar dicas e responder perguntas — no app (Análises, Painel) e
 * no bot do Telegram, que recebe o mesmo resumo no snapshot. Só agregados: nenhuma
 * compra individual sai do app, apenas totais por categoria, local e mês.
 */
export const buildFinanceSummary = (state: FinanceState, month?: string) => {
  const { transactions, monthlyIncomes, categories, aliases, budgets, debts, receivables, members, fixedExpenses } = state;
  const focusMonth = month || getLatestInvoiceMonth(transactions);
  const history = getMonthlySummaries(transactions, monthlyIncomes).filter(item => item.expense > 0 && item.month <= focusMonth).slice(-6);
  const totalsByMonth = new Map(history.map(item => [item.month, getCategoryTotals(filterByMonth(transactions, item.month), categories)]));
  const previous = history.slice(0, -1);
  const categoryAverage = (categoryId: string) => {
    if (!previous.length) return 0;
    return previous.reduce((sum, item) => sum + (totalsByMonth.get(item.month)?.find(row => row.id === categoryId)?.total || 0), 0) / previous.length;
  };
  const scoped = filterByMonth(transactions, focusMonth);

  // Parcelas já assumidas nas próximas faturas, por mês.
  const committed = new Map<string, { total: number; parcelas: number }>();
  getFutureInstallments(transactions).filter(item => item.month > focusMonth).forEach(item => {
    const current = committed.get(item.month) || { total: 0, parcelas: 0 };
    committed.set(item.month, { total: current.total + item.amount, parcelas: current.parcelas + 1 });
  });

  return {
    mesAnalisado: formatMonth(focusMonth),
    faturaDoMes: round(getInvoiceTotal(transactions, focusMonth)),
    historicoFaturas: history.map(item => ({ mes: formatMonth(item.month), fatura: round(item.expense), receita: round(item.income) })),
    categoriasDoMes: (totalsByMonth.get(focusMonth) || getCategoryTotals(scoped, categories)).filter(item => item.total > 0).slice(0, 12).map(item => ({
      categoria: item.name, total: round(item.total), compras: item.count, ticketMedio: round(item.averageTicket), mediaMesesAnteriores: round(categoryAverage(item.id)),
    })),
    // Permite responder "quanto gastei com mercado em março?" sem mandar compras.
    categoriasPorMes: history.map(item => ({
      mes: formatMonth(item.month),
      categorias: Object.fromEntries((totalsByMonth.get(item.month) || []).filter(row => row.total > 0).slice(0, 8).map(row => [row.name, round(row.total)])),
    })),
    principaisLocais: getMerchantTotals(scoped, aliases).slice(0, 12).map(item => ({ local: item.merchant, total: round(item.total), compras: item.count })),
    recorrencias: getRecurringMerchants(transactions, aliases).slice(0, 12).map(item => ({ local: item.merchant, meses: item.months, media: round(item.average) })),
    parcelasFuturas: Array.from(committed.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(0, 6)
      .map(([key, value]) => ({ mes: formatMonth(key), comprometido: round(value.total), parcelas: value.parcelas })),
    metas: getBudgetStatus(budgets, transactions, categories, focusMonth).map(item => ({ categoria: item.name, teto: item.limit, gasto: round(item.spent) })),
    dividasProprias: debts.filter(debt => debt.type === 'a_pagar')
      .map(debt => ({ credor: debt.counterparty, saldo: round(getDebtBalance(debt, transactions)), parcela: debt.monthlyPayment, jurosMes: debt.interestRate }))
      .filter(item => item.saldo > 0),
    // Cartão + contas pagas fora dele (boleto/Pix): o quanto o mês custou de verdade.
    gastoTotalDoMes: round(getInvoiceTotal(transactions, focusMonth) + getFixedMonthlyTotal(fixedExpenses || [], focusMonth)),
    // Fora do cartão: financiamento, internet, moradia… (meses de calendário).
    contasFixasDoMes: getFixedExpensesForMonth(fixedExpenses || [], focusMonth).map(row => {
      const progress = installmentProgress(row.expense);
      return {
        conta: row.expense.name,
        valor: round(row.amount),
        tipo: row.expense.kind,
        ...(row.pending ? { valorEstimado: true } : {}),
        ...(progress ? { parcela: `${row.installment}/${row.expense.installments}`, faltaPagar: round(progress.remainingTotal), ultimaParcela: formatMonth(progress.lastMonth) } : {}),
      };
    }),
    aReceberDeTerceiros: round(getPeopleWhoOweMe(receivables, debts, members, transactions).reduce((sum, person) => sum + person.total, 0)),
  };
};

export type FinanceSummary = ReturnType<typeof buildFinanceSummary>;

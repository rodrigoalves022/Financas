import { toolRegistry } from '../registry';
import { getInvoiceMonths, getInvoiceTotal } from '../../utils/analytics';
import { normalizeText } from '../../utils/formatters';
import type { MonthlyIncome } from '../../types';

// ─── Adicionar / excluir ───────────────────────────────────────────────────────

toolRegistry.register<{ income: MonthlyIncome; replaceKey?: string }, void>({
  id: 'adicionar_receita',
  name: 'Adicionar receita',
  description: 'Cadastra uma entrada de receita mensal ou substitui uma existente (replaceKey)',
  category: 'receitas',
  execute: (params, ctx) => {
    if (!params.income.month || !(params.income.amount > 0)) throw new Error('Informe o mês e um valor maior que zero.');
    if (params.replaceKey) ctx.dispatch({ type: 'DELETE_INCOME', payload: params.replaceKey });
    const income = { ...params.income, id: params.income.id || crypto.randomUUID(), source: params.income.source || 'manual' };
    ctx.dispatch({ type: 'ADD_INCOME', payload: income });
  },
});

toolRegistry.register<{ incomeId: string }, void>({
  id: 'excluir_receita',
  name: 'Excluir receita',
  description: 'Remove uma entrada de receita pelo id (ou chave composta das receitas antigas)',
  category: 'receitas',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'DELETE_INCOME', payload: params.incomeId });
  },
});

toolRegistry.register<{ toMonth: string }, { created: number; fromMonth: string }>({
  id: 'replicar_receitas_recorrentes',
  name: 'Replicar receitas recorrentes',
  description: 'Copia para o mês informado as receitas marcadas como recorrentes do mês anterior mais recente que tiver alguma',
  category: 'receitas',
  execute: (params, ctx) => {
    const { monthlyIncomes } = ctx.getState();
    const fromMonth = Array.from(new Set(monthlyIncomes.filter(item => item.isRecurring && item.month < params.toMonth).map(item => item.month))).sort().at(-1);
    if (!fromMonth) return { created: 0, fromMonth: '' };

    const already = new Set(monthlyIncomes
      .filter(item => item.month === params.toMonth)
      .map(item => `${normalizeText(item.description || '')}|${item.amount.toFixed(2)}`));
    const copies = monthlyIncomes
      .filter(item => item.month === fromMonth && item.isRecurring)
      .filter(item => !already.has(`${normalizeText(item.description || '')}|${item.amount.toFixed(2)}`))
      .map<MonthlyIncome>(item => ({ ...item, id: crypto.randomUUID(), month: params.toMonth, source: 'manual', date: undefined }));
    copies.forEach(income => ctx.dispatch({ type: 'ADD_INCOME', payload: income }));
    return { created: copies.length, fromMonth };
  },
});

// ─── Status da fatura ──────────────────────────────────────────────────────────

toolRegistry.register<{ month: string }, void>({
  id: 'quitar_fatura',
  name: 'Quitar fatura',
  description: 'Marca um mês de fatura como quitado',
  category: 'receitas',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'ADD_PAID_INVOICE_MONTH', payload: params.month });
  },
});

toolRegistry.register<{ month: string }, void>({
  id: 'desmarcar_fatura',
  name: 'Reabrir fatura',
  description: 'Remove a marcação de quitada de um mês de fatura',
  category: 'receitas',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'REMOVE_PAID_INVOICE_MONTH', payload: params.month });
  },
});

// Os valores usam a mesma base canônica do Painel (sem projeções em meses importados).
// Antes somavam todas as transações cruas e o "igualar" criava receita maior que a fatura exibida.

toolRegistry.register<{ month: string }, { amount: number }>({
  id: 'igualar_receita_mes',
  name: 'Igualar receita do mês à fatura',
  description: 'Cria uma receita de ajuste igual ao total da fatura do mês e a marca como quitada',
  category: 'receitas',
  execute: (params, ctx) => {
    const { transactions, monthlyIncomes } = ctx.getState();
    const amount = getInvoiceTotal(transactions, params.month);
    if (amount <= 0) return { amount: 0 };

    const adjustmentId = `adjustment-${params.month}`;
    const adjustment: MonthlyIncome = {
      id: adjustmentId,
      month: params.month,
      amount,
      isRecurring: false,
      source: 'adjustment',
      description: 'Receita ajustada para igualar à fatura',
    };
    ctx.dispatch({ type: 'SET_MONTHLY_INCOMES', payload: [...monthlyIncomes.filter(item => item.id !== adjustmentId), adjustment].sort((a, b) => a.month.localeCompare(b.month)) });
    ctx.dispatch({ type: 'ADD_PAID_INVOICE_MONTH', payload: params.month });
    return { amount };
  },
});

const monthsBefore = (transactions: Parameters<typeof getInvoiceMonths>[0], currentMonth: string) =>
  getInvoiceMonths(transactions).filter(month => month < currentMonth);

toolRegistry.register<{ currentMonth: string }, { months: string[] }>({
  id: 'quitar_faturas_antigas',
  name: 'Quitar faturas antigas',
  description: 'Marca como quitados todos os meses de fatura anteriores ao mês atual',
  category: 'receitas',
  execute: (params, ctx) => {
    const { transactions, paidInvoiceMonths } = ctx.getState();
    const months = monthsBefore(transactions, params.currentMonth);
    const newMonths = months.filter(month => !paidInvoiceMonths.includes(month));
    ctx.dispatch({ type: 'SET_PAID_INVOICE_MONTHS', payload: Array.from(new Set([...paidInvoiceMonths, ...months])).sort() });
    return { months: newMonths };
  },
});

toolRegistry.register<{ currentMonth: string }, { months: number }>({
  id: 'igualar_receitas_faturas',
  name: 'Igualar receitas às faturas antigas',
  description: 'Cria receitas de ajuste iguais às faturas dos meses anteriores ao atual e as marca como quitadas',
  category: 'receitas',
  execute: (params, ctx) => {
    const { transactions, monthlyIncomes, paidInvoiceMonths } = ctx.getState();
    // Estritamente anteriores: o mês atual ainda está em aberto e não deve ser "igualado".
    const months = monthsBefore(transactions, params.currentMonth);
    const target = new Set(months);
    const kept = monthlyIncomes.filter(item => !(item.source === 'adjustment' && target.has(item.month)));
    const adjustments = months.map<MonthlyIncome>(month => ({
      id: `adjustment-${month}`,
      month,
      amount: getInvoiceTotal(transactions, month),
      isRecurring: false,
      source: 'adjustment',
      description: 'Receita ajustada para quitar fatura antiga',
    })).filter(item => item.amount > 0);

    ctx.dispatch({ type: 'SET_MONTHLY_INCOMES', payload: [...kept, ...adjustments].sort((a, b) => a.month.localeCompare(b.month)) });
    ctx.dispatch({ type: 'SET_PAID_INVOICE_MONTHS', payload: Array.from(new Set([...paidInvoiceMonths, ...months])).sort() });
    return { months: adjustments.length };
  },
});

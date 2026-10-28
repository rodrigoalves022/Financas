import { toolRegistry } from '../registry';
import type { FixedExpense } from '../../types';

// ─── Cadastrar/Editar Conta Fixa ──────────────────────────────────────────────

toolRegistry.register<{ expense: FixedExpense }, void>({
  id: 'salvar_conta_fixa',
  name: 'Cadastrar/editar conta fixa',
  description: 'Cadastra ou altera uma conta paga fora do cartão (fixa, de valor variável ou parcelada)',
  category: 'contas',
  execute: (params, ctx) => {
    const expense = { ...params.expense, name: params.expense.name.trim() };
    if (!expense.name) throw new Error('Informe o nome da conta.');
    if (!/^\d{4}-\d{2}$/.test(expense.startMonth)) throw new Error('Informe o mês de início.');
    if (expense.kind !== 'variavel' && !(expense.amount > 0)) throw new Error('Informe o valor mensal.');
    if (expense.kind === 'parcelada' && !(expense.installments && expense.installments > 0)) throw new Error('Informe o total de parcelas.');
    ctx.dispatch({ type: 'UPSERT_FIXED_EXPENSE', payload: expense });
  },
});

// ─── Excluir ──────────────────────────────────────────────────────────────────

toolRegistry.register<{ id: string }, void>({
  id: 'excluir_conta_fixa',
  name: 'Excluir conta fixa',
  description: 'Remove a conta fixa e todo o histórico de valores e pagamentos dela',
  category: 'contas',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'DELETE_FIXED_EXPENSE', payload: params.id });
  },
});

// ─── Pagar / reabrir o mês ────────────────────────────────────────────────────

toolRegistry.register<{ id: string; month: string; paid: boolean }, void>({
  id: 'pagar_conta_fixa',
  name: 'Marcar conta fixa como paga',
  description: 'Marca (ou desmarca) uma conta fixa como paga num mês',
  category: 'contas',
  execute: (params, ctx) => {
    const expense = ctx.getState().fixedExpenses.find(item => item.id === params.id);
    if (!expense) throw new Error('Conta não encontrada.');
    const paidMonths = params.paid
      ? Array.from(new Set([...expense.paidMonths, params.month])).sort()
      : expense.paidMonths.filter(month => month !== params.month);
    ctx.dispatch({ type: 'UPDATE_FIXED_EXPENSE', payload: { id: params.id, patch: { paidMonths } } });
  },
});

// ─── Lançar o valor do mês ────────────────────────────────────────────────────

toolRegistry.register<{ id: string; month: string; value: number | null }, void>({
  id: 'lancar_valor_conta_fixa',
  name: 'Lançar valor da conta no mês',
  description: 'Grava o valor de uma conta variável no mês (ou um ajuste pontual de uma fixa); null volta ao valor padrão',
  category: 'contas',
  execute: (params, ctx) => {
    const expense = ctx.getState().fixedExpenses.find(item => item.id === params.id);
    if (!expense) throw new Error('Conta não encontrada.');
    const values = { ...expense.values };
    if (params.value === null) delete values[params.month];
    else {
      if (!(params.value >= 0)) throw new Error('Valor inválido.');
      values[params.month] = params.value;
    }
    ctx.dispatch({ type: 'UPDATE_FIXED_EXPENSE', payload: { id: params.id, patch: { values } } });
  },
});

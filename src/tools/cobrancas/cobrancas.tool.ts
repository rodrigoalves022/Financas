import { toolRegistry } from '../registry';
import { getDebtBalance } from '../../utils/analytics';
import { normalizeText, todayISO } from '../../utils/formatters';
import type { Receivable } from '../../types';

const statusOf = (paidAmount: number, amount: number): Receivable['status'] =>
  paidAmount >= amount - 0.004 ? 'quitado' : paidAmount > 0 ? 'parcial' : 'pendente';

// ─── Dividir compra ────────────────────────────────────────────────────────────

interface DividirCompraParams {
  transactionId: string;
  /** Participantes, podendo incluir o titular — ele conta como parte, mas não gera cobrança. */
  memberIds: string[];
  /** Valor de cada participante quando a divisão não é em partes iguais. */
  customShares?: Record<string, number>;
}

toolRegistry.register<DividirCompraParams, { charged: number }>({
  id: 'dividir_compra',
  name: 'Dividir compra',
  description: 'Divide o valor de uma compra do cartão entre participantes, gerando cobranças para quem não é o titular',
  category: 'cobrancas',
  execute: (params, ctx) => {
    const { transactions, receivables, members } = ctx.getState();
    const transaction = transactions.find(item => item.id === params.transactionId);
    if (!transaction) throw new Error('Transação não encontrada.');

    const ownerIds = new Set(members.filter(member => member.isOwner).map(member => member.id));
    const participants = Array.from(new Set(params.memberIds));
    const chargeable = participants.filter(id => !ownerIds.has(id));
    const shareOf = (memberId: string) => params.customShares
      ? Math.max(0, params.customShares[memberId] || 0)
      : transaction.amount / Math.max(1, participants.length);

    const created: Receivable[] = chargeable
      .filter(memberId => shareOf(memberId) > 0)
      .map(memberId => {
        const existing = receivables.find(item => item.transactionId === transaction.id && item.memberId === memberId && item.source === 'divisao');
        const amount = Math.round(shareOf(memberId) * 100) / 100;
        const paidAmount = Math.min(existing?.paidAmount || 0, amount);
        return {
          id: existing?.id || crypto.randomUUID(),
          memberId,
          source: 'divisao',
          amount,
          paidAmount,
          date: transaction.date,
          description: transaction.description,
          transactionId: transaction.id,
          status: statusOf(paidAmount, amount),
          paidAt: existing?.paidAt,
        };
      });

    ctx.dispatch({ type: 'SET_RECEIVABLES_FOR_TRANSACTION', payload: { transactionId: transaction.id, receivables: created } });
    ctx.dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: transaction.id, patch: { responsibleMemberId: participants.length === 1 && chargeable.length === 1 ? chargeable[0] : undefined } },
    });
    return { charged: created.length };
  },
});

// ─── Recebimentos ──────────────────────────────────────────────────────────────

toolRegistry.register<{ receivableId: string; amount?: number }, { paid: number }>({
  id: 'marcar_cobranca_recebida',
  name: 'Marcar cobrança como recebida',
  description: 'Quita totalmente ou registra um recebimento parcial de uma cobrança',
  category: 'cobrancas',
  execute: (params, ctx) => {
    const item = ctx.getState().receivables.find(row => row.id === params.receivableId);
    if (!item) return { paid: 0 };
    const paidAmount = Math.min(item.amount, params.amount === undefined ? item.amount : item.paidAmount + Math.max(0, params.amount));
    ctx.dispatch({
      type: 'UPDATE_RECEIVABLE',
      payload: { id: params.receivableId, patch: { paidAmount, status: statusOf(paidAmount, item.amount), paidAt: todayISO() } },
    });
    return { paid: paidAmount - item.paidAmount };
  },
});

toolRegistry.register<{ receivableId: string }, void>({
  id: 'reabrir_cobranca',
  name: 'Reabrir cobrança',
  description: 'Desfaz o recebimento de uma cobrança, voltando-a para pendente',
  category: 'cobrancas',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'UPDATE_RECEIVABLE', payload: { id: params.receivableId, patch: { paidAmount: 0, status: 'pendente', paidAt: undefined } } });
  },
});

toolRegistry.register<{ memberId?: string; name: string; amount?: number }, { paid: number }>({
  id: 'receber_da_pessoa',
  name: 'Receber da pessoa',
  description: 'Abate um valor (ou tudo) das pendências de uma pessoa, da mais antiga para a mais nova',
  category: 'cobrancas',
  execute: (params, ctx) => {
    const { receivables, debts, transactions } = ctx.getState();
    const nameKey = normalizeText(params.name);
    type Pending = { kind: 'receivable' | 'debt'; id: string; due: number; date: string };
    const pending: Pending[] = [
      ...receivables
        .filter(item => params.memberId && item.memberId === params.memberId && item.status !== 'quitado' && item.amount - item.paidAmount > 0)
        .map(item => ({ kind: 'receivable' as const, id: item.id, due: item.amount - item.paidAmount, date: item.date })),
      ...debts
        .filter(debt => debt.type === 'a_receber' && normalizeText(debt.counterparty) === nameKey && getDebtBalance(debt, transactions) > 0)
        .map(debt => ({ kind: 'debt' as const, id: debt.id, due: getDebtBalance(debt, transactions), date: debt.startDate })),
    ].sort((a, b) => a.date.localeCompare(b.date));

    let remaining = params.amount === undefined ? Infinity : Math.max(0, params.amount);
    let paid = 0;
    for (const item of pending) {
      if (remaining <= 0) break;
      const applied = Math.min(item.due, remaining);
      remaining -= applied;
      paid += applied;
      if (item.kind === 'receivable') {
        const row = ctx.getState().receivables.find(entry => entry.id === item.id);
        if (!row) continue;
        const paidAmount = row.paidAmount + applied;
        ctx.dispatch({ type: 'UPDATE_RECEIVABLE', payload: { id: row.id, patch: { paidAmount, status: statusOf(paidAmount, row.amount), paidAt: todayISO() } } });
      } else {
        const debt = ctx.getState().debts.find(entry => entry.id === item.id);
        if (debt) ctx.dispatch({ type: 'UPDATE_DEBT', payload: { id: debt.id, patch: { paidAmount: debt.paidAmount + applied } } });
      }
    }
    return { paid };
  },
});

// ─── Edição ────────────────────────────────────────────────────────────────────

toolRegistry.register<{ receivableId: string; amount?: number; description?: string; date?: string }, void>({
  id: 'atualizar_cobranca',
  name: 'Editar cobrança',
  description: 'Ajusta valor, descrição ou data de uma cobrança existente',
  category: 'cobrancas',
  execute: (params, ctx) => {
    const item = ctx.getState().receivables.find(row => row.id === params.receivableId);
    if (!item) return;
    const amount = params.amount !== undefined && params.amount > 0 ? params.amount : item.amount;
    // Reduzir o valor abaixo do que já foi pago deixaria o registro inconsistente,
    // então o pago acompanha o novo teto e o status é recalculado.
    const paidAmount = Math.min(item.paidAmount, amount);
    ctx.dispatch({
      type: 'UPDATE_RECEIVABLE',
      payload: {
        id: params.receivableId,
        patch: {
          amount,
          paidAmount,
          status: statusOf(paidAmount, amount),
          description: params.description?.trim() || item.description,
          date: params.date || item.date,
        },
      },
    });
  },
});

toolRegistry.register<{ receivableId: string }, void>({
  id: 'excluir_cobranca',
  name: 'Excluir cobrança',
  description: 'Remove uma cobrança e recalcula as divisões restantes se necessário',
  category: 'cobrancas',
  execute: (params, ctx) => {
    const { receivables } = ctx.getState();
    const removed = receivables.find(item => item.id === params.receivableId);
    if (!removed) return;
    const remaining = receivables.filter(item => item.id !== params.receivableId);

    if (removed.source !== 'divisao' || !removed.transactionId) {
      ctx.dispatch({ type: 'SET_RECEIVABLES', payload: remaining });
      return;
    }

    // Quem continua na divisão absorve a parte de quem saiu.
    const siblings = remaining.filter(item => item.transactionId === removed.transactionId && item.source === 'divisao' && item.status !== 'quitado');
    if (!siblings.length) {
      ctx.dispatch({ type: 'SET_RECEIVABLES', payload: remaining });
      return;
    }
    const newShare = (siblings.reduce((sum, item) => sum + item.amount, 0) + removed.amount) / siblings.length;
    ctx.dispatch({
      type: 'SET_RECEIVABLES',
      payload: remaining.map(item => siblings.some(sibling => sibling.id === item.id)
        ? { ...item, amount: newShare, status: statusOf(item.paidAmount, newShare) }
        : item),
    });
  },
});

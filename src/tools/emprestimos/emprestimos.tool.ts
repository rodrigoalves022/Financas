import { toolRegistry } from '../registry';
import type { Receivable } from '../../types';

// ─── Registrar Empréstimo ou Pix Fora do Cartão ───────────────────────────────

toolRegistry.register<{ receivable: Receivable }, void>({
  id: 'registrar_emprestimo_pix',
  name: 'Registrar empréstimo ou Pix',
  description: 'Cadastra ou edita dinheiro/Pix emprestado fora do cartão',
  category: 'emprestimos',
  execute: (params, ctx) => {
    const { members } = ctx.getState();
    const isOwner = members.some(m => m.id === params.receivable.memberId && m.isOwner);
    if (isOwner) throw new Error('O titular não pode dever para si mesmo.');
    if (!(params.receivable.amount > 0)) throw new Error('Informe um valor maior que zero.');

    ctx.dispatch({ type: 'ADD_RECEIVABLE', payload: params.receivable });
  },
});

// ─── Marcar Empréstimo Como Recebido ──────────────────────────────────────────

toolRegistry.register<{ receivableId: string; amount?: number }, void>({
  id: 'marcar_emprestimo_recebido',
  name: 'Marcar empréstimo como recebido',
  description: 'Quita o valor de um empréstimo/Pix emprestado fora do cartão',
  category: 'emprestimos',
  execute: (params, ctx) => {
    const { receivables } = ctx.getState();
    const item = receivables.find(r => r.id === params.receivableId);
    if (!item) return;

    const paidAmount = Math.min(item.amount, params.amount === undefined ? item.amount : item.paidAmount + params.amount);
    const status = paidAmount >= item.amount ? 'quitado' : paidAmount > 0 ? 'parcial' : 'pendente';

    ctx.dispatch({
      type: 'UPDATE_RECEIVABLE',
      payload: { id: params.receivableId, patch: { paidAmount, status } },
    });
  },
});

// ─── Excluir Empréstimo ───────────────────────────────────────────────────────

toolRegistry.register<{ receivableId: string }, void>({
  id: 'excluir_emprestimo',
  name: 'Excluir empréstimo/Pix',
  description: 'Remove um empréstimo ou Pix registrado fora do cartão',
  category: 'emprestimos',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'DELETE_RECEIVABLE', payload: params.receivableId });
  },
});

import { toolRegistry } from '../registry';
import { FLAGS, rememberDeleted } from '../../store/storage';
import { getDebtBalance } from '../../utils/analytics';
import type { Debt } from '../../types';

// ─── Cadastrar/Editar Dívida Própria ──────────────────────────────────────────

toolRegistry.register<{ debt: Debt }, void>({
  id: 'cadastrar_divida',
  name: 'Cadastrar/editar dívida',
  description: 'Cadastra ou altera uma dívida própria ou registro manual a pagar/receber',
  category: 'dividas',
  execute: (params, ctx) => {
    if (!params.debt.counterparty.trim()) throw new Error('Informe com quem é a dívida.');
    if (!(params.debt.totalAmount > 0)) throw new Error('O valor total precisa ser maior que zero.');
    ctx.dispatch({ type: 'ADD_DEBT', payload: { ...params.debt, counterparty: params.debt.counterparty.trim() } });
  },
});

// ─── Quitar Dívida Totalmente ──────────────────────────────────────────────────

toolRegistry.register<{ debtId: string }, void>({
  id: 'quitar_divida',
  name: 'Quitar dívida totalmente',
  description: 'Marca o valor pago igual ao valor total da dívida, quitando o registro',
  category: 'dividas',
  execute: (params, ctx) => {
    const { debts } = ctx.getState();
    const debt = debts.find(d => d.id === params.debtId);
    if (!debt) return;

    ctx.dispatch({
      type: 'UPDATE_DEBT',
      payload: {
        id: params.debtId,
        patch: {
          paidAmount: debt.totalAmount,
          currentInstallment: debt.totalInstallments || debt.currentInstallment,
        },
      },
    });
  },
});

// ─── Pagar Parcela da Dívida ───────────────────────────────────────────────────

toolRegistry.register<{ debtId: string; amount?: number }, { paid: number }>({
  id: 'pagar_parcela_divida',
  name: 'Pagar parcela da dívida',
  description: 'Acrescenta o valor da parcela mensal (ou um valor informado) ao valor pago da dívida',
  category: 'dividas',
  execute: (params, ctx) => {
    const { debts, transactions } = ctx.getState();
    const debt = debts.find(d => d.id === params.debtId);
    if (!debt) return { paid: 0 };

    // Limita ao saldo real (descontando pagamentos vinculados via fatura).
    const balance = getDebtBalance(debt, transactions);
    const payment = Math.min(balance, params.amount ?? (debt.monthlyPayment > 0 ? debt.monthlyPayment : balance));
    const nextInstallment = debt.currentInstallment && debt.totalInstallments
      ? Math.min(debt.totalInstallments, debt.currentInstallment + 1)
      : debt.currentInstallment;

    ctx.dispatch({
      type: 'UPDATE_DEBT',
      payload: { id: params.debtId, patch: { paidAmount: debt.paidAmount + payment, currentInstallment: nextInstallment } },
    });
    return { paid: payment };
  },
});

// ─── Excluir Dívida Própria ───────────────────────────────────────────────────

toolRegistry.register<{ debtId: string }, void>({
  id: 'excluir_divida',
  name: 'Excluir dívida',
  description: 'Remove uma dívida cadastrada',
  category: 'dividas',
  execute: (params, ctx) => {
    const { debts } = ctx.getState();
    const debt = debts.find(d => d.id === params.debtId);
    if (!debt) return;

    rememberDeleted(FLAGS.deletedDebts, params.debtId);

    ctx.dispatch({ type: 'DELETE_DEBT', payload: params.debtId });
  },
});

// ─── Vincular Transação a Dívida ──────────────────────────────────────────────

toolRegistry.register<{ transactionId: string; debtId: string }, void>({
  id: 'vincular_transacao_divida',
  name: 'Vincular transação a dívida',
  description: 'Associa um lançamento da fatura como pagamento de uma dívida',
  category: 'dividas',
  execute: (params, ctx) => {
    const { debts } = ctx.getState();
    const debt = debts.find(d => d.id === params.debtId);

    ctx.dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: params.transactionId, patch: { debtId: params.debtId } },
    });

    if (debt && !debt.linkedTransactionIds.includes(params.transactionId)) {
      ctx.dispatch({
        type: 'UPDATE_DEBT',
        payload: {
          id: params.debtId,
          patch: { linkedTransactionIds: [...debt.linkedTransactionIds, params.transactionId] },
        },
      });
    }
  },
});

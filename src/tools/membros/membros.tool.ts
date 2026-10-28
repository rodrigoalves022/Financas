import { toolRegistry } from '../registry';
import { getDebtBalance } from '../../utils/analytics';
import { normalizeText } from '../../utils/formatters';
import { FLAGS, rememberDeleted } from '../../store/storage';
import type { Member } from '../../types';

// ─── Cadastrar Membro ─────────────────────────────────────────────────────────

toolRegistry.register<{ member: Member }, { memberId: string; created: boolean }>({
  id: 'cadastrar_membro',
  name: 'Cadastrar membro',
  description: 'Cadastra uma pessoa usada em divisões, cobranças e empréstimos (reaproveita se o nome já existe)',
  category: 'membros',
  execute: (params, ctx) => {
    const name = params.member.name.trim();
    if (!name) throw new Error('Informe o nome da pessoa.');
    const { members } = ctx.getState();
    const existing = members.find(member => normalizeText(member.name) === normalizeText(name));
    if (existing) return { memberId: existing.id, created: false };
    if (params.member.isOwner) {
      members.filter(member => member.isOwner).forEach(member => ctx.dispatch({ type: 'UPDATE_MEMBER', payload: { id: member.id, patch: { isOwner: false } } }));
    }
    ctx.dispatch({ type: 'ADD_MEMBER', payload: { ...params.member, name } });
    return { memberId: params.member.id, created: true };
  },
});

// ─── Editar Membro ────────────────────────────────────────────────────────────

toolRegistry.register<{ memberId: string; patch: Partial<Member> }, void>({
  id: 'atualizar_membro',
  name: 'Editar membro',
  description: 'Altera nome, apelido, contato ou marcação de titular de uma pessoa',
  category: 'membros',
  execute: (params, ctx) => {
    const { members, debts } = ctx.getState();
    const member = members.find(item => item.id === params.memberId);
    if (!member) return;

    const nextName = params.patch.name?.trim();
    if (nextName && normalizeText(nextName) !== normalizeText(member.name)
      && members.some(item => item.id !== member.id && normalizeText(item.name) === normalizeText(nextName))) {
      throw new Error(`Já existe uma pessoa chamada ${nextName}.`);
    }
    if (params.patch.isOwner === false && member.isOwner) {
      throw new Error('Para trocar o titular, marque a outra pessoa como titular.');
    }

    // Só pode haver um titular: marcar um novo desmarca o anterior.
    if (params.patch.isOwner) {
      members
        .filter(item => item.isOwner && item.id !== params.memberId)
        .forEach(item => ctx.dispatch({ type: 'UPDATE_MEMBER', payload: { id: item.id, patch: { isOwner: false } } }));
    }

    ctx.dispatch({ type: 'UPDATE_MEMBER', payload: { id: params.memberId, patch: { ...params.patch, ...(nextName ? { name: nextName } : {}) } } });

    // Dívidas ligam a pessoa pelo nome (counterparty): renomear sem propagar
    // fazia o saldo "sumir" da pessoa e reaparecer como um nome solto.
    if (nextName && normalizeText(nextName) !== normalizeText(member.name)) {
      const oldKey = normalizeText(member.name);
      ctx.dispatch({
        type: 'SET_DEBTS',
        payload: debts.map(debt => normalizeText(debt.counterparty) === oldKey ? { ...debt, counterparty: nextName } : debt),
      });
    }
  },
});

// ─── Excluir Membro ───────────────────────────────────────────────────────────

export interface DeleteMemberResult {
  deleted: boolean;
  reason?: string;
}

toolRegistry.register<{ memberId: string }, DeleteMemberResult>({
  id: 'excluir_membro',
  name: 'Excluir membro',
  description: 'Remove uma pessoa, desde que não seja o titular nem tenha valores em aberto',
  category: 'membros',
  execute: (params, ctx): DeleteMemberResult => {
    const { members, receivables, debts, transactions } = ctx.getState();
    const member = members.find(item => item.id === params.memberId);
    if (!member) return { deleted: false, reason: 'Pessoa não encontrada.' };

    if (member.isOwner) {
      return { deleted: false, reason: 'O titular do cartão não pode ser excluído.' };
    }

    // Uma cobrança em aberto some de todos os totais se o dono dela deixar de existir,
    // porque os cálculos localizam a pessoa pelo id. Bloquear é melhor do que apagar
    // dinheiro sem avisar.
    const openReceivable = receivables
      .filter(item => item.memberId === member.id && item.status !== 'quitado')
      .reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0);
    const openDebt = debts
      .filter(item => normalizeText(item.counterparty) === normalizeText(member.name))
      .reduce((sum, item) => sum + getDebtBalance(item, transactions), 0);

    if (openReceivable + openDebt > 0) {
      return {
        deleted: false,
        reason: `${member.name} ainda tem valores em aberto. Quite ou exclua os lançamentos antes de remover a pessoa.`,
      };
    }

    // Sem pendências: limpa o que ficaria apontando para um id inexistente.
    const settledIds = new Set(receivables.filter(item => item.memberId === member.id).map(item => item.id));
    if (settledIds.size) {
      ctx.dispatch({ type: 'SET_RECEIVABLES', payload: receivables.filter(item => !settledIds.has(item.id)) });
    }
    transactions
      .filter(item => item.responsibleMemberId === member.id)
      .forEach(item => ctx.dispatch({
        type: 'UPDATE_TRANSACTION',
        payload: { id: item.id, patch: { responsibleMemberId: undefined } },
      }));

    // Mesma proteção usada por dívidas e cobranças: impede que a migração do banco
    // antigo ressuscite quem foi excluído de propósito.
    rememberDeleted(FLAGS.deletedMembers, params.memberId);

    ctx.dispatch({ type: 'DELETE_MEMBER', payload: params.memberId });
    return { deleted: true };
  },
});

// ─── Atribuir Responsável por Transação ───────────────────────────────────────

toolRegistry.register<{ transactionId: string; memberId: string }, void>({
  id: 'atribuir_responsavel_transacao',
  name: 'Atribuir responsável por transação',
  description: 'Define um único membro responsável por pagar uma compra do cartão',
  category: 'membros',
  execute: (params, ctx) => {
    const { members, transactions, receivables } = ctx.getState();
    const isOwner = members.some(m => m.id === params.memberId && m.isOwner);
    if (isOwner) return;

    const transaction = transactions.find(t => t.id === params.transactionId);

    // Atualiza o responsável na transação
    ctx.dispatch({
      type: 'UPDATE_TRANSACTION',
      payload: { id: params.transactionId, patch: { responsibleMemberId: params.memberId || undefined } },
    });

    if (!params.memberId) {
      // Remove cobrança de responsável se limpo
      const filtered = receivables.filter(r => !(r.transactionId === params.transactionId && r.source === 'responsavel'));
      ctx.dispatch({ type: 'SET_RECEIVABLES', payload: filtered });
      return;
    }

    if (!transaction) return;

    const existing = receivables.find(r => r.transactionId === params.transactionId && r.source === 'responsavel');
    const nextReceivable = {
      id: existing?.id || crypto.randomUUID(),
      memberId: params.memberId,
      source: 'responsavel' as const,
      amount: transaction.amount,
      paidAmount: existing?.paidAmount || 0,
      date: transaction.date,
      description: transaction.description,
      transactionId: params.transactionId,
      status: existing?.status || ('pendente' as const),
    };

    ctx.dispatch({ type: 'ADD_RECEIVABLE', payload: nextReceivable });
  },
});

import type { Member, Receivable, Transaction } from '../types';
import { getDebtBalance, getLatestInvoiceMonth, getInvoiceTotal, getPeopleWhoOweMe } from '../utils/analytics';
import { buildFinanceSummary } from '../utils/aiSummary';
import { invoiceMonthFromFileName, parseInvoiceFile } from '../utils/csvParser';
import { formatBRL, formatMonthLong, normalizeText, shiftMonth, todayISO } from '../utils/formatters';
import type { SnapshotPayload, TelegramPendingEvent, UndoData } from '../utils/telegramSync';
import type { FinanceState } from './actions';
import { DEFAULT_CARD_SETTINGS, closingDateOf, type CardSettings } from './cardSettings';
import { fileSignature, type StoreAccess } from './migrations';
import { FLAGS, readJsonFlag } from './storage';

export interface TelegramEventResult {
  id: number;
  success: boolean;
  message: string;
  undo?: UndoData;
}

/**
 * Aplica eventos vindos do Telegram (registrar dívida, racha, marcar pago, desfazer)
 * reaproveitando as regras das ferramentas de empréstimos e membros, mas acumulando em
 * memória dentro do loop — dois eventos do mesmo lote (ex.: registrar e já marcar pago
 * de uma pessoa nova) enxergam as mudanças um do outro antes do dispatch final.
 */
export const applyTelegramEvents = (state: FinanceState, events: TelegramPendingEvent[]) => {
  let members = [...state.members];
  let receivables = [...state.receivables];
  let debts = [...state.debts];
  const results: TelegramEventResult[] = [];

  const findMember = (name: string) => members.find(member =>
    normalizeText(member.name) === normalizeText(name) || (member.nickname && normalizeText(member.nickname) === normalizeText(name)),
  );

  const buildReceivable = (memberId: string, amount: number, description?: string): Receivable => ({
    id: crypto.randomUUID(),
    memberId,
    source: 'emprestimo_pix',
    amount,
    paidAmount: 0,
    date: todayISO(),
    description: description || 'Registrado via Telegram',
    status: 'pendente',
  });

  for (const event of events) {
    if (event.type === 'registrar_divida') {
      const { personName = '', amount, description, allowCreate } = event.payload;
      if (amount === undefined || amount <= 0) {
        results.push({ id: event.id, success: false, message: `Valor inválido para ${personName}.` });
        continue;
      }
      let member = findMember(personName);
      if (!member) {
        // Só cria pessoa quando o bot confirmou no chat — evita que uma mensagem
        // solta vire um membro de lixo no cadastro.
        if (!allowCreate) {
          results.push({ id: event.id, success: false, message: `Não encontrei "${personName}" e não tive confirmação para criar.` });
          continue;
        }
        const created: Member = { id: crypto.randomUUID(), name: personName, aliases: [] };
        members = [...members, created];
        member = created;
      }
      if (member.isOwner) {
        results.push({ id: event.id, success: false, message: `${personName} é o titular do cartão — não registrei.` });
        continue;
      }
      const receivable = buildReceivable(member.id, amount, description);
      receivables = [receivable, ...receivables];
      results.push({
        id: event.id,
        success: true,
        message: `Registrado: ${personName} te deve ${formatBRL(amount)}${description ? ` (${description})` : ''}.`,
        undo: { kind: 'created_receivables', receivableIds: [receivable.id] },
      });
      continue;
    }

    if (event.type === 'racha') {
      const { personNames = [], amount, shares, description } = event.payload;
      const parts = shares && shares > 0 ? shares : personNames.length;
      if (amount === undefined || amount <= 0 || !personNames.length || !parts) {
        results.push({ id: event.id, success: false, message: 'Racha inválido.' });
        continue;
      }
      const share = amount / parts;
      const created: string[] = [];
      const missing: string[] = [];
      personNames.forEach(name => {
        const member = findMember(name);
        if (!member || member.isOwner) { missing.push(name); return; }
        const receivable = buildReceivable(member.id, share, description || 'Racha via Telegram');
        receivables = [receivable, ...receivables];
        created.push(receivable.id);
      });
      if (!created.length) {
        results.push({ id: event.id, success: false, message: `Não achei ninguém do racha: ${missing.join(', ')}.` });
        continue;
      }
      const warn = missing.length ? ` (ignorei: ${missing.join(', ')})` : '';
      results.push({
        id: event.id,
        success: true,
        message: `Racha aplicado: ${formatBRL(share)} para ${created.length} pessoa(s)${warn}.`,
        undo: { kind: 'created_receivables', receivableIds: created },
      });
      continue;
    }

    if (event.type === 'desfazer') {
      const undo = event.payload.undo;
      if (!undo) {
        results.push({ id: event.id, success: false, message: 'Não recebi o que precisava para desfazer.' });
        continue;
      }
      if (undo.kind === 'created_receivables') {
        const ids = new Set(undo.receivableIds);
        receivables = receivables.filter(item => !ids.has(item.id));
        results.push({ id: event.id, success: true, message: `Desfeito: removi ${ids.size} lançamento(s).` });
      } else {
        undo.items.forEach(item => {
          if (item.source === 'receivable') {
            receivables = receivables.map(row => row.id === item.id
              ? { ...row, paidAmount: item.paidAmount, status: (item.status || 'pendente') as Receivable['status'] }
              : row);
          } else {
            debts = debts.map(debt => debt.id === item.id ? { ...debt, paidAmount: item.paidAmount } : debt);
          }
        });
        results.push({ id: event.id, success: true, message: `Desfeito: restaurei ${undo.items.length} cobrança(s).` });
      }
      continue;
    }

    // marcar_pago — olha as duas representações de "me devem":
    // Receivable (qualquer origem) e Debt do tipo a_receber.
    const { personName = '', amount } = event.payload;
    const member = findMember(personName);
    const nameKey = normalizeText(member?.name || personName);

    type Payable = { id: string; source: 'receivable' | 'debt'; due: number; date: string; paidAmount: number; status?: string };
    const pendingReceivables: Payable[] = receivables
      .filter(item => member && item.memberId === member.id && item.status !== 'quitado' && item.amount - item.paidAmount > 0)
      .map(item => ({ id: item.id, source: 'receivable', due: item.amount - item.paidAmount, date: item.date, paidAmount: item.paidAmount, status: item.status }));
    const pendingDebts: Payable[] = debts
      .filter(debt => debt.type === 'a_receber' && normalizeText(debt.counterparty) === nameKey && getDebtBalance(debt, state.transactions) > 0)
      .map(debt => ({ id: debt.id, source: 'debt', due: getDebtBalance(debt, state.transactions), date: debt.startDate, paidAmount: debt.paidAmount }));
    const pending = [...pendingReceivables, ...pendingDebts].sort((a, b) => a.date.localeCompare(b.date));

    if (!pending.length) {
      const reason = member || pendingDebts.length ? 'não tem cobrança pendente' : 'não está cadastrado';
      results.push({ id: event.id, success: false, message: `${personName} ${reason}.` });
      continue;
    }

    let remaining = amount;
    let appliedTotal = 0;
    const undoItems: Array<{ id: string; source: 'receivable' | 'debt'; paidAmount: number; status?: string }> = [];

    pending.forEach(item => {
      if (remaining !== undefined && remaining <= 0) return;
      const applied = remaining === undefined ? item.due : Math.min(item.due, remaining);
      if (applied <= 0) return;
      undoItems.push({ id: item.id, source: item.source, paidAmount: item.paidAmount, status: item.status });
      const paidAmount = item.paidAmount + applied;

      if (item.source === 'receivable') {
        receivables = receivables.map(row => {
          if (row.id !== item.id) return row;
          const status = paidAmount >= row.amount ? 'quitado' : paidAmount > 0 ? 'parcial' : 'pendente';
          return { ...row, paidAmount, status: status as Receivable['status'], paidAt: todayISO() };
        });
      } else {
        debts = debts.map(debt => debt.id === item.id ? { ...debt, paidAmount } : debt);
      }

      appliedTotal += applied;
      if (remaining !== undefined) remaining -= applied;
    });

    results.push({
      id: event.id,
      success: true,
      message: `Marquei ${formatBRL(appliedTotal)} de ${personName} como pago.`,
      undo: { kind: 'restored_payments', items: undoItems },
    });
  }

  return { results, members, receivables, debts };
};

/** Resumo que o bot usa para responder consultas — os mesmos números que o app mostra. */
export const buildTelegramSnapshot = (state: FinanceState): SnapshotPayload => {
  const latestMonth = getLatestInvoiceMonth(state.transactions) || todayISO().substring(0, 7);
  const ownDebts = state.debts
    .filter(debt => debt.type === 'a_pagar')
    .reduce((sum, debt) => sum + getDebtBalance(debt, state.transactions), 0);

  return {
    people: getPeopleWhoOweMe(state.receivables, state.debts, state.members, state.transactions).map(person => ({
      memberId: person.memberId,
      name: person.name,
      total: person.total,
      items: person.items.map(item => ({
        kind: item.kind,
        id: item.id,
        description: item.description,
        remaining: item.remaining,
        date: item.date,
        origin: item.origin,
      })),
    })),
    allMemberNames: state.members.filter(member => !member.isOwner).map(member => member.name),
    cardInvoice: getInvoiceTotal(state.transactions, latestMonth),
    ownDebts,
    currentMonth: latestMonth,
    financeSummary: buildFinanceSummary(state, latestMonth),
  };
};

// ─── Fatura mandada no chat ──────────────────────────────────────────────────

const MONTH_NAMES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));

/** Mês na legenda: "2026-11", "11/2026", "nov/26", "novembro" (sem ano: o mais perto do palpite). */
const monthFromCaption = (caption: string | undefined, reference: string): string => {
  if (!caption) return '';
  // Sem normalizeText: ele troca "/" e "-" por espaço, e as datas deixariam de bater.
  const text = caption.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const iso = text.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`;
  const numeric = text.match(/\b(0?[1-9]|1[0-2])[-/](20\d{2}|\d{2})\b/);
  if (numeric) return `${numeric[2].length === 2 ? `20${numeric[2]}` : numeric[2]}-${numeric[1].padStart(2, '0')}`;
  const index = MONTH_NAMES.findIndex(name => new RegExp(`\\b(${name}|${name.slice(0, 3)})\\b`).test(text));
  if (index < 0) return '';
  const month = String(index + 1).padStart(2, '0');
  const shortYear = text.match(/\/(\d{2})\b/)?.[1];
  const year = text.match(/\b(20\d{2})\b/)?.[1] || (shortYear ? `20${shortYear}` : '');
  if (year) return `${year}-${month}`;
  const referenceYear = Number(reference.slice(0, 4)) || new Date().getFullYear();
  return [referenceYear - 1, referenceYear, referenceYear + 1]
    .map(candidate => `${candidate}-${month}`)
    .sort((a, b) => Math.abs(monthIndex(a) - monthIndex(reference)) - Math.abs(monthIndex(b) - monthIndex(reference)))[0];
};

/** Fatura em que a compra à vista mais recente cai, pelo fechamento configurado do cartão. */
const guessInvoiceMonth = (rows: Transaction[], settings: CardSettings) => {
  const dates = rows.filter(row => row.type === 'expense' && !row.installment).map(row => row.date).sort();
  const latest = dates.at(-1) || rows.map(row => row.date).sort().at(-1);
  if (!latest) return '';
  let month = latest.slice(0, 7);
  for (let step = 0; step < 3; step += 1) {
    if (latest <= closingDateOf(month, settings)) return month;
    month = shiftMonth(month, 1);
  }
  return month;
};

/**
 * Importa a fatura recebida pelo bot pelo mesmo caminho das faturas de public/faturas:
 * nome canônico por mês (fatura-inter-AAAA-MM), reconciliação com RESYNC e assinatura
 * do conteúdo. Mandar a mesma fatura de novo não duplica nada; mandar a versão fechada
 * depois da parcial troca as linhas que mudaram.
 */
export const applyTelegramFatura = async ({ getState, dispatch }: StoreAccess, event: TelegramPendingEvent) => {
  const { fileName = 'fatura.csv', content = '', caption } = event.payload;
  const fail = (message: string) => ({ id: event.id, success: false, message });
  if (!content.trim()) return fail(`${fileName} chegou vazio.`);

  const extension = /\.ofx$/i.test(fileName) ? 'ofx' : 'csv';
  const state = getState();
  const context = { categories: state.categories, rules: state.categoryRules, aliases: state.aliases };
  let firstPass: Transaction[];
  try {
    firstPass = await parseInvoiceFile(fileName, content, context);
  } catch {
    return fail(`Não consegui ler ${fileName}. Confira se é o CSV/OFX exportado do banco.`);
  }
  if (!firstPass.length) return fail(`Não achei lançamentos em ${fileName}.`);

  // Nome com data completa (ex.: exportado em 2026-11-05) é a data do download, não o mês da fatura.
  const settings = { ...DEFAULT_CARD_SETTINGS, ...readJsonFlag<Partial<CardSettings>>(FLAGS.card, {}) };
  const guessed = guessInvoiceMonth(firstPass, settings);
  const fromName = /(20\d{2})[-_](0[1-9]|1[0-2])[-_]\d{2}/.test(fileName) ? '' : invoiceMonthFromFileName(fileName);
  const month = monthFromCaption(caption, guessed) || fromName || guessed;
  if (!month) return fail(`Não descobri o mês de ${fileName}. Mande de novo com a legenda "MM/AAAA".`);

  const sourceFile = `fatura-inter-${month}.${extension}`;
  const rows = await parseInvoiceFile(sourceFile, content, context);
  const before = getState().transactions.filter(row => row.sourceFile === sourceFile);
  dispatch({ type: 'RESYNC_TRANSACTIONS', payload: { staleSourceFiles: [sourceFile], incoming: rows } });
  // Soma a assinatura sem apagar as antigas: uma versão anterior que ainda esteja em
  // public/faturas não volta a ser importada por cima desta.
  dispatch({ type: 'ADD_PROCESSED_FILES', payload: [sourceFile, fileSignature(sourceFile, content)] });

  const after = getState().transactions.filter(row => row.sourceFile === sourceFile);
  const beforeIds = new Set(before.map(row => row.id));
  const afterIds = new Set(after.map(row => row.id));
  const added = after.filter(row => !beforeIds.has(row.id)).length;
  const removed = before.filter(row => !afterIds.has(row.id)).length;
  const total = formatBRL(getInvoiceTotal(getState().transactions, month));
  const label = formatMonthLong(month);
  const how = monthFromCaption(caption, guessed) ? '' : fromName ? '' : ' (mês deduzido pelas datas — se estiver errado, mande de novo com a legenda "MM/AAAA")';

  return {
    id: event.id,
    success: true,
    message: added || removed
      ? `Fatura de ${label} importada: ${added} lançamento(s) novo(s)${removed ? `, ${removed} antigo(s) substituído(s)` : ''} · total ${total}${how}.`
      : `Fatura de ${label}: nada novo, os ${rows.length} lançamentos já estavam no app (total ${total}).`,
  };
};

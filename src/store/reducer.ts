import type { FinanceState, FinanceAction } from './actions';
import type { MonthlyIncome } from '../types';
import { normalizeText } from '../utils/formatters';
import { normalizeMerchant } from '../utils/merchant';
import { inheritPurchaseNotes } from '../utils/analytics';

// Receitas antigas (migradas) não têm id: a chave composta é a identidade delas.
export const incomeKey = (income: MonthlyIncome) =>
  income.id || `${income.month}-${income.source || 'manual'}-${income.amount}-${income.description || ''}`;

const uniqueKey = (t: { date: string; description: string; amount: number; installment?: string; sourceFile?: string; type?: string; occurrence?: number }) =>
  normalizeText(`${t.sourceFile || ''}|${t.date}|${t.description}|${t.amount.toFixed(2)}|${t.installment || ''}${t.type === 'income' ? '|credito' : ''}${t.occurrence && t.occurrence > 1 ? `|${t.occurrence}` : ''}`);

export function financeReducer(state: FinanceState, action: FinanceAction): FinanceState {
  switch (action.type) {

    // ─── Transactions ──────────────────────────────────────────────────────────

    case 'SET_TRANSACTIONS':
      return { ...state, transactions: action.payload };

    case 'ADD_TRANSACTIONS': {
      const existingIds = new Set(state.transactions.map(t => t.id));
      const existingKeys = new Set(state.transactions.map(uniqueKey));
      const incomingKeys = new Set<string>();
      const deduped = action.payload
        .filter(t => {
          const key = uniqueKey(t);
          if (existingIds.has(t.id) || existingKeys.has(key) || incomingKeys.has(key)) return false;
          incomingKeys.add(key);
          return true;
        })
        .map(t => ({ ...t, status: 'ok' as const }));
      return {
        ...state,
        transactions: [...state.transactions, ...inheritPurchaseNotes(state.transactions, deduped)].sort((a, b) => b.date.localeCompare(a.date)),
      };
    }

    // Reconcilia as transações de arquivos de fatura cujo conteúdo mudou depois de já
    // terem sido importados (ex.: um CSV incompleto foi substituído pelo extrato completo).
    // ADD_TRANSACTIONS sozinho só soma linhas novas e nunca remove nada: se uma linha some
    // ou muda de texto no arquivo corrigido, a versão antiga (errada) fica presa pra sempre
    // e a versão nova entra ao lado dela, duplicando o valor da fatura.
    //
    // Aqui só se remove, dos arquivos em staleSourceFiles, o que NÃO aparece mais no parse
    // atual (`incoming`) — linhas cujo conteúdo não mudou mantêm o mesmo id/uniqueKey e
    // permanecem intactas, preservando edições do usuário (responsável, vínculo com dívida).
    case 'RESYNC_TRANSACTIONS': {
      const { staleSourceFiles, incoming } = action.payload;
      const staleSet = new Set(staleSourceFiles);
      const incomingIds = new Set(incoming.map(t => t.id));
      const incomingKeys = new Set(incoming.map(uniqueKey));
      const kept = state.transactions.filter(t => {
        if (!t.sourceFile || !staleSet.has(t.sourceFile)) return true;
        return incomingIds.has(t.id) || incomingKeys.has(uniqueKey(t));
      });

      const existingIds = new Set(kept.map(t => t.id));
      const existingKeys = new Set(kept.map(uniqueKey));
      const seenKeys = new Set<string>();
      const deduped = incoming
        .filter(t => {
          const key = uniqueKey(t);
          if (existingIds.has(t.id) || existingKeys.has(key) || seenKeys.has(key)) return false;
          seenKeys.add(key);
          return true;
        })
        .map(t => ({ ...t, status: 'ok' as const }));

      return {
        ...state,
        transactions: [...kept, ...inheritPurchaseNotes(kept, deduped)].sort((a, b) => b.date.localeCompare(a.date)),
      };
    }

    case 'UPDATE_TRANSACTION':
      return {
        ...state,
        transactions: state.transactions.map(t =>
          t.id === action.payload.id ? { ...t, ...action.payload.patch } : t
        ),
      };

    case 'DELETE_TRANSACTION':
      return { ...state, transactions: state.transactions.filter(t => t.id !== action.payload) };

    // ─── Debts ─────────────────────────────────────────────────────────────────

    case 'SET_DEBTS':
      return { ...state, debts: action.payload };

    case 'ADD_DEBT':
      return { ...state, debts: [action.payload, ...state.debts.filter(d => d.id !== action.payload.id)] };

    case 'UPDATE_DEBT':
      return {
        ...state,
        debts: state.debts.map(d =>
          d.id === action.payload.id ? { ...d, ...action.payload.patch } : d
        ),
      };

    case 'DELETE_DEBT':
      return { ...state, debts: state.debts.filter(d => d.id !== action.payload) };

    // ─── Budgets ───────────────────────────────────────────────────────────────

    case 'SET_BUDGETS':
      return { ...state, budgets: action.payload };

    case 'ADD_BUDGET':
      return {
        ...state,
        budgets: [...state.budgets.filter(b => b.categoryId !== action.payload.categoryId), action.payload],
      };

    case 'DELETE_BUDGET':
      return { ...state, budgets: state.budgets.filter(b => b.categoryId !== action.payload) };

    // ─── Members ───────────────────────────────────────────────────────────────

    case 'SET_MEMBERS':
      return { ...state, members: action.payload };

    case 'ADD_MEMBER':
      return {
        ...state,
        members: [action.payload, ...state.members.filter(m => m.id !== action.payload.id)],
      };

    // Diferente de ADD_MEMBER, preserva a posição na lista — editar não deve fazer
    // a pessoa pular para o topo.
    case 'UPDATE_MEMBER':
      return {
        ...state,
        members: state.members.map(m =>
          m.id === action.payload.id ? { ...m, ...action.payload.patch } : m
        ),
      };

    case 'DELETE_MEMBER':
      return { ...state, members: state.members.filter(m => m.id !== action.payload) };

    // ─── Receivables ───────────────────────────────────────────────────────────

    case 'SET_RECEIVABLES':
      return { ...state, receivables: action.payload };

    case 'ADD_RECEIVABLE':
      return {
        ...state,
        receivables: [action.payload, ...state.receivables.filter(r => r.id !== action.payload.id)],
      };

    case 'UPDATE_RECEIVABLE':
      return {
        ...state,
        receivables: state.receivables.map(r =>
          r.id === action.payload.id ? { ...r, ...action.payload.patch } : r
        ),
      };

    case 'DELETE_RECEIVABLE':
      return { ...state, receivables: state.receivables.filter(r => r.id !== action.payload) };

    case 'SET_RECEIVABLES_FOR_TRANSACTION': {
      const { transactionId, receivables } = action.payload;
      const kept = state.receivables.filter(
        r => !(r.transactionId === transactionId && r.source === 'divisao')
      );
      return { ...state, receivables: [...receivables, ...kept] };
    }

    // ─── MonthlyIncomes ────────────────────────────────────────────────────────

    case 'SET_MONTHLY_INCOMES':
      return { ...state, monthlyIncomes: action.payload };

    case 'ADD_INCOME': {
      const k = incomeKey(action.payload);
      return {
        ...state,
        monthlyIncomes: [
          action.payload,
          ...state.monthlyIncomes.filter(i => incomeKey(i) !== k),
        ],
      };
    }

    // Compara pela chave (id ou composta): antes só olhava `id`, então receitas
    // migradas sem id nunca podiam ser excluídas.
    case 'DELETE_INCOME':
      return {
        ...state,
        monthlyIncomes: state.monthlyIncomes.filter(i => incomeKey(i) !== action.payload),
      };

    // ─── Fixed Expenses ────────────────────────────────────────────────────────

    case 'SET_FIXED_EXPENSES':
      return { ...state, fixedExpenses: action.payload };

    case 'UPSERT_FIXED_EXPENSE':
      return {
        ...state,
        fixedExpenses: state.fixedExpenses.some(item => item.id === action.payload.id)
          ? state.fixedExpenses.map(item => item.id === action.payload.id ? action.payload : item)
          : [...state.fixedExpenses, action.payload],
      };

    case 'UPDATE_FIXED_EXPENSE':
      return {
        ...state,
        fixedExpenses: state.fixedExpenses.map(item => item.id === action.payload.id ? { ...item, ...action.payload.patch } : item),
      };

    case 'DELETE_FIXED_EXPENSE':
      return { ...state, fixedExpenses: state.fixedExpenses.filter(item => item.id !== action.payload) };

    // ─── Paid Invoice Months ───────────────────────────────────────────────────

    case 'SET_PAID_INVOICE_MONTHS':
      return { ...state, paidInvoiceMonths: action.payload };

    case 'ADD_PAID_INVOICE_MONTH':
      return {
        ...state,
        paidInvoiceMonths: Array.from(new Set([...state.paidInvoiceMonths, action.payload])).sort(),
      };

    case 'REMOVE_PAID_INVOICE_MONTH':
      return { ...state, paidInvoiceMonths: state.paidInvoiceMonths.filter(month => month !== action.payload) };

    // ─── Categories ────────────────────────────────────────────────────────────

    case 'SET_CATEGORIES':
      return {
        ...state,
        categories: [...action.payload].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      };

    // ─── Category Rules ────────────────────────────────────────────────────────

    case 'SET_CATEGORY_RULES':
      return { ...state, categoryRules: action.payload };

    case 'ADD_CATEGORY_RULE':
      return {
        ...state,
        categoryRules: [
          action.payload,
          ...state.categoryRules.filter(r =>
            normalizeText(r.keyword) !== normalizeText(action.payload.keyword)
          ),
        ],
      };

    case 'UPDATE_CATEGORY_RULE':
      return {
        ...state,
        categoryRules: state.categoryRules.map(r =>
          r.id === action.payload.id ? { ...r, ...action.payload.patch } : r
        ),
      };

    case 'DELETE_CATEGORY_RULE':
      return { ...state, categoryRules: state.categoryRules.filter(r => r.id !== action.payload) };

    // ─── Aliases ───────────────────────────────────────────────────────────────

    case 'SET_ALIASES':
      return { ...state, aliases: action.payload };

    // O apelido vale para o local (nome normalizado), não para o texto exato: a mesma
    // loja aparece com maquininhas/cidades diferentes. Antes a chave era o texto bruto e
    // renomear de novo por outra variação criava um segundo apelido que nunca vencia.
    case 'ADD_ALIAS': {
      const key = normalizeMerchant(action.payload.original);
      return { ...state, aliases: [...state.aliases.filter(a => normalizeMerchant(a.original) !== key), action.payload] };
    }

    case 'REMOVE_ALIAS': {
      const key = normalizeMerchant(action.payload);
      return { ...state, aliases: state.aliases.filter(a => normalizeMerchant(a.original) !== key) };
    }

    // ─── Processed Files ───────────────────────────────────────────────────────

    case 'SET_PROCESSED_FILES':
      return { ...state, processedFiles: action.payload };

    case 'ADD_PROCESSED_FILES':
      return {
        ...state,
        processedFiles: Array.from(new Set([...state.processedFiles, ...action.payload])),
      };

    // ─── Reset ─────────────────────────────────────────────────────────────────

    case 'RESTORE_STATE':
      return {
        ...action.payload,
        categories: [...action.payload.categories].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      };

    case 'RESET_ALL':
      return {
        transactions: [],
        debts: [],
        fixedExpenses: [],
        budgets: [],
        members: action.payload.members,
        receivables: [],
        monthlyIncomes: [],
        paidInvoiceMonths: [],
        categories: action.payload.categories,
        categoryRules: [],
        aliases: [],
        processedFiles: [],
      };

    default:
      return state;
  }
}

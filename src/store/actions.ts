import type {
  Alias,
  Budget,
  Category,
  CategoryRule,
  Debt,
  FixedExpense,
  Member,
  MonthlyIncome,
  Receivable,
  Transaction,
} from '../types';

// ─── Estado global somente-leitura ────────────────────────────────────────────

export interface FinanceState {
  transactions: Transaction[];
  debts: Debt[];
  fixedExpenses: FixedExpense[];
  budgets: Budget[];
  members: Member[];
  receivables: Receivable[];
  monthlyIncomes: MonthlyIncome[];
  paidInvoiceMonths: string[];
  categories: Category[];
  categoryRules: CategoryRule[];
  aliases: Alias[];
  processedFiles: string[];
}

// ─── Actions (union discriminada) ─────────────────────────────────────────────

export type FinanceAction =
  | { type: 'SET_TRANSACTIONS'; payload: Transaction[] }
  | { type: 'ADD_TRANSACTIONS'; payload: Transaction[] }
  | { type: 'RESYNC_TRANSACTIONS'; payload: { staleSourceFiles: string[]; incoming: Transaction[] } }
  | { type: 'UPDATE_TRANSACTION'; payload: { id: string; patch: Partial<Transaction> } }
  | { type: 'DELETE_TRANSACTION'; payload: string }
  | { type: 'SET_DEBTS'; payload: Debt[] }
  | { type: 'ADD_DEBT'; payload: Debt }
  | { type: 'UPDATE_DEBT'; payload: { id: string; patch: Partial<Debt> } }
  | { type: 'DELETE_DEBT'; payload: string }
  | { type: 'SET_FIXED_EXPENSES'; payload: FixedExpense[] }
  | { type: 'UPSERT_FIXED_EXPENSE'; payload: FixedExpense }
  | { type: 'UPDATE_FIXED_EXPENSE'; payload: { id: string; patch: Partial<FixedExpense> } }
  | { type: 'DELETE_FIXED_EXPENSE'; payload: string }
  | { type: 'SET_BUDGETS'; payload: Budget[] }
  | { type: 'ADD_BUDGET'; payload: Budget }
  | { type: 'DELETE_BUDGET'; payload: string }
  | { type: 'SET_MEMBERS'; payload: Member[] }
  | { type: 'ADD_MEMBER'; payload: Member }
  | { type: 'UPDATE_MEMBER'; payload: { id: string; patch: Partial<Member> } }
  | { type: 'DELETE_MEMBER'; payload: string }
  | { type: 'SET_RECEIVABLES'; payload: Receivable[] }
  | { type: 'ADD_RECEIVABLE'; payload: Receivable }
  | { type: 'UPDATE_RECEIVABLE'; payload: { id: string; patch: Partial<Receivable> } }
  | { type: 'DELETE_RECEIVABLE'; payload: string }
  | { type: 'SET_RECEIVABLES_FOR_TRANSACTION'; payload: { transactionId: string; receivables: Receivable[] } }
  | { type: 'SET_MONTHLY_INCOMES'; payload: MonthlyIncome[] }
  | { type: 'ADD_INCOME'; payload: MonthlyIncome }
  | { type: 'DELETE_INCOME'; payload: string }
  | { type: 'SET_PAID_INVOICE_MONTHS'; payload: string[] }
  | { type: 'ADD_PAID_INVOICE_MONTH'; payload: string }
  | { type: 'REMOVE_PAID_INVOICE_MONTH'; payload: string }
  | { type: 'SET_CATEGORIES'; payload: Category[] }
  | { type: 'SET_CATEGORY_RULES'; payload: CategoryRule[] }
  | { type: 'ADD_CATEGORY_RULE'; payload: CategoryRule }
  | { type: 'UPDATE_CATEGORY_RULE'; payload: { id: string; patch: Partial<CategoryRule> } }
  | { type: 'DELETE_CATEGORY_RULE'; payload: string }
  | { type: 'SET_ALIASES'; payload: Alias[] }
  | { type: 'ADD_ALIAS'; payload: Alias }
  /** Remove o apelido do local desta descrição (todas as variações dele). */
  | { type: 'REMOVE_ALIAS'; payload: string }
  | { type: 'SET_PROCESSED_FILES'; payload: string[] }
  | { type: 'ADD_PROCESSED_FILES'; payload: string[] }
  | { type: 'RESTORE_STATE'; payload: FinanceState }
  | { type: 'RESET_ALL'; payload: { categories: Category[]; members: Member[] } };

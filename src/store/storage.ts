import type { Member } from '../types';
import { DEFAULT_CATEGORIES } from '../utils/constants';
import type { FinanceState } from './actions';

/** Chave do IndexedDB de cada fatia do estado (mesmos nomes da época do localStorage). */
export const STORAGE_KEYS: Record<keyof FinanceState, string> = {
  transactions: 'finance_transactions_v2',
  debts: 'finance_debts_v2',
  fixedExpenses: 'finance_fixed_expenses_v1',
  budgets: 'finance_budgets_v2',
  members: 'finance_members_v2',
  receivables: 'finance_receivables_v2',
  monthlyIncomes: 'finance_incomes_v2',
  paidInvoiceMonths: 'finance_paid_invoice_months_v1',
  categories: 'finance_categories_v2',
  categoryRules: 'finance_category_rules_v2',
  aliases: 'finance_aliases_v2',
  processedFiles: 'finance_processed_files_v2',
};

/** Flags de controle no localStorage (migrações já feitas, preferências). */
export const FLAGS = {
  userCleared: 'finance_user_cleared_data_v1',
  legacyVersion: 'finance_legacy_migration_version',
  rulesBackfilled: 'finance_category_rules_backfilled_v1',
  installmentDatesFixed: 'finance_installment_dates_fixed_v1',
  iofRecovered: 'finance_lines_recovered_v3',
  rawCategoryBackfilled: 'finance_raw_category_backfilled_v1',
  incomeCleanup: 'finance_income_cleanup_v2',
  deletedDebts: 'finance_deleted_debt_ids_v1',
  deletedReceivables: 'finance_deleted_receivable_ids_v1',
  deletedMembers: 'finance_deleted_member_ids_v1',
  selectedMonth: 'finance_selected_month_v1',
  telegramUrl: 'finance_telegram_sync_url_v1',
  telegramToken: 'finance_telegram_sync_token_v1',
  telegramApplied: 'finance_telegram_applied_events_v1',
  aiSettings: 'finance_ai_settings_v1',
  aiSuggestions: 'finance_ai_suggestions_v1',
  aiInsights: 'finance_ai_insights_v1',
  inboxApplied: 'finance_inbox_applied_v1',
  spendingScope: 'finance_spending_scope_v1',
  theme: 'finance_theme_v1',
  accent: 'finance_accent_v1',
  card: 'finance_card_settings_v1',
} as const;

export const readFlag = (key: string) => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export const writeFlag = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // localStorage indisponível (modo privado / WebView restrito)
  }
};

export const readJsonFlag = <T,>(key: string, fallback: T): T => {
  const raw = readFlag(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

/** Guarda ids excluídos de propósito para a migração do banco antigo não ressuscitá-los. */
export const rememberDeleted = (key: string, id: string) => {
  const ids = readJsonFlag<string[]>(key, []);
  writeFlag(key, JSON.stringify(Array.from(new Set([...ids, id]))));
};

export const DEFAULT_OWNER: Member = { id: 'owner-rodrigo', name: 'Rodrigo', nickname: 'Titular', contact: '', isOwner: true, aliases: [] };

export const initialFinanceState: FinanceState = {
  transactions: [],
  debts: [],
  fixedExpenses: [],
  budgets: [],
  members: [],
  receivables: [],
  monthlyIncomes: [],
  paidInvoiceMonths: [],
  categories: DEFAULT_CATEGORIES,
  categoryRules: [],
  aliases: [],
  processedFiles: [],
};

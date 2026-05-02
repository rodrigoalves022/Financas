export interface Category {
  id: string;
  name: string;
  color: string;
  keywords: string[];
}

export interface Alias {
  original: string;
  alias: string;
}

export interface CategoryRule {
  id: string;
  keyword: string;
  categoryId: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  categoryId: string;
  type: 'expense' | 'income';
  source: 'csv' | 'ofx' | 'manual' | 'projection';
  sourceFile?: string;
  installment?: string;
  cardLastDigits?: string;
  debtId?: string;
  responsibleMemberId?: string;
  note?: string;
  tags?: string[];
  status?: 'ok' | 'possible_duplicate';
  normalizedMerchant?: string;
}

export interface Member {
  id: string;
  name: string;
  nickname?: string;
  contact?: string;
  isOwner?: boolean;
  aliases: string[];
}

export interface Receivable {
  id: string;
  memberId: string;
  source: 'responsavel' | 'divisao' | 'emprestimo_pix';
  amount: number;
  paidAmount: number;
  date: string;
  description: string;
  transactionId?: string;
  status: 'pendente' | 'parcial' | 'quitado';
}

export interface Debt {
  id: string;
  type: 'a_receber' | 'a_pagar';
  origin: 'manual' | 'cartao' | 'emprestimo' | 'financiamento' | 'outros';
  counterparty: string;
  totalAmount: number;
  paidAmount: number;
  monthlyPayment: number;
  interestRate: number;
  startDate: string;
  linkedTransactionIds: string[];
  currentInstallment?: number;
  totalInstallments?: number;
  note?: string;
}

export interface MonthlyIncome {
  month: string;
  amount: number;
  isRecurring: boolean;
}

export interface Budget {
  categoryId: string;
  monthlyLimit: number;
}

export interface ImportReviewRow extends Transaction {
  selected: boolean;
}

export interface CategoryTotal {
  id: string;
  name: string;
  color: string;
  total: number;
  percent: number;
  count: number;
  averageTicket: number;
}

export interface MerchantTotal {
  merchant: string;
  total: number;
  count: number;
  averageTicket: number;
  variants: string[];
}

export interface MonthlySummary {
  month: string;
  income: number;
  expense: number;
  balance: number;
  projected?: boolean;
}

export interface LegacyMigrationData {
  schemaVersion: string;
  categories: Category[];
  categoryRules?: CategoryRule[];
  aliases: Alias[];
  transactions: Transaction[];
  monthlyIncomes: MonthlyIncome[];
  debts: Debt[];
  members?: Member[];
  receivables?: Receivable[];
  budgets?: Budget[];
  processedFiles: string[];
}

export interface Category {
  id: string;
  name: string;
  color: string;
  keywords: string[];
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
  note?: string;
  status?: 'ok' | 'possible_duplicate';
  normalizedMerchant?: string;
}

export interface Debt {
  id: string;
  type: 'a_receber' | 'a_pagar';
  origin: 'manual' | 'cartao' | 'emprestimo' | 'outros';
  counterparty: string;
  totalAmount: number;
  paidAmount: number;
  monthlyPayment: number;
  interestRate: number;
  startDate: string;
  linkedTransactionIds: string[];
  note?: string;
}

export interface MonthlyIncome {
  month: string;
  amount: number;
  isRecurring: boolean;
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

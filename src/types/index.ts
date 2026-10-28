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

/**
 * Como a palavra-chave da regra é comparada com o nome do estabelecimento:
 * - auto: palavra inteira se curta (≤ 4), início de palavra se média, trecho se longa
 * - word: palavra(s) inteira(s)
 * - prefix: o nome começa com a palavra-chave
 * - contains: qualquer trecho, inclusive a cidade
 */
export type RuleMatchType = 'auto' | 'word' | 'prefix' | 'contains';

export type CategorizationSource = 'manual' | 'regra' | 'palavra-chave' | 'dicionario' | 'extrato' | 'padrao' | 'ia';

export interface CategoryRule {
  id: string;
  keyword: string;
  categoryId: string;
  createdAt: string;
  matchType?: RuleMatchType;
  /** Origem da regra: criada à mão ou aceita a partir de sugestão da IA. */
  origin?: 'manual' | 'ia';
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
  /** Mês da fatura (YYYY-MM) escolhido explicitamente na importação/lançamento manual. */
  invoiceMonth?: string;
  /** Categoria original do extrato, usada como fallback ao recategorizar. */
  rawCategory?: string;
  /** Categoria escolhida à mão: regras automáticas não sobrescrevem. */
  manualCategory?: boolean;
  /** Como a categoria atual foi decidida — usado para explicar e para a fila "a revisar". */
  categorySource?: CategorizationSource;
  /** Créditos da fatura (type 'income'): pagamento feito ao banco ou estorno de compra. */
  creditKind?: 'pagamento' | 'estorno';
  /**
   * Ordem da linha entre linhas idênticas do mesmo arquivo (2, 3...). Duas compras iguais
   * no mesmo dia são legítimas; sem isso a segunda era descartada como duplicata.
   */
  occurrence?: number;
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
  /** Data (YYYY-MM-DD) do último recebimento registrado. */
  paidAt?: string;
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

/**
 * Conta fixa paga fora do cartão (boleto, Pix, débito): financiamento, internet, aluguel.
 * Os meses são de calendário — o mês em que o dinheiro sai, comparado com a receita do mês.
 */
export interface FixedExpense {
  id: string;
  name: string;
  categoryId?: string;
  /** fixa: mesmo valor todo mês · variavel: valor lançado mês a mês · parcelada: valor fixo por N meses. */
  kind: 'fixa' | 'variavel' | 'parcelada';
  /** Valor do mês (fixa/parcelada). Na variável, a estimativa usada até o valor do mês ser lançado (0 = sem estimativa). */
  amount: number;
  /** Primeiro mês (AAAA-MM). Na parcelada, o mês da parcela 1. */
  startMonth: string;
  /** Parcelada: total de parcelas. */
  installments?: number;
  /** Dia do vencimento, para o aviso no Painel. */
  dueDay?: number;
  /** Valor lançado em cada mês: obrigatório na variável, ajuste pontual nas outras. */
  values: Record<string, number>;
  paidMonths: string[];
  /** Último mês de uma conta encerrada (ex.: cancelou a internet). */
  endMonth?: string;
  /** Antes deste mês a conta não entra nas contas do app (o histórico anterior não foi registrado). */
  trackedFrom: string;
  note?: string;
}

export interface MonthlyIncome {
  id?: string;
  month: string;
  amount: number;
  isRecurring: boolean;
  source?: 'manual' | 'legacy' | 'imported' | 'adjustment';
  date?: string;
  description?: string;
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

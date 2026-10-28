export type PendingEventType = 'registrar_divida' | 'marcar_pago' | 'racha' | 'desfazer' | 'importar_fatura';

export interface RegistrarDividaPayload {
  personName: string;
  amount: number;
  description?: string;
  /** Autoriza criar a pessoa se ela ainda não existir (vem da confirmação no chat). */
  allowCreate?: boolean;
}

export interface MarcarPagoPayload {
  personName: string;
  amount?: number;
}

export interface RachaPayload {
  amount: number;
  personNames: string[];
  /** Quantidade total de partes, incluindo o titular quando ele entra na divisão. */
  shares: number;
  description?: string;
}

export interface DesfazerPayload {
  targetEventId: number;
  undo: UndoData;
}

/** Arquivo de fatura mandado no chat — o app lê, categoriza e importa como na tela de importação. */
export interface ImportarFaturaPayload {
  fileName: string;
  content: string;
  /** Legenda da mensagem: pode trazer o mês da fatura ("novembro", "11/2026"). */
  caption?: string;
}

export type PendingEventPayload =
  | RegistrarDividaPayload
  | MarcarPagoPayload
  | RachaPayload
  | DesfazerPayload
  | ImportarFaturaPayload;

/** Como reverter um evento já aplicado — preenchido pelo app ao reportar o resultado. */
export type UndoData =
  | { kind: 'created_receivables'; receivableIds: string[] }
  | { kind: 'restored_payments'; items: Array<{ id: string; source: 'receivable' | 'debt'; paidAmount: number; status?: string }> };

export type PendingEventStatus = 'pending' | 'applied' | 'failed';

export interface PendingEvent {
  id: number;
  type: PendingEventType;
  payload: PendingEventPayload;
  status: PendingEventStatus;
  createdAt: string;
  appliedAt: string | null;
  undo?: UndoData | null;
}

// ─── Snapshot enviado pelo app ────────────────────────────────────────────────

export interface SnapshotItem {
  kind: 'receivable' | 'debt';
  id: string;
  description: string;
  remaining: number;
  date: string;
  origin: string;
}

export interface SnapshotPerson {
  memberId?: string;
  name: string;
  total: number;
  items: SnapshotItem[];
}

export interface Snapshot {
  people: SnapshotPerson[];
  /** Todos os membros cadastrados, inclusive quem não deve nada — usado no fuzzy match. */
  allMemberNames: string[];
  cardInvoice?: number;
  ownDebts?: number;
  currentMonth?: string;
  /** Resumo agregado (categorias, locais, parcelas, metas) que a IA usa para dicas e perguntas. */
  financeSummary?: unknown;
  updatedAt: string;
}

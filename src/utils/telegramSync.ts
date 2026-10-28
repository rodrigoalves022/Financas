export type TelegramEventType = 'registrar_divida' | 'marcar_pago' | 'racha' | 'desfazer' | 'importar_fatura';

/** Como reverter um evento — devolvido pelo app e guardado no servidor para o "desfazer". */
export type UndoData =
  | { kind: 'created_receivables'; receivableIds: string[] }
  | { kind: 'restored_payments'; items: Array<{ id: string; source: 'receivable' | 'debt'; paidAmount: number; status?: string }> };

export interface TelegramPendingEvent {
  id: number;
  type: TelegramEventType;
  payload: {
    personName?: string;
    amount?: number;
    description?: string;
    allowCreate?: boolean;
    personNames?: string[];
    shares?: number;
    targetEventId?: number;
    undo?: UndoData;
    /** importar_fatura: arquivo mandado no chat. */
    fileName?: string;
    content?: string;
    caption?: string;
  };
  status: 'pending' | 'applied' | 'failed';
  createdAt: string;
  appliedAt: string | null;
}

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

export interface SnapshotPayload {
  people: SnapshotPerson[];
  allMemberNames: string[];
  cardInvoice?: number;
  ownDebts?: number;
  currentMonth?: string;
  /** Resumo agregado para a IA do bot responder perguntas e dar dicas. */
  financeSummary?: unknown;
}

const normalizeBaseUrl = (baseUrl: string) => baseUrl.trim().replace(/\/$/, '');

const authHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

export const fetchPendingEvents = async (baseUrl: string, token: string): Promise<TelegramPendingEvent[]> => {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/pending-events`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(`Falha ao buscar eventos do Telegram (${response.status})`);
  const data = await response.json() as { events: TelegramPendingEvent[] };
  return data.events;
};

// Marca o evento como aplicado/falho no backend e faz o bot avisar no chat — fecha o ciclo.
export const reportEventResult = async (
  baseUrl: string,
  token: string,
  id: number,
  success: boolean,
  message: string,
  undo?: UndoData,
): Promise<void> => {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/pending-events/${id}/result`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ success, message, undo }),
  });
  if (!response.ok) throw new Error(`Falha ao reportar resultado do evento ${id} (${response.status})`);
};

/** Sem isso o bot é cego: é este resumo que permite responder consultas e sugerir nomes. */
export const pushSnapshot = async (baseUrl: string, token: string, snapshot: SnapshotPayload): Promise<void> => {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/snapshot`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw new Error(`Falha ao enviar snapshot (${response.status})`);
};

import { useSyncExternalStore } from 'react';
import { invoiceDueDate, type InvoiceStatement } from '../utils/analytics';
import { currentMonthISO, daysBetween, shiftMonth, todayISO } from '../utils/formatters';
import { FLAGS, readJsonFlag, writeFlag } from './storage';

export interface CardSettings {
  /** Dia do vencimento da fatura. */
  dueDay: number;
  /** Quantos dias antes do vencimento a fatura fecha (Inter: 8 → vence dia 7, melhor dia de compra 31). */
  closingDaysBefore: number;
  /** Limite total do cartão (0 = não informado). */
  limit: number;
}

export const DEFAULT_CARD_SETTINGS: CardSettings = { dueDay: 7, closingDaysBefore: 8, limit: 0 };

// Preferência por aparelho (localStorage), compartilhada entre telas sem contexto próprio.
const listeners = new Set<() => void>();
let cached: CardSettings = { ...DEFAULT_CARD_SETTINGS, ...readJsonFlag<Partial<CardSettings>>(FLAGS.card, {}) };

export const saveCardSettings = (settings: CardSettings) => {
  cached = settings;
  writeFlag(FLAGS.card, JSON.stringify(settings));
  listeners.forEach(listener => listener());
};

export const useCardSettings = () => useSyncExternalStore(
  listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  () => cached,
);

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T12:00:00`);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const dueDateOf = (month: string, settings: CardSettings) => invoiceDueDate(month, settings.dueDay);

/** Último dia de compras que entram na fatura do mês. */
export const closingDateOf = (month: string, settings: CardSettings) => addDays(dueDateOf(month, settings), -settings.closingDaysBefore);

/** "Melhor dia de compra": a partir dele, a compra só vence na fatura seguinte. */
export const bestPurchaseDateOf = (month: string, settings: CardSettings) => addDays(closingDateOf(month, settings), 1);

/** Fatura que está recebendo as compras de hoje. */
export const openInvoiceMonth = (settings: CardSettings, today = todayISO()) => {
  let month = currentMonthISO();
  for (let step = 0; step < 3; step += 1) {
    if (today <= closingDateOf(month, settings)) return month;
    month = shiftMonth(month, 1);
  }
  return month;
};

/**
 * CSV exportado antes de a fatura fechar: a última compra à vista fica dias antes do
 * fechamento. Foi o que aconteceu com a fatura 10/2026 (exportada em 08/09, fechou em 29/09).
 */
export const invoiceLooksIncomplete = (statement: InvoiceStatement, closingDate: string, today = todayISO()) =>
  today > closingDate && Boolean(statement.lastPurchase) && daysBetween(statement.lastPurchase as string, closingDate) > 4;

import { useSyncExternalStore } from 'react';
import { FLAGS, readFlag, writeFlag } from './storage';

/** Análises com o gasto total (cartão + contas fixas) ou só com o cartão — vale para todas as telas. */
export type SpendingScope = 'tudo' | 'cartao';

let scope: SpendingScope = readFlag(FLAGS.spendingScope) === 'cartao' ? 'cartao' : 'tudo';
const listeners = new Set<() => void>();

export const setSpendingScope = (next: SpendingScope) => {
  scope = next;
  writeFlag(FLAGS.spendingScope, next);
  listeners.forEach(listener => listener());
};

export const useSpendingScope = () => useSyncExternalStore(
  listener => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  () => scope,
);

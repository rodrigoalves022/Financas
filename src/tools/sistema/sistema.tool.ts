import { toolRegistry } from '../registry';
import { DEFAULT_CATEGORIES } from '../../utils/constants';
import { todayISO } from '../../utils/formatters';
import { DEFAULT_OWNER, FLAGS, STORAGE_KEYS, initialFinanceState, writeFlag } from '../../store/storage';
import { ensureOwner } from '../../store/migrations';
import type { FinanceState } from '../../store/actions';
import { clear as idbClear } from 'idb-keyval';

const BACKUP_FORMAT = 'financas-backup';

// ─── Exportar Dados em JSON ────────────────────────────────────────────────────

toolRegistry.register<void, { fileName: string }>({
  id: 'exportar_dados',
  name: 'Exportar dados em JSON',
  description: 'Gera um download em JSON contendo todos os dados cadastrados no aplicativo',
  category: 'sistema',
  execute: (_params, ctx) => {
    const payload = { format: BACKUP_FORMAT, version: 2, exportedAt: new Date().toISOString(), ...ctx.getState() };
    const fileName = `financas-backup-${todayISO()}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { fileName };
  },
});

// ─── Restaurar Backup ──────────────────────────────────────────────────────────

export interface BackupSummary {
  transactions: number;
  members: number;
  receivables: number;
  debts: number;
  incomes: number;
  exportedAt?: string;
}

/** Valida o JSON de backup e devolve o estado completo + um resumo para confirmação. */
export const readBackup = (raw: unknown): { state: FinanceState; summary: BackupSummary } => {
  if (!raw || typeof raw !== 'object') throw new Error('Arquivo não é um backup válido.');
  const data = raw as Partial<FinanceState> & { exportedAt?: string };
  if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) {
    throw new Error('Backup sem transações ou categorias — confira se é o arquivo exportado pelo app.');
  }
  const state = { ...initialFinanceState };
  (Object.keys(STORAGE_KEYS) as Array<keyof FinanceState>).forEach(key => {
    const value = data[key];
    if (Array.isArray(value)) (state as Record<keyof FinanceState, unknown>)[key] = value;
  });
  state.members = ensureOwner(state.members);
  return {
    state,
    summary: {
      transactions: state.transactions.length,
      members: state.members.length,
      receivables: state.receivables.length,
      debts: state.debts.length,
      incomes: state.monthlyIncomes.length,
      exportedAt: data.exportedAt,
    },
  };
};

toolRegistry.register<{ data: unknown }, BackupSummary>({
  id: 'restaurar_backup',
  name: 'Restaurar backup',
  description: 'Substitui todos os dados locais pelo conteúdo de um backup JSON exportado pelo app',
  category: 'sistema',
  execute: (params, ctx) => {
    const { state, summary } = readBackup(params.data);
    ctx.dispatch({ type: 'RESTORE_STATE', payload: state });
    return summary;
  },
});

// ─── Limpar Todos os Dados Locais ──────────────────────────────────────────────
// A confirmação fica na interface (diálogo próprio), não aqui.

toolRegistry.register<void, void>({
  id: 'limpar_dados',
  name: 'Limpar todos os dados locais',
  description: 'Apaga o IndexedDB e reseta todas as informações mantendo categorias padrão e o titular',
  category: 'sistema',
  execute: async (_params, ctx) => {
    writeFlag(FLAGS.userCleared, new Date().toISOString());
    await idbClear();
    ctx.dispatch({ type: 'RESET_ALL', payload: { categories: DEFAULT_CATEGORIES, members: [DEFAULT_OWNER] } });
    writeFlag(FLAGS.rulesBackfilled, null);
    writeFlag(FLAGS.installmentDatesFixed, null);
    writeFlag(FLAGS.telegramApplied, null);
    writeFlag(FLAGS.legacyVersion, 'user-cleared');
    writeFlag(FLAGS.incomeCleanup, 'true');
  },
});

// ─── Retomar importação automática ─────────────────────────────────────────────

toolRegistry.register<void, void>({
  id: 'retomar_importacao_automatica',
  name: 'Retomar importação automática',
  description: 'Volta a importar as faturas de public/faturas ao abrir o app (pausada após limpar os dados)',
  category: 'sistema',
  execute: () => {
    writeFlag(FLAGS.userCleared, null);
  },
});

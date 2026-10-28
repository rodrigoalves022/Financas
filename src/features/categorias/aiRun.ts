import { useSyncExternalStore } from 'react';
import { batchSizeFor, categorizeWithAi, type AiMerchantInput, type AiServerConfig, type AiSettings, type AiSuggestion } from '../../utils/aiClient';
import { merchantKeyword } from '../../utils/merchant';
import { FLAGS, readJsonFlag, writeFlag } from '../../store/storage';

// A rodada do assistente vive fora do componente: com o Opus, 200 locais levam vários
// minutos, e trocar de aba desmontava a tela — as respostas da IA chegavam e eram
// descartadas. Aqui ela continua rodando e as sugestões ficam salvas até aplicar/descartar.

export interface AiSuggestionRow extends AiSuggestion {
  merchant: AiMerchantInput;
  selected: boolean;
  /** Valor do select: id de categoria existente ou "new:<nome>". */
  target: string;
}

export interface AiRunOutcome {
  tone: 'good' | 'warn' | 'bad';
  message: string;
}

export interface AiRunState {
  rows: AiSuggestionRow[];
  progress: { done: number; total: number; startedAt: number } | null;
  outcome: AiRunOutcome | null;
}

const persisted = readJsonFlag<Pick<AiRunState, 'rows' | 'outcome'>>(FLAGS.aiSuggestions, { rows: [], outcome: null });
let state: AiRunState = { rows: Array.isArray(persisted.rows) ? persisted.rows : [], outcome: persisted.outcome || null, progress: null };
let cancelRequested = false;
const listeners = new Set<() => void>();

const setState = (patch: Partial<AiRunState> | ((current: AiRunState) => Partial<AiRunState>)) => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  writeFlag(FLAGS.aiSuggestions, state.rows.length || state.outcome ? JSON.stringify({ rows: state.rows, outcome: state.outcome }) : null);
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useAiRun = () => useSyncExternalStore(subscribe, () => state, () => state);

export const updateAiRows = (update: (rows: AiSuggestionRow[]) => AiSuggestionRow[]) => setState(current => ({ rows: update(current.rows) }));
export const discardAiRun = () => setState({ rows: [], outcome: null });
export const setAiOutcome = (outcome: AiRunOutcome | null) => setState({ outcome });
export const cancelAiRun = () => { cancelRequested = true; };

const minutes = (ms: number) => {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, '0')}s`;
};

export const startAiRun = async ({ merchants, categories, allowNew, settings, server }: {
  merchants: AiMerchantInput[];
  categories: Array<{ id: string; name: string; keywords?: string[] }>;
  allowNew: boolean;
  settings: AiSettings;
  server: AiServerConfig;
}) => {
  if (state.progress || !merchants.length) return;
  cancelRequested = false;
  const size = batchSizeFor(settings.model);
  const batches: AiMerchantInput[][] = [];
  for (let index = 0; index < merchants.length; index += size) batches.push(merchants.slice(index, index + size));
  const startedAt = Date.now();
  setState({ rows: [], outcome: null, progress: { done: 0, total: batches.length, startedAt } });

  const byKey = new Map(merchants.map(merchant => [merchant.key, merchant]));
  const failures: string[] = [];
  let answered = 0;
  let done = 0;
  let stopped = false;

  // Um lote que falha (timeout, resposta quebrada) não derruba os outros.
  for (let index = 0; index < batches.length; index += 1) {
    if (cancelRequested) {
      stopped = true;
      break;
    }
    try {
      const response = await categorizeWithAi(settings, server, { merchants: batches[index], categories, allowNewCategories: allowNew });
      const batchRows: AiSuggestionRow[] = response.suggestions.flatMap(suggestion => {
        const merchant = byKey.get(suggestion.key);
        if (!merchant) return [];
        const target = suggestion.categoryId || (suggestion.newCategoryName ? `new:${suggestion.newCategoryName}` : merchant.currentCategoryId || 'outros');
        return [{
          ...suggestion,
          keyword: suggestion.keyword || merchantKeyword(merchant.samples[0] || merchant.name),
          merchant,
          target,
          selected: target !== merchant.currentCategoryId && suggestion.confidence !== 'baixa',
        }];
      });
      answered += batchRows.length;
      setState(current => ({ rows: [...current.rows, ...batchRows] }));
    } catch (error) {
      failures.push(`lote ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
    done = index + 1;
    setState(current => ({ progress: current.progress ? { ...current.progress, done } : null }));
  }

  const elapsed = minutes(Date.now() - startedAt);
  const changes = state.rows.filter(row => row.target !== row.merchant.currentCategoryId).length;
  let outcome: AiRunOutcome;
  if (failures.length === batches.length) {
    outcome = { tone: 'bad', message: `Nenhum lote funcionou (${elapsed}). ${failures[0]}` };
  } else if (failures.length) {
    outcome = { tone: 'warn', message: `${answered} sugestão(ões) em ${elapsed}, mas ${failures.length} de ${batches.length} lote(s) falharam — aplique as que quiser e rode de novo para pegar os que faltaram. ${failures[0]}` };
  } else if (stopped) {
    outcome = { tone: 'warn', message: `Parado depois de ${done} de ${batches.length} lote(s): ${answered} sugestão(ões) em ${elapsed}.` };
  } else if (!answered) {
    outcome = { tone: 'warn', message: `A IA respondeu em ${elapsed}, mas sem sugestões aproveitáveis. Tente outro modelo ou escopo.` };
  } else {
    outcome = { tone: 'good', message: `${answered} sugestão(ões) em ${elapsed} · ${changes} mudam a categoria atual. Revise abaixo e clique em "Aplicar".` };
  }
  setState({ progress: null, outcome });
};

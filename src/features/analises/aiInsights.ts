import { useSyncExternalStore } from 'react';
import { analyzeWithAi, type AiInsight, type AiServerConfig, type AiSettings } from '../../utils/aiClient';
import { FLAGS, readJsonFlag, writeFlag } from '../../store/storage';

// As dicas da IA ficam fora dos componentes, como a rodada do assistente de categorias:
// o Painel e a aba Análises mostram o mesmo resultado, a análise continua se a pessoa
// trocar de página no meio, e a última leitura fica salva até ser refeita.

export interface SavedInsights {
  /** Mês de fatura analisado (AAAA-MM). */
  month: string;
  generatedAt: string;
  modelLabel: string;
  seconds: number;
  insights: AiInsight[];
  question?: string;
  answer?: string;
}

export interface AiInsightsState {
  result: SavedInsights | null;
  running: { startedAt: number; month: string } | null;
  error: string | null;
}

const saved = readJsonFlag<SavedInsights | null>(FLAGS.aiInsights, null);
let state: AiInsightsState = { result: saved && Array.isArray(saved.insights) ? saved : null, running: null, error: null };
const listeners = new Set<() => void>();

const setState = (patch: Partial<AiInsightsState>) => {
  state = { ...state, ...patch };
  if ('result' in patch) writeFlag(FLAGS.aiInsights, state.result ? JSON.stringify(state.result) : null);
  listeners.forEach(listener => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useAiInsights = () => useSyncExternalStore(subscribe, () => state, () => state);

export const runAiInsights = async ({ settings, server, summary, month, question, modelLabel }: {
  settings: AiSettings;
  server: AiServerConfig;
  summary: unknown;
  month: string;
  question?: string;
  modelLabel: string;
}) => {
  if (state.running) return;
  setState({ running: { startedAt: Date.now(), month }, error: null });
  try {
    const response = await analyzeWithAi(settings, server, { summary, question });
    setState({
      running: null,
      result: {
        month,
        generatedAt: new Date().toISOString(),
        modelLabel,
        seconds: Math.round(response.durationMs / 1000),
        insights: response.insights,
        question,
        answer: response.answer,
      },
    });
  } catch (error) {
    setState({ running: null, error: error instanceof Error ? error.message : String(error) });
  }
};

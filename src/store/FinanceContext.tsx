/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { get, set as idbSet } from 'idb-keyval';
import { fetchPendingEvents, pushSnapshot, reportEventResult } from '../utils/telegramSync';
import { financeReducer } from './reducer';
import type { FinanceAction, FinanceState } from './actions';
import { autoImportFaturas, backfillCategorySource, backfillRawCategories, recoverMissingTransactions, resyncLocalFaturas, runLegacyMigration, runLocalMigrations } from './migrations';
import { FLAGS, STORAGE_KEYS, initialFinanceState, readFlag, readJsonFlag, writeFlag } from './storage';
import { applyTelegramEvents, applyTelegramFatura, buildTelegramSnapshot, type TelegramEventResult } from './telegramEvents';

export interface FinanceContextType extends FinanceState {
  dispatch: (action: FinanceAction) => void;
  /** Estado mais recente, inclusive mudanças despachadas e ainda não renderizadas. */
  getState: () => FinanceState;
  /** Migrações e auto-import terminaram. */
  isReady: boolean;
  autoImportStatus: string;
  resyncFaturas: () => Promise<void>;
  resyncStatus: string;
  telegramSyncUrl: string;
  telegramSyncToken: string;
  setTelegramSyncUrl: (url: string) => void;
  setTelegramSyncToken: (token: string) => void;
  telegramSyncStatus: string;
  telegramLastSyncAt: string;
  syncTelegram: () => Promise<void>;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const STATE_KEYS = Object.keys(STORAGE_KEYS) as Array<keyof FinanceState>;

export const FinanceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, rawDispatch] = useReducer(financeReducer, initialFinanceState);
  // O reducer é puro: aplicar a mesma ação no ref e no React chega no mesmo estado.
  // Com isso, ferramentas que despacham e leem em sequência (ou depois de um await)
  // enxergam o valor atual — antes liam o estado congelado do último render e
  // sobrescreviam mudanças feitas nesse meio-tempo.
  const stateRef = useRef(state);
  const dispatch = useCallback((action: FinanceAction) => {
    stateRef.current = financeReducer(stateRef.current, action);
    rawDispatch(action);
  }, []);
  const getState = useCallback(() => stateRef.current, []);

  const [isDbLoaded, setIsDbLoaded] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [autoImportStatus, setAutoImportStatus] = useState('Aguardando faturas');
  const [resyncStatus, setResyncStatus] = useState('');
  const [telegramSyncUrl, setTelegramSyncUrlState] = useState(() => readFlag(FLAGS.telegramUrl) || '');
  const [telegramSyncToken, setTelegramSyncTokenState] = useState(() => readFlag(FLAGS.telegramToken) || '');
  const [telegramSyncStatus, setTelegramSyncStatus] = useState('Nunca sincronizado');
  const [telegramLastSyncAt, setTelegramLastSyncAt] = useState('');

  // StrictMode roda efeitos duas vezes no dev: um segundo carregamento chegando depois
  // das migrações sobrescreveria o que elas acabaram de gravar.
  const loadStartedRef = useRef(false);
  useEffect(() => {
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;
    const loadDatabase = async () => {
      const loadKey = async <T,>(key: string, fallback: T): Promise<T> => {
        try {
          const value = await get(key);
          if (value !== undefined) return value as T;
          const legacy = localStorage.getItem(key);
          if (legacy) {
            const parsed = JSON.parse(legacy) as T;
            await idbSet(key, parsed);
            return parsed;
          }
          return fallback;
        } catch {
          return fallback;
        }
      };

      const loaded = { ...initialFinanceState };
      for (const key of STATE_KEYS) {
        (loaded as Record<keyof FinanceState, unknown>)[key] = await loadKey(STORAGE_KEYS[key], initialFinanceState[key]);
      }
      dispatch({ type: 'RESTORE_STATE', payload: loaded });
      setIsDbLoaded(true);
    };
    loadDatabase();
  }, [dispatch]);

  // Grava só as fatias que mudaram desde a última gravação.
  const persistedRef = useRef<FinanceState | null>(null);
  useEffect(() => {
    if (!isDbLoaded) return;
    const previous = persistedRef.current;
    STATE_KEYS.forEach(key => {
      if (!previous || previous[key] !== state[key]) idbSet(STORAGE_KEYS[key], state[key]).catch(() => undefined);
    });
    persistedRef.current = state;
  }, [state, isDbLoaded]);

  // Migrações em sequência, só depois do banco carregado. Antes cada uma era um efeito
  // solto e algumas rodavam em paralelo ao carregamento do IndexedDB, podendo misturar
  // estado vazio com estado salvo. O ref garante uma execução só (StrictMode monta duas vezes).
  const migrationsStartedRef = useRef(false);
  useEffect(() => {
    if (!isDbLoaded || migrationsStartedRef.current) return;
    migrationsStartedRef.current = true;
    const store = { getState, dispatch };
    (async () => {
      const legacyStatus = await runLegacyMigration(store);
      runLocalMigrations(store);
      try {
        const importStatus = await autoImportFaturas(store);
        setAutoImportStatus(legacyStatus && !readFlag(FLAGS.userCleared) ? `${legacyStatus} · ${importStatus}` : importStatus);
      } catch {
        setAutoImportStatus('Importação automática indisponível');
      }
      await recoverMissingTransactions(store);
      await backfillRawCategories(store);
      backfillCategorySource(store);
      setIsReady(true);
    })();
  }, [isDbLoaded, dispatch, getState]);

  const resyncFaturas = useCallback(async () => {
    setResyncStatus('Ressincronizando faturas...');
    try {
      setResyncStatus(await resyncLocalFaturas({ getState, dispatch }));
    } catch {
      setResyncStatus('Falha ao ressincronizar faturas.');
    }
  }, [dispatch, getState]);

  const setTelegramSyncUrl = useCallback((url: string) => {
    setTelegramSyncUrlState(url);
    writeFlag(FLAGS.telegramUrl, url);
  }, []);
  const setTelegramSyncToken = useCallback((token: string) => {
    setTelegramSyncTokenState(token);
    writeFlag(FLAGS.telegramToken, token);
  }, []);

  const syncingRef = useRef(false);
  const syncTelegram = useCallback(async () => {
    if (!telegramSyncUrl || !telegramSyncToken) {
      setTelegramSyncStatus('Configure a URL e o token do servidor para sincronizar');
      return;
    }
    if (syncingRef.current) return;
    syncingRef.current = true;
    setTelegramSyncStatus('Sincronizando...');
    try {
      const events = await fetchPendingEvents(telegramSyncUrl, telegramSyncToken);

      // Eventos já aplicados aqui mas cujo resultado não chegou ao servidor (queda de rede)
      // voltam como "pendentes". Sem este registro local, seriam aplicados de novo —
      // duplicando cobranças.
      const applied = readJsonFlag<Record<string, TelegramEventResult>>(FLAGS.telegramApplied, {});
      const fresh = events.filter(event => !applied[event.id]);
      const results: TelegramEventResult[] = events.filter(event => applied[event.id]).map(event => applied[event.id]);

      // Faturas mandadas no chat: assíncronas (parse do CSV) e independentes das cobranças.
      for (const event of fresh.filter(item => item.type === 'importar_fatura')) {
        const result = await applyTelegramFatura({ getState, dispatch }, event);
        applied[result.id] = result;
        writeFlag(FLAGS.telegramApplied, JSON.stringify(applied));
        results.push(result);
      }

      const debtEvents = fresh.filter(item => item.type !== 'importar_fatura');
      if (debtEvents.length) {
        const outcome = applyTelegramEvents(getState(), debtEvents);
        dispatch({ type: 'SET_MEMBERS', payload: outcome.members });
        dispatch({ type: 'SET_RECEIVABLES', payload: outcome.receivables });
        dispatch({ type: 'SET_DEBTS', payload: outcome.debts });
        outcome.results.forEach(result => { applied[result.id] = result; });
        writeFlag(FLAGS.telegramApplied, JSON.stringify(applied));
        results.push(...outcome.results);
      }

      await Promise.all(results.map(async result => {
        try {
          await reportEventResult(telegramSyncUrl, telegramSyncToken, result.id, result.success, result.message, result.undo);
          delete applied[result.id];
        } catch {
          // fica registrado e é reenviado no próximo ciclo, sem reaplicar
        }
      }));
      writeFlag(FLAGS.telegramApplied, JSON.stringify(applied));

      // O snapshot vai em toda sincronização, mesmo sem eventos: é ele que mantém o bot
      // capaz de responder consultas e sugerir nomes.
      await pushSnapshot(telegramSyncUrl, telegramSyncToken, buildTelegramSnapshot(getState())).catch(() => undefined);
      setTelegramLastSyncAt(new Date().toISOString());

      const newResults = results.filter(result => fresh.some(event => event.id === result.id));
      if (!newResults.length) {
        setTelegramSyncStatus('Em dia — nenhum evento novo');
        return;
      }
      const successCount = newResults.filter(item => item.success).length;
      const failureCount = newResults.length - successCount;
      setTelegramSyncStatus(failureCount ? `${successCount} evento(s) aplicado(s), ${failureCount} com erro` : `${successCount} evento(s) aplicado(s)`);
    } catch {
      setTelegramSyncStatus('Falha ao conectar no servidor do Telegram');
    } finally {
      syncingRef.current = false;
    }
  }, [telegramSyncUrl, telegramSyncToken, dispatch, getState]);

  useEffect(() => {
    if (!isReady || !telegramSyncUrl || !telegramSyncToken) return;
    const timer = window.setTimeout(() => { syncTelegram(); }, 0);
    const interval = window.setInterval(() => { syncTelegram(); }, 15000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(interval);
    };
  }, [isReady, telegramSyncUrl, telegramSyncToken, syncTelegram]);

  const value = useMemo<FinanceContextType>(() => ({
    ...state,
    dispatch,
    getState,
    isReady,
    autoImportStatus,
    resyncFaturas,
    resyncStatus,
    telegramSyncUrl,
    telegramSyncToken,
    setTelegramSyncUrl,
    setTelegramSyncToken,
    telegramSyncStatus,
    telegramLastSyncAt,
    syncTelegram,
  }), [state, dispatch, getState, isReady, autoImportStatus, resyncFaturas, resyncStatus, telegramSyncUrl, telegramSyncToken, setTelegramSyncUrl, setTelegramSyncToken, telegramSyncStatus, telegramLastSyncAt, syncTelegram]);

  return (
    <FinanceContext.Provider value={value}>
      {isDbLoaded ? children : (
        <div className="boot-screen">
          <div className="boot-logo" />
          <strong>Carregando seus dados…</strong>
        </div>
      )}
    </FinanceContext.Provider>
  );
};

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within FinanceProvider');
  return context;
};

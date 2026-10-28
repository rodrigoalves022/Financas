/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useState } from 'react';
import { Bot, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import {
  AI_PROVIDER_LABELS, ANTIGRAVITY_FALLBACK_MODELS, CLAUDE_MODELS, DEFAULT_AI_MODEL, aiDisplayName, getAiStatus, loadAiSettings, providerStatus, saveAiSettings,
  type AiProvider, type AiSettings, type AiStatus,
} from '../utils/aiClient';
import { Field } from './ui/Card';

/** Preferências do modo IA (provedor, modelo e onde o CLI roda) + verificação de disponibilidade. */
export function useAiSettings({ autoCheck = true }: { autoCheck?: boolean } = {}) {
  const { telegramSyncUrl, telegramSyncToken } = useFinance();
  const [settings, setSettingsState] = useState<AiSettings>(loadAiSettings);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const server = { url: telegramSyncUrl, token: telegramSyncToken };

  const setSettings = (next: AiSettings) => {
    setSettingsState(next);
    saveAiSettings(next);
  };

  // O status traz os dois provedores de uma vez: trocar de provedor ou modelo não precisa
  // consultar de novo, só trocar de onde o CLI roda.
  const endpoint = settings.endpoint;
  const check = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await getAiStatus({ ...loadAiSettings(), endpoint }, { url: telegramSyncUrl, token: telegramSyncToken }));
    } catch (error) {
      setStatus({ available: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      setChecking(false);
    }
  }, [endpoint, telegramSyncUrl, telegramSyncToken]);

  // Telas que só disparam a IA (o card do Painel) não precisam rodar os CLIs a cada visita.
  useEffect(() => {
    if (!autoCheck) return;
    const timer = window.setTimeout(() => { check(); }, 0);
    return () => window.clearTimeout(timer);
  }, [check, autoCheck]);

  const current = providerStatus(status, settings.provider);
  const antigravityModels = providerStatus(status, 'antigravity')?.models;
  const models = settings.provider === 'claude' ? CLAUDE_MODELS : antigravityModels?.length ? antigravityModels : ANTIGRAVITY_FALLBACK_MODELS;
  const displayName = aiDisplayName(settings, models);

  return { settings, setSettings, server, status, current, models, displayName, checking, check };
}

export function AiSettingsControls({ ai }: { ai: ReturnType<typeof useAiSettings> }) {
  const { settings, setSettings, current, models, checking, check } = ai;
  const providerName = settings.provider === 'claude' ? 'Claude' : 'Antigravity';
  // Modelo salvo que a conta não oferece mais continua visível em vez de sumir do select.
  const options = models.some(option => option.id === settings.model) ? models : [{ id: settings.model, label: settings.model }, ...models];
  return (
    <div className="ai-controls">
      <Field label="IA">
        <select value={settings.provider} onChange={event => {
          const provider = event.target.value as AiProvider;
          setSettings({ ...settings, provider, model: DEFAULT_AI_MODEL[provider] });
        }}>
          {(Object.keys(AI_PROVIDER_LABELS) as AiProvider[]).map(provider => <option key={provider} value={provider}>{AI_PROVIDER_LABELS[provider]}</option>)}
        </select>
      </Field>
      <Field label="Modelo">
        <select value={settings.model} onChange={event => setSettings({ ...settings, model: event.target.value })}>
          {options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </Field>
      <Field label="Onde roda">
        <select value={settings.endpoint} onChange={event => setSettings({ ...settings, endpoint: event.target.value as AiSettings['endpoint'] })}>
          <option value="local">Este computador (npm run dev)</option>
          <option value="server">Servidor do Telegram</option>
        </select>
      </Field>
      <button type="button" className="secondary-button" onClick={check} disabled={checking} title={current?.error || current?.version}>
        {checking ? <Loader2 size={15} className="spin" /> : current?.available ? <CheckCircle2 size={15} className="text-good" /> : current ? <XCircle size={15} className="text-bad" /> : <Bot size={15} />}
        {checking ? 'Verificando…' : current?.available ? `${providerName} conectado` : current ? `${providerName} indisponível` : 'Testar conexão'}
      </button>
    </div>
  );
}

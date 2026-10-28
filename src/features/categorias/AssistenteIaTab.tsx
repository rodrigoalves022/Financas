import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bot, Check, CheckCircle2, Loader2, Sparkles, Square, Trash2, XCircle } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { applyAlias, filterByMonth } from '../../utils/analytics';
import { batchSizeFor, type AiMerchantInput } from '../../utils/aiClient';
import { isLowConfidence } from '../../utils/categorizer';
import { formatBRL, formatMonth, titleCase } from '../../utils/formatters';
import { AiSettingsControls, useAiSettings } from '../../components/AiSettings';
import { Badge, Card, CategoryDot, Field, ProgressBar } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useFeedback } from '../../components/ui/feedback';
import type { ApplySuggestionsResult } from '../../tools/ia/ia.tool';
import type { Transaction } from '../../types';
import { cancelAiRun, discardAiRun, setAiOutcome, startAiRun, updateAiRows, useAiRun, type AiSuggestionRow } from './aiRun';

type Scope = 'revisar' | 'mes' | 'todos';
const MAX_MERCHANTS = 240;

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

const mostCommon = (values: Array<string | undefined>) => {
  const counts = new Map<string, number>();
  values.forEach(value => { if (value) counts.set(value, (counts.get(value) || 0) + 1); });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
};

export function AssistenteIaTab({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, aliases } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const ai = useAiSettings();
  const [scope, setScope] = useState<Scope>('revisar');
  const [allowNew, setAllowNew] = useState(true);
  const { rows, progress, outcome } = useAiRun();
  const [applying, setApplying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const running = Boolean(progress);

  // Relógio da rodada: com o Opus um lote passa de um minuto e a tela parecia travada.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const merchants = useMemo<AiMerchantInput[]>(() => {
    const base: Transaction[] = scope === 'mes' && selectedMonth ? filterByMonth(transactions, selectedMonth) : transactions;
    const candidates = base.filter(item => item.type === 'expense' && !item.manualCategory && (scope !== 'revisar' || isLowConfidence(item.categorySource)));
    const groups = new Map<string, Transaction[]>();
    candidates.forEach(item => {
      const key = applyAlias(item.description, aliases);
      groups.set(key, [...(groups.get(key) || []), item]);
    });
    return Array.from(groups.entries())
      .map(([key, items]) => ({
        key,
        name: key,
        samples: Array.from(new Set(items.map(item => item.description))).slice(0, 3),
        count: items.length,
        total: items.reduce((sum, item) => sum + item.amount, 0),
        currentCategoryId: mostCommon(items.map(item => item.categoryId)),
        rawCategory: mostCommon(items.map(item => item.rawCategory)),
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_MERCHANTS);
  }, [transactions, aliases, scope, selectedMonth]);

  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);

  const run = () => {
    setNow(Date.now());
    startAiRun({
      merchants,
      categories: categories.map(category => ({ id: category.id, name: category.name, keywords: category.keywords.slice(0, 8) })),
      allowNew,
      settings: ai.settings,
      server: ai.server,
    });
  };

  const update = (key: string, patch: Partial<AiSuggestionRow>) => updateAiRows(previous => previous.map(row => row.key === key ? { ...row, ...patch } : row));
  const setRows = (update: (rows: AiSuggestionRow[]) => AiSuggestionRow[]) => updateAiRows(update);
  const selected = rows.filter(row => row.selected && row.keyword.trim());
  const newCategoryNames = Array.from(new Set(rows.filter(row => row.target.startsWith('new:')).map(row => row.target.slice(4))));

  const apply = async () => {
    setApplying(true);
    const result = await callTool<ApplySuggestionsResult>('aplicar_sugestoes_ia', {
      suggestions: selected.map(row => row.target.startsWith('new:')
        ? { keyword: row.keyword, newCategoryName: row.target.slice(4) }
        : { keyword: row.keyword, categoryId: row.target }),
    });
    setApplying(false);
    if (!result.success || !result.data) {
      toast(result.message, 'error');
      return;
    }
    const created = result.data.createdCategories.length ? ` · categorias criadas: ${result.data.createdCategories.join(', ')}` : '';
    const message = `${result.data.rules} regra(s) criada(s), ${result.data.changed} lançamento(s) recategorizado(s)${created}.`;
    toast(message);
    const remaining = rows.length - rows.filter(row => row.selected).length;
    setAiOutcome({ tone: 'good', message: `Aplicado: ${message}${remaining ? ` As ${remaining} sugestão(ões) não marcadas continuam abaixo.` : ''}` });
    setRows(previous => previous.filter(row => !row.selected));
  };

  const batchSize = batchSizeFor(ai.settings.model);
  const OutcomeIcon = outcome?.tone === 'good' ? CheckCircle2 : outcome?.tone === 'bad' ? XCircle : AlertTriangle;

  return (
    <div className="page-grid">
      <Card span="full" icon={<Bot size={17} />} title="Assistente de categorização com IA"
        subtitle="A IA lê o nome de cada estabelecimento (não os valores individuais) e sugere categoria e palavra-chave. Você revisa antes de aplicar — cada sugestão aceita vira uma regra para as próximas faturas.">
        <div className="ai-hero">
          <div className="grow">
            <h4>{merchants.length} estabelecimento(s) para analisar</h4>
            <p>Roda pelo {ai.settings.provider === 'claude' ? 'Claude Code' : 'Antigravity'} instalado neste computador (sua assinatura, sem chave de API) · {ai.displayName} · {Math.ceil(merchants.length / batchSize) || 0} lote(s) de até {batchSize}. Pode trocar de aba enquanto roda.</p>
          </div>
          <AiSettingsControls ai={ai} />
        </div>
        <div className="inline-form" style={{ marginTop: 16 }}>
          <Field label="O que analisar">
            <select value={scope} onChange={event => setScope(event.target.value as Scope)}>
              <option value="revisar">Só os incertos (sem regra ou pela categoria do banco)</option>
              <option value="mes" disabled={!selectedMonth}>Todos da fatura {selectedMonth ? formatMonth(selectedMonth) : '(escolha um mês)'}</option>
              <option value="todos">Todos os estabelecimentos</option>
            </select>
          </Field>
          <label className="check-line" style={{ minHeight: 40 }}>
            <input type="checkbox" checked={allowNew} onChange={event => setAllowNew(event.target.checked)} />
            Pode sugerir categorias novas
          </label>
          {running ? (
            <button type="button" className="secondary-button" onClick={cancelAiRun}><Square size={14} /> Parar</button>
          ) : (
            <button type="button" className="primary-button" onClick={run} disabled={!merchants.length}><Sparkles size={16} /> Sugerir categorias</button>
          )}
        </div>
        {progress ? (
          <div className="ai-progress">
            <span className="muted" style={{ fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Loader2 size={14} className="spin" /> Lote {Math.min(progress.done + 1, progress.total)} de {progress.total} · {clock(now - progress.startedAt)} · {rows.length} sugestão(ões) até agora — cada lote leva de 30s a 2min.
            </span>
            <ProgressBar value={(progress.done / progress.total) * 100} tone="accent" />
          </div>
        ) : null}
        {outcome && !running ? (
          <div className={`notice ${outcome.tone}`} style={{ marginTop: 14 }}>
            <OutcomeIcon size={16} />
            <span>{outcome.message}</span>
          </div>
        ) : null}
      </Card>

      {rows.length ? (
        <Card span="full" title={`${rows.length} sugestão(ões)`} subtitle="Ajuste a categoria ou a palavra-chave se quiser. Confiança baixa vem desmarcada."
          actions={(
            <>
              <button type="button" className="ghost-button" onClick={() => setRows(previous => previous.map(row => ({ ...row, selected: true })))}>Marcar todas</button>
              <button type="button" className="ghost-button" onClick={() => setRows(previous => previous.map(row => ({ ...row, selected: false })))}>Desmarcar</button>
              <button type="button" className="ghost-button" onClick={discardAiRun} disabled={running} title="Descartar todas as sugestões"><Trash2 size={15} /> Descartar</button>
              <button type="button" className="primary-button" onClick={apply} disabled={!selected.length || applying || running}>
                {applying ? <Loader2 size={15} className="spin" /> : <Check size={15} />} Aplicar {selected.length}
              </button>
            </>
          )}>
          <div className="ai-table">
            <div className="ai-row head">
              <span />
              <span>Estabelecimento</span>
              <span>Categoria sugerida</span>
              <span>Palavra-chave da regra</span>
              <span>Por quê</span>
            </div>
            {rows.map(row => {
              const current = row.merchant.currentCategoryId ? categoryById.get(row.merchant.currentCategoryId) : undefined;
              return (
                <div className="ai-row" key={row.key}>
                  <input type="checkbox" checked={row.selected} onChange={event => update(row.key, { selected: event.target.checked })} aria-label={`Aplicar sugestão para ${row.merchant.name}`} />
                  <div className="merchant">
                    <strong title={row.merchant.samples.join('\n')}>{titleCase(row.merchant.name)}</strong>
                    <small>{row.merchant.count} compra(s) · {formatBRL(row.merchant.total)} · hoje: {current ? current.name : '—'}</small>
                  </div>
                  <select value={row.target} onChange={event => update(row.key, { target: event.target.value, selected: true })}>
                    {newCategoryNames.map(name => <option key={`new:${name}`} value={`new:${name}`}>✚ Nova: {name}</option>)}
                    {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                  <input value={row.keyword} onChange={event => update(row.key, { keyword: event.target.value })} />
                  <span className="reason">
                    <Badge tone={row.confidence === 'alta' ? 'good' : row.confidence === 'media' ? 'warn' : 'neutral'}>{row.confidence}</Badge>{' '}
                    {row.target.startsWith('new:') ? null : <CategoryDot color={categoryById.get(row.target)?.color || '#94a3b8'} />} {row.reason}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ) : !running ? (
        <Card span="full">
          <EmptyState icon={<Sparkles size={22} />} title={merchants.length ? 'Pronto para sugerir' : 'Nada incerto por aqui'}
            description={merchants.length ? 'Clique em "Sugerir categorias". As sugestões aparecem aqui para revisão.' : 'Todos os lançamentos já têm regra ou categoria escolhida por você. Mude o escopo para revisar tudo.'} />
        </Card>
      ) : null}
    </div>
  );
}

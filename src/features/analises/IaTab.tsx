import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Loader2, MessageSquareText, Sparkles, XCircle } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { getLatestInvoiceMonth } from '../../utils/analytics';
import { buildFinanceSummary } from '../../utils/aiSummary';
import { formatDateTime, formatMonth, formatMonthLong } from '../../utils/formatters';
import { AiSettingsControls, useAiSettings } from '../../components/AiSettings';
import { AiInsightList } from '../../components/AiInsightList';
import { Card } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { runAiInsights, useAiInsights } from './aiInsights';

export function IaTab({ selectedMonth }: { selectedMonth: string }) {
  const finance = useFinance();
  const ai = useAiSettings();
  const { result, running, error } = useAiInsights();
  const [question, setQuestion] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const focusMonth = selectedMonth || getLatestInvoiceMonth(finance.transactions);
  const summary = useMemo(() => buildFinanceSummary(finance, focusMonth), [finance, focusMonth]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const run = (event?: FormEvent) => {
    event?.preventDefault();
    setNow(Date.now());
    runAiInsights({ settings: ai.settings, server: ai.server, summary, month: focusMonth, question: question.trim() || undefined, modelLabel: ai.displayName });
  };

  if (!finance.transactions.length) return <EmptyState title="Sem dados para analisar" description="Importe faturas primeiro." />;

  return (
    <div className="page-grid">
      <Card span="full" icon={<Sparkles size={17} />} title="Análise com IA" subtitle={`A IA lê um resumo agregado de ${formatMonthLong(focusMonth)} (categorias, locais, parcelas futuras, metas, histórico) — nenhuma compra individual é enviada.`}>
        <div className="ai-hero">
          <div className="grow">
            <h4>Peça uma leitura da sua fatura</h4>
            <p>Usa o {ai.settings.provider === 'claude' ? 'Claude Code' : 'Antigravity'} instalado no computador (sua assinatura, sem chave de API) · {ai.displayName}. Leva de 10 a 60 segundos; pode trocar de página enquanto isso.</p>
          </div>
          <AiSettingsControls ai={ai} />
        </div>
        <form className="inline-form" style={{ marginTop: 16 }} onSubmit={run}>
          <label className="field">
            <span className="field-label">Pergunta opcional</span>
            <input value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ex.: onde consigo economizar R$ 300 no mês que vem?" />
          </label>
          <button type="submit" className="primary-button" disabled={Boolean(running)}>
            {running ? <Loader2 size={16} className="spin" /> : <MessageSquareText size={16} />}
            {running ? `Analisando… ${Math.max(0, Math.floor((now - running.startedAt) / 1000))}s` : `Analisar com ${ai.displayName}`}
          </button>
        </form>
        {error && !running ? <div className="notice bad" style={{ marginTop: 14 }}><XCircle size={16} /><span>{error}</span></div> : null}
      </Card>

      {result ? (
        <Card span="full" title="O que a IA encontrou" subtitle={`${formatMonth(result.month)} · ${result.modelLabel} · ${result.seconds}s · gerado em ${formatDateTime(result.generatedAt)}`}>
          {result.answer ? (
            <div className="notice" style={{ marginBottom: 12 }}>
              <MessageSquareText size={16} />
              <span>{result.question ? <><strong>{result.question}</strong><br /></> : null}{result.answer}</span>
            </div>
          ) : null}
          <AiInsightList insights={result.insights} />
        </Card>
      ) : null}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Lightbulb, Loader2, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { getLatestInvoiceMonth } from '../../utils/analytics';
import { buildFinanceSummary } from '../../utils/aiSummary';
import { formatDateTime, formatMonthLong } from '../../utils/formatters';
import { useAiSettings } from '../../components/AiSettings';
import { AiInsightList } from '../../components/AiInsightList';
import { Card } from '../../components/ui/Card';
import { runAiInsights, useAiInsights } from '../analises/aiInsights';

/** Dicas da IA no Painel: a última leitura salva e um botão para refazer com o mês aberto. */
export function AiTipsCard({ selectedMonth }: { selectedMonth: string }) {
  const finance = useFinance();
  const ai = useAiSettings({ autoCheck: false });
  const { result, running, error } = useAiInsights();
  const [now, setNow] = useState(() => Date.now());
  const latestMonth = getLatestInvoiceMonth(finance.transactions);
  const month = selectedMonth || latestMonth;

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const run = () => {
    setNow(Date.now());
    runAiInsights({ settings: ai.settings, server: ai.server, summary: buildFinanceSummary(finance, month), month, modelLabel: ai.displayName });
  };

  // As dicas valem para um mês; o Painel pode estar em outro (ou ter chegado fatura nova).
  const stale = result && month && result.month !== month;
  const button = (
    <button type="button" className="small-action" onClick={run} disabled={Boolean(running)} title={`Analisar ${formatMonthLong(month)} com ${ai.displayName}`}>
      {running ? <Loader2 size={14} className="spin" /> : result ? <RefreshCw size={14} /> : <Sparkles size={14} />}
      {running ? `Analisando… ${Math.max(0, Math.floor((now - running.startedAt) / 1000))}s` : result ? 'Atualizar' : 'Gerar dicas'}
    </button>
  );

  return (
    <Card span="full" title="Dicas da IA" icon={<Lightbulb size={17} />}
      subtitle={result
        ? `${formatMonthLong(result.month)} · ${result.modelLabel} · ${formatDateTime(result.generatedAt)}`
        : `${ai.displayName} lê o resumo da fatura (só totais, nenhuma compra individual) e aponta onde agir.`}
      actions={<>{button}<Link className="small-action" to="/analises?aba=ia">Análise completa <ArrowRight size={14} /></Link></>}>
      {error && !running ? <div className="notice bad" style={{ marginBottom: 12 }}><XCircle size={16} /><span>{error}</span></div> : null}
      {stale && !running ? (
        <div className="notice warn" style={{ marginBottom: 12 }}>
          <Sparkles size={16} />
          <span>
            Estas dicas são de {formatMonthLong(result.month)}
            {month === latestMonth && result.month < latestMonth ? ` e já chegou a fatura de ${formatMonthLong(latestMonth)}` : ''}.
            {' '}"Atualizar" analisa {formatMonthLong(month)}.
          </span>
        </div>
      ) : null}
      {result ? <AiInsightList insights={result.insights} limit={4} columns /> : (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {running ? 'Lendo categorias, locais, parcelas futuras e metas — leva de 10 a 60 segundos.' : 'Nenhuma dica ainda. Clique em "Gerar dicas" — roda no CLI de IA deste computador (Claude Code ou Antigravity), sem chave de API.'}
        </p>
      )}
    </Card>
  );
}

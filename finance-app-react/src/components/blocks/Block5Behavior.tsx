import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { expenseTransactions, filterByMonth, getCategoryTotals, getCategoryVolatility, getDailyHeatmap, getInsights, getMonthlySummaries, getRecurringMerchants, getTransactionAnomalies, getWeekdayAverages } from '../../utils/analytics';
import { AXIS_PROPS, GRID_COLOR, TOOLTIP_PROPS } from '../../utils/chartTheme';
import { formatBRL, formatDate } from '../../utils/formatters';
import { DataTable, type Column } from '../ui/DataTable';

export function Block5Behavior({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, aliases, monthlyIncomes } = useFinance();
  const [cutAmount, setCutAmount] = useState(300);
  const scopedTransactions = filterByMonth(transactions, selectedMonth);
  const expenses = expenseTransactions(scopedTransactions);
  const summaries = getMonthlySummaries(transactions, monthlyIncomes);
  const categoryTotals = getCategoryTotals(scopedTransactions, categories);

  const total = expenses.reduce((sum, item) => sum + item.amount, 0);
  const avgTicket = expenses.length ? total / expenses.length : 0;
  const subscriptionsId = categories.find(item => item.id === 'assinaturas')?.id;
  const subscriptionMerchants = new Set(expenses.filter(item => item.categoryId === subscriptionsId).map(item => item.normalizedMerchant || item.description));
  const weekdays = getWeekdayAverages(expenses);
  const mostExpensiveDay = [...weekdays].sort((a, b) => b.average - a.average)[0];
  const highestTicketCategory = [...categoryTotals].sort((a, b) => b.averageTicket - a.averageTicket)[0];
  const metrics = { avgTicket, subscriptionCount: subscriptionMerchants.size, weekdays, mostExpensiveDay, highestTicketCategory };

  const insightRows = getInsights(scopedTransactions, categories, summaries);
  const ticketRows = categoryTotals.slice(0, 8).map(item => ({ name: item.name, ticket: item.averageTicket }));
  const heatmapRows = getDailyHeatmap(transactions, selectedMonth || summaries.at(-1)?.month || '');
  const recurringRows = getRecurringMerchants(transactions, aliases).slice(0, 10);
  const anomalies = getTransactionAnomalies(scopedTransactions, categories).slice(0, 12);
  const volatilityRows = getCategoryVolatility(transactions, categories).slice(0, 8);
  const anomalyColumns: Column<(typeof anomalies)[number]>[] = [
    { key: 'date', header: 'Data', accessor: row => formatDate(row.date), align: 'center', sortValue: row => row.date },
    { key: 'description', header: 'Descricao', accessor: row => row.description },
    { key: 'categoryName', header: 'Categoria', accessor: row => row.categoryName, align: 'center' },
    { key: 'amount', header: 'Valor', accessor: row => row.amount, render: row => formatBRL(row.amount), align: 'right', sortValue: row => row.amount },
    { key: 'multiple', header: 'Acima da media', accessor: row => row.multiple, render: row => `${row.multiple.toFixed(1)}x`, align: 'center' },
  ];

  if (!expenses.length) {
    return <div className="empty-state">Importe faturas para gerar comportamento de consumo, tickets medios e alertas automaticos.</div>;
  }

  return (
    <div className="section-grid">
      <div className="kpi-grid">
        <Kpi label="Assinaturas" value={String(metrics.subscriptionCount)} sub="estabelecimentos detectados" />
        <Kpi label="Valor medio" value={formatBRL(metrics.avgTicket)} sub={`${expenses.length} compras`} />
        <Kpi label="Dia mais caro" value={metrics.mostExpensiveDay?.label || '-'} sub={formatBRL(metrics.mostExpensiveDay?.average || 0)} />
        <Kpi label="Maior valor medio" value={metrics.highestTicketCategory?.name || '-'} sub={formatBRL(metrics.highestTicketCategory?.averageTicket || 0)} />
      </div>

      <div className="chart-card">
        <h3>Gasto medio por dia da semana</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={metrics.weekdays}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${value}`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="average" name="Media" radius={[6, 6, 0, 0]}>
              {metrics.weekdays.map((item, index) => (
                <Cell key={item.label} fill={index === 5 || index === 6 ? '#dc2626' : '#2563eb'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Valor medio por categoria</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ticketRows} layout="vertical" margin={{ left: 90 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
            <XAxis {...AXIS_PROPS} type="number" tickFormatter={value => `R$${value}`} />
            <YAxis {...AXIS_PROPS} dataKey="name" type="category" width={110} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="ticket" name="Media" fill="#0ea5e9" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Mapa diario de gastos</h3>
        <div className="heatmap-grid">
          {heatmapRows.map(day => (
            <div
              key={day.day}
              className="heatmap-cell"
              title={`${day.day}: ${formatBRL(day.total)}`}
              style={{ backgroundColor: `rgba(37, 99, 235, ${0.12 + day.intensity * 0.78})` }}
            >
              <span>{day.day}</span>
              <small>{day.total ? formatBRL(day.total).replace(',00', '') : '-'}</small>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card">
        <h3>Volatilidade por categoria</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={volatilityRows} layout="vertical" margin={{ left: 90 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
            <XAxis {...AXIS_PROPS} type="number" tickFormatter={value => `${Number(value).toFixed(1)}x`} />
            <YAxis {...AXIS_PROPS} dataKey="name" type="category" width={110} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => `${Number(value || 0).toFixed(2)}x`} />
            <Bar dataKey="volatility" name="Volatilidade" fill="#f59e0b" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card wide">
        <div className="chart-title-row">
          <h3>Simulador e se</h3>
          <label className="slider-label">
            Corte mensal {formatBRL(cutAmount)}
            <input type="range" min="0" max="2000" step="50" value={cutAmount} onChange={event => setCutAmount(Number(event.target.value))} />
          </label>
        </div>
        <div className="simulator-grid">
          <Kpi label="Impacto em 6 meses" value={formatBRL(cutAmount * 6)} sub="saldo acumulado" />
          <Kpi label="Impacto em 12 meses" value={formatBRL(cutAmount * 12)} sub="saldo acumulado" />
        </div>
      </div>

      <div className="table-card wide">
        <h3>Recorrencias detectadas</h3>
        <DataTable
          rows={recurringRows}
          initialPageSize={8}
          emptyLabel="Nenhuma recorrencia detectada."
          columns={[
            { key: 'merchant', label: 'Local', value: row => row.merchant, filterable: true },
            { key: 'confidence', label: 'Situacao', align: 'center', value: row => row.confidence, render: row => <span className={`badge ${row.confidence === 'confirmada' ? 'success' : 'warning'}`}>{row.confidence}</span> },
            { key: 'months', label: 'Meses', align: 'center', value: row => row.months },
            { key: 'average', label: 'Media', align: 'right', value: row => row.average, render: row => formatBRL(row.average) },
            { key: 'total', label: 'Total', align: 'right', value: row => row.total, render: row => formatBRL(row.total) },
          ]}
        />
      </div>

      <div className="table-card wide">
        <h3>Alertas de anomalia</h3>
        <DataTable rows={anomalies} columns={anomalyColumns} initialPageSize={8} emptyLabel="Nenhuma compra fora do padrao no periodo." />
      </div>

      <div className="chart-card wide">
        <h3>Analises automaticas</h3>
        <div className="insight-list">
          {insightRows.map((item, index) => <div className="insight" key={index}>{item}</div>)}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="kpi-card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

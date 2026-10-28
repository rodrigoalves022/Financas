import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Lightbulb } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import {
  expenseTransactions, filterByMonth, getCategoryTotals, getCategoryVolatility, getDailyHeatmap, getInsights, getLatestInvoiceMonth,
  getMonthlySummaries, getRecurringMerchants, getTransactionAnomalies, getWeekdayAverages,
} from '../../utils/analytics';
import { useChartTheme } from '../../utils/chartTheme';
import { WEEKDAY_LABELS } from '../../utils/constants';
import { formatBRL, formatDate, formatMonth, titleCase } from '../../utils/formatters';
import { Badge, Card, StatCard } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';

export function ComportamentoTab({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, aliases, monthlyIncomes } = useFinance();
  const chart = useChartTheme();
  const navigate = useNavigate();

  const data = useMemo(() => {
    const scoped = filterByMonth(transactions, selectedMonth);
    const expenses = expenseTransactions(scoped);
    const total = expenses.reduce((sum, item) => sum + item.amount, 0);
    const categoryTotals = getCategoryTotals(scoped, categories);
    const weekdays = getWeekdayAverages(expenses);
    const heatmapMonth = selectedMonth || getLatestInvoiceMonth(transactions);
    return {
      expenses,
      avgTicket: expenses.length ? total / expenses.length : 0,
      subscriptions: new Set(expenses.filter(item => item.categoryId === 'assinaturas' || item.categoryId === 'assinaturas-streaming').map(item => item.normalizedMerchant || item.description)).size,
      weekdays,
      mostExpensiveDay: [...weekdays].sort((a, b) => b.total - a.total)[0],
      ticketRows: [...categoryTotals].sort((a, b) => b.averageTicket - a.averageTicket).slice(0, 8).map(item => ({ name: item.name, ticket: item.averageTicket, color: item.color })),
      heatmap: getDailyHeatmap(transactions, heatmapMonth),
      heatmapMonth,
      recurring: getRecurringMerchants(transactions, aliases).slice(0, 15),
      anomalies: getTransactionAnomalies(scoped, categories).slice(0, 15),
      volatility: getCategoryVolatility(transactions, categories).slice(0, 8),
      insights: getInsights(scoped, categories, getMonthlySummaries(transactions, monthlyIncomes)),
    };
  }, [transactions, categories, aliases, monthlyIncomes, selectedMonth]);

  if (!data.expenses.length) return <EmptyState title="Sem compras no período" description="Importe faturas para ver padrões de consumo." />;

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label="Ticket médio" value={formatBRL(data.avgTicket)} hint={`${data.expenses.length} compras`} />
        <StatCard label="Dia que mais gasta" value={data.mostExpensiveDay?.label || '-'} hint={formatBRL(data.mostExpensiveDay?.total || 0)} />
        <StatCard label="Assinaturas ativas" value={data.subscriptions} hint="Estabelecimentos distintos" />
        <StatCard label="Recorrências" value={data.recurring.filter(item => item.confidence === 'confirmada').length} hint={`${data.recurring.length} suspeitas no histórico`} onClick={() => document.getElementById('recorrencias')?.scrollIntoView({ behavior: 'smooth' })} />
      </div>

      <Card span="full" title="Leituras automáticas" icon={<Lightbulb size={17} />}>
        <div className="insight-list">
          {data.insights.map(item => <div className="insight" key={item}><Lightbulb size={16} /><span>{item}</span></div>)}
        </div>
      </Card>

      <Card span="half" title="Calendário de gastos" subtitle={`Datas das compras da fatura ${formatMonth(data.heatmapMonth)} · toque num dia para ver as compras`}>
        <div className="heatmap">
          {WEEKDAY_LABELS.map(label => <div key={label} className="heatmap-head">{label}</div>)}
          {data.heatmap.map(cell => (
            <div
              key={cell.date}
              className={`heatmap-cell ${cell.filler ? 'filler' : ''} ${cell.total ? 'clickable' : ''}`}
              onClick={cell.total ? () => navigate(`/transacoes?mes=${data.heatmapMonth}&busca=${formatDate(cell.date)}`) : undefined}
              title={cell.filler ? '' : `${formatDate(cell.date)}: ${formatBRL(cell.total)} em ${cell.count} compra(s)`}
              style={cell.filler || !cell.total ? undefined : { background: `color-mix(in srgb, ${chart.colors.primary} ${Math.round(18 + cell.intensity * 70)}%, transparent)` }}
            >
              {cell.filler ? null : <><span>{cell.day}</span><small>{cell.total ? formatBRL(cell.total).replace(',00', '').replace('R$', '').trim() : ''}</small></>}
            </div>
          ))}
        </div>
      </Card>

      <Card span="half" title="Gasto por dia da semana" subtitle="Total gasto em cada dia">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.weekdays}>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="label" {...chart.axis} />
            <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
            <Tooltip {...chart.tooltip} />
            <Bar dataKey="total" name="Total" radius={[6, 6, 0, 0]}>
              {data.weekdays.map((item, index) => <Cell key={item.label} fill={index === 0 || index >= 5 ? chart.colors.violet : chart.colors.primary} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Ticket médio por categoria">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.ticketRows} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid {...chart.grid} horizontal={false} />
            <XAxis type="number" {...chart.axis} tickFormatter={chart.moneyAxis} />
            <YAxis type="category" dataKey="name" {...chart.axis} width={130} />
            <Tooltip {...chart.tooltip} />
            <Bar dataKey="ticket" name="Ticket médio" radius={[0, 6, 6, 0]}>
              {data.ticketRows.map(item => <Cell key={item.name} fill={item.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Volatilidade por categoria" subtitle="Quanto o gasto varia de um mês para outro">
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.volatility} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid {...chart.grid} horizontal={false} />
            <XAxis type="number" {...chart.axis} tickFormatter={value => `${Number(value).toFixed(1)}x`} />
            <YAxis type="category" dataKey="name" {...chart.axis} width={130} />
            <Tooltip {...chart.tooltip} formatter={value => `${Number(value || 0).toFixed(2)}x`} />
            <Bar dataKey="volatility" name="Volatilidade" fill={chart.colors.warn} radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card span="full" title="Recorrências detectadas" subtitle="Locais que aparecem em vários meses — toque para ver todas as compras do local">
        <span id="recorrencias" />
        <DataTable
          rows={data.recurring}
          rowKey={row => row.merchant}
          onRowClick={row => navigate(`/transacoes?mes=all&busca=${encodeURIComponent(row.merchant)}`)}
          initialPageSize={8}
          initialSort={{ key: 'months', direction: 'desc' }}
          emptyLabel="Nenhuma recorrência detectada."
          columns={[
            { key: 'merchant', label: 'Local', value: row => row.merchant, render: row => <strong>{titleCase(row.merchant)}</strong> },
            { key: 'confidence', label: 'Situação', align: 'center', value: row => row.confidence, render: row => <Badge tone={row.confidence === 'confirmada' ? 'good' : 'warn'}>{row.confidence}</Badge> },
            { key: 'months', label: 'Meses', align: 'right', value: row => row.months },
            { key: 'average', label: 'Média', align: 'right', value: row => row.average, render: row => formatBRL(row.average) },
            { key: 'total', label: 'Total', align: 'right', value: row => row.total, render: row => formatBRL(row.total) },
          ]}
        />
      </Card>

      <Card span="full" title="Compras fora do padrão" subtitle="Bem acima da média da própria categoria">
        <DataTable
          rows={data.anomalies}
          rowKey={row => row.id}
          onRowClick={row => navigate(`/transacoes?busca=${encodeURIComponent(row.description)}`)}
          initialPageSize={8}
          initialSort={{ key: 'multiple', direction: 'desc' }}
          emptyLabel="Nenhuma compra fora do padrão no período."
          columns={[
            { key: 'date', label: 'Data', value: row => formatDate(row.date), sortValue: row => row.date },
            { key: 'description', label: 'Descrição', value: row => row.description },
            { key: 'categoryName', label: 'Categoria', value: row => row.categoryName },
            { key: 'amount', label: 'Valor', align: 'right', value: row => row.amount, render: row => formatBRL(row.amount) },
            { key: 'multiple', label: 'x média', align: 'right', value: row => row.multiple, render: row => <Badge tone="warn">{row.multiple.toFixed(1)}x</Badge> },
          ]}
        />
      </Card>
    </div>
  );
}

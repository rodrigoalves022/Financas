import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { expenseTransactions, getCategoryTotals, getInsights, getMonthlySummaries, getWeekdayAverages } from '../../utils/analytics';
import { formatBRL } from '../../utils/formatters';

export function Block5Behavior() {
  const { transactions, categories, monthlyIncomes } = useFinance();
  const expenses = expenseTransactions(transactions);
  const summaries = getMonthlySummaries(transactions, monthlyIncomes);
  const categoryTotals = getCategoryTotals(transactions, categories);

  const metrics = useMemo(() => {
    const total = expenses.reduce((sum, item) => sum + item.amount, 0);
    const avgTicket = expenses.length ? total / expenses.length : 0;
    const subscriptionsId = categories.find(item => item.id === 'assinaturas')?.id;
    const subscriptionMerchants = new Set(expenses.filter(item => item.categoryId === subscriptionsId).map(item => item.normalizedMerchant || item.description));
    const weekdays = getWeekdayAverages(expenses);
    const mostExpensiveDay = [...weekdays].sort((a, b) => b.average - a.average)[0];
    const highestTicketCategory = [...categoryTotals].sort((a, b) => b.averageTicket - a.averageTicket)[0];
    return { avgTicket, subscriptionCount: subscriptionMerchants.size, weekdays, mostExpensiveDay, highestTicketCategory };
  }, [expenses, categories, categoryTotals]);

  const insightRows = getInsights(transactions, categories, summaries);
  const ticketRows = categoryTotals.slice(0, 8).map(item => ({ name: item.name, ticket: item.averageTicket }));

  if (!expenses.length) {
    return <div className="empty-state">Importe faturas para gerar comportamento de consumo, tickets medios e alertas automaticos.</div>;
  }

  return (
    <div className="section-grid">
      <div className="kpi-grid">
        <Kpi label="Assinaturas" value={String(metrics.subscriptionCount)} sub="estabelecimentos detectados" />
        <Kpi label="Ticket medio" value={formatBRL(metrics.avgTicket)} sub={`${expenses.length} compras`} />
        <Kpi label="Dia mais caro" value={metrics.mostExpensiveDay?.label || '-'} sub={formatBRL(metrics.mostExpensiveDay?.average || 0)} />
        <Kpi label="Maior ticket" value={metrics.highestTicketCategory?.name || '-'} sub={formatBRL(metrics.highestTicketCategory?.averageTicket || 0)} />
      </div>

      <div className="chart-card">
        <h3>Gasto medio por dia da semana</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={metrics.weekdays}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ef" vertical={false} />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={value => `R$${value}`} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="average" radius={[6, 6, 0, 0]}>
              {metrics.weekdays.map((item, index) => (
                <Cell key={item.label} fill={index === 5 || index === 6 ? '#dc2626' : '#2563eb'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <h3>Ticket medio por categoria</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={ticketRows} layout="vertical" margin={{ left: 90 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ef" horizontal={false} />
            <XAxis type="number" tickFormatter={value => `R$${value}`} />
            <YAxis dataKey="name" type="category" width={100} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="ticket" fill="#0ea5e9" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card wide">
        <h3>Insights automaticos</h3>
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

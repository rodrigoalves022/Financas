import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { getMonthlySummaries } from '../../utils/analytics';
import { formatBRL, formatMonth, formatPercent } from '../../utils/formatters';

export function Block1Overview({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, monthlyIncomes } = useFinance();
  const summaries = getMonthlySummaries(transactions, monthlyIncomes);
  const scoped = selectedMonth ? summaries.filter(item => item.month === selectedMonth) : summaries;
  const income = scoped.reduce((sum, item) => sum + item.income, 0);
  const expense = scoped.reduce((sum, item) => sum + item.expense, 0);
  const balance = income - expense;
  let accumulated = 0;
  const chartRows = summaries.map(item => {
    accumulated += item.balance;
    return { ...item, label: formatMonth(item.month), accumulated };
  });

  return (
    <div className="section-grid">
      <div className="kpi-grid">
        <Kpi label="Receita" value={formatBRL(income)} tone="good" sub={selectedMonth ? formatMonth(selectedMonth) : 'Todo periodo'} />
        <Kpi label="Gastos" value={formatBRL(expense)} tone="bad" sub={`${formatPercent(income ? (expense / income) * 100 : 0)} da renda`} />
        <Kpi label="Saldo" value={formatBRL(balance)} tone={balance >= 0 ? 'good' : 'bad'} sub={balance >= 0 ? 'Gerou caixa' : 'Consumiu caixa'} />
        <Kpi label="Comprometimento" value={formatPercent(income ? (expense / income) * 100 : 0)} tone={expense <= income ? 'good' : 'warn'} sub="Gastos / receita" />
      </div>
      <div className="chart-card wide">
        <h3>Receita vs despesa</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="income" name="Receita" fill="#16a34a" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expense" name="Despesa" fill="#dc2626" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Saldo acumulado</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            <Line type="monotone" dataKey="accumulated" stroke="#2563eb" strokeWidth={3} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'good' | 'bad' | 'warn' }) {
  return (
    <div className="kpi-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={tone}>{sub}</small>
    </div>
  );
}

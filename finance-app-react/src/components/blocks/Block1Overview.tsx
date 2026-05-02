import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { getFinancialHealthScore, getMonthlySummaries } from '../../utils/analytics';
import { AXIS_PROPS, GRID_COLOR, TOOLTIP_PROPS } from '../../utils/chartTheme';
import { formatBRL, formatMonth } from '../../utils/formatters';

type MonthlyChartRow = {
  month: string;
  income: number;
  expense: number;
  balance: number;
  label: string;
  accumulated: number;
};

export function Block1Overview({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, monthlyIncomes, debts, addIncome } = useFinance();
  const summaries = getMonthlySummaries(transactions, monthlyIncomes);
  const scoped = selectedMonth ? summaries.filter(item => item.month === selectedMonth) : summaries;
  const income = scoped.reduce((sum, item) => sum + item.income, 0);
  const expense = scoped.reduce((sum, item) => sum + item.expense, 0);
  const balance = income - expense;
  const score = getFinancialHealthScore(transactions, monthlyIncomes, debts, selectedMonth);
  const paid = balance >= 0 && expense > 0;
  const coverage = expense ? Math.min(100, (income / expense) * 100) : 0;

  const markInvoicePaid = () => {
    if (!selectedMonth || balance >= 0) return;
    addIncome({ month: selectedMonth, amount: income + Math.abs(balance), isRecurring: false });
  };
  const chartRows = summaries.reduce<{ rows: Array<MonthlyChartRow>; accumulated: number }>((state, item) => {
    const accumulated = state.accumulated + item.balance;
    return {
      accumulated,
      rows: [...state.rows, { ...item, label: formatMonth(item.month), accumulated }],
    };
  }, { rows: [], accumulated: 0 }).rows;

  return (
    <div className="section-grid">
      <div className="kpi-grid">
        <Kpi label="Receita" value={formatBRL(income)} tone="good" sub={selectedMonth ? formatMonth(selectedMonth) : 'Todo periodo'} />
        <Kpi label="Valor da fatura" value={formatBRL(expense)} tone="bad" sub="Total de compras" />
        <Kpi label="Saldo da fatura" value={formatBRL(balance)} tone={balance >= 0 ? 'good' : 'bad'} sub={balance >= 0 ? 'Positivo ou quitado' : 'Em aberto'} />
        <Kpi label="Situacao" value={paid ? 'Quitada' : balance < 0 ? 'Em aberto' : 'Sem gasto'} tone={paid ? 'good' : balance < 0 ? 'warn' : 'good'} sub="Receita registrada x fatura" />
        <Kpi label="Nota financeira" value={`${score}/100`} tone={score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad'} sub="Renda, gastos e dividas" />
        <Kpi label="Saldo final" value={formatBRL(balance)} tone={balance >= 0 ? 'good' : 'bad'} sub="Receita - fatura" />
      </div>
      <div className="chart-card wide">
        <div className="chart-title-row">
          <h3>Saldo da fatura</h3>
          {selectedMonth && balance < 0 ? <button className="secondary-button" onClick={markInvoicePaid}>Marcar fatura quitada</button> : null}
        </div>
        <div className="invoice-balance-panel">
          <div>
            <strong>{formatBRL(income)}</strong>
            <span>Receita ou ajuste registrado</span>
          </div>
          <div>
            <strong>{formatBRL(expense)}</strong>
            <span>Valor da fatura</span>
          </div>
          <div>
            <strong className={balance >= 0 ? 'good-text' : 'bad-text'}>{formatBRL(balance)}</strong>
            <span>{balance >= 0 ? 'Saldo positivo' : 'Saldo negativo'}</span>
          </div>
        </div>
        <div className="progress-track invoice-progress">
          <div className={coverage >= 100 ? 'progress-fill good' : 'progress-fill warn'} style={{ width: `${coverage}%` }} />
        </div>
      </div>
      <div className="chart-card wide">
        <h3>Receita vs despesa</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="income" name="Receita" fill="#16a34a" radius={[6, 6, 0, 0]} />
            <Bar dataKey="expense" name="Despesa" fill="#dc2626" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Saldo acumulado</h3>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Line type="monotone" dataKey="accumulated" name="Saldo acumulado" stroke="#2563eb" strokeWidth={3} dot={false} />
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

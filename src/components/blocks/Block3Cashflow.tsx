import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { filterByMonth, getCategoryTotals, getMonthlySummaries } from '../../utils/analytics';
import { AXIS_PROPS, GRID_COLOR, TOOLTIP_PROPS } from '../../utils/chartTheme';
import { formatBRL, formatMonth } from '../../utils/formatters';

export function Block3Cashflow({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, monthlyIncomes, categories } = useFinance();
  const summaries = getMonthlySummaries(transactions, monthlyIncomes);
  const averageExpense = summaries.length ? summaries.reduce((sum, item) => sum + item.expense, 0) / summaries.length : 0;
  const movingAverage = summaries.slice(-3).reduce((sum, item) => sum + item.balance, 0) / Math.max(1, summaries.slice(-3).length);
  const best = [...summaries].sort((a, b) => b.balance - a.balance)[0];
  const worst = [...summaries].sort((a, b) => a.balance - b.balance)[0];
  const lastMonth = summaries[summaries.length - 1]?.month || new Date().toISOString().substring(0, 7);
  const projectedRows = Array.from({ length: 3 }, (_, index) => {
    const date = new Date(`${lastMonth}-01T12:00:00`);
    date.setMonth(date.getMonth() + index + 1);
    return { month: date.toISOString().substring(0, 7), income: 0, expense: 0, balance: movingAverage, projected: true };
  });
  const chartRows = [...summaries, ...projectedRows].map(item => ({
    ...item,
    label: formatMonth(item.month),
    seasonality: averageExpense ? item.expense / averageExpense : 0,
  }));
  const selectedSummary = selectedMonth ? summaries.find(item => item.month === selectedMonth) : summaries.at(-1);
  const incomeBase = selectedSummary?.income || 0;
  const waterfallState = getCategoryTotals(filterByMonth(transactions, selectedSummary?.month || selectedMonth), categories).slice(0, 8)
    .reduce<{ rows: Array<{ name: string; value: number; balance: number; fill: string }>; running: number }>((state, category) => {
      const running = state.running - category.total;
      return {
        running,
        rows: [...state.rows, { name: category.name, value: -category.total, balance: running, fill: '#dc2626' }],
      };
    }, { rows: [], running: incomeBase });
  const waterfallRows = [
    { name: 'Receita', value: incomeBase, balance: incomeBase, fill: '#16a34a' },
    ...waterfallState.rows,
    { name: 'Saldo', value: waterfallState.running, balance: waterfallState.running, fill: waterfallState.running >= 0 ? '#16a34a' : '#dc2626' },
  ];

  return (
    <div className="section-grid">
      <div className="kpi-grid">
        <Kpi label="Melhor mês" value={best ? formatBRL(best.balance) : formatBRL(0)} sub={best ? formatMonth(best.month) : 'Sem dados'} />
        <Kpi label="Pior mês" value={worst ? formatBRL(worst.balance) : formatBRL(0)} sub={worst ? formatMonth(worst.month) : 'Sem dados'} />
        <Kpi label="Projeção" value={formatBRL(movingAverage)} sub="Média móvel 3 meses" />
      </div>
      <div className="chart-card wide">
        <h3>Saldo mensal e projeção</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="balance" name="Saldo" radius={[6, 6, 0, 0]}>
              {chartRows.map(item => (
                <Cell key={item.month} fill={item.projected ? '#7dd3fc' : item.balance >= 0 ? '#16a34a' : '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Índice de sazonalidade</h3>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={chartRows.filter(item => !item.projected)}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => Number(value || 0).toFixed(2)} />
            <ReferenceLine y={1} stroke="#16a34a" strokeDasharray="4 4" />
            <Bar dataKey="seasonality" name="Indice" radius={[6, 6, 0, 0]}>
              {chartRows.filter(item => !item.projected).map(item => (
                <Cell key={item.month} fill={item.seasonality > 1.3 ? '#dc2626' : item.seasonality > 1 ? '#f59e0b' : '#16a34a'} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card wide">
        <h3>Composição do saldo mensal</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={waterfallRows}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="name" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="value" name="Valor" radius={[6, 6, 0, 0]}>
              {waterfallRows.map(item => <Cell key={item.name} fill={item.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="kpi-card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

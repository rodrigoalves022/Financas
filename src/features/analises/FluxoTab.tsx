import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { filterByMonth, getCategoryTotals, getLatestInvoiceMonth, getMonthlySummaries } from '../../utils/analytics';
import { useChartTheme } from '../../utils/chartTheme';
import { getFixedMonthlyTotal, mergeFixedIntoCategories } from '../../utils/fixedExpenses';
import { useSpendingScope } from '../../store/spendingScope';
import { SpendingScopeTabs } from '../../components/SpendingScopeTabs';
import { currentMonthISO, formatBRL, formatMonth, formatMonthShort } from '../../utils/formatters';
import { Card, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

const monthFromBar = (entry: unknown) => {
  const item = entry as { month?: string; payload?: { month?: string } };
  return item.payload?.month || item.month || '';
};

const deltaFormatter = (_value: unknown, _name: unknown, item: unknown) =>
  formatBRL(Number((item as { payload?: { delta?: number } }).payload?.delta || 0));

export function FluxoTab({ selectedMonth, onSelectMonth }: { selectedMonth: string; onSelectMonth: (month: string) => void }) {
  const navigate = useNavigate();
  const pick = (entry: unknown) => { const month = monthFromBar(entry); if (month) onSelectMonth(month); };
  const { transactions, monthlyIncomes, categories, fixedExpenses } = useFinance();
  const chart = useChartTheme();
  const scope = useSpendingScope();
  const includeFixed = scope === 'tudo';

  const data = useMemo(() => {
    const latest = getLatestInvoiceMonth(transactions);
    const limit = latest > currentMonthISO() ? latest : currentMonthISO();
    // Saldo do mês = receita − fatura − contas fixas (no modo "Tudo").
    const history = getMonthlySummaries(transactions, monthlyIncomes).filter(item => item.month <= limit && (item.expense > 0 || item.income > 0)).map(item => {
      const fixed = includeFixed ? getFixedMonthlyTotal(fixedExpenses, item.month) : 0;
      return { ...item, fixed, balance: item.income - item.expense - fixed };
    });
    const hasFixed = history.some(item => item.fixed > 0);
    const withIncome = history.filter(item => item.income > 0);
    const averageExpense = history.length ? history.reduce((sum, item) => sum + item.expense, 0) / history.length : 0;
    const averageIncome = withIncome.length ? withIncome.reduce((sum, item) => sum + item.income, 0) / withIncome.length : 0;

    const rows = history.reduce<Array<(typeof history)[number] & { label: string; accumulated: number; seasonality: number }>>((list, item) => [
      ...list,
      { ...item, label: formatMonthShort(item.month), accumulated: (list.at(-1)?.accumulated || 0) + item.balance, seasonality: averageExpense ? item.expense / averageExpense : 0 },
    ], []);

    const focus = selectedMonth ? history.find(item => item.month === selectedMonth) : history.at(-1);
    const focusMonth = focus?.month || selectedMonth;
    const cardCategories = getCategoryTotals(filterByMonth(transactions, focusMonth), categories);
    const categoriesOfMonth = includeFixed && focusMonth ? mergeFixedIntoCategories(cardCategories, fixedExpenses, [focusMonth], categories) : cardCategories;
    const top = categoriesOfMonth.slice(0, 7);
    const rest = categoriesOfMonth.slice(7).reduce((sum, item) => sum + item.total, 0);
    const steps: Array<{ name: string; range: [number, number]; delta: number; fill: string }> = [];
    let running = focus?.income || 0;
    steps.push({ name: 'Receita', range: [0, running], delta: running, fill: chart.colors.good });
    [...top.map(item => ({ name: item.name, total: item.total, color: item.color })), ...(rest ? [{ name: 'Demais', total: rest, color: chart.colors.muted }] : [])].forEach(item => {
      const next = running - item.total;
      steps.push({ name: item.name, range: [Math.min(running, next), Math.max(running, next)], delta: -item.total, fill: item.color });
      running = next;
    });
    steps.push({ name: 'Saldo', range: [Math.min(0, running), Math.max(0, running)], delta: running, fill: running >= 0 ? chart.colors.good : chart.colors.bad });

    const sortedByBalance = [...history].sort((a, b) => b.balance - a.balance);
    return {
      rows, steps, focusMonth, averageExpense, averageIncome, hasFixed,
      best: sortedByBalance[0], worst: sortedByBalance.at(-1),
      highest: [...history].sort((a, b) => b.expense - a.expense)[0],
    };
  }, [transactions, monthlyIncomes, categories, fixedExpenses, includeFixed, selectedMonth, chart.colors]);

  if (!data.rows.length) return <EmptyState title="Sem histórico" description="Importe faturas e registre receitas para ver o fluxo mês a mês." />;

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label="Melhor mês" value={formatBRL(data.best?.balance || 0)} hint={data.best ? formatMonth(data.best.month) : ''} tone={(data.best?.balance || 0) >= 0 ? 'good' : 'bad'} onClick={data.best ? () => onSelectMonth(data.best!.month) : undefined} />
        <StatCard label="Pior mês" value={formatBRL(data.worst?.balance || 0)} hint={data.worst ? formatMonth(data.worst.month) : ''} tone={(data.worst?.balance || 0) >= 0 ? 'good' : 'bad'} onClick={data.worst ? () => onSelectMonth(data.worst!.month) : undefined} />
        <StatCard label="Receita média" value={formatBRL(data.averageIncome)} hint="Meses com receita" onClick={() => navigate('/receitas')} />
        <StatCard label="Fatura média" value={formatBRL(data.averageExpense)} hint={`${data.rows.length} meses`} />
        <StatCard label="Maior fatura" value={formatBRL(data.highest?.expense || 0)} hint={data.highest ? formatMonth(data.highest.month) : ''} onClick={data.highest ? () => onSelectMonth(data.highest!.month) : undefined} />
      </div>

      <Card span="full" title={data.hasFixed ? 'Receita x gastos' : 'Receita x fatura'}
        subtitle={`Mês a mês${data.hasFixed ? ' · gastos = fatura + contas fixas' : ''} · toque numa barra para abrir o mês`}
        actions={fixedExpenses.length ? <SpendingScopeTabs /> : null}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data.rows} barGap={4}>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="label" {...chart.axis} />
            <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
            <Tooltip {...chart.tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="income" name="Receita" fill={chart.colors.good} radius={[5, 5, 0, 0]} cursor="pointer" onClick={pick} />
            <Bar dataKey="expense" name="Fatura" stackId="gasto" fill={chart.colors.primary} radius={data.hasFixed ? [0, 0, 0, 0] : [5, 5, 0, 0]} cursor="pointer" onClick={pick} />
            {data.hasFixed ? <Bar dataKey="fixed" name="Contas fixas" stackId="gasto" fill={chart.colors.info} radius={[5, 5, 0, 0]} cursor="pointer" onClick={pick} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Composição do saldo" subtitle={`Da receita ao saldo — ${formatMonth(data.focusMonth)}`}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data.steps}>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="name" {...chart.axis} interval={0} angle={-25} textAnchor="end" height={60} />
            <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
            <Tooltip {...chart.tooltip} formatter={deltaFormatter} />
            <ReferenceLine y={0} stroke={chart.colors.muted} />
            <Bar dataKey="range" name="Valor" radius={[4, 4, 4, 4]}>
              {data.steps.map(step => <Cell key={step.name} fill={step.fill} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Saldo acumulado" subtitle="Soma dos saldos mensais desde o início">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data.rows}>
            <defs>
              <linearGradient id="accumulatedFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={chart.colors.primary} stopOpacity={0.35} />
                <stop offset="100%" stopColor={chart.colors.primary} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="label" {...chart.axis} />
            <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
            <Tooltip {...chart.tooltip} />
            <ReferenceLine y={0} stroke={chart.colors.muted} strokeDasharray="4 4" />
            <Area type="monotone" dataKey="accumulated" name="Saldo acumulado" stroke={chart.colors.primary} strokeWidth={2.5} fill="url(#accumulatedFill)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Saldo de cada mês">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.rows}>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="label" {...chart.axis} />
            <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
            <Tooltip {...chart.tooltip} />
            <ReferenceLine y={0} stroke={chart.colors.muted} />
            <Bar dataKey="balance" name="Saldo" radius={[5, 5, 0, 0]} cursor="pointer" onClick={pick}>
              {data.rows.map(item => <Cell key={item.month} fill={item.balance >= 0 ? chart.colors.good : chart.colors.bad} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Sazonalidade" subtitle="Fatura do mês ÷ média (1,0 = normal)">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data.rows}>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="label" {...chart.axis} />
            <YAxis {...chart.axis} width={40} />
            <Tooltip {...chart.tooltip} formatter={value => `${Number(value || 0).toFixed(2)}x`} />
            <ReferenceLine y={1} stroke={chart.colors.good} strokeDasharray="4 4" />
            <Bar dataKey="seasonality" name="Índice" radius={[5, 5, 0, 0]} cursor="pointer" onClick={pick}>
              {data.rows.map(item => <Cell key={item.month} fill={item.seasonality > 1.3 ? chart.colors.bad : item.seasonality > 1 ? chart.colors.warn : chart.colors.good} />)}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

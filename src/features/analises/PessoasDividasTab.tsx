import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { getPeopleIOwe, getPeopleWhoOweMe, getPersonCategoryBreakdown } from '../../utils/analytics';
import { SERIES_COLORS, useChartTheme } from '../../utils/chartTheme';
import { formatBRL, normalizeText } from '../../utils/formatters';
import { Card, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';

export function PessoasDividasTab() {
  const { debts, transactions, receivables, members, categories } = useFinance();
  const chart = useChartTheme();
  const navigate = useNavigate();

  const data = useMemo(() => {
    const owesMe = getPeopleWhoOweMe(receivables, debts, members, transactions);
    const iOwe = getPeopleIOwe(debts, transactions);
    const balances = new Map<string, { name: string; receivable: number; payable: number }>();
    owesMe.forEach(person => balances.set(normalizeText(person.name), { name: person.name, receivable: person.total, payable: 0 }));
    iOwe.forEach(person => {
      const key = normalizeText(person.name);
      const current = balances.get(key) || { name: person.name, receivable: 0, payable: 0 };
      balances.set(key, { ...current, payable: current.payable + person.total });
    });
    const balanceRows = Array.from(balances.values())
      .map(row => ({ ...row, balance: row.receivable - row.payable }))
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

    const breakdown = getPersonCategoryBreakdown(receivables, transactions, categories, members);
    const totals = new Map<string, number>();
    breakdown.forEach(person => person.categories.forEach(category => totals.set(category.name, (totals.get(category.name) || 0) + category.total)));
    const series = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
    const breakdownRows = breakdown.map(person => {
      const row: Record<string, string | number> = { name: person.memberName };
      let others = 0;
      person.categories.forEach(category => {
        if (series.includes(category.name)) row[category.name] = category.total;
        else others += category.total;
      });
      if (others > 0) row.Outros = others;
      return row;
    });

    return {
      balanceRows,
      breakdownRows,
      series: breakdownRows.some(row => row.Outros) ? [...series, 'Outros'] : series,
      receivable: owesMe.reduce((sum, person) => sum + person.total, 0),
      payable: iOwe.reduce((sum, person) => sum + person.total, 0),
    };
  }, [debts, transactions, receivables, members, categories]);

  if (!data.balanceRows.length) return <EmptyState title="Sem valores entre pessoas" description="Divida compras ou registre empréstimos e dívidas para ver este resumo." />;

  const colorOf = (name: string, index: number) => categories.find(category => category.name === name)?.color || SERIES_COLORS[index % SERIES_COLORS.length];

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label="Me devem" value={formatBRL(data.receivable)} tone="good" onClick={() => navigate('/pessoas')} />
        <StatCard label="Eu devo" value={formatBRL(data.payable)} tone="bad" onClick={() => navigate('/dividas')} />
        <StatCard label="Saldo líquido" value={formatBRL(data.receivable - data.payable)} tone={data.receivable >= data.payable ? 'good' : 'bad'} onClick={() => navigate('/pessoas')} />
      </div>

      <Card span="full" title="Quem deve pra quem" subtitle="Positivo: a pessoa te deve · negativo: você deve a ela">
        <ResponsiveContainer width="100%" height={Math.max(180, data.balanceRows.length * 40)}>
          <BarChart data={data.balanceRows} layout="vertical" margin={{ left: 8 }}>
            <CartesianGrid {...chart.grid} horizontal={false} />
            <XAxis type="number" {...chart.axis} tickFormatter={chart.moneyAxis} />
            <YAxis type="category" dataKey="name" {...chart.axis} width={130} />
            <Tooltip {...chart.tooltip} />
            <Bar dataKey="balance" name="Saldo" radius={[0, 6, 6, 0]} cursor="pointer" onClick={entry => {
              const name = (entry as { name?: string; payload?: { name?: string } }).payload?.name || (entry as { name?: string }).name;
              if (name) navigate(`/pessoas?pessoa=${encodeURIComponent(name)}`);
            }}>
              {data.balanceRows.map(row => <Cell key={row.name} fill={row.balance >= 0 ? chart.colors.good : chart.colors.bad} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {data.breakdownRows.length ? (
        <Card span="full" title="Divisões de compras por categoria" subtitle="Em que cada pessoa costuma dividir com você">
          <ResponsiveContainer width="100%" height={Math.max(200, data.breakdownRows.length * 46)}>
            <BarChart data={data.breakdownRows} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid {...chart.grid} horizontal={false} />
              <XAxis type="number" {...chart.axis} tickFormatter={chart.moneyAxis} />
              <YAxis type="category" dataKey="name" {...chart.axis} width={130} />
              <Tooltip {...chart.tooltip} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {data.series.map((name, index) => <Bar key={name} dataKey={name} stackId="pessoa" fill={colorOf(name, index)} />)}
            </BarChart>
          </ResponsiveContainer>
        </Card>
      ) : null}
    </div>
  );
}

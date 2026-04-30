import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { filterByMonth, getCategoryTotals, getMerchantTotals } from '../../utils/analytics';
import { formatBRL, formatMonth } from '../../utils/formatters';
import { DataTable } from '../ui/DataTable';

export function Block2WhereMoneyWent({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories } = useFinance();
  const scoped = filterByMonth(transactions, selectedMonth);
  const categoryTotals = getCategoryTotals(scoped, categories);
  const merchants = getMerchantTotals(scoped).slice(0, 15);
  const top3 = categoryTotals.slice(0, 3);
  const months = Array.from(new Set(transactions.map(item => item.date.substring(0, 7)))).sort();
  const evolution = months.map(month => {
    const monthRows = filterByMonth(transactions, month);
    const totals = getCategoryTotals(monthRows, categories);
    return top3.reduce<Record<string, string | number>>((row, category) => {
      row[category.name] = totals.find(item => item.id === category.id)?.total || 0;
      return row;
    }, { month: formatMonth(month) });
  });

  return (
    <div className="section-grid">
      <div className="chart-card">
        <h3>Categorias rankeadas</h3>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={categoryTotals.slice(0, 10)} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis type="number" tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <YAxis type="category" dataKey="name" width={96} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="total" fill="#2563eb" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Top 3 categorias no tempo</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={evolution}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" />
            <YAxis tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            {top3.map(category => <Line key={category.id} type="monotone" dataKey={category.name} stroke={category.color} strokeWidth={3} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="table-card wide">
        <h3>Ranking por categoria</h3>
        <DataTable
          rows={categoryTotals}
          emptyLabel="Nenhuma categoria com gasto no periodo."
          columns={[
            { key: 'name', label: 'Categoria', sortable: true, filterable: true, value: row => row.name },
            { key: 'total', label: 'Total', align: 'right', sortable: true, value: row => row.total, render: row => formatBRL(row.total) },
            { key: 'percent', label: '%', align: 'center', sortable: true, value: row => row.percent, render: row => `${row.percent.toFixed(1)}%` },
            { key: 'count', label: 'Qtd', align: 'center', sortable: true, value: row => row.count },
            { key: 'averageTicket', label: 'Ticket medio', align: 'right', sortable: true, value: row => row.averageTicket, render: row => formatBRL(row.averageTicket) },
          ]}
        />
      </div>
      <div className="table-card wide">
        <h3>Ranking por local</h3>
        <DataTable
          rows={merchants}
          emptyLabel="Nenhum local encontrado."
          columns={[
            { key: 'merchant', label: 'Local', sortable: true, filterable: true, value: row => row.merchant },
            { key: 'total', label: 'Total', align: 'right', sortable: true, value: row => row.total, render: row => formatBRL(row.total) },
            { key: 'count', label: 'Qtd', align: 'center', sortable: true, value: row => row.count },
            { key: 'averageTicket', label: 'Ticket medio', align: 'right', sortable: true, value: row => row.averageTicket, render: row => formatBRL(row.averageTicket) },
            { key: 'variants', label: 'Variantes', value: row => row.variants.join(' / '), render: row => <span className="muted">{row.variants.join(' / ')}</span> },
          ]}
        />
      </div>
    </div>
  );
}

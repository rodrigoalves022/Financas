import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, Treemap, XAxis, YAxis, ZAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { filterByMonth, getAccountingMonth, getCategoryTotals, getMerchantTotals, getMonthCategoryDiff } from '../../utils/analytics';
import { AXIS_PROPS, GRID_COLOR, TOOLTIP_PROPS } from '../../utils/chartTheme';
import { formatBRL, formatMonth } from '../../utils/formatters';
import { DataTable } from '../ui/DataTable';

const TREEMAP_COLORS = ['#5b7cfa', '#4aa3b5', '#6ea879', '#c79a58', '#9b7ac7', '#c46f75', '#6f93b8', '#8aa0b2', '#7a8fb8', '#5f9ea0'];

export function Block2WhereMoneyWent({ selectedMonth, compareMonth }: { selectedMonth: string; compareMonth: string }) {
  const { transactions, categories, aliases } = useFinance();
  const scoped = filterByMonth(transactions, selectedMonth);
  const categoryTotals = getCategoryTotals(scoped, categories);
  const merchants = getMerchantTotals(scoped, aliases).slice(0, 15);
  const top3 = categoryTotals.slice(0, 3);
  const monthDiff = selectedMonth && compareMonth ? getMonthCategoryDiff(transactions, categories, selectedMonth, compareMonth).slice(0, 8) : [];
  const scatterRows = categoryTotals.map(item => ({ ...item, x: item.count, y: item.total, z: item.averageTicket }));
  const treemapRows = categoryTotals.map((item, index) => ({ ...item, size: item.total, color: TREEMAP_COLORS[index % TREEMAP_COLORS.length] }));
  const months = Array.from(new Set(transactions.map(item => getAccountingMonth(item)))).sort();
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
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis {...AXIS_PROPS} type="number" tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <YAxis {...AXIS_PROPS} type="category" dataKey="name" width={116} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="total" name="Total" fill="#2563eb" radius={[0, 6, 6, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Top 3 categorias no tempo</h3>
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={evolution}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis dataKey="month" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            {top3.map(category => <Line key={category.id} type="monotone" dataKey={category.name} name={category.name} stroke={category.color} strokeWidth={3} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Mapa de proporcao de gastos</h3>
        <ResponsiveContainer width="100%" height={300}>
          <Treemap data={treemapRows} dataKey="size" nameKey="name" stroke="#0f172a">
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            {treemapRows.map(item => <Cell key={item.id} fill={item.color} />)}
          </Treemap>
        </ResponsiveContainer>
      </div>
      <div className="chart-card">
        <h3>Valor x frequencia</h3>
        <ResponsiveContainer width="100%" height={340} minHeight={300}>
          <ScatterChart>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
            <XAxis {...AXIS_PROPS} type="number" dataKey="x" name="Compras" />
            <YAxis {...AXIS_PROPS} type="number" dataKey="y" name="Total" tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <ZAxis type="number" dataKey="z" range={[80, 420]} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Scatter data={scatterRows} fill="#0ea5e9" name="Categorias" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      {monthDiff.length ? (
        <div className="table-card wide">
          <h3>Comparativo mes a mes</h3>
          <DataTable
            rows={monthDiff}
            emptyLabel="Selecione dois meses para comparar."
            columns={[
              { key: 'name', label: 'Categoria', sortable: true, filterable: true, value: row => row.name },
              { key: 'current', label: selectedMonth, align: 'right', sortable: true, value: row => row.current, render: row => formatBRL(row.current) },
              { key: 'compare', label: compareMonth, align: 'right', sortable: true, value: row => row.compare, render: row => formatBRL(row.compare) },
              { key: 'diff', label: 'Diferenca', align: 'right', sortable: true, value: row => row.diff, render: row => <span className={row.diff > 0 ? 'bad-text' : 'good-text'}>{formatBRL(row.diff)}</span> },
              { key: 'percent', label: '%', align: 'center', sortable: true, value: row => row.percent || 0, render: row => row.percent === null ? '-' : `${row.percent.toFixed(1)}%` },
            ]}
          />
        </div>
      ) : null}
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

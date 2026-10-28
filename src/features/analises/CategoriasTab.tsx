import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, Treemap, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { filterByMonth, getCategoryTotals, getInvoiceMonths, getMerchantTotals, getMonthCategoryDiff } from '../../utils/analytics';
import { useChartTheme } from '../../utils/chartTheme';
import { fixedExpenseMonths, mergeFixedIntoCategories } from '../../utils/fixedExpenses';
import { useSpendingScope } from '../../store/spendingScope';
import { SpendingScopeTabs } from '../../components/SpendingScopeTabs';
import { currentMonthISO, formatBRL, formatInvoiceMonthLabel, formatMonth, formatMonthShort, shiftMonth, titleCase } from '../../utils/formatters';
import { Card, CategoryDot, StatCard } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';

interface TreemapNodeProps {
  x?: number; y?: number; width?: number; height?: number; name?: string; fill?: string; total?: number; depth?: number;
}

// O conteúdo padrão do Treemap ignora a cor de cada item; este desenha cor e rótulo.
function TreemapNode({ x = 0, y = 0, width = 0, height = 0, name, fill, total, depth }: TreemapNodeProps) {
  if (depth !== 1) return null;
  const showLabel = width > 70 && height > 34;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx={8} fill={fill} stroke="rgba(0,0,0,0.25)" />
      {showLabel ? (
        <>
          <text x={x + 10} y={y + 20} fill="#fff" fontSize={12} fontWeight={700}>{name}</text>
          <text x={x + 10} y={y + 36} fill="rgba(255,255,255,0.85)" fontSize={11}>{formatBRL(total || 0)}</text>
        </>
      ) : null}
    </g>
  );
}

export function CategoriasTab({ selectedMonth, months }: { selectedMonth: string; months: string[] }) {
  const { transactions, categories, aliases, fixedExpenses } = useFinance();
  const chart = useChartTheme();
  const navigate = useNavigate();
  const scope = useSpendingScope();
  const includeFixed = scope === 'tudo';
  const openCategory = (categoryId: string) => navigate(`/transacoes?categoria=${categoryId}`);
  // Categoria que só tem contas fixas não tem compra para listar: abre as contas.
  const openRow = (row: { id: string; cardTotal: number }) => (row.cardTotal ? openCategory(row.id) : navigate('/contas'));
  const openMerchant = (merchant: string) => navigate(`/transacoes?busca=${encodeURIComponent(merchant)}`);
  const [compareMonth, setCompareMonth] = useState(() => selectedMonth ? shiftMonth(selectedMonth, -1) : '');

  const data = useMemo(() => {
    const scoped = filterByMonth(transactions, selectedMonth);
    const limit = shiftMonth(currentMonthISO(), 1);
    // Modo "Tudo": as contas fixas entram na categoria delas (carro em Transporte, internet em Moradia).
    const withFixed = (cardTotals: ReturnType<typeof getCategoryTotals>, months: string[]) => includeFixed
      ? mergeFixedIntoCategories(cardTotals, fixedExpenses, months, categories)
      : cardTotals.map(item => ({ ...item, cardTotal: item.total, fixedTotal: 0 }));
    const categoryTotals = withFixed(getCategoryTotals(scoped, categories), selectedMonth ? [selectedMonth] : fixedExpenseMonths(fixedExpenses, limit));
    const merchants = getMerchantTotals(scoped, aliases);
    const top3 = categoryTotals.slice(0, 3);
    const evolution = getInvoiceMonths(transactions).filter(month => month <= limit).slice(-12).map(month => {
      const totals = withFixed(getCategoryTotals(filterByMonth(transactions, month), categories), [month]);
      return top3.reduce<Record<string, string | number>>((row, category) => {
        row[category.name] = totals.find(item => item.id === category.id)?.total || 0;
        return row;
      }, { month: formatMonthShort(month) });
    });
    return {
      categoryTotals, merchants, top3, evolution,
      total: categoryTotals.reduce((sum, item) => sum + item.total, 0),
      fixedTotal: categoryTotals.reduce((sum, item) => sum + item.fixedTotal, 0),
    };
  }, [transactions, categories, aliases, fixedExpenses, includeFixed, selectedMonth]);

  const monthDiff = useMemo(
    () => selectedMonth && compareMonth ? getMonthCategoryDiff(transactions, categories, selectedMonth, compareMonth) : [],
    [transactions, categories, selectedMonth, compareMonth],
  );

  if (!data.categoryTotals.length) return <EmptyState title="Sem gastos no período" description="Escolha outro mês no topo da página." />;

  const treemapRows = data.categoryTotals.map(item => ({ name: item.name, size: item.total, total: item.total, fill: item.color }));

  return (
    <div className="page-grid">
      {fixedExpenses.length ? (
        <div className="toolbar-row">
          <span className="muted">{includeFixed ? 'Cartão + contas fixas: cada conta entra na categoria dela.' : 'Só as compras do cartão.'}</span>
          <SpendingScopeTabs />
        </div>
      ) : null}
      <div className="stat-grid">
        <StatCard label="Total analisado" value={formatBRL(data.total)}
          hint={`${selectedMonth ? formatMonth(selectedMonth) : 'Todo o período'}${data.fixedTotal ? ` · ${formatBRL(data.fixedTotal)} de contas fixas` : ''}`} />
        <StatCard label="Categorias com gasto" value={data.categoryTotals.length} hint={`${data.categoryTotals.reduce((sum, item) => sum + item.count, 0)} compras`} onClick={() => document.getElementById('ranking-categorias')?.scrollIntoView({ behavior: 'smooth' })} />
        <StatCard label="Categoria principal" value={data.categoryTotals[0]?.name || '-'} hint={data.categoryTotals[0] ? `${data.categoryTotals[0].percent.toFixed(1)}% do total` : ''} onClick={data.categoryTotals[0] ? () => openRow(data.categoryTotals[0]) : undefined} />
        <StatCard label="Local principal" value={data.merchants[0] ? titleCase(data.merchants[0].merchant) : '-'} hint={data.merchants[0] ? formatBRL(data.merchants[0].total) : ''} onClick={data.merchants[0] ? () => openMerchant(data.merchants[0].merchant) : undefined} />
      </div>

      <Card span="half" title="Mapa de proporção" subtitle="Tamanho de cada bloco = quanto a categoria pesou">
        <ResponsiveContainer width="100%" height={300}>
          <Treemap data={treemapRows} dataKey="size" nameKey="name" isAnimationActive={false} content={<TreemapNode />}>
            <Tooltip {...chart.tooltip} />
          </Treemap>
        </ResponsiveContainer>
      </Card>

      <Card span="half" title="Top 3 categorias no tempo" subtitle="Últimos 12 meses">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data.evolution}>
            <CartesianGrid {...chart.grid} vertical={false} />
            <XAxis dataKey="month" {...chart.axis} />
            <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
            <Tooltip {...chart.tooltip} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {data.top3.map(category => <Line key={category.id} type="monotone" dataKey={category.name} stroke={category.color} strokeWidth={2.5} dot={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card span="full" title="Comparar com outro mês" subtitle={selectedMonth ? `Diferença por categoria entre ${formatMonth(selectedMonth)} e o mês escolhido` : 'Escolha um mês específico no topo para comparar'}
        actions={selectedMonth ? (
          <select value={compareMonth} onChange={event => setCompareMonth(event.target.value)} style={{ width: 240 }}>
            <option value="">Escolha o mês</option>
            {months.filter(month => month !== selectedMonth).map(month => <option key={month} value={month}>{formatInvoiceMonthLabel(month)}</option>)}
          </select>
        ) : null}>
        {monthDiff.length ? (
          <>
            <ResponsiveContainer width="100%" height={Math.max(200, monthDiff.slice(0, 10).length * 34)}>
              <BarChart data={monthDiff.slice(0, 10)} layout="vertical" margin={{ left: 8 }}>
                <CartesianGrid {...chart.grid} horizontal={false} />
                <XAxis type="number" {...chart.axis} tickFormatter={chart.moneyAxis} />
                <YAxis type="category" dataKey="name" {...chart.axis} width={130} />
                <Tooltip {...chart.tooltip} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="compare" name={formatMonth(compareMonth)} fill={chart.colors.border} radius={[0, 4, 4, 0]} />
                <Bar dataKey="current" name={formatMonth(selectedMonth)} fill={chart.colors.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <DataTable
              rows={monthDiff}
              searchable={false}
              rowKey={row => row.id}
              onRowClick={row => openCategory(row.id)}
              initialSort={{ key: 'diff', direction: 'desc' }}
              columns={[
                { key: 'name', label: 'Categoria', value: row => row.name, render: row => <span className="category-tag"><CategoryDot color={row.color} />{row.name}</span> },
                { key: 'current', label: formatMonth(selectedMonth), align: 'right', value: row => row.current, render: row => formatBRL(row.current) },
                { key: 'compare', label: formatMonth(compareMonth), align: 'right', value: row => row.compare, render: row => formatBRL(row.compare) },
                { key: 'diff', label: 'Diferença', align: 'right', value: row => row.diff, render: row => <span className={row.diff > 0 ? 'text-bad' : 'text-good'}>{row.diff > 0 ? '+' : ''}{formatBRL(row.diff)}</span> },
                { key: 'percent', label: 'Variação', align: 'right', value: row => row.percent ?? 0, render: row => row.percent === null ? 'novo' : `${row.percent > 0 ? '+' : ''}${row.percent.toFixed(0)}%` },
              ]}
            />
          </>
        ) : <EmptyState compact title={selectedMonth ? 'Escolha um mês para comparar.' : 'Selecione um mês específico no topo.'} />}
      </Card>

      <Card span="full" title="Ranking por categoria" subtitle="Toque numa linha para ver as compras" className="anchor" >
        <span id="ranking-categorias" />
        <DataTable
          rows={data.categoryTotals}
          rowKey={row => row.id}
          onRowClick={openRow}
          initialSort={{ key: 'total', direction: 'desc' }}
          columns={[
            { key: 'name', label: 'Categoria', value: row => row.name, render: row => <span className="category-tag"><CategoryDot color={row.color} />{row.name}</span> },
            { key: 'total', label: 'Total', align: 'right', value: row => row.total, render: row => formatBRL(row.total) },
            { key: 'percent', label: '% do total', align: 'right', value: row => row.percent, render: row => `${row.percent.toFixed(1)}%` },
            ...(data.fixedTotal ? [{ key: 'fixedTotal', label: 'Contas fixas', align: 'right' as const, value: (row: (typeof data.categoryTotals)[number]) => row.fixedTotal, render: (row: (typeof data.categoryTotals)[number]) => row.fixedTotal ? formatBRL(row.fixedTotal) : <span className="muted">—</span> }] : []),
            { key: 'count', label: 'Compras', align: 'right', value: row => row.count },
            { key: 'averageTicket', label: 'Ticket médio', align: 'right', value: row => row.averageTicket, render: row => formatBRL(row.averageTicket) },
          ]}
        />
      </Card>

      <Card span="full" title="Ranking por local" subtitle="Variações de maquininha e cidade já agrupadas · toque para ver as compras">
        <DataTable
          rows={data.merchants}
          rowKey={row => row.merchant}
          onRowClick={row => openMerchant(row.merchant)}
          initialSort={{ key: 'total', direction: 'desc' }}
          searchPlaceholder="Buscar local..."
          columns={[
            { key: 'merchant', label: 'Local', value: row => row.merchant, render: row => <strong>{titleCase(row.merchant)}</strong> },
            { key: 'total', label: 'Total', align: 'right', value: row => row.total, render: row => formatBRL(row.total) },
            { key: 'count', label: 'Compras', align: 'right', value: row => row.count },
            { key: 'averageTicket', label: 'Ticket médio', align: 'right', value: row => row.averageTicket, render: row => formatBRL(row.averageTicket) },
            { key: 'variants', label: 'Como aparece na fatura', sortable: false, value: row => row.variants.join(' / '), render: row => <span className="muted">{row.variants.join(' · ')}</span> },
          ]}
        />
      </Card>
    </div>
  );
}

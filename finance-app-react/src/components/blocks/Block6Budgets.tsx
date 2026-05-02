import { useCallback, useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { filterByMonth, getCategoryTotals, getFutureInstallments } from '../../utils/analytics';
import { AXIS_PROPS, GRID_COLOR, TOOLTIP_PROPS } from '../../utils/chartTheme';
import { formatBRL, formatDate, formatMonth } from '../../utils/formatters';
import { DataTable, type Column } from '../ui/DataTable';

type PlanningRow = {
  date: string;
  description: string;
  category: string;
  amount: number;
  type: string;
};

export function Block6Budgets({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, debts, budgets } = useFinance();
  const categoryName = useCallback((id: string) => categories.find(item => item.id === id)?.name || 'Outros', [categories]);

  const rows = useMemo<PlanningRow[]>(() => {
    const installments = getFutureInstallments(transactions).map(item => ({
      date: item.date,
      description: item.description,
      category: categoryName(item.categoryId),
      amount: item.amount,
      type: item.type,
    }));
    const debtRows = debts
      .filter(item => item.type === 'a_pagar' && item.monthlyPayment > 0)
      .map(item => ({
        date: item.startDate,
        description: item.counterparty,
        category: 'Dividas',
        amount: item.monthlyPayment,
        type: 'Parcela fixa',
      }));
    return [...installments, ...debtRows].sort((a, b) => a.date.localeCompare(b.date));
  }, [transactions, debts, categoryName]);

  const chartRows = useMemo(() => {
    const groups = new Map<string, number>();
    rows.forEach(item => {
      const month = item.date.substring(0, 7);
      groups.set(month, (groups.get(month) || 0) + item.amount);
    });
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b)).slice(0, 12).map(([month, amount]) => ({
      month,
      label: formatMonth(month),
      amount,
    }));
  }, [rows]);

  const budgetRows = useMemo(() => {
    const totals = getCategoryTotals(filterByMonth(transactions, selectedMonth), categories);
    return budgets.map(budget => {
      const category = categories.find(item => item.id === budget.categoryId);
      const spent = totals.find(item => item.id === budget.categoryId)?.total || 0;
      return {
        category: category?.name || budget.categoryId,
        color: category?.color || '#64748b',
        spent,
        limit: budget.monthlyLimit,
        progress: budget.monthlyLimit ? (spent / budget.monthlyLimit) * 100 : 0,
      };
    }).sort((a, b) => b.progress - a.progress);
  }, [budgets, categories, selectedMonth, transactions]);

  const columns: Column<PlanningRow>[] = [
    { key: 'date', header: 'Data', accessor: row => formatDate(row.date), align: 'center', sortValue: row => row.date },
    { key: 'description', header: 'Descricao', accessor: row => row.description },
    { key: 'category', header: 'Categoria', accessor: row => row.category, align: 'center' },
    { key: 'type', header: 'Tipo', accessor: row => row.type, align: 'center' },
    { key: 'amount', header: 'Valor', accessor: row => row.amount, render: row => formatBRL(row.amount), align: 'right' },
  ];

  if (!rows.length && !budgetRows.length) {
    return <div className="empty-state">Sem parcelas futuras ou compromissos cadastrados. Quando houver parcelamentos ou dividas fixas, eles aparecem aqui.</div>;
  }

  return (
    <div className="section-grid">
      {budgetRows.length ? (
        <div className="chart-card wide">
          <h3>Metas por categoria</h3>
          <div className="budget-list">
            {budgetRows.map(row => (
              <div className="budget-row" key={row.category}>
                <div>
                  <strong>{row.category}</strong>
                  <span>{formatBRL(row.spent)} de {formatBRL(row.limit)}</span>
                </div>
                <div className="progress-track">
                  <div className={row.progress >= 100 ? 'progress-fill danger' : row.progress >= 80 ? 'progress-fill warn' : 'progress-fill good'} style={{ width: `${Math.min(100, row.progress)}%`, backgroundColor: row.progress < 80 ? row.color : undefined }} />
                </div>
                <span className={row.progress >= 80 ? 'bad-text' : 'good-text'}>{row.progress.toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="chart-card">
        <h3>Compromissos futuros</h3>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartRows}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
            <XAxis dataKey="label" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip {...TOOLTIP_PROPS} formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="amount" name="Valor" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card wide">
        <h3>Tabela de planejamento</h3>
        <DataTable rows={rows} columns={columns} searchPlaceholder="Buscar parcela, categoria ou tipo..." initialPageSize={8} />
      </div>
    </div>
  );
}

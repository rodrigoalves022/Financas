import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FormEvent } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, Lightbulb, Pencil, PiggyBank, Plus, Target, Trash2 } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { filterByMonth, getBudgetStatus, getCategoryTotals, getFutureInstallments, getLatestInvoiceMonth, getMonthlyDebtCommitment, type BudgetStatus } from '../../utils/analytics';
import { useChartTheme } from '../../utils/chartTheme';
import { getFixedMonthlyTotal } from '../../utils/fixedExpenses';
import { currentMonthISO, formatBRL, formatDate, formatMonth, formatMonthLong, formatMonthShort, parseAmount, shiftMonth } from '../../utils/formatters';
import { Badge, Card, CategoryDot, Field, ProgressBar, StatCard } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';

const roundUp = (value: number, step = 50) => Math.ceil(value / step) * step;

export function MetasPage({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, budgets, debts, fixedExpenses } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const chart = useChartTheme();
  const [editing, setEditing] = useState<{ categoryId: string; limit?: number } | null>(null);

  const month = selectedMonth || getLatestInvoiceMonth(transactions) || currentMonthISO();
  const status = useMemo(() => getBudgetStatus(budgets, transactions, categories, month), [budgets, transactions, categories, month]);

  const suggestions = useMemo(() => {
    const withBudget = new Set(budgets.map(budget => budget.categoryId));
    const previous = [1, 2, 3].map(offset => shiftMonth(month, -offset));
    const totals = previous.map(item => getCategoryTotals(filterByMonth(transactions, item), categories));
    return categories
      .filter(category => !withBudget.has(category.id))
      .map(category => ({ category, average: totals.reduce((sum, list) => sum + (list.find(row => row.id === category.id)?.total || 0), 0) / previous.length }))
      .filter(item => item.average >= 50)
      .sort((a, b) => b.average - a.average)
      .slice(0, 6);
  }, [budgets, categories, transactions, month]);

  const commitments = useMemo(() => {
    const debtMonthly = getMonthlyDebtCommitment(debts, transactions);
    const installments = getFutureInstallments(transactions);
    const start = currentMonthISO() > month ? currentMonthISO() : month;
    const months = Array.from({ length: 12 }, (_, index) => shiftMonth(start, index + 1));
    const chartRows = months.map(item => {
      const parcel = installments.filter(row => row.month === item).reduce((sum, row) => sum + row.amount, 0);
      return { month: item, label: formatMonthShort(item), parcelas: parcel, dividas: debtMonthly + getFixedMonthlyTotal(fixedExpenses, item) };
    }).filter(row => row.parcelas > 0 || row.dividas > 0);
    const categoryName = (id: string) => categories.find(category => category.id === id)?.name || 'Outros';
    const tableRows = installments.filter(row => row.month > month).map(row => ({ ...row, category: categoryName(row.categoryId) }));
    return { chartRows, tableRows, next3: chartRows.slice(0, 3).reduce((sum, row) => sum + row.parcelas + row.dividas, 0) };
  }, [debts, fixedExpenses, transactions, categories, month]);

  const budgeted = status.reduce((sum, item) => sum + item.limit, 0);
  const spent = status.reduce((sum, item) => sum + Math.min(item.spent, item.limit * 10), 0);
  const exceeded = status.filter(item => item.level === 'estourado').length;

  const remove = async (item: BudgetStatus) => {
    if (!await confirm({ title: `Remover meta de ${item.name}?`, message: 'Os lançamentos não mudam.', confirmLabel: 'Remover', tone: 'danger' })) return;
    await callTool('excluir_meta', { categoryId: item.categoryId });
    toast('Meta removida.');
  };

  const quickCreate = async (categoryId: string, limit: number) => {
    await callTool('salvar_meta', { categoryId, monthlyLimit: limit });
    toast(`Meta de ${formatBRL(limit)} criada.`);
  };

  const [filterExceeded, setFilterExceeded] = useState(false);
  const [searchParams] = useSearchParams();
  const requestedParcelas = searchParams.get('parcelas');
  const [selectedCommitmentMonth, setSelectedCommitmentMonth] = useState<string | null>(() => requestedParcelas && /^\d{4}-\d{2}$/.test(requestedParcelas) ? requestedParcelas : null);

  // Vindo do Painel: rola direto para os compromissos.
  useEffect(() => {
    if (!requestedParcelas) return;
    const timer = window.setTimeout(() => document.getElementById('compromissos-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    return () => window.clearTimeout(timer);
  }, [requestedParcelas]);

  const displayedStatus = useMemo(() => {
    if (!filterExceeded) return status;
    return status.filter(item => item.level === 'estourado' || item.level === 'alerta');
  }, [status, filterExceeded]);

  const displayedTableRows = useMemo(() => {
    if (!selectedCommitmentMonth) return commitments.tableRows;
    return commitments.tableRows.filter(row => row.month === selectedCommitmentMonth);
  }, [commitments.tableRows, selectedCommitmentMonth]);

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard
          label="Metas ativas"
          value={status.length}
          icon={<Target size={16} />}
          hint={formatMonthLong(month)}
          onClick={() => {
            setFilterExceeded(false);
            document.getElementById('metas-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
        <StatCard
          label="Gasto x orçado"
          value={`${formatBRL(spent)}`}
          hint={`de ${formatBRL(budgeted)} nas categorias com meta`}
          tone={spent > budgeted ? 'bad' : 'neutral'}
          icon={<PiggyBank size={16} />}
          onClick={() => {
            document.getElementById('metas-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
        <StatCard
          label="Estouradas"
          value={exceeded}
          tone={exceeded ? 'bad' : 'good'}
          hint={`${status.filter(item => item.level === 'alerta').length} acima de 80%`}
          active={filterExceeded}
          onClick={() => {
            setFilterExceeded(prev => !prev);
            document.getElementById('metas-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
        <StatCard
          label="Já comprometido (3 meses)"
          value={formatBRL(commitments.next3)}
          icon={<CalendarClock size={16} />}
          hint="Parcelas + dívidas e contas fixas"
          onClick={() => {
            document.getElementById('compromissos-section')?.scrollIntoView({ behavior: 'smooth' });
          }}
        />
      </div>

      <div id="metas-section" className="span-full">
        <Card
          span="full"
          icon={<Target size={17} />}
          title={`Metas de ${formatMonthLong(month)}${filterExceeded ? ' (filtrando estouradas/alerta)' : ''}`}
          subtitle="Teto mensal por categoria. O Painel avisa quando passa de 80%."
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              {filterExceeded ? (
                <button type="button" className="ghost-button sm" onClick={() => setFilterExceeded(false)}>
                  Mostrar todas
                </button>
              ) : null}
              <button type="button" className="primary-button" onClick={() => setEditing({ categoryId: '' })}>
                <Plus size={15} /> Nova meta
              </button>
            </div>
          }
        >
          {displayedStatus.length ? (
            <div className="budget-grid" style={{ gridColumn: 'auto' }}>
              {displayedStatus.map(item => (
                <div className="card budget-card" key={item.categoryId} style={{ boxShadow: 'none', background: 'var(--surface-2)' }}>
                  <div className="person-head">
                    <CategoryDot color={item.color} />
                    <div className="grow"><strong>{item.name}</strong><small>média 3 meses: {formatBRL(item.average)}</small></div>
                    <Badge tone={item.level === 'estourado' ? 'bad' : item.level === 'alerta' ? 'warn' : 'good'}>{item.progress.toFixed(0)}%</Badge>
                  </div>
                  <div className="budget-amounts">
                    <div><strong>{formatBRL(item.spent)}</strong><span> de {formatBRL(item.limit)}</span></div>
                    <span className={item.remaining < 0 ? 'text-bad' : 'muted'}>{item.remaining < 0 ? `${formatBRL(-item.remaining)} acima` : `${formatBRL(item.remaining)} livres`}</span>
                  </div>
                  <ProgressBar value={item.progress} tone={item.level === 'estourado' ? 'bad' : item.level === 'alerta' ? 'warn' : 'good'} />
                  <div className="row-actions" style={{ justifyContent: 'flex-end', display: 'flex', gap: 6 }}>
                    <button type="button" className="icon-button sm ghost" onClick={() => setEditing({ categoryId: item.categoryId, limit: item.limit })} title="Editar"><Pencil size={14} /></button>
                    <button type="button" className="icon-button sm ghost danger" onClick={() => remove(item)} title="Remover"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<Target size={22} />} title={filterExceeded ? "Nenhuma meta estourada" : "Nenhuma meta ainda"} description={filterExceeded ? "Todas as metas estão dentro do orçamento planejado." : "Defina tetos para as categorias que mais pesam — veja as sugestões abaixo."} />}
        </Card>
      </div>

      {suggestions.length ? (
        <Card span="full" icon={<Lightbulb size={17} />} title="Sugestões de meta" subtitle="Categorias sem teto, com a média dos 3 meses anteriores arredondada para cima.">
          <div className="category-grid">
            {suggestions.map(({ category, average }) => (
              <div className="category-card" key={category.id}>
                <CategoryDot color={category.color} />
                <div className="grow"><strong>{category.name}</strong><small>média {formatBRL(average)}</small></div>
                <button type="button" className="small-action primary" onClick={() => quickCreate(category.id, roundUp(average))}>{formatBRL(roundUp(average))}</button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <div id="compromissos-section" className="span-full">
        <Card
          span="full"
          icon={<CalendarClock size={17} />}
          title="Compromissos dos próximos meses"
          subtitle="Parcelas do cartão já lançadas, parcelas de dívidas próprias e contas fixas."
          actions={
            selectedCommitmentMonth ? (
              <button type="button" className="ghost-button sm" onClick={() => setSelectedCommitmentMonth(null)}>
                Limpar filtro ({formatMonth(selectedCommitmentMonth)})
              </button>
            ) : null
          }
        >
          {commitments.chartRows.length ? (
            <>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={commitments.chartRows}
                  style={{ cursor: 'pointer' }}
                  onClick={state => {
                    // Recharts 3 não manda mais activePayload no clique: acha a barra pelo índice/rótulo.
                    const { activeTooltipIndex, activeLabel } = (state || {}) as { activeTooltipIndex?: number | string | null; activeLabel?: string | number };
                    const row = commitments.chartRows[Number(activeTooltipIndex)] || commitments.chartRows.find(item => item.label === activeLabel);
                    if (row) setSelectedCommitmentMonth(prev => prev === row.month ? null : row.month);
                  }}
                >
                  <CartesianGrid {...chart.grid} vertical={false} />
                  <XAxis dataKey="label" {...chart.axis} />
                  <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
                  <Tooltip {...chart.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="parcelas" name="Parcelas do cartão" stackId="c" fill={chart.colors.primary} />
                  <Bar dataKey="dividas" name="Dívidas e contas fixas" stackId="c" fill={chart.colors.info} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <DataTable
                rows={displayedTableRows}
                rowKey={(row, index) => `${row.month}-${row.description}-${index}`}
                initialSort={{ key: 'month', direction: 'asc' }}
                initialPageSize={10}
                searchPlaceholder="Buscar parcela..."
                emptyLabel={selectedCommitmentMonth ? `Sem parcelas para ${formatMonth(selectedCommitmentMonth)}.` : "Sem parcelas futuras no cartão."}
                columns={[
                  { key: 'month', label: 'Fatura', value: row => row.month, render: row => formatMonth(row.month) },
                  { key: 'date', label: 'Compra', value: row => formatDate(row.date), sortValue: row => row.date },
                  {
                    key: 'description', label: 'Descrição', value: row => `${row.note || ''} ${row.description}`, render: row => row.note ? (
                      <div className="merchant-cell">
                        <strong>{row.note}</strong>
                        <small title={row.description}>{row.description}</small>
                      </div>
                    ) : row.description,
                  },
                  { key: 'category', label: 'Categoria', value: row => row.category },
                  { key: 'type', label: 'Parcela', align: 'center', value: row => row.type, render: row => <Badge>{row.type}</Badge> },
                  { key: 'amount', label: 'Valor', align: 'right', value: row => row.amount, render: row => formatBRL(row.amount) },
                ]}
              />
            </>
          ) : <EmptyState compact title="Nenhum compromisso futuro registrado." />}
        </Card>
      </div>

      {editing ? <BudgetModal initial={editing} month={month} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function BudgetModal({ initial, month, onClose }: { initial: { categoryId: string; limit?: number }; month: string; onClose: () => void }) {
  const { categories, budgets, transactions } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const available = categories.filter(category => category.id === initial.categoryId || !budgets.some(budget => budget.categoryId === category.id));
  const [categoryId, setCategoryId] = useState(initial.categoryId || available[0]?.id || '');
  const [limit, setLimit] = useState(initial.limit ? String(initial.limit) : '');

  const average = useMemo(() => {
    const months = [1, 2, 3].map(offset => shiftMonth(month, -offset));
    return months.reduce((sum, item) => sum + (getCategoryTotals(filterByMonth(transactions, item), categories).find(row => row.id === categoryId)?.total || 0), 0) / months.length;
  }, [month, transactions, categories, categoryId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = await callTool('salvar_meta', { categoryId, monthlyLimit: parseAmount(limit) });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast('Meta salva.');
    onClose();
  };

  return (
    <Modal size="sm" title={initial.categoryId ? 'Editar meta' : 'Nova meta'} subtitle="Quanto você quer gastar, no máximo, por mês." onClose={onClose} icon={<Target size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="budget-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="budget-form" className="form-grid" onSubmit={save}>
        <Field label="Categoria" full>
          <select required value={categoryId} onChange={event => setCategoryId(event.target.value)} disabled={Boolean(initial.categoryId)}>
            {available.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label="Teto mensal" full hint={average ? <>Média dos 3 meses anteriores: {formatBRL(average)} · <button type="button" className="link-button" onClick={() => setLimit(String(roundUp(average)))}>usar {formatBRL(roundUp(average))}</button></> : undefined}>
          <input required type="number" step="0.01" min="1" inputMode="decimal" autoFocus value={limit} onChange={event => setLimit(event.target.value)} placeholder="0,00" />
        </Field>
      </form>
    </Modal>
  );
}

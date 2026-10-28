import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarClock, Check, CircleDollarSign, Pencil, Plus, Receipt, Repeat, Trash2 } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { fixedExpenseLastMonth, getFixedExpensesForMonth, installmentProgress, type FixedExpenseMonth } from '../../utils/fixedExpenses';
import { currentMonthISO, formatBRL, formatMonthLong, parseAmount, shiftMonth } from '../../utils/formatters';
import { Card, CategoryDot, Field, ProgressBar, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { FixedExpense } from '../../types';

const KIND_LABEL: Record<FixedExpense['kind'], string> = {
  fixa: 'Valor fixo',
  variavel: 'Valor muda todo mês',
  parcelada: 'Parcelada',
};

export function ContasFixasPage({ selectedMonth }: { selectedMonth: string }) {
  const { fixedExpenses, categories } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<FixedExpense | null>(null);
  const [creating, setCreating] = useState(false);
  // Em "Todo o período" a tela mostra o mês corrente: conta fixa é sempre de um mês.
  const month = selectedMonth || currentMonthISO();

  const rows = useMemo(() => getFixedExpensesForMonth(fixedExpenses, month), [fixedExpenses, month]);
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  const paidTotal = rows.filter(row => row.paid).reduce((sum, row) => sum + row.amount, 0);
  const pendingValues = rows.filter(row => row.pending).length;
  const installmentsLeft = fixedExpenses.reduce((sum, expense) => sum + (installmentProgress(expense)?.remainingTotal || 0), 0);
  const categoryOf = (id?: string) => categories.find(category => category.id === id);

  const togglePaid = async (row: FixedExpenseMonth) => {
    const result = await callTool('pagar_conta_fixa', { id: row.expense.id, month, paid: !row.paid });
    if (!result.success) toast(result.message, 'error');
    else toast(row.paid ? `${row.expense.name}: ${formatMonthLong(month)} reaberta.` : `${row.expense.name} paga em ${formatMonthLong(month)}.`);
  };

  const remove = async (expense: FixedExpense) => {
    if (!await confirm({ title: `Excluir ${expense.name}?`, message: 'Apaga a conta e todo o histórico de valores e pagamentos dela.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    await callTool('excluir_conta_fixa', { id: expense.id });
    toast('Conta excluída.');
  };

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label={`Contas de ${formatMonthLong(month)}`} value={formatBRL(total)} hint={`${rows.length} conta(s) fora do cartão`} icon={<Receipt size={16} />} />
        <StatCard label="Pagas" value={formatBRL(paidTotal)} hint={`${rows.filter(row => row.paid).length} de ${rows.length}`} tone="good" icon={<Check size={16} />} />
        <StatCard label="A pagar" value={formatBRL(total - paidTotal)} hint={pendingValues ? `${pendingValues} sem valor lançado` : 'Valores do mês completos'} tone={total - paidTotal > 0 ? 'warn' : 'neutral'} icon={<CircleDollarSign size={16} />} />
        <StatCard label="Parcelas restantes" value={formatBRL(installmentsLeft)} hint="Soma do que falta nas parceladas" icon={<CalendarClock size={16} />} />
      </div>

      <div className="toolbar-row">
        <span className="muted">Contas pagas fora do cartão (boleto, Pix, débito). Entram nos compromissos e no saldo do mês.</span>
        <button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova conta</button>
      </div>

      {fixedExpenses.length ? (
        <>
          <Card span="two-thirds" icon={<Repeat size={17} />} title={`Contas de ${formatMonthLong(month)}`} subtitle="Lance o valor das contas variáveis e marque o que já pagou.">
            {rows.length ? (
              <div className="list">
                {rows.map(row => {
                  const category = categoryOf(row.expense.categoryId);
                  return (
                    <div className="list-row fixed-row" key={row.expense.id}>
                      {category ? <CategoryDot color={category.color} /> : <span className="category-dot" />}
                      <div className="grow">
                        <span className="title">{row.expense.name}</span>
                        <span className="subtitle">
                          {row.installment && row.expense.installments ? `Parcela ${row.installment}/${row.expense.installments}` : KIND_LABEL[row.expense.kind]}
                          {row.expense.dueDay ? ` · vence dia ${row.expense.dueDay}` : ''}
                          {category ? ` · ${category.name}` : ''}
                          {row.expense.note ? ` · ${row.expense.note}` : ''}
                        </span>
                      </div>
                      {row.expense.kind === 'variavel'
                        ? <MonthValueInput key={`${row.expense.id}-${month}-${row.expense.values[month] ?? ''}`} row={row} />
                        : <strong className="fixed-amount">{formatBRL(row.amount)}</strong>}
                      <button type="button" className={`status-pill as-button ${row.paid ? 'paid' : 'open'}`} onClick={() => togglePaid(row)} title={row.paid ? 'Clique para reabrir' : 'Marcar como paga'}>
                        {row.paid ? 'Paga' : 'A pagar'}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState compact title={`Nenhuma conta em ${formatMonthLong(month)}.`} description="As contas aparecem a partir do mês de início de cada uma." />}
          </Card>

          <Card span="third" icon={<Receipt size={17} />} title="Todas as contas">
            <div className="list">
              {fixedExpenses.map(expense => {
                const progress = installmentProgress(expense);
                const last = fixedExpenseLastMonth(expense);
                return (
                  <div className="list-row fixed-summary" key={expense.id}>
                    <div className="grow">
                      <span className="title">{expense.name}</span>
                      <span className="subtitle">
                        {expense.kind === 'variavel' ? `Valor muda todo mês${expense.amount ? ` · estimativa ${formatBRL(expense.amount)}` : ''}` : `${formatBRL(expense.amount)}/mês`}
                        {progress ? ` · ${progress.paid}/${expense.installments} pagas` : ''}
                      </span>
                      {progress ? (
                        <>
                          <ProgressBar value={(progress.paid / (expense.installments || 1)) * 100} size="sm" tone={progress.remaining ? 'accent' : 'good'} />
                          <span className="subtitle">{progress.remaining ? `Faltam ${progress.remaining} (${formatBRL(progress.remainingTotal)}) · última em ${formatMonthLong(progress.lastMonth)}` : 'Quitada'}</span>
                        </>
                      ) : last ? <span className="subtitle">Até {formatMonthLong(last)}</span> : null}
                    </div>
                    <div className="row-actions">
                      <button type="button" className="icon-button sm ghost" onClick={() => setEditing(expense)} title="Editar"><Pencil size={14} /></button>
                      <button type="button" className="icon-button sm ghost danger" onClick={() => remove(expense)} title="Excluir"><Trash2 size={14} /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      ) : (
        <Card span="full">
          <EmptyState icon={<Receipt size={22} />} title="Nenhuma conta fixa"
            description="Cadastre o que você paga fora do cartão: financiamento, internet, aluguel, mesada, escola…"
            action={<button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova conta</button>} />
        </Card>
      )}

      {creating || editing ? <FixedExpenseModal expense={editing} onClose={() => { setCreating(false); setEditing(null); }} /> : null}
    </div>
  );
}

/** Valor do mês de uma conta variável: grava ao sair do campo ou com Enter. */
function MonthValueInput({ row }: { row: FixedExpenseMonth }) {
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const launched = row.expense.values[row.month];
  const [value, setValue] = useState(launched === undefined ? '' : String(launched));

  const save = async () => {
    const text = value.trim();
    const next = text ? parseAmount(text) : null;
    if (next === (launched ?? null)) return;
    const result = await callTool('lancar_valor_conta_fixa', { id: row.expense.id, month: row.month, value: next });
    if (!result.success) toast(result.message, 'error');
    else if (next !== null) toast(`${row.expense.name}: ${formatBRL(next)} em ${formatMonthLong(row.month)}.`);
  };

  return (
    <input
      className={`fixed-value-input ${row.pending ? 'pending' : ''}`}
      inputMode="decimal"
      value={value}
      placeholder={row.amount ? `≈ ${formatBRL(row.amount)}` : 'Lançar valor'}
      title={row.pending ? 'Valor deste mês ainda não lançado — o saldo usa a estimativa' : 'Valor lançado neste mês'}
      onChange={event => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
    />
  );
}

function FixedExpenseModal({ expense, onClose }: { expense: FixedExpense | null; onClose: () => void }) {
  const { categories } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const today = currentMonthISO();
  const progress = expense ? installmentProgress(expense) : null;

  const [name, setName] = useState(expense?.name || '');
  const [kind, setKind] = useState<FixedExpense['kind']>(expense?.kind || 'fixa');
  const [categoryId, setCategoryId] = useState(expense?.categoryId || '');
  const [amount, setAmount] = useState(expense?.amount ? String(expense.amount) : '');
  const [dueDay, setDueDay] = useState(expense?.dueDay ? String(expense.dueDay) : '');
  // Padrão: a partir do mês que vem — a conta do mês corrente costuma já estar paga.
  const [startMonth, setStartMonth] = useState(expense?.startMonth || shiftMonth(today, 1));
  const [endMonth, setEndMonth] = useState(expense?.endMonth || '');
  const [installments, setInstallments] = useState(expense?.installments ? String(expense.installments) : '');
  const [paidCount, setPaidCount] = useState(progress ? String(progress.paid) : '');
  const [nextMonth, setNextMonth] = useState(expense && progress ? shiftMonth(expense.startMonth, progress.paid) : shiftMonth(today, 1));
  const [note, setNote] = useState(expense?.note || '');

  const value = parseAmount(amount);
  const total = Number(installments) || 0;
  const paid = Math.min(total, Math.max(0, Number(paidCount) || 0));
  const remaining = total - paid;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    let start = startMonth;
    let trackedFrom = expense?.trackedFrom || startMonth;
    let paidMonths = expense?.paidMonths || [];

    // Parcelada: "N pagas, a próxima em tal mês" define o início. O app passa a acompanhar
    // a partir do mês atual (ou da próxima parcela); o que veio antes conta como pago.
    if (kind === 'parcelada') {
      start = shiftMonth(nextMonth, -paid);
      trackedFrom = expense?.trackedFrom || (nextMonth < today ? nextMonth : today);
      const paidBefore: string[] = [];
      for (let month = trackedFrom; month < nextMonth; month = shiftMonth(month, 1)) paidBefore.push(month);
      paidMonths = Array.from(new Set([...paidBefore, ...paidMonths.filter(month => month >= nextMonth)])).sort();
    } else if (!expense) {
      trackedFrom = startMonth;
    }

    const result = await callTool('salvar_conta_fixa', {
      expense: {
        id: expense?.id || crypto.randomUUID(),
        name,
        kind,
        categoryId: categoryId || undefined,
        amount: value,
        startMonth: start,
        installments: kind === 'parcelada' ? total : undefined,
        dueDay: dueDay ? Math.min(31, Math.max(1, Number(dueDay))) : undefined,
        values: expense?.values || {},
        paidMonths,
        endMonth: kind !== 'parcelada' && endMonth ? endMonth : undefined,
        trackedFrom,
        note: note.trim() || undefined,
      } satisfies FixedExpense,
    });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(expense ? 'Conta atualizada.' : 'Conta cadastrada.');
    onClose();
  };

  return (
    <Modal size="lg" title={expense ? 'Editar conta' : 'Nova conta fixa'} subtitle="Paga fora do cartão: boleto, Pix ou débito." onClose={onClose} icon={<Receipt size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="fixed-expense-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="fixed-expense-form" className="form-grid cols-3" onSubmit={save}>
        <Field label="Nome"><input required autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Internet, Carro, Moradia" /></Field>
        <Field label="Tipo">
          <select value={kind} onChange={event => setKind(event.target.value as FixedExpense['kind'])}>
            <option value="fixa">Valor fixo todo mês</option>
            <option value="variavel">Valor muda todo mês</option>
            <option value="parcelada">Parcelada (financiamento)</option>
          </select>
        </Field>
        <Field label="Categoria">
          <select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
            <option value="">Sem categoria</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label={kind === 'variavel' ? 'Estimativa mensal (opcional)' : kind === 'parcelada' ? 'Valor da parcela' : 'Valor mensal'}
          hint={kind === 'variavel' ? 'Usada no saldo até você lançar o valor de cada mês.' : undefined}>
          <input required={kind !== 'variavel'} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Dia do vencimento"><input type="number" min="1" max="31" value={dueDay} onChange={event => setDueDay(event.target.value)} placeholder="Opcional" /></Field>
        {kind === 'parcelada' ? (
          <>
            <Field label="Total de parcelas"><input required type="number" min="1" step="1" value={installments} onChange={event => setInstallments(event.target.value)} placeholder="Ex.: 48" /></Field>
            <Field label="Parcelas já pagas"><input type="number" min="0" step="1" value={paidCount} onChange={event => setPaidCount(event.target.value)} placeholder="Ex.: 31" /></Field>
            <Field label="Mês da próxima parcela"><input required type="month" value={nextMonth} onChange={event => setNextMonth(event.target.value)} /></Field>
            {total && value ? (
              <div className="notice full" style={{ gridColumn: '1 / -1' }}>
                <CalendarClock size={16} />
                <span>
                  {remaining
                    ? `Próxima: parcela ${paid + 1}/${total} em ${formatMonthLong(nextMonth)} · faltam ${remaining} (${formatBRL(remaining * value)}) · última em ${formatMonthLong(shiftMonth(nextMonth, remaining - 1))}.`
                    : 'Todas as parcelas pagas.'}
                </span>
              </div>
            ) : null}
          </>
        ) : (
          <>
            <Field label="Começa em" hint="Antes deste mês a conta não entra no saldo."><input required type="month" value={startMonth} onChange={event => setStartMonth(event.target.value)} /></Field>
            <Field label="Último mês" hint="Deixe vazio se não tem fim."><input type="month" value={endMonth} onChange={event => setEndMonth(event.target.value)} /></Field>
          </>
        )}
        <Field label="Observação" full><input value={note} onChange={event => setNote(event.target.value)} placeholder="Ex.: boleto do banco, débito automático" /></Field>
      </form>
    </Modal>
  );
}

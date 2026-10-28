import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { FormEvent } from 'react';
import { CalendarCheck, Copy, CreditCard, Pencil, Plus, Repeat, Trash2, Wallet } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { incomeKey } from '../../store/reducer';
import { useTools } from '../../tools/useTools';
import { getInvoiceStatements, getInvoiceTotal, getMonthlyDebtCommitment, getLatestInvoiceMonth } from '../../utils/analytics';
import { useCardSettings } from '../../store/cardSettings';
import { getFixedMonthlyTotal } from '../../utils/fixedExpenses';
import { currentMonthISO, formatBRL, formatDate, formatMonth, formatMonthLong, parseAmount, shiftMonth, todayISO } from '../../utils/formatters';
import { Badge, Card, Field, ProgressBar, StatCard } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { MonthlyIncome } from '../../types';

const SOURCE_LABEL: Record<NonNullable<MonthlyIncome['source']>, string> = {
  manual: 'Manual',
  adjustment: 'Ajuste da fatura',
  legacy: 'Sistema antigo',
  imported: 'Importada',
};

export function ReceitasPage({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, monthlyIncomes, paidInvoiceMonths, debts, fixedExpenses } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<MonthlyIncome | null>(null);
  const [creating, setCreating] = useState(false);
  const card = useCardSettings();
  const navigate = useNavigate();
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const month = selectedMonth;
  const statement = useMemo(
    () => month ? getInvoiceStatements(transactions, paidInvoiceMonths, card.dueDay).find(item => item.month === month) : undefined,
    [transactions, paidInvoiceMonths, card.dueDay, month],
  );
  const monthIncomes = useMemo(() => month ? monthlyIncomes.filter(item => item.month === month) : monthlyIncomes, [monthlyIncomes, month]);
  const incomeTotal = monthIncomes.reduce((sum, item) => sum + item.amount, 0);
  const invoice = month ? statement?.total ?? getInvoiceTotal(transactions, month) : 0;
  const includeDebts = Boolean(month) && (month === getLatestInvoiceMonth(transactions) || month >= currentMonthISO());
  const debtMonthly = includeDebts ? getMonthlyDebtCommitment(debts, transactions) : 0;
  const paid = Boolean(month && paidInvoiceMonths.includes(month));
  // Pagamento detectado no extrato do banco: não há o que marcar à mão.
  const autoPaid = Boolean(statement?.auto && statement.status === 'paga');
  const fixedMonthly = month ? getFixedMonthlyTotal(fixedExpenses, month) : 0;
  const balance = incomeTotal - invoice - debtMonthly - fixedMonthly;
  const previousRecurring = useMemo(() => {
    if (!month) return '';
    return Array.from(new Set(monthlyIncomes.filter(item => item.isRecurring && item.month < month).map(item => item.month))).sort().at(-1) || '';
  }, [monthlyIncomes, month]);

  const markPaid = async () => {
    await callTool(paid ? 'desmarcar_fatura' : 'quitar_fatura', { month });
    toast(paid ? `Fatura de ${formatMonth(month)} reaberta.` : `Fatura de ${formatMonth(month)} marcada como quitada.`);
  };

  const equalize = async () => {
    if (!await confirm({ title: 'Igualar receita à fatura?', message: `Cria uma receita de ajuste de ${formatBRL(invoice)} em ${formatMonth(month)} e marca a fatura como quitada. Use quando a fatura foi paga com dinheiro que não está registrado aqui.`, confirmLabel: 'Criar ajuste' })) return;
    await callTool('igualar_receita_mes', { month });
    toast('Ajuste criado e fatura quitada.');
  };

  // Faturas já vencidas: a do mês corrente entra quando o dia do vencimento passa.
  const dueCutoff = Number(todayISO().slice(8, 10)) > card.dueDay ? shiftMonth(currentMonthISO(), 1) : currentMonthISO();

  const batch = async (kind: 'quitar' | 'igualar') => {
    const current = dueCutoff;
    const ok = await confirm({
      title: kind === 'quitar' ? 'Quitar todas as faturas antigas?' : 'Igualar receitas de todas as faturas antigas?',
      message: kind === 'quitar'
        ? `Marca como quitadas todas as faturas já vencidas (anteriores a ${formatMonth(current)}). Não altera receitas.`
        : `Cria receitas de ajuste iguais a cada fatura anterior a ${formatMonth(current)} e as marca como quitadas. Ajustes antigos desses meses são substituídos.`,
      confirmLabel: 'Confirmar',
    });
    if (!ok) return;
    if (kind === 'quitar') {
      const result = await callTool<{ months: string[] }>('quitar_faturas_antigas', { currentMonth: current });
      toast(`${result.data?.months.length || 0} fatura(s) marcada(s) como quitada(s).`);
    } else {
      const result = await callTool<{ months: number }>('igualar_receitas_faturas', { currentMonth: current });
      toast(`${result.data?.months || 0} ajuste(s) criado(s).`);
    }
  };

  const replicate = async () => {
    const result = await callTool<{ created: number; fromMonth: string }>('replicar_receitas_recorrentes', { toMonth: month });
    toast(result.data?.created ? `${result.data.created} receita(s) recorrente(s) copiada(s) de ${formatMonth(result.data.fromMonth)}.` : 'As recorrentes já estão neste mês.', result.data?.created ? 'success' : 'info');
  };

  const remove = async (income: MonthlyIncome) => {
    if (!await confirm({ title: 'Excluir receita?', message: `${income.description || SOURCE_LABEL[income.source || 'manual']} · ${formatBRL(income.amount)} em ${formatMonth(income.month)}`, confirmLabel: 'Excluir', tone: 'danger' })) return;
    await callTool('excluir_receita', { incomeId: incomeKey(income) });
    toast('Receita excluída.');
  };

  const rowActions = (income: MonthlyIncome) => (
    <div className="row-actions">
      <button type="button" className="icon-button sm ghost" onClick={() => setEditing(income)} title="Editar"><Pencil size={14} /></button>
      <button type="button" className="icon-button sm ghost danger" onClick={() => remove(income)} title="Excluir"><Trash2 size={14} /></button>
    </div>
  );

  const coverage = invoice + debtMonthly + fixedMonthly ? (incomeTotal / (invoice + debtMonthly + fixedMonthly)) * 100 : 0;

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label="Receita" value={formatBRL(incomeTotal)} hint={month ? formatMonthLong(month) : 'Todo o período'} tone="good" icon={<Wallet size={16} />} onClick={() => goTo('entradas')} />
        {month ? <StatCard label="Fatura" value={formatBRL(invoice)} hint={debtMonthly ? `+ ${formatBRL(debtMonthly)} de parcelas de dívidas` : 'Compras do cartão'} icon={<CreditCard size={16} />} onClick={() => navigate('/transacoes')} /> : null}
        {month ? <StatCard label="Saldo do mês" value={formatBRL(balance)} hint={fixedMonthly ? `Receita − fatura − dívidas − ${formatBRL(fixedMonthly)} de contas fixas` : 'Receita − fatura − dívidas'} tone={balance >= 0 ? 'good' : 'bad'} onClick={() => goTo('status-fatura')} /> : null}
        <StatCard label="Entradas" value={monthIncomes.length} hint={`${monthIncomes.filter(item => item.isRecurring).length} recorrente(s)`} icon={<Repeat size={16} />} onClick={() => goTo('historico-receitas')} />
      </div>

      {month ? (
        <Card id="status-fatura" span="half" icon={<CalendarCheck size={17} />} title="Status da fatura" subtitle="Marcar como quitada não cria receita — é só o status.">
          <div className="kv-list">
            <div><span>Fatura de {formatMonth(month)}</span><strong>{formatBRL(invoice)}</strong></div>
            {statement && statement.advance > 0 ? <div><span>Pago antecipado</span><strong className="text-good">−{formatBRL(statement.advance)}</strong></div> : null}
            {statement && statement.advance > 0 ? <div><span>A pagar no vencimento</span><strong>{formatBRL(statement.toPay)}</strong></div> : null}
            <div><span>Receita registrada</span><strong>{formatBRL(incomeTotal)}</strong></div>
            <div><span>Situação</span><strong><span className={`status-pill ${!invoice ? 'none' : statement?.status === 'paga' || paid ? 'paid' : statement?.status === 'sem_dados' ? 'none' : 'open'}`}>
              {!invoice ? 'Sem fatura'
                : autoPaid ? `Paga${statement?.paidOn ? ` em ${formatDate(statement.paidOn)}` : ''} (pelo extrato)`
                : statement?.status === 'paga' || paid ? 'Quitada (marcada)'
                : statement?.status === 'parcial' ? `Paga em parte (${formatBRL(statement.paidAmount)})`
                : statement?.status === 'sem_dados' ? 'Sem pagamento no extrato'
                : 'Em aberto'}
            </span></strong></div>
          </div>
          <div style={{ margin: '12px 0 16px' }}><ProgressBar value={coverage} tone={coverage >= 100 ? 'good' : 'warn'} /></div>
          <div className="card-footer-actions">
            <button type="button" className="secondary-button" disabled={!invoice || autoPaid} onClick={markPaid} title={autoPaid ? 'O pagamento já aparece no extrato do banco' : undefined}>{autoPaid ? 'Paga pelo extrato' : paid ? 'Reabrir fatura' : 'Marcar como quitada'}</button>
            <button type="button" className="secondary-button" disabled={!invoice} onClick={equalize}>Igualar receita ({formatBRL(invoice)})</button>
          </div>
          <div className="card-footer-actions" style={{ borderTop: 0, paddingTop: 8 }}>
            <span className="muted" style={{ fontSize: 12.5, width: '100%' }}>Em lote, para as faturas já vencidas (anteriores a {formatMonth(dueCutoff)}):</span>
            <button type="button" className="ghost-button" onClick={() => batch('quitar')}>Quitar antigas</button>
            <button type="button" className="ghost-button" onClick={() => batch('igualar')}>Igualar receitas antigas</button>
          </div>
        </Card>
      ) : null}

      <Card id="entradas" span={month ? 'half' : 'full'} icon={<Wallet size={17} />} title={month ? `Entradas de ${formatMonthLong(month)}` : 'Todas as entradas'}
        actions={(
          <>
            {month && previousRecurring ? <button type="button" className="secondary-button" onClick={replicate} title={`Copiar recorrentes de ${formatMonth(previousRecurring)}`}><Copy size={15} /> Recorrentes</button> : null}
            <button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Receita</button>
          </>
        )}>
        {monthIncomes.length ? (
          <div className="list">
            {[...monthIncomes].sort((a, b) => b.month.localeCompare(a.month) || b.amount - a.amount).slice(0, month ? 50 : 8).map(income => (
              <div className="list-row" key={incomeKey(income)}>
                <div className="grow">
                  <span className="title">{income.description || SOURCE_LABEL[income.source || 'manual']}</span>
                  <span className="subtitle">{formatMonth(income.month)} · {SOURCE_LABEL[income.source || 'manual']}{income.isRecurring ? ' · recorrente' : ''}</span>
                </div>
                <span className="amount text-good">{formatBRL(income.amount)}</span>
                {rowActions(income)}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact title="Nenhuma receita neste mês." description={previousRecurring ? `Você tem receitas recorrentes em ${formatMonth(previousRecurring)} — use "Recorrentes" para copiar.` : 'Registre salário, vendas, Pix recebidos…'} />
        )}
      </Card>

      <Card id="historico-receitas" span="full" title="Histórico de receitas">
        <DataTable
          rows={monthlyIncomes}
          rowKey={row => incomeKey(row)}
          initialSort={{ key: 'month', direction: 'desc' }}
          searchPlaceholder="Buscar descrição..."
          emptyLabel="Nenhuma receita cadastrada."
          columns={[
            { key: 'month', label: 'Mês', value: row => row.month, render: row => formatMonth(row.month) },
            { key: 'description', label: 'Descrição', value: row => row.description || '' },
            { key: 'source', label: 'Origem', value: row => SOURCE_LABEL[row.source || 'manual'], render: row => <Badge tone={row.source === 'adjustment' ? 'warn' : 'neutral'}>{SOURCE_LABEL[row.source || 'manual']}</Badge> },
            { key: 'recurring', label: 'Recorrente', align: 'center', value: row => row.isRecurring ? 'sim' : 'não', render: row => row.isRecurring ? <Badge tone="good">sim</Badge> : <span className="muted">—</span> },
            { key: 'amount', label: 'Valor', align: 'right', value: row => row.amount, render: row => <strong className="num">{formatBRL(row.amount)}</strong> },
            { key: 'actions', label: '', sortable: false, filterable: false, value: () => '', render: rowActions },
          ]}
        />
      </Card>

      {creating || editing ? <IncomeModal income={editing} defaultMonth={month || currentMonthISO()} onClose={() => { setCreating(false); setEditing(null); }} /> : null}
    </div>
  );
}

function IncomeModal({ income, defaultMonth, onClose }: { income: MonthlyIncome | null; defaultMonth: string; onClose: () => void }) {
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [month, setMonth] = useState(income?.month || defaultMonth);
  const [amount, setAmount] = useState(income ? String(income.amount) : '');
  const [description, setDescription] = useState(income?.description || '');
  const [isRecurring, setIsRecurring] = useState(Boolean(income?.isRecurring));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = await callTool('adicionar_receita', {
      replaceKey: income ? incomeKey(income) : undefined,
      income: {
        id: income?.id || crypto.randomUUID(),
        month,
        amount: parseAmount(amount),
        isRecurring,
        description: description.trim() || undefined,
        source: income?.source && income.source !== 'adjustment' ? income.source : 'manual',
      },
    });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(income ? 'Receita atualizada.' : 'Receita adicionada.');
    onClose();
  };

  return (
    <Modal size="sm" title={income ? 'Editar receita' : 'Nova receita'} subtitle="Dinheiro que realmente entrou. Várias entradas no mesmo mês são somadas." onClose={onClose} icon={<Wallet size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="income-form" className="primary-button">{income ? 'Salvar' : 'Adicionar'}</button>
        </>
      )}>
      <form id="income-form" className="form-grid" onSubmit={save}>
        <Field label="Mês"><input type="month" required value={month} onChange={event => setMonth(event.target.value)} /></Field>
        <Field label="Valor"><input type="number" step="0.01" min="0.01" inputMode="decimal" required autoFocus value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" /></Field>
        <Field label="Descrição" full><input value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex.: salário, venda, Pix recebido" /></Field>
        <label className="check-line full"><input type="checkbox" checked={isRecurring} onChange={event => setIsRecurring(event.target.checked)} /> Recorrente (aparece para copiar nos próximos meses)</label>
      </form>
    </Modal>
  );
}

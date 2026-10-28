import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarClock, Check, Landmark, Pencil, Percent, Plus, Trash2, TrendingDown } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { getDebtBalance, simulatePayoffPlan, type PayoffStrategy } from '../../utils/analytics';
import { useChartTheme } from '../../utils/chartTheme';
import { formatBRL, formatDate, formatMonthLong, parseAmount, shiftMonth, todayISO, currentMonthISO } from '../../utils/formatters';
import { Badge, Card, Field, ProgressBar, StatCard, Tabs } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { Debt } from '../../types';

const ORIGIN_LABEL: Record<Debt['origin'], string> = {
  cartao: 'Cartão', emprestimo: 'Empréstimo', financiamento: 'Financiamento', manual: 'Manual', outros: 'Outros',
};

const riskOf = (rate: number) => rate >= 3 ? { label: 'Juros alto', tone: 'bad' as const } : rate >= 1 ? { label: 'Juros médio', tone: 'warn' as const } : { label: 'Juros baixo', tone: 'good' as const };
const monthsLabel = (months: number | null) => months === null ? 'não quita' : months === 0 ? 'já quitado' : months < 12 ? `${months} mês(es)` : `${Math.floor(months / 12)}a ${months % 12}m`;

export function DividasPage() {
  const { debts, transactions } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const chart = useChartTheme();
  const [editing, setEditing] = useState<Debt | null>(null);
  const [creating, setCreating] = useState(false);
  const [extra, setExtra] = useState(0);
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const own = useMemo(() => debts.filter(debt => debt.type === 'a_pagar').map(debt => ({ debt, balance: getDebtBalance(debt, transactions) })), [debts, transactions]);
  const active = own.filter(item => item.balance > 0);
  const totalBalance = active.reduce((sum, item) => sum + item.balance, 0);
  const monthly = active.reduce((sum, item) => sum + Math.min(item.debt.monthlyPayment || 0, item.balance), 0);
  const highestRate = active.reduce((max, item) => Math.max(max, item.debt.interestRate || 0), 0);

  const plans = useMemo(() => ({
    baseline: simulatePayoffPlan(debts, transactions, 0, strategy),
    chosen: simulatePayoffPlan(debts, transactions, extra, strategy),
    other: simulatePayoffPlan(debts, transactions, extra, strategy === 'avalanche' ? 'bola_de_neve' : 'avalanche'),
  }), [debts, transactions, extra, strategy]);

  const timeline = useMemo(() => {
    const length = Math.min(120, Math.max(plans.baseline.timeline.length, plans.chosen.timeline.length));
    return Array.from({ length }, (_, month) => ({
      month,
      label: month === 0 ? 'hoje' : `${month}m`,
      base: plans.baseline.timeline[month]?.balance ?? 0,
      plano: plans.chosen.timeline[month]?.balance ?? 0,
    }));
  }, [plans]);

  const payInstallment = async (debt: Debt) => {
    const result = await callTool<{ paid: number }>('pagar_parcela_divida', { debtId: debt.id });
    toast(`Parcela de ${formatBRL(result.data?.paid || 0)} registrada para ${debt.counterparty}.`);
  };

  const payOff = async (debt: Debt) => {
    if (!await confirm({ title: `Quitar ${debt.counterparty}?`, message: 'Marca o valor total como pago.', confirmLabel: 'Quitar' })) return;
    await callTool('quitar_divida', { debtId: debt.id });
    toast(`${debt.counterparty} quitada. 🎉`);
  };

  const remove = async (debt: Debt) => {
    if (!await confirm({ title: 'Excluir dívida?', message: `${debt.counterparty} · ${formatBRL(debt.totalAmount)}`, confirmLabel: 'Excluir', tone: 'danger' })) return;
    await callTool('excluir_divida', { debtId: debt.id });
    toast('Dívida excluída.');
  };

  const saved = plans.baseline.totalInterest - plans.chosen.totalInterest;
  const finishDate = (months: number | null) => months === null ? '—' : formatMonthLong(shiftMonth(currentMonthISO(), months));

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label="Saldo devedor" value={formatBRL(totalBalance)} tone="bad" icon={<Landmark size={16} />} hint={`${active.length} dívida(s) ativa(s)`} onClick={() => goTo('dividas-lista')} />
        <StatCard label="Parcelas por mês" value={formatBRL(monthly)} icon={<CalendarClock size={16} />} onClick={() => goTo('dividas-lista')} />
        <StatCard label="Maior juros" value={`${highestRate.toFixed(2).replace('.', ',')}% a.m.`} tone={highestRate >= 3 ? 'bad' : 'neutral'} icon={<Percent size={16} />} onClick={() => {
          const top = [...active].sort((a, b) => b.debt.interestRate - a.debt.interestRate)[0];
          goTo(top ? `divida-${top.debt.id}` : 'dividas-lista');
        }} />
        <StatCard label="Livre de dívidas em" value={active.length ? monthsLabel(plans.baseline.months) : '—'} hint={!active.length ? 'Nenhuma dívida ativa' : plans.baseline.months ? finishDate(plans.baseline.months) : 'Mantendo as parcelas atuais'} icon={<TrendingDown size={16} />} onClick={() => goTo(active.length ? 'plano-quitacao' : 'dividas-lista')} />
      </div>

      <div className="toolbar-row">
        <span className="muted">Dívidas próprias. Valores que alguém te deve ficam em Pessoas e cobranças.</span>
        <button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova dívida</button>
      </div>

      {own.length ? (
        <div className="debt-grid" id="dividas-lista">
          {own.map(({ debt, balance }) => {
            const paidShare = debt.totalAmount ? ((debt.totalAmount - balance) / debt.totalAmount) * 100 : 0;
            const risk = riskOf(debt.interestRate);
            const stuck = balance > 0 && debt.monthlyPayment > 0 && debt.monthlyPayment <= balance * (debt.interestRate / 100);
            return (
              <section className="card debt-card" key={debt.id} id={`divida-${debt.id}`}>
                <div className="person-head">
                  <span className="card-icon"><Landmark size={17} /></span>
                  <div className="grow">
                    <strong>{debt.counterparty}</strong>
                    <small>{debt.note || ORIGIN_LABEL[debt.origin]} · desde {formatDate(debt.startDate)}</small>
                  </div>
                  {balance <= 0 ? <Badge tone="good">quitada</Badge> : <Badge tone={risk.tone}>{risk.label}</Badge>}
                </div>
                <div className="debt-amounts">
                  <div>
                    <strong>{formatBRL(balance)}</strong>
                    <span> restantes de {formatBRL(debt.totalAmount)}</span>
                  </div>
                  <span>{paidShare.toFixed(0)}% pago</span>
                </div>
                <ProgressBar value={paidShare} tone={balance <= 0 ? 'good' : 'accent'} />
                <div className="debt-meta">
                  <Badge>{ORIGIN_LABEL[debt.origin]}</Badge>
                  {debt.monthlyPayment ? <Badge>{formatBRL(debt.monthlyPayment)}/mês</Badge> : null}
                  {debt.currentInstallment && debt.totalInstallments ? <Badge>parcela {debt.currentInstallment}/{debt.totalInstallments}</Badge> : null}
                  <Badge>{debt.interestRate}% a.m.</Badge>
                </div>
                {stuck ? <div className="notice bad"><Percent size={15} /><span>A parcela não cobre os juros — o saldo nunca diminui. Simule um aporte extra abaixo.</span></div> : null}
                <div className="card-footer-actions">
                  {balance > 0 && debt.monthlyPayment > 0 && balance > debt.monthlyPayment ? <button type="button" className="secondary-button" onClick={() => payInstallment(debt)}>Pagar parcela</button> : null}
                  {balance > 0 ? <button type="button" className="secondary-button" onClick={() => payOff(debt)}><Check size={15} /> Quitar</button> : null}
                  <button type="button" className="icon-button" onClick={() => setEditing(debt)} title="Editar"><Pencil size={15} /></button>
                  <button type="button" className="icon-button danger" onClick={() => remove(debt)} title="Excluir"><Trash2 size={15} /></button>
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Card span="full"><EmptyState icon={<Landmark size={22} />} title="Nenhuma dívida cadastrada" description="Cadastre financiamentos e empréstimos para acompanhar o saldo e simular a quitação."
          action={<button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova dívida</button>} /></Card>
      )}

      {active.length ? (
        <Card id="plano-quitacao" span="full" icon={<TrendingDown size={17} />} title="Plano de quitação" subtitle="Simulação: aplica juros, paga as parcelas e joga o aporte extra (e as parcelas que vão se liberando) na dívida-alvo."
          actions={<Tabs<PayoffStrategy> size="sm" value={strategy} onChange={setStrategy} tabs={[{ id: 'avalanche', label: 'Avalanche (maior juros)' }, { id: 'bola_de_neve', label: 'Bola de neve (menor saldo)' }]} />}>
          <div className="inline-form">
            <Field label={`Aporte extra por mês: ${formatBRL(extra)}`}>
              <input type="range" min="0" max={Math.max(3000, Math.ceil(monthly / 100) * 100)} step="50" value={extra} onChange={event => setExtra(Number(event.target.value))} />
            </Field>
            <Field label="Valor exato"><input type="number" min="0" step="50" value={extra} onChange={event => setExtra(Math.max(0, parseAmount(event.target.value)))} style={{ width: 140 }} /></Field>
          </div>
          <div className="strategy-result">
            <div className="hero-stat"><span>Quitação com o plano</span><strong>{monthsLabel(plans.chosen.months)}</strong><small>{finishDate(plans.chosen.months)}</small></div>
            <div className="hero-stat"><span>Juros pagos no plano</span><strong>{formatBRL(plans.chosen.totalInterest)}</strong><small>{saved > 1 ? <span className="text-good">economia de {formatBRL(saved)}</span> : 'sem aporte extra'}</small></div>
            <div className="hero-stat"><span>Outra estratégia</span><strong>{monthsLabel(plans.other.months)}</strong><small>juros {formatBRL(plans.other.totalInterest)}</small></div>
          </div>
          <div className="page-grid" style={{ marginTop: 0 }}>
            <div className="span-two-thirds">
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={timeline}>
                  <CartesianGrid {...chart.grid} vertical={false} />
                  <XAxis dataKey="label" {...chart.axis} interval="preserveStartEnd" />
                  <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
                  <Tooltip {...chart.tooltip} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="base" name="Só as parcelas" stroke={chart.colors.bad} fill={chart.colors.bad} fillOpacity={0.08} strokeWidth={2} />
                  <Area type="monotone" dataKey="plano" name="Com o plano" stroke={chart.colors.good} fill={chart.colors.good} fillOpacity={0.12} strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="span-third">
              <div className="list">
                <span className="field-label" style={{ padding: '0 12px 4px' }}>Ordem de quitação</span>
                {plans.chosen.order.map((item, index) => (
                  <div className="list-row" key={item.id}>
                    <span className="badge badge-accent">{index + 1}</span>
                    <div className="grow"><span className="title">{item.name}</span><span className="subtitle">{item.payoffMonth === null ? 'não quita no horizonte' : finishDate(item.payoffMonth)}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {creating || editing ? <DebtModal debt={editing} onClose={() => { setCreating(false); setEditing(null); }} /> : null}
    </div>
  );
}

function DebtModal({ debt, onClose }: { debt: Debt | null; onClose: () => void }) {
  const { members } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [counterparty, setCounterparty] = useState(debt?.counterparty || '');
  const [origin, setOrigin] = useState<Debt['origin']>(debt?.origin || 'emprestimo');
  const [totalAmount, setTotalAmount] = useState(debt ? String(debt.totalAmount) : '');
  const [paidAmount, setPaidAmount] = useState(debt ? String(debt.paidAmount) : '0');
  const [monthlyPayment, setMonthlyPayment] = useState(debt ? String(debt.monthlyPayment) : '');
  const [interestRate, setInterestRate] = useState(debt ? String(debt.interestRate) : '0');
  const [startDate, setStartDate] = useState(debt?.startDate || todayISO());
  const [currentInstallment, setCurrentInstallment] = useState(debt?.currentInstallment ? String(debt.currentInstallment) : '');
  const [totalInstallments, setTotalInstallments] = useState(debt?.totalInstallments ? String(debt.totalInstallments) : '');
  const [note, setNote] = useState(debt?.note || '');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = await callTool('cadastrar_divida', {
      debt: {
        id: debt?.id || crypto.randomUUID(),
        type: 'a_pagar',
        origin,
        counterparty,
        totalAmount: parseAmount(totalAmount),
        paidAmount: parseAmount(paidAmount),
        monthlyPayment: parseAmount(monthlyPayment),
        interestRate: parseAmount(interestRate),
        startDate,
        linkedTransactionIds: debt?.linkedTransactionIds || [],
        currentInstallment: currentInstallment ? Number(currentInstallment) : undefined,
        totalInstallments: totalInstallments ? Number(totalInstallments) : undefined,
        note: note.trim() || undefined,
      } satisfies Debt,
    });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(debt ? 'Dívida atualizada.' : 'Dívida cadastrada.');
    onClose();
  };

  return (
    <Modal size="lg" title={debt ? 'Editar dívida' : 'Nova dívida'} subtitle="Compromissos que você precisa pagar." onClose={onClose} icon={<Landmark size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="debt-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="debt-form" className="form-grid cols-3" onSubmit={save}>
        <Field label="Com quem / credor">
          <input required list="debt-counterparties" value={counterparty} onChange={event => setCounterparty(event.target.value)} placeholder="Ex.: Banco, financeira, pessoa" />
          <datalist id="debt-counterparties">{members.filter(member => !member.isOwner).map(member => <option key={member.id} value={member.name} />)}</datalist>
        </Field>
        <Field label="Tipo">
          <select value={origin} onChange={event => setOrigin(event.target.value as Debt['origin'])}>
            {(Object.keys(ORIGIN_LABEL) as Debt['origin'][]).map(key => <option key={key} value={key}>{ORIGIN_LABEL[key]}</option>)}
          </select>
        </Field>
        <Field label="Início"><input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></Field>
        <Field label="Valor total"><input required type="number" step="0.01" min="0.01" value={totalAmount} onChange={event => setTotalAmount(event.target.value)} /></Field>
        <Field label="Já pago"><input type="number" step="0.01" min="0" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} /></Field>
        <Field label="Parcela mensal"><input type="number" step="0.01" min="0" value={monthlyPayment} onChange={event => setMonthlyPayment(event.target.value)} /></Field>
        <Field label="Juros ao mês (%)"><input type="number" step="0.01" min="0" value={interestRate} onChange={event => setInterestRate(event.target.value)} /></Field>
        <Field label="Parcela atual"><input type="number" min="1" step="1" value={currentInstallment} onChange={event => setCurrentInstallment(event.target.value)} placeholder="Ex.: 26" /></Field>
        <Field label="Total de parcelas"><input type="number" min="1" step="1" value={totalInstallments} onChange={event => setTotalInstallments(event.target.value)} placeholder="Ex.: 48" /></Field>
        <Field label="Observação" full><input value={note} onChange={event => setNote(event.target.value)} placeholder="Ex.: financiamento do carro" /></Field>
      </form>
    </Modal>
  );
}

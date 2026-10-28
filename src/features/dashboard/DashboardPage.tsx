import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Copy, CreditCard, Flame, HandCoins, Landmark, PiggyBank, Receipt, Sparkles, Tags, Target, TrendingUp, Upload, Wallet,
} from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import {
  expenseTransactions, filterByMonth, getBudgetStatus, getCategoryTotals, getDebtBalance, getFutureInstallments, getInvoiceStatements, getLatestInvoiceMonth,
  getMerchantTotals, getMonthlyDebtCommitment, getMonthlySummaries, getPeopleWhoOweMe, getPossibleDuplicates, oldestPendingDays,
} from '../../utils/analytics';
import { bestPurchaseDateOf, closingDateOf, dueDateOf, invoiceLooksIncomplete, openInvoiceMonth, useCardSettings } from '../../store/cardSettings';
import { isLowConfidence } from '../../utils/categorizer';
import { fixedExpenseMonths, getFixedExpensesForMonth, getFixedMonthlyTotal, mergeFixedIntoCategories } from '../../utils/fixedExpenses';
import { useSpendingScope } from '../../store/spendingScope';
import { SpendingScopeTabs } from '../../components/SpendingScopeTabs';
import { useChartTheme } from '../../utils/chartTheme';
import { currentMonthISO, daysBetween, formatBRL, formatDate, formatMonthLong, formatMonthShort, formatRefMonth, shiftMonth, titleCase, todayISO } from '../../utils/formatters';
import { Avatar, Card, CategoryDot, ProgressBar } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { AiTipsCard } from './AiTipsCard';

interface Alert {
  id: string;
  tone: 'good' | 'bad' | 'warn' | 'info';
  icon: ReactNode;
  title: string;
  detail: string;
  to: string;
}

const percentLabel = (current: number, previous: number) => {
  if (!previous) return null;
  const percent = ((current - previous) / previous) * 100;
  if (Math.abs(percent) < 0.5) return null;
  return { percent, label: `${percent > 0 ? '▲' : '▼'} ${Math.abs(percent).toFixed(1)}%` };
};

const monthFromBar = (entry: unknown) => {
  const item = entry as { month?: string; payload?: { month?: string } };
  return item.payload?.month || item.month || '';
};

export function DashboardPage({ selectedMonth, onSelectMonth }: { selectedMonth: string; onSelectMonth: (month: string) => void }) {
  const { transactions, monthlyIncomes, receivables, members, paidInvoiceMonths, debts, fixedExpenses, categories, budgets, aliases } = useFinance();
  const chart = useChartTheme();
  const card = useCardSettings();
  const scope = useSpendingScope();

  const data = useMemo(() => {
    const today = currentMonthISO();
    const latestInvoice = getLatestInvoiceMonth(transactions);
    const summaries = getMonthlySummaries(transactions, monthlyIncomes);
    const scoped = filterByMonth(transactions, selectedMonth);
    const expenses = expenseTransactions(scoped);
    const gross = expenses.reduce((sum, item) => sum + item.amount, 0);
    const statement = selectedMonth ? getInvoiceStatements(transactions, paidInvoiceMonths, card.dueDay).find(item => item.month === selectedMonth) : undefined;
    // Valor da fatura como o banco mostra (compras − estornos).
    const invoice = selectedMonth ? statement?.total ?? gross : summaries.reduce((sum, item) => sum + item.expense, 0);
    const income = (selectedMonth ? summaries.filter(item => item.month === selectedMonth) : summaries).reduce((sum, item) => sum + item.income, 0);

    // Parcelas de dívidas entram só na fatura "da vez" (não existem por mês no histórico).
    const includeDebts = Boolean(selectedMonth) && (selectedMonth === latestInvoice || selectedMonth >= today);
    const debtMonthly = includeDebts ? getMonthlyDebtCommitment(debts, transactions) : 0;
    // Contas fixas têm mês próprio e só existem a partir de quando passaram a ser acompanhadas.
    const fixedMonthly = selectedMonth ? getFixedMonthlyTotal(fixedExpenses, selectedMonth) : 0;
    const commitments = invoice + debtMonthly + fixedMonthly;
    const balance = income - commitments;

    const index = selectedMonth ? summaries.findIndex(item => item.month === selectedMonth) : -1;
    const previous = index > 0 ? summaries[index - 1] : null;
    const trend = previous ? percentLabel(invoice, previous.expense) : null;

    // Status vem do extrato: pagamentos do ciclo seguinte quitam a fatura.
    const isOpenInvoice = selectedMonth === openInvoiceMonth(card);
    const dueDate = selectedMonth ? dueDateOf(selectedMonth, card) : '';
    const closing = selectedMonth ? closingDateOf(selectedMonth, card) : '';
    const daysToDue = selectedMonth ? daysBetween(todayISO(), dueDate) : 0;
    let status: 'paid' | 'open' | 'covered' | 'none' = 'none';
    let statusLabel = 'Sem compras';
    if (invoice && statement?.status === 'paga') {
      status = 'paid';
      statusLabel = statement.paidOn ? `Paga em ${formatDate(statement.paidOn).slice(0, 5)}` : 'Paga';
    } else if (invoice && isOpenInvoice) {
      status = 'covered';
      statusLabel = `Aberta · fecha ${formatDate(closing).slice(0, 5)}`;
    } else if (invoice && (statement?.status === 'aberta' || statement?.status === 'parcial')) {
      status = 'open';
      statusLabel = statement.status === 'parcial' ? 'Paga em parte' : daysToDue >= 0 ? `Vence ${formatDate(dueDate).slice(0, 5)}` : 'Vencida';
    } else if (invoice) {
      statusLabel = 'Sem pagamento no extrato';
    }

    const people = getPeopleWhoOweMe(receivables, debts, members, transactions);
    const owedTotal = people.reduce((sum, person) => sum + person.total, 0);

    const upcomingMonths = [1, 2, 3, 4, 5, 6].map(offset => shiftMonth(selectedMonth || latestInvoice || today, offset));
    const installments = getFutureInstallments(transactions).filter(item => upcomingMonths.includes(item.month));
    const monthlyDebt = getMonthlyDebtCommitment(debts, transactions);
    const upcoming = upcomingMonths.map(month => {
      const rows = installments.filter(item => item.month === month);
      const installmentTotal = rows.reduce((sum, item) => sum + item.amount, 0);
      const fixed = getFixedMonthlyTotal(fixedExpenses, month);
      return { month, installmentTotal, count: rows.length, debt: monthlyDebt, fixed, total: installmentTotal + monthlyDebt + fixed };
    });

    const categoryTotals = getCategoryTotals(scoped, categories);
    // Gasto total: as contas fixas entram na categoria delas (carro em Transporte etc.).
    const fixedMonths = selectedMonth ? [selectedMonth] : fixedExpenseMonths(fixedExpenses, latestInvoice > today ? latestInvoice : today);
    const spendingTotals = mergeFixedIntoCategories(categoryTotals, fixedExpenses, fixedMonths, categories);
    const hasFixed = spendingTotals.some(item => item.fixedTotal > 0);
    const merchants = getMerchantTotals(scoped, aliases).slice(0, 5);
    const biggest = [...expenses].sort((a, b) => b.amount - a.amount)[0];
    const upcomingMax = Math.max(1, ...upcoming.map(item => item.total));

    const evolutionLimit = latestInvoice > today ? latestInvoice : today;
    const history = summaries.filter(item => item.expense > 0 && item.month <= evolutionLimit).slice(-12)
      .map(item => ({ ...item, fixed: getFixedMonthlyTotal(fixedExpenses, item.month) }));
    const hasFixedHistory = history.some(item => item.fixed > 0);
    const average = history.length ? history.reduce((sum, item) => sum + item.expense, 0) / history.length : 0;

    const budgetStatus = selectedMonth ? getBudgetStatus(budgets, transactions, categories, selectedMonth) : [];

    // ─── Alertas ─────────────────────────────────────────────────────────────
    const alerts: Alert[] = [];
    if (statement && !isOpenInvoice && (statement.status === 'aberta' || statement.status === 'parcial')) {
      const remaining = Math.max(0, statement.toPay - statement.paidAmount);
      alerts.push({
        id: 'due', tone: daysToDue < 0 ? 'bad' : daysToDue <= 5 ? 'warn' : 'info', icon: <CreditCard size={16} />,
        title: daysToDue < 0 ? `Fatura vencida há ${-daysToDue} dia(s)` : daysToDue === 0 ? 'Fatura vence hoje' : `Fatura vence em ${daysToDue} dia(s)`,
        detail: `${formatBRL(remaining)} a pagar em ${formatDate(dueDate)}.`, to: '/transacoes',
      });
    }
    if (statement && !isOpenInvoice && invoiceLooksIncomplete(statement, closing)) {
      alerts.push({ id: 'incomplete', tone: 'warn', icon: <AlertTriangle size={16} />, title: 'CSV da fatura parece incompleto', detail: `Última compra em ${formatDate(statement.lastPurchase)}, mas a fatura fechou em ${formatDate(closing)}. Exporte de novo.`, to: '/transacoes' });
    }
    const overBudget = budgetStatus.filter(item => item.level !== 'ok');
    if (overBudget.length) alerts.push({ id: 'budget', tone: overBudget.some(item => item.level === 'estourado') ? 'bad' : 'warn', icon: <Target size={16} />, title: `${overBudget.length} meta(s) no limite`, detail: overBudget.slice(0, 3).map(item => `${item.name} ${item.progress.toFixed(0)}%`).join(' · '), to: '/metas' });
    const review = expenses.filter(item => !item.manualCategory && isLowConfidence(item.categorySource)).length;
    if (review) alerts.push({ id: 'review', tone: 'info', icon: <Sparkles size={16} />, title: `${review} lançamento(s) com categoria incerta`, detail: 'Revise ou peça sugestões ao assistente de IA.', to: '/categorias' });
    const duplicates = getPossibleDuplicates(scoped).length;
    if (duplicates) alerts.push({ id: 'dup', tone: 'warn', icon: <Copy size={16} />, title: `${duplicates} possível(is) duplicata(s)`, detail: 'Mesma data, local e valor na mesma fatura.', to: '/transacoes' });
    const stale = people.filter(person => oldestPendingDays(person) > 30);
    if (stale.length) alerts.push({ id: 'stale', tone: 'warn', icon: <HandCoins size={16} />, title: `${stale.length} cobrança(s) há mais de 30 dias`, detail: stale.slice(0, 3).map(person => person.name).join(', '), to: '/pessoas' });
    const stuck = debts.filter(debt => debt.type === 'a_pagar' && getDebtBalance(debt, transactions) > 0 && debt.monthlyPayment > 0 && debt.monthlyPayment <= getDebtBalance(debt, transactions) * (debt.interestRate / 100));
    if (stuck.length) alerts.push({ id: 'stuck', tone: 'bad', icon: <Landmark size={16} />, title: 'Dívida que não diminui', detail: `${stuck.map(debt => debt.counterparty).join(', ')}: a parcela não cobre os juros.`, to: '/dividas' });
    const billsNow = getFixedExpensesForMonth(fixedExpenses, today);
    const toLaunch = billsNow.filter(row => row.pending);
    if (toLaunch.length) alerts.push({ id: 'fixed-values', tone: 'info', icon: <Receipt size={16} />, title: `Lançar o valor de ${toLaunch.map(row => row.expense.name).join(', ')}`, detail: `Conta(s) que mudam todo mês — ${formatMonthLong(today)}.`, to: '/contas' });
    const dayNow = Number(todayISO().slice(8, 10));
    const dueSoon = billsNow.filter(row => !row.paid && row.expense.dueDay && row.expense.dueDay - dayNow <= 5);
    const overdue = dueSoon.filter(row => (row.expense.dueDay || 0) < dayNow);
    if (dueSoon.length) alerts.push({ id: 'fixed-due', tone: overdue.length ? 'bad' : 'warn', icon: <Receipt size={16} />, title: overdue.length ? `${overdue.length} conta(s) fixa(s) vencida(s)` : 'Conta fixa vencendo', detail: dueSoon.slice(0, 3).map(row => `${row.expense.name} dia ${row.expense.dueDay} (${formatBRL(row.amount)})`).join(' · '), to: '/contas' });
    if (selectedMonth && average && invoice > average * 1.3) alerts.push({ id: 'high', tone: 'warn', icon: <Flame size={16} />, title: 'Fatura acima da média', detail: `${((invoice / average - 1) * 100).toFixed(0)}% maior que a média dos últimos meses.`, to: '/analises' });

    return {
      invoice, gross, statement, income, commitments, debtMonthly, fixedMonthly, balance, trend, status, statusLabel, people, owedTotal, upcoming, upcomingMax, categoryTotals, merchants, biggest,
      spendingTotals, hasFixed, history, hasFixedHistory, average, budgetStatus, alerts, count: expenses.length, latestInvoice,
    };
  }, [transactions, monthlyIncomes, receivables, members, paidInvoiceMonths, debts, fixedExpenses, categories, budgets, aliases, selectedMonth, card]);

  if (!transactions.length) {
    return (
      <div className="page-grid">
        <div className="welcome-card">
          <div>
            <h2>Bem-vindo ao seu controle financeiro</h2>
            <p>Importe a primeira fatura (CSV ou OFX) para ver o resumo, as categorias e os alertas aqui.</p>
          </div>
          <Link className="primary-button" to="/importacao"><Upload size={16} /> Importar fatura</Link>
        </div>
      </div>
    );
  }

  const coverage = data.commitments ? (data.income / data.commitments) * 100 : 0;
  const showTotal = scope === 'tudo' && data.hasFixed;
  const topCategories = (showTotal ? data.spendingTotals : data.categoryTotals.map(item => ({ ...item, cardTotal: item.total, fixedTotal: 0 }))).slice(0, 7);

  return (
    <div className="page-grid">
      <section className="hero-card">
        <div>
          <div className="hero-eyebrow">
            <span>{selectedMonth ? `Fatura de ${formatMonthLong(selectedMonth)}` : 'Todo o período'}</span>
            {selectedMonth ? <span className="muted">Ref. {formatRefMonth(selectedMonth)}</span> : null}
            {selectedMonth ? <span className={`status-pill ${data.status}`}>{data.statusLabel}</span> : null}
          </div>
          <Link className="hero-amount hero-link" to="/transacoes" title="Ver os lançamentos desta fatura">{formatBRL(data.invoice)}</Link>
          <div className="hero-sub">
            <span><strong>{data.count}</strong> compras</span>
            <span>Ticket médio <strong>{formatBRL(data.count ? data.gross / data.count : 0)}</strong></span>
            {data.trend ? <span className={`trend ${data.trend.percent > 0 ? 'trend-bad' : 'trend-good'}`}>{data.trend.label} vs. fatura anterior</span> : null}
          </div>
          {data.statement && (data.statement.advance > 0 || data.statement.refunds > 0) ? (
            <div className="hero-sub" style={{ marginTop: 6 }}>
              {data.statement.advance > 0 ? <span>A pagar <strong>{formatBRL(data.statement.toPay)}</strong> · {formatBRL(data.statement.advance)} pago antecipado</span> : null}
              {data.statement.refunds > 0 ? <span>Estornos <strong>−{formatBRL(data.statement.refunds)}</strong></span> : null}
            </div>
          ) : null}
          {data.biggest ? (
            <div className="hero-sub" style={{ marginTop: 6 }}>
              <span>Maior compra: <strong>{formatBRL(data.biggest.amount)}</strong> em {titleCase(data.biggest.normalizedMerchant || data.biggest.description)}</span>
            </div>
          ) : null}
          <div className="hero-coverage">
            <div className="hero-coverage-labels">
              <span>Receita {formatBRL(data.income)}</span>
              <span>
                Compromissos {formatBRL(data.commitments)}
                {data.debtMonthly || data.fixedMonthly ? ` (inclui ${[data.fixedMonthly ? `${formatBRL(data.fixedMonthly)} de contas fixas` : '', data.debtMonthly ? `${formatBRL(data.debtMonthly)} de dívidas` : ''].filter(Boolean).join(' e ')})` : ''}
              </span>
            </div>
            <ProgressBar value={coverage} size="lg" tone={coverage >= 100 ? 'good' : coverage >= 70 ? 'warn' : 'bad'} />
          </div>
        </div>
        <div className="hero-side">
          {selectedMonth ? (
            <Link className="hero-stat clickable wide" to="/contas" title="Ver as contas fixas do mês">
              <span>Gasto total do mês</span>
              <strong>{formatBRL(data.commitments)}</strong>
              <small>
                Cartão {formatBRL(data.invoice)} · contas fixas {formatBRL(data.fixedMonthly)}
                {data.debtMonthly ? ` · dívidas ${formatBRL(data.debtMonthly)}` : ''}
              </small>
            </Link>
          ) : null}
          <Link className="hero-stat clickable" to="/receitas">
            <span>Receita</span>
            <strong className="text-good">{formatBRL(data.income)}</strong>
            <small>{data.income ? 'Entradas registradas' : <span className="link-button">Registrar receita</span>}</small>
          </Link>
          <Link className="hero-stat clickable" to="/receitas">
            <span>Saldo</span>
            <strong className={data.balance >= 0 ? 'text-good' : 'text-bad'}>{formatBRL(data.balance)}</strong>
            <small>Receita − compromissos</small>
          </Link>
          <Link className="hero-stat clickable" to="/pessoas">
            <span>A receber</span>
            <strong>{formatBRL(data.owedTotal)}</strong>
            <small>{data.people.length} pessoa(s) devendo</small>
          </Link>
          <Link className="hero-stat clickable" to="/metas?parcelas=proximas">
            <span>Próximos 3 meses</span>
            <strong>{formatBRL(data.upcoming.slice(0, 3).reduce((sum, item) => sum + item.total, 0))}</strong>
            <small>Parcelas, dívidas e contas fixas</small>
          </Link>
        </div>
      </section>

      <Card span="two-thirds" title="Para onde foi o dinheiro"
        subtitle={`${selectedMonth ? formatMonthLong(selectedMonth) : 'Todo o período'}${showTotal ? ' · cartão + contas fixas' : data.hasFixed ? ' · só o cartão' : ''}`} icon={<Tags size={17} />}
        actions={<>{data.hasFixed ? <SpendingScopeTabs /> : null}<Link className="small-action" to="/analises">Ver análises <ArrowRight size={14} /></Link></>}>
        {topCategories.length ? (
          <div className="rank-list">
            {topCategories.map(category => (
              <Link className="rank-row clickable-row" key={category.id} to={category.cardTotal ? `/transacoes?categoria=${category.id}` : '/contas'} title={category.cardTotal ? `Ver as compras de ${category.name}` : 'Ver as contas fixas'}>
                <div className="rank-row-head">
                  <CategoryDot color={category.color} />
                  <span className="name">{category.name}</span>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {[category.count ? `${category.count} compras` : '', category.fixedTotal ? `${formatBRL(category.fixedTotal)} de contas fixas` : ''].filter(Boolean).join(' + ')}
                  </span>
                  <span className="value">{formatBRL(category.total)}</span>
                  <span className="share">{category.percent.toFixed(0)}%</span>
                </div>
                <ProgressBar value={(category.total / topCategories[0].total) * 100} color={category.color} size="sm" />
              </Link>
            ))}
          </div>
        ) : <EmptyState compact title="Sem gastos no período." />}
      </Card>

      <Card span="third" title="Pede atenção" icon={<AlertTriangle size={17} />}>
        {data.alerts.length ? (
          <div className="alert-list">
            {data.alerts.map(alert => (
              <Link key={alert.id} className="alert-item" to={alert.to}>
                <span className={`alert-icon tone-${alert.tone}`}>{alert.icon}</span>
                <div>
                  <strong>{alert.title}</strong>
                  <span>{alert.detail}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="alert-item">
            <span className="alert-icon tone-good"><CheckCircle2 size={16} /></span>
            <div><strong>Tudo em dia</strong><span>Nada fora do esperado neste período.</span></div>
          </div>
        )}
        <div className="card-fill" />
        <CardSummary />
      </Card>

      <Card span="half" title={data.hasFixedHistory ? 'Evolução dos gastos' : 'Evolução das faturas'}
        subtitle={`${data.hasFixedHistory ? 'Fatura + contas fixas · ' : ''}média da fatura ${formatBRL(data.average)} · toque numa barra para abrir o mês`} icon={<TrendingUp size={17} />}>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.history.map(item => ({ ...item, label: formatMonthShort(item.month) }))}>
              <CartesianGrid {...chart.grid} vertical={false} />
              <XAxis dataKey="label" {...chart.axis} />
              <YAxis {...chart.axis} width={62} tickFormatter={chart.moneyAxis} />
              <Tooltip {...chart.tooltip} />
              <ReferenceLine y={data.average} stroke={chart.colors.muted} strokeDasharray="4 4" />
              {data.hasFixedHistory ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
              <Bar dataKey="expense" name="Fatura" stackId="gasto" radius={data.hasFixedHistory ? [0, 0, 0, 0] : [6, 6, 0, 0]} fill={chart.colors.primary} cursor="pointer" onClick={entry => { const month = monthFromBar(entry); if (month) onSelectMonth(month); }}>
                {data.history.map(item => (
                  <Cell key={item.month} fill={item.month === selectedMonth ? chart.colors.primary : chart.colors.border} />
                ))}
              </Bar>
              {data.hasFixedHistory ? (
                <Bar dataKey="fixed" name="Contas fixas" stackId="gasto" radius={[6, 6, 0, 0]} fill={chart.colors.info} cursor="pointer" onClick={entry => { const month = monthFromBar(entry); if (month) onSelectMonth(month); }} />
              ) : null}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card span="half" title="Próximos compromissos" subtitle="Parcelas já assumidas no cartão (inclusive as que ainda vão cair) e dívidas" icon={<CalendarClock size={17} />}
        actions={<Link className="small-action" to="/metas">Planejamento <ArrowRight size={14} /></Link>}>
        <div className="rank-list">
          {data.upcoming.map(item => (
            <Link className="rank-row clickable-row" key={item.month} to={`/metas?parcelas=${item.month}`} title="Ver as parcelas deste mês">
              <div className="rank-row-head">
                <span className="name">{formatMonthLong(item.month)}</span>
                <span className="muted" style={{ fontSize: 12 }}>{item.count} parcela(s){item.debt ? ' + dívidas' : ''}{item.fixed ? ' + contas' : ''}</span>
                <span className="value">{formatBRL(item.total)}</span>
              </div>
              <ProgressBar value={(item.total / data.upcomingMax) * 100} size="sm" tone="accent" />
            </Link>
          ))}
        </div>
      </Card>

      <Card span="third" title="Locais que mais pesaram" icon={<Wallet size={17} />}>
        {data.merchants.length ? (
          <div className="list">
            {data.merchants.map((merchant, position) => (
              <Link className="list-row clickable-row" key={merchant.merchant} to={`/transacoes?busca=${encodeURIComponent(merchant.merchant)}`} title={`Ver as compras em ${titleCase(merchant.merchant)}`}>
                <span className="badge badge-neutral">{position + 1}</span>
                <div className="grow">
                  <span className="title">{titleCase(merchant.merchant)}</span>
                  <span className="subtitle">{merchant.count} compra(s)</span>
                </div>
                <span className="amount">{formatBRL(merchant.total)}</span>
              </Link>
            ))}
          </div>
        ) : <EmptyState compact title="Sem compras no período." />}
      </Card>

      <Card span="third" title="Quem te deve" icon={<HandCoins size={17} />} actions={<Link className="small-action" to="/pessoas">Cobranças <ArrowRight size={14} /></Link>}>
        {data.people.length ? (
          <div className="list">
            {data.people.slice(0, 5).map(person => (
              <Link className="list-row clickable-row" key={person.name} to={`/pessoas?pessoa=${encodeURIComponent(person.name)}`} title={`Abrir as cobranças de ${person.name}`}>
                <Avatar name={person.name} size="sm" />
                <div className="grow">
                  <span className="title">{person.name}</span>
                  <span className="subtitle">{person.items.length} pendência(s) · há {oldestPendingDays(person)} dias</span>
                </div>
                <span className="amount">{formatBRL(person.total)}</span>
              </Link>
            ))}
          </div>
        ) : <EmptyState compact title="Ninguém te devendo." />}
      </Card>

      <Card span="third" title="Metas do mês" icon={<PiggyBank size={17} />} actions={<Link className="small-action" to="/metas">Metas <ArrowRight size={14} /></Link>}>
        {data.budgetStatus.length ? (
          <div className="rank-list">
            {data.budgetStatus.slice(0, 5).map(item => (
              <Link className="rank-row clickable-row" key={item.categoryId} to={`/transacoes?categoria=${item.categoryId}`} title={`Ver as compras de ${item.name}`}>
                <div className="rank-row-head">
                  <CategoryDot color={item.color} />
                  <span className="name">{item.name}</span>
                  <span className="value">{formatBRL(item.spent)}</span>
                  <span className="share">{item.progress.toFixed(0)}%</span>
                </div>
                <ProgressBar value={item.progress} size="sm" tone={item.level === 'estourado' ? 'bad' : item.level === 'alerta' ? 'warn' : 'good'} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState compact title={selectedMonth ? 'Nenhuma meta definida.' : 'Escolha um mês para ver as metas.'} description={selectedMonth ? <Link className="link-button" to="/metas">Definir tetos por categoria</Link> : undefined} />
        )}
      </Card>

      <AiTipsCard selectedMonth={selectedMonth} />
    </div>
  );
}

/** Situação do cartão hoje: qual fatura está aberta e as datas que importam. */
function CardSummary() {
  const card = useCardSettings();
  const month = openInvoiceMonth(card);
  const short = (iso: string) => formatDate(iso).slice(0, 5);
  return (
    <div className="card-summary">
      <span className="card-summary-title"><CreditCard size={14} /> Compras de hoje vão para a fatura de {formatMonthLong(month)}</span>
      <div className="card-summary-grid">
        <span><em>Fecha</em><b>{short(closingDateOf(month, card))}</b></span>
        <span><em>Vence</em><b>{short(dueDateOf(month, card))}</b></span>
        <span><em>Melhor dia de compra</em><b>{short(bestPurchaseDateOf(month, card))}</b></span>
      </div>
    </div>
  );
}

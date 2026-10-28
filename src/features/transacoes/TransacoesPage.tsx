import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, CreditCard, HandCoins, Plus, Receipt, Settings2, Sparkles, Upload, Wallet } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useFinance } from '../../store/FinanceContext';
import { bestPurchaseDateOf, closingDateOf, invoiceLooksIncomplete, openInvoiceMonth, saveCardSettings, useCardSettings, type CardSettings } from '../../store/cardSettings';
import { useTools } from '../../tools/useTools';
import { TransactionLedger, type QuickFilter } from '../../components/TransactionLedger';
import { InvoiceTimeline } from '../../components/InvoiceTimeline';
import { expenseTransactions, filterByMonth, getFutureInstallments, getInvoiceStatements } from '../../utils/analytics';
import { isLowConfidence } from '../../utils/categorizer';
import { currentMonthISO, formatBRL, formatDate, formatInvoiceMonthLabel, formatMonthLong, parseAmount, shiftMonth, todayISO } from '../../utils/formatters';
import { Badge, Card, Field, ProgressBar, StatCard } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';

export function TransacoesPage({ selectedMonth, onSelectMonth, onOpenImport }: { selectedMonth: string; onSelectMonth: (month: string) => void; onOpenImport: () => void }) {
  const { transactions, receivables, paidInvoiceMonths } = useFinance();
  const card = useCardSettings();
  const [showManual, setShowManual] = useState(false);
  const [showCard, setShowCard] = useState(false);
  // Filtros vindos de outras telas (?categoria=, ?filtro=, ?busca=) ou dos cards abaixo.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlFilter = (searchParams.get('filtro') || 'todas') as QuickFilter;
  const urlCategory = searchParams.get('categoria') || '';
  const urlSearch = searchParams.get('busca') || '';
  const applyFilter = (filter: QuickFilter | '') => {
    setSearchParams(filter && filter !== 'todas' ? { filtro: filter } : {});
    window.setTimeout(() => document.getElementById('lancamentos')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const data = useMemo(() => {
    const monthRows = filterByMonth(transactions, selectedMonth);
    const expenses = expenseTransactions(monthRows);
    const ids = new Set(expenses.map(item => item.id));
    const shared = receivables.filter(item => item.transactionId && ids.has(item.transactionId) && item.source === 'divisao');
    const statements = getInvoiceStatements(transactions, paidInvoiceMonths, card.dueDay);
    const statement = statements.find(item => item.month === selectedMonth);

    // Limite comprometido = faturas ainda não pagas + parcelas que vão cair depois da última fatura importada.
    const unpaid = statements.filter(item => item.status === 'aberta' || item.status === 'parcial').reduce((sum, item) => sum + Math.max(0, item.toPay - item.paidAmount), 0);
    const lastMonth = statements.at(-1)?.month || currentMonthISO();
    const futureInstallments = getFutureInstallments(transactions).filter(item => item.month > lastMonth).reduce((sum, item) => sum + item.amount, 0);

    return {
      statement,
      credits: monthRows.filter(item => item.type === 'income').sort((a, b) => a.date.localeCompare(b.date)),
      gross: expenses.reduce((sum, item) => sum + item.amount, 0),
      count: expenses.length,
      installments: expenses.filter(item => item.installment).reduce((sum, item) => sum + item.amount, 0),
      installmentCount: expenses.filter(item => item.installment).length,
      review: expenses.filter(item => !item.manualCategory && isLowConfidence(item.categorySource)).length,
      shared: shared.reduce((sum, item) => sum + item.amount, 0),
      used: unpaid + futureInstallments,
    };
  }, [transactions, receivables, paidInvoiceMonths, selectedMonth, card.dueDay]);

  if (!transactions.length) {
    return (
      <div className="page-grid">
        <Card span="full">
          <EmptyState icon={<CreditCard size={22} />} title="Nenhuma fatura importada" description="Importe um CSV ou OFX do banco para começar a organizar seus gastos."
            action={<button type="button" className="primary-button" onClick={onOpenImport}><Upload size={16} /> Importar fatura</button>} />
        </Card>
      </div>
    );
  }

  const { statement } = data;
  const isOpen = selectedMonth === openInvoiceMonth(card);
  const closing = selectedMonth ? closingDateOf(selectedMonth, card) : '';
  const incomplete = statement && !isOpen && invoiceLooksIncomplete(statement, closing);
  const available = card.limit ? card.limit - data.used : 0;

  return (
    <div className="page-grid">
      <div className="span-full">
        <InvoiceTimeline selectedMonth={selectedMonth} onSelect={onSelectMonth} />
      </div>

      {incomplete ? (
        <div className="notice warn span-full">
          <AlertTriangle size={16} />
          <span>
            A fatura {formatInvoiceMonthLabel(selectedMonth)} fechou em {formatDate(closing)}, mas a última compra no arquivo é de {formatDate(statement?.lastPurchase)}.
            O CSV provavelmente foi exportado antes do fechamento — exporte de novo no app do banco e substitua o arquivo em <code>public/faturas</code> (o app reimporta sozinho).
          </span>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label={statement && statement.advance > 0 ? 'A pagar' : 'Valor da fatura'} value={formatBRL(statement ? statement.toPay : data.gross)} icon={<Receipt size={16} />} tone="accent"
          hint={statement && statement.advance > 0 ? `${formatBRL(statement.total)} − ${formatBRL(statement.advance)} antecipado` : selectedMonth ? formatInvoiceMonthLabel(selectedMonth) : 'Todo o período'}
          active={urlFilter === 'todas' && !urlCategory && !urlSearch} onClick={() => applyFilter('todas')} />
        <StatCard label="Parceladas" value={formatBRL(data.installments)} hint={`${data.installmentCount} parcela(s) nesta fatura`} active={urlFilter === 'parceladas'} onClick={() => applyFilter(urlFilter === 'parceladas' ? '' : 'parceladas')} />
        {isOpen && selectedMonth ? (
          <StatCard label="Fecha em" value={formatDate(closing).slice(0, 5)} hint={`Melhor dia de compra: ${formatDate(bestPurchaseDateOf(selectedMonth, card)).slice(0, 5)}`} onClick={() => setShowCard(true)} />
        ) : (
          <StatCard label="Dividido com outros" value={formatBRL(data.shared)} hint="Vai voltar para você" icon={<HandCoins size={16} />} tone="good" active={urlFilter === 'divididas'} onClick={() => applyFilter(urlFilter === 'divididas' ? '' : 'divididas')} />
        )}
        {card.limit ? (
          <StatCard label="Limite disponível" value={formatBRL(available)} tone={available < card.limit * 0.15 ? 'bad' : 'neutral'} icon={<Wallet size={16} />} onClick={() => setShowCard(true)}
            hint={<span style={{ display: 'grid', gap: 6, width: '100%' }}><ProgressBar size="sm" value={(data.used / card.limit) * 100} tone={data.used / card.limit > 0.85 ? 'bad' : 'accent'} />{formatBRL(data.used)} de {formatBRL(card.limit)} comprometidos</span>} />
        ) : (
          <StatCard label="Limite disponível" value="—" hint="Toque para informar o limite do cartão" icon={<Wallet size={16} />} onClick={() => setShowCard(true)} />
        )}
        <StatCard label="A revisar" value={data.review} hint={data.review ? 'Toque para ver só esses' : 'Tudo categorizado'} icon={<Sparkles size={16} />} tone={data.review ? 'warn' : 'good'}
          active={urlFilter === 'revisar'} onClick={() => applyFilter(urlFilter === 'revisar' ? '' : 'revisar')} />
      </div>

      <div id="lancamentos" className="span-full" style={{ scrollMarginTop: 90 }}>
      <Card span="full" title="Lançamentos" subtitle={urlFilter === 'revisar' ? <>Mostrando só os incertos · <Link className="link-button" to="/categorias">sugerir categorias com IA</Link></> : 'Troque a categoria direto na tabela — o app oferece aplicar ao local inteiro e cria a regra para as próximas faturas.'}
        actions={(
          <>
            <button type="button" className="secondary-button" onClick={onOpenImport}><Upload size={15} /> Importar</button>
            <button type="button" className="secondary-button" onClick={() => setShowCard(true)}><Settings2 size={15} /> Cartão</button>
            <button type="button" className="primary-button" onClick={() => setShowManual(true)}><Plus size={15} /> Lançamento manual</button>
          </>
        )}>
        <TransactionLedger key={`${selectedMonth}|${searchParams.toString()}`} selectedMonth={selectedMonth} initialFilter={urlFilter} initialCategory={urlCategory} initialSearch={urlSearch} />
      </Card>
      </div>

      {data.credits.length ? (
        <Card span="full" title="Pagamentos e estornos" subtitle="Créditos que vieram no extrato deste ciclo. Pagamentos depois do vencimento anterior contam como antecipados.">
          <div className="list">
            {data.credits.map(item => (
              <div className="list-row" key={item.id}>
                <Badge tone={item.creditKind === 'pagamento' ? 'good' : 'info'}>{item.creditKind === 'pagamento' ? 'pagamento' : 'estorno'}</Badge>
                <div className="grow">
                  <span className="title">{item.description}</span>
                  <span className="subtitle">{formatDate(item.date)}</span>
                </div>
                <span className="amount text-good">−{formatBRL(item.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {showManual ? <ManualExpenseModal defaultMonth={selectedMonth || openInvoiceMonth(card)} onClose={() => setShowManual(false)} /> : null}
      {showCard ? <CardSettingsModal onClose={() => setShowCard(false)} /> : null}
    </div>
  );
}

function CardSettingsModal({ onClose }: { onClose: () => void }) {
  const card = useCardSettings();
  const { toast } = useFeedback();
  const [dueDay, setDueDay] = useState(String(card.dueDay));
  const [closingDaysBefore, setClosingDaysBefore] = useState(String(card.closingDaysBefore));
  const [limit, setLimit] = useState(card.limit ? String(card.limit) : '');

  const preview: CardSettings = { dueDay: Number(dueDay) || 7, closingDaysBefore: Number(closingDaysBefore) || 0, limit: parseAmount(limit) };
  const nextMonth = openInvoiceMonth(preview);

  const save = (event: FormEvent) => {
    event.preventDefault();
    saveCardSettings({ dueDay: Math.min(31, Math.max(1, preview.dueDay)), closingDaysBefore: Math.min(20, Math.max(0, preview.closingDaysBefore)), limit: Math.max(0, preview.limit) });
    toast('Dados do cartão salvos.');
    onClose();
  };

  return (
    <Modal size="sm" title="Seu cartão" subtitle="Usado para vencimentos, melhor dia de compra, status das faturas e limite disponível." onClose={onClose} icon={<CreditCard size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="card-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="card-form" className="form-grid" onSubmit={save}>
        <Field label="Dia do vencimento"><input type="number" min="1" max="31" required value={dueDay} onChange={event => setDueDay(event.target.value)} /></Field>
        <Field label="Fecha quantos dias antes" hint="No Inter costuma ser 8."><input type="number" min="0" max="20" required value={closingDaysBefore} onChange={event => setClosingDaysBefore(event.target.value)} /></Field>
        <Field label="Limite total do cartão" full hint="Opcional — mostra quanto ainda está livre, contando parcelas futuras."><input type="number" min="0" step="0.01" inputMode="decimal" value={limit} onChange={event => setLimit(event.target.value)} placeholder="Ex.: 8000" /></Field>
        <div className="notice full">
          <CreditCard size={16} />
          <span>Compras de hoje ({formatDate(todayISO())}) entram na fatura de <strong>{formatMonthLong(nextMonth)}</strong>, que fecha em {formatDate(closingDateOf(nextMonth, preview))}. Melhor dia de compra: {formatDate(bestPurchaseDateOf(nextMonth, preview))}.</span>
        </div>
      </form>
    </Modal>
  );
}

function ManualExpenseModal({ defaultMonth, onClose }: { defaultMonth: string; onClose: () => void }) {
  const { categories } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayISO());
  const [invoiceMonth, setInvoiceMonth] = useState(defaultMonth);
  const [categoryId, setCategoryId] = useState('outros');
  const [installments, setInstallments] = useState('1');
  const [note, setNote] = useState('');

  const total = parseAmount(amount);
  const parts = Math.max(1, Number(installments) || 1);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = await callTool<{ created: number }>('lancar_despesa_manual', { date, description, amount: total, categoryId, invoiceMonth, installments: parts, note });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(parts > 1 ? `${parts} parcelas lançadas a partir de ${formatMonthLong(invoiceMonth)}.` : 'Lançamento adicionado à fatura.');
    onClose();
  };

  return (
    <Modal title="Lançamento manual" subtitle="Uma compra que não veio no extrato (ou ainda não fechou a fatura)." onClose={onClose} icon={<Plus size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="manual-form" className="primary-button">Adicionar</button>
        </>
      )}>
      <form id="manual-form" className="form-grid" onSubmit={save}>
        <Field label="Descrição" full><input required autoFocus value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex.: Mercado do bairro" /></Field>
        <Field label="Valor total"><input required type="number" step="0.01" min="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" /></Field>
        <Field label="Parcelas" hint={parts > 1 && total ? `${parts}x de ${formatBRL(total / parts)}` : undefined}>
          <input type="number" min="1" max="48" step="1" value={installments} onChange={event => setInstallments(event.target.value)} />
        </Field>
        <Field label="Data da compra"><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="Fatura (1ª parcela)" hint={formatInvoiceMonthLabel(invoiceMonth)}>
          <input required type="month" value={invoiceMonth} onChange={event => setInvoiceMonth(event.target.value)} />
        </Field>
        <Field label="Categoria" full>
          <select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label="Observação" full><input value={note} onChange={event => setNote(event.target.value)} placeholder="Opcional" /></Field>
        {parts > 1 ? <p className="muted full" style={{ margin: 0, fontSize: 12.5 }}>Última parcela na fatura de {formatMonthLong(shiftMonth(invoiceMonth, parts - 1))}.</p> : null}
      </form>
    </Modal>
  );
}

import { useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import { bestPurchaseDateOf, closingDateOf, dueDateOf, invoiceLooksIncomplete, openInvoiceMonth, useCardSettings } from '../store/cardSettings';
import { getInvoiceStatements, type InvoiceStatement } from '../utils/analytics';
import { formatBRL, formatDate, todayISO } from '../utils/formatters';
import { Badge } from './ui/Card';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const monthTitle = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const dayMonth = (iso: string) => formatDate(iso).slice(0, 5);

const STATUS: Record<InvoiceStatement['status'], { label: string; tone: 'good' | 'warn' | 'info' | 'neutral' }> = {
  paga: { label: 'Paga', tone: 'good' },
  parcial: { label: 'Parcial', tone: 'warn' },
  aberta: { label: 'Aberta', tone: 'info' },
  sem_dados: { label: 'Sem pagamento no extrato', tone: 'neutral' },
};

export function InvoiceTimeline({ selectedMonth, onSelect }: { selectedMonth: string; onSelect: (month: string) => void }) {
  const { transactions, paidInvoiceMonths } = useFinance();
  const card = useCardSettings();
  const scroller = useRef<HTMLDivElement>(null);

  const statements = useMemo(() => getInvoiceStatements(transactions, paidInvoiceMonths, card.dueDay).slice(-12), [transactions, paidInvoiceMonths, card.dueDay]);
  const open = openInvoiceMonth(card);
  const today = todayISO();

  useEffect(() => {
    const target = scroller.current?.querySelector<HTMLElement>('.invoice-card.selected');
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [selectedMonth, statements.length]);

  const scrollBy = (direction: number) => scroller.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });

  if (!statements.length) return null;

  return (
    <div className="invoice-timeline">
      <button type="button" className="timeline-arrow" onClick={() => scrollBy(-1)} aria-label="Faturas anteriores"><ChevronLeft size={20} /></button>
      <div className="invoice-track" ref={scroller}>
        {statements.map(statement => {
          const isOpen = statement.month === open;
          const status = isOpen && statement.status !== 'paga' ? { label: 'Aberta', tone: 'info' as const } : STATUS[statement.status];
          const closing = closingDateOf(statement.month, card);
          const incomplete = !isOpen && invoiceLooksIncomplete(statement, closing, today);
          return (
            <button type="button" key={statement.month} className={`invoice-card ${statement.month === selectedMonth ? 'selected' : ''} ${isOpen ? 'open' : ''}`} onClick={() => onSelect(statement.month)}>
              <div className="invoice-card-head">
                <strong>{monthTitle(statement.month)}</strong>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              <div className="invoice-card-amount">{formatBRL(statement.toPay)}</div>
              <div className="invoice-card-rows">
                <span><em>Vencimento</em><b>{dayMonth(dueDateOf(statement.month, card))}</b></span>
                {statement.advance > 0 ? <span><em>Pago antecipado</em><b>{formatBRL(statement.advance)}</b></span> : null}
                {statement.refunds > 0 ? <span><em>Estornos</em><b>−{formatBRL(statement.refunds)}</b></span> : null}
                {isOpen
                  ? <span><em>Melhor dia de compra</em><b>{dayMonth(bestPurchaseDateOf(statement.month, card))}</b></span>
                  : statement.paidOn && statement.status === 'paga'
                    ? <span><em>Paga em</em><b>{dayMonth(statement.paidOn)}</b></span>
                    : statement.status === 'parcial'
                      ? <span><em>Pago</em><b>{formatBRL(statement.paidAmount)}</b></span>
                      : null}
              </div>
              {incomplete ? <span className="invoice-card-warning" title={`Última compra em ${formatDate(statement.lastPurchase)}, mas a fatura fechou em ${formatDate(closing)}. Exporte o CSV de novo.`}>⚠ CSV pode estar incompleto</span> : null}
            </button>
          );
        })}
      </div>
      <button type="button" className="timeline-arrow" onClick={() => scrollBy(1)} aria-label="Próximas faturas"><ChevronRight size={20} /></button>
    </div>
  );
}

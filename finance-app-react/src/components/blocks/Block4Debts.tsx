import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFinance } from '../../store/FinanceContext';
import { getDebtBalance, getDebtPayoffRows } from '../../utils/analytics';
import { formatBRL, formatDate } from '../../utils/formatters';
import { DataTable, type Column } from '../ui/DataTable';
import type { Debt } from '../../types';

type DebtRow = Debt & {
  remaining: number;
  progress: number;
  risk: string;
  payoffMonths: number;
};

type PersonDebtSummary = {
  counterparty: string;
  receivable: number;
  payable: number;
  balance: number;
};

const riskOf = (rate: number) => {
  if (rate >= 3) return 'Alto';
  if (rate >= 1) return 'Medio';
  return 'Controlado';
};

const payoffMonths = (debt: Debt, remaining: number) => {
  if (remaining <= 0) return 0;
  if (debt.monthlyPayment <= 0) return 999;
  let balance = remaining;
  const rate = debt.interestRate / 100;
  for (let month = 1; month <= 120; month += 1) {
    balance = Math.max(0, balance * (1 + rate) - debt.monthlyPayment);
    if (balance === 0) return month;
  }
  return 999;
};

export function Block4Debts() {
  const { debts, transactions } = useFinance();
  const [extraPayment, setExtraPayment] = useState(0);

  const rows = useMemo<DebtRow[]>(() => debts.map(debt => {
    const remaining = getDebtBalance(debt, transactions);
    return {
      ...debt,
      remaining,
      progress: debt.totalAmount ? ((debt.totalAmount - remaining) / debt.totalAmount) * 100 : 0,
      risk: riskOf(debt.interestRate),
      payoffMonths: payoffMonths(debt, remaining),
    };
  }), [debts, transactions]);

  const totals = useMemo(() => {
    const payable = rows.filter(item => item.type === 'a_pagar');
    const receivable = rows.filter(item => item.type === 'a_receber');
    return {
      payable: payable.reduce((sum, item) => sum + item.remaining, 0),
      receivable: receivable.reduce((sum, item) => sum + item.remaining, 0),
      monthly: payable.reduce((sum, item) => sum + item.monthlyPayment, 0),
      highestRate: rows.reduce((max, item) => Math.max(max, item.interestRate), 0),
      shortest: payable.filter(item => item.payoffMonths < 999).sort((a, b) => a.payoffMonths - b.payoffMonths)[0],
    };
  }, [rows]);

  const summaryRows = useMemo<PersonDebtSummary[]>(() => {
    const groups = new Map<string, PersonDebtSummary>();
    rows.forEach(row => {
      const current = groups.get(row.counterparty) || { counterparty: row.counterparty, receivable: 0, payable: 0, balance: 0 };
      if (row.type === 'a_receber') current.receivable += row.remaining;
      if (row.type === 'a_pagar') current.payable += row.remaining;
      current.balance = current.receivable - current.payable;
      groups.set(row.counterparty, current);
    });
    return Array.from(groups.values()).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [rows]);

  const payoffDebt = rows.filter(item => item.type === 'a_pagar' && item.remaining > 0).sort((a, b) => b.remaining - a.remaining)[0];
  const payoffRows = payoffDebt ? getDebtPayoffRows({ ...payoffDebt, totalAmount: payoffDebt.remaining, paidAmount: 0 }, extraPayment) : [];
  const debtByType = [
    { name: 'A pagar', value: totals.payable },
    { name: 'A receber', value: totals.receivable },
  ];

  const columns: Column<DebtRow>[] = [
    { key: 'counterparty', header: 'Pessoa/entidade', accessor: row => row.counterparty },
    { key: 'type', header: 'Tipo', accessor: row => row.type === 'a_receber' ? 'A receber' : 'A pagar', align: 'center' },
    { key: 'origin', header: 'Origem', accessor: row => row.origin, align: 'center' },
    { key: 'remaining', header: 'Saldo', accessor: row => row.remaining, render: row => formatBRL(row.remaining), align: 'right', sortValue: row => row.remaining },
    { key: 'monthlyPayment', header: 'Parcela', accessor: row => row.monthlyPayment, render: row => formatBRL(row.monthlyPayment), align: 'right' },
    { key: 'interestRate', header: 'Juros', accessor: row => `${row.interestRate}%`, align: 'center', sortValue: row => row.interestRate },
    { key: 'risk', header: 'Risco', accessor: row => row.risk, align: 'center', render: row => <span className={`badge ${row.risk === 'Alto' ? 'danger' : row.risk === 'Medio' ? 'warning' : 'success'}`}>{row.risk}</span> },
    { key: 'startDate', header: 'Inicio', accessor: row => formatDate(row.startDate), align: 'center', sortValue: row => row.startDate },
  ];

  const summaryColumns: Column<PersonDebtSummary>[] = [
    { key: 'counterparty', header: 'Pessoa/entidade', accessor: row => row.counterparty },
    { key: 'receivable', header: 'A receber', accessor: row => row.receivable, render: row => formatBRL(row.receivable), align: 'right' },
    { key: 'payable', header: 'A pagar', accessor: row => row.payable, render: row => formatBRL(row.payable), align: 'right' },
    { key: 'balance', header: 'Saldo', accessor: row => row.balance, render: row => formatBRL(row.balance), align: 'right' },
  ];

  if (!rows.length) {
    return <div className="empty-state">Cadastre dividas, emprestimos ou valores a receber para acompanhar saldo, risco e quitacao.</div>;
  }

  return (
    <div className="section-grid">
      <div className="kpi-grid">
        <Kpi label="Total a pagar" value={formatBRL(totals.payable)} tone="danger" sub="Eu devo" />
        <Kpi label="Total a receber" value={formatBRL(totals.receivable)} tone="success" sub="Me devem" />
        <Kpi label="Parcela mensal" value={formatBRL(totals.monthly)} tone="warning" sub="Compromisso fixo" />
        <Kpi label="Maior juros" value={`${totals.highestRate.toFixed(2)}%`} tone={totals.highestRate >= 3 ? 'danger' : 'info'} sub="ao mes" />
      </div>

      <div className="chart-card">
        <h3>Resumo por tipo</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={debtByType}>
            <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ef" vertical={false} />
            <XAxis dataKey="name" />
            <YAxis tickFormatter={value => `R$${Number(value) / 1000}k`} />
            <Tooltip formatter={value => formatBRL(Number(value || 0))} />
            <Bar dataKey="value" fill="#2563eb" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-card">
        <div className="chart-title-row">
          <h3>Simulacao de quitacao</h3>
          <label className="slider-label">
            Aporte extra {formatBRL(extraPayment)}
            <input type="range" min="0" max="3000" step="50" value={extraPayment} onChange={event => setExtraPayment(Number(event.target.value))} />
          </label>
        </div>
        {payoffDebt ? (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={payoffRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#dbe3ef" />
              <XAxis dataKey="month" tickFormatter={value => `${value}m`} />
              <YAxis tickFormatter={value => `R$${Number(value) / 1000}k`} />
              <Tooltip formatter={value => formatBRL(Number(value || 0))} labelFormatter={value => `Mes ${value}`} />
              <Line dataKey="base" name="Sem aporte" stroke="#dc2626" strokeWidth={2} dot={false} />
              <Line dataKey="extra" name="Com aporte" stroke="#16a34a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <div className="empty-state compact">Sem divida a pagar para simular.</div>}
      </div>

      <div className="chart-card wide">
        <h3>Resumo por pessoa</h3>
        <DataTable rows={summaryRows} columns={summaryColumns} searchPlaceholder="Buscar pessoa..." initialPageSize={6} />
      </div>

      <div className="chart-card wide">
        <h3>Detalhamento das dividas</h3>
        <DataTable rows={rows} columns={columns} searchPlaceholder="Buscar pessoa, origem ou tipo..." initialPageSize={8} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: 'danger' | 'success' | 'warning' | 'info' }) {
  return <div className={`kpi-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>;
}

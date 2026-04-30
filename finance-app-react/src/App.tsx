import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, Plus, Trash2, Upload } from 'lucide-react';
import { FinanceProvider, useFinance } from './store/FinanceContext';
import { ImportModal } from './components/ImportModal';
import { ManualEntryModal } from './components/ManualEntryModal';
import { TransactionLedger } from './components/TransactionLedger';
import { Block1Overview } from './components/blocks/Block1Overview';
import { Block2WhereMoneyWent } from './components/blocks/Block2WhereMoneyWent';
import { Block3Cashflow } from './components/blocks/Block3Cashflow';
import { Block4Debts } from './components/blocks/Block4Debts';
import { Block5Behavior } from './components/blocks/Block5Behavior';
import { Block6Budgets } from './components/blocks/Block6Budgets';
import { formatMonth } from './utils/formatters';

function Dashboard() {
  const { transactions, clearAllData, exportData, autoImportStatus } = useFinance();
  const [showImport, setShowImport] = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState('');

  const months = useMemo(() => Array.from(new Set(transactions.map(item => item.date.substring(0, 7)))).sort().reverse(), [transactions]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">Controle financeiro pessoal</span>
          <h1>Dashboard Financeiro</h1>
          <p>{autoImportStatus}</p>
        </div>
        <div className="topbar-actions">
          <select value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>
            <option value="">Todo o periodo</option>
            {months.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
          </select>
          <button className="secondary-button" onClick={() => setShowManual(true)}><Plus size={16} /> Lancar</button>
          <button className="primary-button" onClick={() => setShowImport(true)}><Upload size={16} /> Importar</button>
          <button className="icon-button" onClick={exportData} title="Exportar JSON"><Download size={18} /></button>
          <button className="icon-button danger" onClick={clearAllData} title="Limpar dados"><Trash2 size={18} /></button>
        </div>
      </header>

      <main className="page-content">
        {!transactions.length ? (
          <section className="empty-hero">
            <span>Comece importando CSV/OFX ou deixe arquivos em public/faturas para importacao automatica.</span>
            <button className="primary-button" onClick={() => setShowImport(true)}><Upload size={16} /> Importar agora</button>
          </section>
        ) : null}

        <Section title="Visao geral do ano"><Block1Overview selectedMonth={selectedMonth} /></Section>
        <Section title="Onde o dinheiro foi"><Block2WhereMoneyWent selectedMonth={selectedMonth} /></Section>
        <Section title="Fluxo de caixa e sazonalidade"><Block3Cashflow /></Section>
        <Section title="Planejamento futuro"><Block6Budgets /></Section>
        <Section title="Painel de dividas"><Block4Debts /></Section>
        <Section title="Comportamento de consumo"><Block5Behavior /></Section>
        <Section title="Lancamentos"><TransactionLedger selectedMonth={selectedMonth} /></Section>
      </main>

      {showImport ? <ImportModal onClose={() => setShowImport(false)} /> : null}
      {showManual ? <ManualEntryModal onClose={() => setShowManual(false)} /> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="dashboard-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function App() {
  return (
    <FinanceProvider>
      <Dashboard />
    </FinanceProvider>
  );
}

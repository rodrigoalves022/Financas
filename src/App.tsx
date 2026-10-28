import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { HashRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  BarChart3, ChevronLeft, ChevronRight, CreditCard, Landmark, LayoutDashboard, Menu, Moon, Printer, Receipt, Sun, Tags, Target, Upload, Users, Wallet,
} from 'lucide-react';
import { FinanceProvider, useFinance } from './store/FinanceContext';
import { FLAGS, readFlag, writeFlag } from './store/storage';
import { FeedbackProvider } from './components/ui/feedback';
import { ACCENTS, ThemeProvider, useTheme, type AccentId } from './components/ui/theme';
import { ImportModal } from './components/ImportModal';
import { LocalInbox } from './components/LocalInbox';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { TransacoesPage } from './features/transacoes/TransacoesPage';

// Painel e Fatura (mais usados) vão no pacote inicial; o resto carrega sob demanda.
const AnalisesPage = lazy(() => import('./features/analises/AnalisesPage').then(module => ({ default: module.AnalisesPage })));
const ReceitasPage = lazy(() => import('./features/receitas/ReceitasPage').then(module => ({ default: module.ReceitasPage })));
const PessoasPage = lazy(() => import('./features/pessoas/PessoasPage').then(module => ({ default: module.PessoasPage })));
const DividasPage = lazy(() => import('./features/dividas/DividasPage').then(module => ({ default: module.DividasPage })));
const ContasFixasPage = lazy(() => import('./features/contas/ContasFixasPage').then(module => ({ default: module.ContasFixasPage })));
const MetasPage = lazy(() => import('./features/metas/MetasPage').then(module => ({ default: module.MetasPage })));
const CategoriasPage = lazy(() => import('./features/categorias/CategoriasPage').then(module => ({ default: module.CategoriasPage })));
const ImportacaoPage = lazy(() => import('./features/importacao/ImportacaoPage').then(module => ({ default: module.ImportacaoPage })));
import { getAccountingMonth, getLatestInvoiceMonth, getPeopleWhoOweMe } from './utils/analytics';
import { currentMonthISO, formatInvoiceMonthLabel } from './utils/formatters';

type Group = 'Análise' | 'Gestão' | 'Sistema';

interface ModuleDef {
  id: string;
  path: string;
  label: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  group: Group;
  usesMonth?: boolean;
}

const MODULES: ModuleDef[] = [
  { id: 'dashboard', path: '/painel', label: 'Painel', icon: LayoutDashboard, group: 'Análise', usesMonth: true, description: 'Resumo da fatura, saldo do mês e o que pede atenção.' },
  { id: 'analises', path: '/analises', label: 'Análises', icon: BarChart3, group: 'Análise', usesMonth: true, description: 'Categorias, locais, fluxo mensal, comportamento e análise com IA.' },
  { id: 'transacoes', path: '/transacoes', label: 'Fatura', icon: CreditCard, group: 'Gestão', usesMonth: true, description: 'Revise, categorize, divida e anote os lançamentos da fatura.' },
  { id: 'receitas', path: '/receitas', label: 'Receitas', icon: Wallet, group: 'Gestão', usesMonth: true, description: 'Entradas reais de dinheiro e status de pagamento da fatura.' },
  { id: 'pessoas', path: '/pessoas', label: 'Pessoas e cobranças', icon: Users, group: 'Gestão', description: 'Quem te deve, recebimentos, cobrança por WhatsApp e cadastro de pessoas.' },
  { id: 'contas', path: '/contas', label: 'Contas fixas', icon: Receipt, group: 'Gestão', usesMonth: true, description: 'Contas pagas fora do cartão: financiamento, internet, moradia.' },
  { id: 'dividas', path: '/dividas', label: 'Dívidas', icon: Landmark, group: 'Gestão', description: 'Financiamentos e empréstimos próprios, com plano de quitação.' },
  { id: 'metas', path: '/metas', label: 'Metas e planejamento', icon: Target, group: 'Gestão', usesMonth: true, description: 'Tetos de gasto por categoria e compromissos dos próximos meses.' },
  { id: 'categorias', path: '/categorias', label: 'Categorias e regras', icon: Tags, group: 'Gestão', description: 'Categorias, regras automáticas inteligentes e assistente de IA.' },
  { id: 'importacao', path: '/importacao', label: 'Importação e backup', icon: Upload, group: 'Sistema', description: 'Importe faturas, faça backup, restaure e conecte o Telegram.' },
];

const GROUPS: Group[] = ['Análise', 'Gestão', 'Sistema'];
const ALL_PERIOD = 'all';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [pathname]);
  return null;
}

function FinanceApp() {
  const { transactions, monthlyIncomes, receivables, debts, members, autoImportStatus, isReady } = useFinance();
  const { theme, accent, toggleTheme, setAccent } = useTheme();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [storedMonth, setStoredMonth] = useState(() => readFlag(FLAGS.selectedMonth) || '');

  useEffect(() => {
    const timer = window.setTimeout(() => setNavOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [location.pathname]);

  const months = useMemo(() => Array.from(new Set([
    ...transactions.map(getAccountingMonth),
    ...monthlyIncomes.map(item => item.month),
  ])).sort().reverse(), [monthlyIncomes, transactions]);

  // "Todo o período" agora é um valor próprio. Antes era string vazia — que também
  // significava "sem escolha" — então o seletor sempre voltava para o último mês.
  const defaultMonth = getLatestInvoiceMonth(transactions) || months[0] || currentMonthISO();
  const pickerValue = storedMonth === ALL_PERIOD ? ALL_PERIOD : months.includes(storedMonth) ? storedMonth : defaultMonth;
  const selectedMonth = pickerValue === ALL_PERIOD ? '' : pickerValue;

  const setSelectedMonth = useCallback((month: string) => {
    setStoredMonth(month);
    writeFlag(FLAGS.selectedMonth, month || null);
  }, []);

  // Links de outras telas podem escolher o mês da fatura (?mes=2026-08 ou ?mes=all).
  useEffect(() => {
    const month = new URLSearchParams(location.search).get('mes');
    if (!month) return;
    const timer = window.setTimeout(() => setSelectedMonth(month), 0);
    return () => window.clearTimeout(timer);
  }, [location.search, setSelectedMonth]);

  const activeModule = MODULES.find(item => location.pathname.startsWith(item.path)) || MODULES[0];

  // Aba do navegador com a página atual ("Painel · Finanças"), não um título fixo comprido.
  useEffect(() => {
    document.title = `${activeModule.label} · Finanças`;
  }, [activeModule.label]);
  const chronological = useMemo(() => [...months].reverse(), [months]);
  const index = chronological.indexOf(selectedMonth);
  const previousMonth = index > 0 ? chronological[index - 1] : '';
  const nextMonth = index >= 0 && index < chronological.length - 1 ? chronological[index + 1] : '';

  const peopleOwing = useMemo(() => getPeopleWhoOweMe(receivables, debts, members, transactions).length, [receivables, debts, members, transactions]);
  const badges: Record<string, number> = { pessoas: peopleOwing };

  return (
    <div className={`app-layout ${navOpen ? 'nav-open' : ''}`}>
      <ScrollToTop />
      <aside className="sidebar">
        <Link className="sidebar-brand" to="/painel">
          <span className="brand-logo"><CreditCard size={19} /></span>
          <span>
            <strong>Finanças</strong>
            <small>Seu dinheiro em dia</small>
          </span>
        </Link>
        <nav className="sidebar-nav">
          {GROUPS.map(group => (
            <div className="nav-group" key={group}>
              <span className="nav-label">{group}</span>
              {MODULES.filter(item => item.group === group).map(item => {
                const Icon = item.icon;
                const badge = badges[item.id];
                return (
                  <NavLink key={item.id} to={item.path} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Icon size={18} />
                    <span>{item.label}</span>
                    {badge ? <span className="nav-badge" title="Pessoas com valores em aberto">{badge}</span> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sync-status" title={autoImportStatus}>
            <span className={`status-dot ${isReady ? '' : 'busy'}`} />
            <span>{isReady ? autoImportStatus : 'Sincronizando faturas…'}</span>
          </div>
          <div className="accent-picker" role="radiogroup" aria-label="Cor de destaque">
            {(Object.keys(ACCENTS) as AccentId[]).map(id => (
              <button key={id} type="button" role="radio" aria-checked={accent === id} title={ACCENTS[id].label}
                className={`accent-swatch ${accent === id ? 'active' : ''}`}
                style={{ background: `linear-gradient(135deg, ${ACCENTS[id][theme][0]}, ${ACCENTS[id][theme][1]})` }}
                onClick={() => setAccent(id)} />
            ))}
          </div>
          <button type="button" className="ghost-button" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
          </button>
        </div>
      </aside>
      <div className="sidebar-backdrop" onClick={() => setNavOpen(false)} />

      <div className="workspace">
        <header className="topbar">
          <button type="button" className="icon-button ghost menu-button" onClick={() => setNavOpen(true)} aria-label="Abrir menu"><Menu size={20} /></button>
          <div className="topbar-title">
            <h1>{activeModule.label}</h1>
            <p>{activeModule.description}</p>
          </div>
          <div className="topbar-actions">
            {activeModule.usesMonth ? (
              <div className="month-picker">
                <button type="button" className="icon-button ghost" disabled={!previousMonth} onClick={() => setSelectedMonth(previousMonth)} title="Fatura anterior" aria-label="Fatura anterior"><ChevronLeft size={18} /></button>
                <select value={pickerValue} onChange={event => setSelectedMonth(event.target.value)} aria-label="Fatura selecionada">
                  <option value={ALL_PERIOD}>Todo o período</option>
                  {months.map(month => <option key={month} value={month}>{formatInvoiceMonthLabel(month)}</option>)}
                </select>
                <button type="button" className="icon-button ghost" disabled={!nextMonth} onClick={() => setSelectedMonth(nextMonth)} title="Próxima fatura" aria-label="Próxima fatura"><ChevronRight size={18} /></button>
              </div>
            ) : null}
            <button type="button" className="icon-button" onClick={() => window.print()} title="Imprimir / salvar PDF"><Printer size={17} /></button>
          </div>
        </header>

        <main className="page-content">
          <Suspense fallback={<div className="empty-state"><div className="boot-logo" /></div>}>
            <Routes>
              <Route path="/" element={<Navigate to="/painel" replace />} />
              <Route path="/painel" element={<DashboardPage selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} />} />
              <Route path="/analises" element={<AnalisesPage selectedMonth={selectedMonth} months={months} onSelectMonth={setSelectedMonth} />} />
              <Route path="/transacoes" element={<TransacoesPage selectedMonth={selectedMonth} onSelectMonth={setSelectedMonth} onOpenImport={() => setShowImport(true)} />} />
              <Route path="/receitas" element={<ReceitasPage selectedMonth={selectedMonth} />} />
              <Route path="/pessoas" element={<PessoasPage />} />
              <Route path="/membros" element={<Navigate to="/pessoas" replace />} />
              <Route path="/cobrancas" element={<Navigate to="/pessoas" replace />} />
              <Route path="/contas" element={<ContasFixasPage selectedMonth={selectedMonth} />} />
              <Route path="/dividas" element={<DividasPage />} />
              <Route path="/metas" element={<MetasPage selectedMonth={selectedMonth} />} />
              <Route path="/categorias" element={<CategoriasPage selectedMonth={selectedMonth} />} />
              <Route path="/importacao" element={<ImportacaoPage onOpenImport={() => setShowImport(true)} />} />
              <Route path="*" element={<Navigate to="/painel" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>

      {showImport ? <ImportModal onClose={() => setShowImport(false)} /> : null}
      <LocalInbox />
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FeedbackProvider>
        <FinanceProvider>
          <HashRouter>
            <FinanceApp />
          </HashRouter>
        </FinanceProvider>
      </FeedbackProvider>
    </ThemeProvider>
  );
}

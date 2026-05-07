import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { BarChart3, ChevronLeft, ChevronRight, CreditCard, Download, FileText, HandCoins, Landmark, LayoutDashboard, Trash2, Upload, Users, Wallet } from 'lucide-react';
import { FinanceProvider, useFinance } from './store/FinanceContext';
import { ImportModal } from './components/ImportModal';
import { TransactionLedger } from './components/TransactionLedger';
import { Block1Overview } from './components/blocks/Block1Overview';
import { Block2WhereMoneyWent } from './components/blocks/Block2WhereMoneyWent';
import { Block3Cashflow } from './components/blocks/Block3Cashflow';
import { Block4Debts } from './components/blocks/Block4Debts';
import { Block5Behavior } from './components/blocks/Block5Behavior';
import { Block6Budgets } from './components/blocks/Block6Budgets';
import { getAccountingMonth } from './utils/analytics';
import { formatBRL, formatDate, formatMonth, normalizeText } from './utils/formatters';
import type { CategoryRule, Debt, Member, MonthlyIncome, Receivable } from './types';

type ModuleId = 'dashboard' | 'receitas' | 'transacoes' | 'membros' | 'cobrancas' | 'emprestimos' | 'dividas' | 'importacao';

const modules: Array<{ id: ModuleId; label: string; icon: ReactNode }> = [
  { id: 'dashboard', label: 'Painel', icon: <LayoutDashboard size={18} /> },
  { id: 'receitas', label: 'Receitas', icon: <Wallet size={18} /> },
  { id: 'transacoes', label: 'Transações', icon: <CreditCard size={18} /> },
  { id: 'membros', label: 'Membros', icon: <Users size={18} /> },
  { id: 'cobrancas', label: 'Divisões e cobranças', icon: <HandCoins size={18} /> },
  { id: 'emprestimos', label: 'Empréstimos e Pix', icon: <Landmark size={18} /> },
  { id: 'dividas', label: 'Dívidas', icon: <BarChart3 size={18} /> },
  { id: 'importacao', label: 'Importação', icon: <Upload size={18} /> },
];

const moduleDescriptions: Record<ModuleId, string> = {
  dashboard: 'Resumo do mês, fatura, categorias e evolução dos gastos.',
  receitas: 'Cadastre e acompanhe a renda mensal usada nos dashboards.',
  transacoes: 'Revise, categorize e organize os lançamentos da fatura.',
  membros: 'Cadastre as pessoas usadas em divisões, cobranças e empréstimos.',
  cobrancas: 'Acompanhe o que outras pessoas precisam te pagar no cartão.',
  emprestimos: 'Registre Pix e dinheiro emprestado fora do cartão.',
  dividas: 'Controle financiamentos, empréstimos e compromissos a pagar.',
  importacao: 'Importe faturas CSV ou OFX e confira os arquivos processados.',
};

const numberOf = (value: string) => Number(value.replace(',', '.')) || 0;

function FinanceApp() {
  const { transactions, monthlyIncomes, clearAllData, exportData } = useFinance();
  const [activeModule, setActiveModule] = useState<ModuleId>('dashboard');
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().substring(0, 7));
  const [compareMonth, setCompareMonth] = useState('');
  const [showImport, setShowImport] = useState(false);
  const months = useMemo(() => Array.from(new Set([...transactions.map(item => getAccountingMonth(item)), ...monthlyIncomes.map(item => item.month)])).sort().reverse(), [monthlyIncomes, transactions]);
  const activeLabel = modules.find(item => item.id === activeModule)?.label || 'Painel';
  const chronologicalMonths = useMemo(() => [...months].reverse(), [months]);
  const selectedIndex = chronologicalMonths.indexOf(selectedMonth);
  const previousMonth = selectedIndex > 0 ? chronologicalMonths[selectedIndex - 1] : '';
  const nextMonth = selectedIndex >= 0 && selectedIndex < chronologicalMonths.length - 1 ? chronologicalMonths[selectedIndex + 1] : '';
  const goToModule = (module: ModuleId) => {
    setActiveModule(module);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <button className="brand-block" type="button" onClick={() => goToModule('dashboard')} title="Ir para o painel inicial">
          <span className="eyebrow">Financeiro pessoal</span>
          <strong>Cartão, dívidas e recebimentos</strong>
        </button>
        <nav className="module-nav">
          {modules.map(item => (
            <button key={item.id} className={activeModule === item.id ? 'active' : ''} onClick={() => goToModule(item.id)}>
              {item.icon}<span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{activeModule === 'dashboard' ? 'Análise' : 'Gestão'}</span>
            <h1>{activeLabel}</h1>
            <p>{moduleDescriptions[activeModule]}</p>
          </div>
          <div className="topbar-actions">
            {activeModule === 'dashboard' || activeModule === 'transacoes' || activeModule === 'receitas' ? (
              <div className="invoice-nav">
                <button className="icon-button" disabled={!previousMonth} onClick={() => setSelectedMonth(previousMonth)} title="Fatura anterior"><ChevronLeft size={18} /></button>
                <select value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>
                  <option value="">Todo o período</option>
                  {months.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
                </select>
                <button className="icon-button" disabled={!nextMonth} onClick={() => setSelectedMonth(nextMonth)} title="Próxima fatura"><ChevronRight size={18} /></button>
              </div>
            ) : null}
            {activeModule === 'dashboard' ? (
              <select value={compareMonth} onChange={event => setCompareMonth(event.target.value)} title="Mes para comparar">
                <option value="">Comparar com</option>
                {months.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
              </select>
            ) : null}
            <button className="icon-button" onClick={() => window.print()} title="Exportar relatorio em PDF"><FileText size={18} /></button>
            <button className="icon-button" onClick={exportData} title="Exportar dados em JSON"><Download size={18} /></button>
            <button className="icon-button danger" onClick={clearAllData} title="Limpar todos os dados"><Trash2 size={18} /></button>
          </div>
        </header>

        <main className="page-content">
          {!transactions.length && (activeModule === 'dashboard' || activeModule === 'transacoes') ? (
            <section className="empty-hero">
              <span>Comece importando CSV ou OFX na tela de importação.</span>
              <button className="primary-button" onClick={() => setActiveModule('importacao')}><Upload size={16} /> Ir para importação</button>
            </section>
          ) : null}

          {activeModule === 'dashboard' ? <DashboardPage selectedMonth={selectedMonth} compareMonth={compareMonth} /> : null}
          {activeModule === 'receitas' ? <IncomePage key={selectedMonth || 'todos'} selectedMonth={selectedMonth} /> : null}
          {activeModule === 'transacoes' ? <TransactionsPage selectedMonth={selectedMonth} /> : null}
          {activeModule === 'membros' ? <MembersPage /> : null}
          {activeModule === 'cobrancas' ? <ChargesPage /> : null}
          {activeModule === 'emprestimos' ? <LoansPage /> : null}
          {activeModule === 'dividas' ? <DebtsPage /> : null}
          {activeModule === 'importacao' ? <ImportPage onOpenImport={() => setShowImport(true)} /> : null}
        </main>
      </div>

      {showImport ? <ImportModal onClose={() => setShowImport(false)} /> : null}
    </div>
  );
}

function DashboardPage({ selectedMonth, compareMonth }: { selectedMonth: string; compareMonth: string }) {
  return (
    <>
      <Section title="Visão geral"><Block1Overview selectedMonth={selectedMonth} /></Section>
      <Section title="Onde o dinheiro foi"><Block2WhereMoneyWent selectedMonth={selectedMonth} compareMonth={compareMonth} /></Section>
      <Section title="Receita, despesa e sazonalidade"><Block3Cashflow selectedMonth={selectedMonth} /></Section>
      <Section title="Dívidas e planejamento"><Block4Debts /></Section>
      <Section title="Comportamento de consumo"><Block5Behavior selectedMonth={selectedMonth} /></Section>
      <Section title="Metas e compromissos futuros"><Block6Budgets selectedMonth={selectedMonth} /></Section>
    </>
  );
}

function IncomePage({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, monthlyIncomes, paidInvoiceMonths, addIncome, setMonthlyIncomes, setPaidInvoiceMonths, markPastInvoicesPaid, equalizePastInvoiceIncomes } = useFinance();
  const [month, setMonth] = useState(selectedMonth || new Date().toISOString().substring(0, 7));
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [editingIncomeId, setEditingIncomeId] = useState('');

  const incomeKey = (income: MonthlyIncome) => income.id || `${income.month}-${income.source || 'manual'}-${income.amount}-${income.description || ''}`;
  const sortedIncomes = useMemo(() => [...monthlyIncomes].sort((a, b) => b.month.localeCompare(a.month)), [monthlyIncomes]);
  const totalIncome = sortedIncomes.reduce((sum, item) => sum + item.amount, 0);
  const selectedIncomeTotal = selectedMonth
    ? monthlyIncomes.filter(item => item.month === selectedMonth).reduce((sum, item) => sum + item.amount, 0)
    : totalIncome;
  const selectedInvoiceExpense = transactions
    .filter(item => item.type === 'expense' && getAccountingMonth(item) === selectedMonth)
    .reduce((sum, item) => sum + item.amount, 0);
  const selectedInvoicePaid = Boolean(selectedMonth && paidInvoiceMonths.includes(selectedMonth));

  const resetForm = () => {
    setMonth(selectedMonth || new Date().toISOString().substring(0, 7));
    setAmount('');
    setDescription('');
    setIsRecurring(false);
    setEditingIncomeId('');
  };

  const saveIncome = (event: FormEvent) => {
    event.preventDefault();
    const cleanAmount = numberOf(amount);
    if (!month || cleanAmount <= 0) return;
    if (editingIncomeId) {
      setMonthlyIncomes(previous => previous.filter(item => incomeKey(item) !== editingIncomeId));
    }
    addIncome({ id: editingIncomeId || crypto.randomUUID(), month, amount: cleanAmount, isRecurring, description: description.trim() || undefined });
    resetForm();
  };

  const editIncome = (income: MonthlyIncome) => {
    setEditingIncomeId(incomeKey(income));
    setMonth(income.month);
    setAmount(String(income.amount));
    setDescription(income.description || '');
    setIsRecurring(income.isRecurring);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteIncome = (income: MonthlyIncome) => {
    const key = incomeKey(income);
    setMonthlyIncomes(previous => previous.filter(item => incomeKey(item) !== key));
    if (editingIncomeId === key) resetForm();
  };

  const markSelectedInvoicePaid = () => {
    if (!selectedMonth) return;
    setPaidInvoiceMonths(previous => Array.from(new Set([...previous, selectedMonth])).sort());
  };

  const sourceLabel = (income: MonthlyIncome) => {
    if (income.source === 'adjustment') return 'Ajuste histórico';
    if (income.source === 'legacy') return 'Migrada do sistema antigo';
    if (income.source === 'imported') return 'Importada';
    return 'Manual';
  };

  return (
    <div className="section-grid">
      <div className="chart-card">
        <h3>{editingIncomeId ? 'Editar entrada de receita' : 'Adicionar entrada de receita'}</h3>
        <p className="muted">Registre cada recebimento separado. O sistema soma tudo no mês automaticamente.</p>
        <form className="form-grid" onSubmit={saveIncome}>
          <label>Mês<input type="month" required value={month} onChange={event => setMonth(event.target.value)} /></label>
          <label>Valor recebido<input type="number" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="Ex: 700,00" /></label>
          <label className="full">Descrição<input value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex: salário, venda, comissão, Pix recebido..." /></label>
          <label className="checkbox-line full">
            <input type="checkbox" checked={isRecurring} onChange={event => setIsRecurring(event.target.checked)} />
            Receita recorrente
          </label>
          <button className="primary-button full" type="submit">{editingIncomeId ? 'Atualizar entrada' : 'Adicionar entrada'}</button>
          {editingIncomeId ? <button className="secondary-button full" type="button" onClick={resetForm}>Cancelar edição</button> : null}
        </form>
      </div>

      <div className="chart-card">
        <h3>Resumo registrado</h3>
        <div className="kpi-grid compact">
          <div className="kpi-card"><span>Entradas registradas</span><strong>{sortedIncomes.length}</strong><small className="good">Lançamentos salvos</small></div>
          <div className="kpi-card"><span>Receita do período</span><strong>{formatBRL(selectedIncomeTotal)}</strong><small className="good">{selectedMonth ? formatMonth(selectedMonth) : 'Todo o período'}</small></div>
        </div>
      </div>

      <div className="chart-card wide">
        <h3>Status da fatura</h3>
        <div className="invoice-balance-panel">
          <div>
            <strong>{selectedMonth ? formatMonth(selectedMonth) : 'Todo o período'}</strong>
            <span>Fatura selecionada</span>
          </div>
          <div>
            <strong>{formatBRL(selectedInvoiceExpense)}</strong>
            <span>Valor da fatura</span>
          </div>
          <div>
            <strong className={selectedInvoicePaid ? 'good-text' : selectedInvoiceExpense > 0 ? 'bad-text' : ''}>{selectedInvoicePaid ? 'Quitada' : selectedInvoiceExpense > 0 ? 'Em aberto' : 'Sem fatura'}</strong>
            <span>Marcação não altera receita</span>
          </div>
        </div>
        <div className="inline-actions">
          <button className="secondary-button" type="button" disabled={!selectedMonth || !selectedInvoiceExpense || selectedInvoicePaid} onClick={markSelectedInvoicePaid}>Marcar fatura selecionada como quitada</button>
          <button className="secondary-button" type="button" onClick={() => markPastInvoicesPaid(new Date().toISOString().substring(0, 7))}>Quitar faturas antigas</button>
          <button className="primary-button" type="button" onClick={() => equalizePastInvoiceIncomes(new Date().toISOString().substring(0, 7))}>Igualar receitas às faturas antigas</button>
        </div>
      </div>

      <div className="table-card wide">
        <h3>Entradas de receita</h3>
        <div className="simple-list">
          {sortedIncomes.length ? sortedIncomes.map(income => (
            <div key={incomeKey(income)} className="list-row">
              <div>
                <strong>{income.description || sourceLabel(income)}</strong>
                <span>{formatMonth(income.month)}</span>
                <small>{income.isRecurring ? 'Recorrente' : 'Entrada avulsa'} - {sourceLabel(income)}</small>
              </div>
              <strong className="good-text">{formatBRL(income.amount)}</strong>
              <div className="row-actions">
                <button className="secondary-button" type="button" onClick={() => editIncome(income)}>Editar</button>
                <button className="icon-button danger" type="button" onClick={() => deleteIncome(income)}>x</button>
              </div>
            </div>
          )) : <div className="empty-state">Nenhuma receita cadastrada ainda.</div>}
        </div>
      </div>
    </div>
  );
}

function TransactionsPage({ selectedMonth }: { selectedMonth: string }) {
  return (
    <>
      <Section title="Organizacao da fatura"><TransactionLedger selectedMonth={selectedMonth} /></Section>
      <TransactionTools />
    </>
  );
}

function TransactionTools() {
  const { categories, categoryRules, addCategoryRule, updateCategoryRule, deleteCategoryRule } = useFinance();
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleCategoryId, setRuleCategoryId] = useState(categories[0]?.id || 'outros');
  const [editingRuleId, setEditingRuleId] = useState('');

  const clearRuleForm = () => {
    setRuleKeyword('');
    setRuleCategoryId(categories[0]?.id || 'outros');
    setEditingRuleId('');
  };

  const saveRule = (event: FormEvent) => {
    event.preventDefault();
    if (editingRuleId) {
      updateCategoryRule(editingRuleId, ruleKeyword, ruleCategoryId);
    } else {
      addCategoryRule(ruleKeyword, ruleCategoryId);
    }
    clearRuleForm();
  };

  const editRule = (rule: CategoryRule) => {
    setEditingRuleId(rule.id);
    setRuleKeyword(rule.keyword);
    setRuleCategoryId(rule.categoryId);
  };

  const removeRule = (ruleId: string) => {
    if (editingRuleId === ruleId) clearRuleForm();
    deleteCategoryRule(ruleId);
  };

  return (
    <div className="section-grid">
      <section className="table-card wide">
        <h3>Regra de categoria</h3>
        <form className="form-grid embedded" onSubmit={saveRule}>
          <label>Palavra chave<input required value={ruleKeyword} onChange={event => setRuleKeyword(event.target.value)} placeholder="Posto, Emporio Almeida" /></label>
          <label>Categoria
            <select value={ruleCategoryId} onChange={event => setRuleCategoryId(event.target.value)}>
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </label>
          <button className="primary-button full" type="submit">{editingRuleId ? 'Atualizar regra' : 'Aplicar regra agora e nas proximas importacoes'}</button>
        </form>
        <div className="rule-header">
          <strong>Regras personalizadas</strong>
          {editingRuleId ? <button className="small-action" type="button" onClick={clearRuleForm}>Cancelar edição</button> : null}
        </div>
        <div className="simple-list rule-list">
          {categoryRules.map(rule => (
            <div className="list-row rule-row" key={rule.id}>
              <div>
                <strong>{rule.keyword}</strong>
                <span>{categories.find(category => category.id === rule.categoryId)?.name || 'Categoria removida'}</span>
              </div>
              <div className="row-actions">
                <button className="small-action" type="button" onClick={() => editRule(rule)}>Editar</button>
                <button className="icon-button danger" type="button" onClick={() => removeRule(rule.id)} title="Excluir regra">x</button>
              </div>
            </div>
          ))}
          {!categoryRules.length ? <div className="empty-state compact">Nenhuma regra personalizada criada.</div> : null}
        </div>
      </section>
    </div>
  );
}

function MembersPage() {
  const { members, addMember } = useFinance();
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [contact, setContact] = useState('');
  const [isOwner, setIsOwner] = useState(false);

  const save = (event: FormEvent) => {
    event.preventDefault();
    addMember({ id: crypto.randomUUID(), name, nickname, contact, isOwner, aliases: [] });
    setName('');
    setNickname('');
    setContact('');
    setIsOwner(false);
  };

  return (
    <div className="members-layout">
      <section className="table-card wide">
        <h3>Novo membro</h3>
        <form className="form-grid" onSubmit={save}>
          <label>Nome<input required value={name} onChange={event => setName(event.target.value)} /></label>
          <label>Apelido<input value={nickname} onChange={event => setNickname(event.target.value)} /></label>
          <label>Contato<input value={contact} onChange={event => setContact(event.target.value)} /></label>
          <label className="checkbox-line"><input type="checkbox" checked={isOwner} onChange={event => setIsOwner(event.target.checked)} /> Titular do cartao</label>
          <button className="primary-button full" type="submit">Cadastrar membro</button>
        </form>
      </section>
      <section className="table-card wide">
        <h3>Membros cadastrados</h3>
        <div className="simple-list">
          {members.map(member => <MemberCard key={member.id} member={member} />)}
          {!members.length ? <div className="empty-state compact">Nenhum membro cadastrado.</div> : null}
        </div>
      </section>
    </div>
  );
}

function MemberCard({ member }: { member: Member }) {
  const { receivables } = useFinance();
  const total = member.isOwner ? 0 : receivables.filter(item => item.memberId === member.id && item.status !== 'quitado').reduce((sum, item) => sum + item.amount - item.paidAmount, 0);
  return (
    <div className="list-row">
      <div>
        <strong>{member.name}</strong>
        <span>{member.isOwner ? 'Titular' : member.nickname || 'Sem apelido'} - {member.contact || 'Sem contato'}</span>
        <small>Histórico e saldo de cobranças deste membro</small>
      </div>
      <strong className={total > 0 ? 'bad-text' : 'good-text'}>{formatBRL(total)}</strong>
    </div>
  );
}

function ChargesPage() {
  const { members, receivables, markReceivablePaid, deleteReceivable } = useFinance();
  const ownerIds = new Set(members.filter(member => member.isOwner).map(member => member.id));
  const pending = receivables.filter(item => item.status !== 'quitado' && item.source !== 'emprestimo_pix' && !ownerIds.has(item.memberId));

  return (
    <div className="section-grid">
      <section className="table-card wide">
        <h3>Painel a receber</h3>
        <ReceivableTotals rows={pending} />
        <ReceivableList rows={pending} onPay={markReceivablePaid} onDelete={deleteReceivable} />
      </section>
    </div>
  );
}

function LoansPage() {
  const { members, receivables, addReceivable, markReceivablePaid, deleteReceivable } = useFinance();
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [description, setDescription] = useState('');
  const [editingLoanId, setEditingLoanId] = useState('');
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [historyLoan, setHistoryLoan] = useState<Receivable | null>(null);
  const chargeableMembers = members.filter(member => !member.isOwner);
  const ownerIds = new Set(members.filter(member => member.isOwner).map(member => member.id));
  const rows = receivables.filter(item => item.source === 'emprestimo_pix' && !ownerIds.has(item.memberId));
  const pending = rows.filter(item => item.status !== 'quitado');

  const save = (event: FormEvent) => {
    event.preventDefault();
    const existing = receivables.find(item => item.id === editingLoanId);
    addReceivable({
      id: editingLoanId || crypto.randomUUID(),
      memberId,
      source: 'emprestimo_pix',
      amount: numberOf(amount),
      paidAmount: existing?.paidAmount || 0,
      date,
      description,
      status: existing?.status || 'pendente',
    });
    resetLoanForm();
  };

  const resetLoanForm = () => {
    setMemberId('');
    setAmount('');
    setDate(new Date().toISOString().substring(0, 10));
    setDescription('');
    setEditingLoanId('');
    setShowLoanModal(false);
  };

  const editLoan = (loan: Receivable) => {
    setMemberId(loan.memberId);
    setAmount(String(loan.amount));
    setDate(loan.date);
    setDescription(loan.description);
    setEditingLoanId(loan.id);
    setShowLoanModal(true);
  };

  const removeLoan = (loanId: string) => {
    deleteReceivable(loanId);
    if (historyLoan?.id === loanId) setHistoryLoan(null);
    if (editingLoanId === loanId) resetLoanForm();
  };

  return (
    <div className="section-grid">
      <section className="table-card wide">
        <div className="chart-title-row">
          <div>
            <h3>Total por pessoa</h3>
            <p className="muted">Pix e dinheiro emprestado fora do cartão.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => { resetLoanForm(); setShowLoanModal(true); }}>Novo empréstimo/Pix</button>
        </div>
        <ReceivableTotals rows={pending} />
        <h3 className="stacked-title">Empréstimos e Pix registrados</h3>
        <div className="simple-list">
          {rows.map(row => {
            const remaining = row.amount - row.paidAmount;
            return (
              <div className="list-row" key={row.id}>
                <div>
                  <strong>{members.find(member => member.id === row.memberId)?.name || 'Membro'}</strong>
                  <span>{row.description}</span>
                  <small>{formatDate(row.date)} · {row.status === 'quitado' ? 'Recebido' : 'Pendente'}</small>
                </div>
                <div className="row-actions">
                  <strong>{formatBRL(remaining)}</strong>
                  <button className="small-action" type="button" onClick={() => setHistoryLoan(row)}>Ver histórico</button>
                  <button className="small-action" type="button" onClick={() => editLoan(row)}>Editar</button>
                  <button className="secondary-button" onClick={() => markReceivablePaid(row.id)}>Marcar recebido</button>
                  <button className="icon-button danger" type="button" onClick={() => removeLoan(row.id)} title="Excluir registro">x</button>
                </div>
              </div>
            );
          })}
          {!rows.length ? <div className="empty-state compact">Nenhum empréstimo ou Pix registrado.</div> : null}
        </div>
      </section>

      {showLoanModal ? (
        <div className="modal-backdrop" onClick={resetLoanForm}>
          <div className="modal compact-modal" onClick={event => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>{editingLoanId ? 'Editar empréstimo/Pix' : 'Novo empréstimo ou Pix'}</h2>
                <p>Registre dinheiro emprestado fora do cartão.</p>
              </div>
              <button className="icon-button" type="button" onClick={resetLoanForm}>x</button>
            </header>
            <form className="form-grid" onSubmit={save}>
              <label>Quem<select required value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">Selecione</option>{chargeableMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
              <label>Valor<input required type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
              <label>Data<input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
              <label>Descrição<input required value={description} onChange={event => setDescription(event.target.value)} /></label>
              <button className="primary-button full" type="submit">{editingLoanId ? 'Atualizar registro' : 'Registrar valor a receber'}</button>
              <button className="secondary-button full" type="button" onClick={resetLoanForm}>Cancelar</button>
            </form>
          </div>
        </div>
      ) : null}

      {historyLoan ? (
        <div className="modal-backdrop" onClick={() => setHistoryLoan(null)}>
          <div className="modal compact-modal" onClick={event => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>Histórico do empréstimo/Pix</h2>
                <p>{members.find(member => member.id === historyLoan.memberId)?.name || 'Membro'}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setHistoryLoan(null)}>x</button>
            </header>
            <div className="simple-list modal-content-pad">
              <div className="list-row"><span>Descrição</span><strong>{historyLoan.description}</strong></div>
              <div className="list-row"><span>Valor original</span><strong>{formatBRL(historyLoan.amount)}</strong></div>
              <div className="list-row"><span>Valor recebido</span><strong>{formatBRL(historyLoan.paidAmount)}</strong></div>
              <div className="list-row"><span>Saldo restante</span><strong>{formatBRL(Math.max(0, historyLoan.amount - historyLoan.paidAmount))}</strong></div>
              <div className="list-row"><span>Data</span><strong>{formatDate(historyLoan.date)}</strong></div>
              <div className="list-row"><span>Status</span><strong>{historyLoan.status}</strong></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReceivableTotals({ rows }: { rows: Receivable[] }) {
  const { members } = useFinance();
  const totals = members
    .filter(member => !member.isOwner)
    .map(member => ({
      member,
      total: rows
        .filter(row => row.memberId === member.id && row.status !== 'quitado')
        .reduce((sum, row) => sum + row.amount - row.paidAmount, 0),
    }))
    .filter(item => item.total > 0)
    .sort((a, b) => b.total - a.total);

  if (!totals.length) return <div className="empty-state compact">Nenhum valor pendente por pessoa.</div>;
  return (
    <div className="receivable-total-grid">
      {totals.map(item => (
        <div className="receivable-total-card" key={item.member.id}>
          <span>{item.member.name}</span>
          <strong>{formatBRL(item.total)}</strong>
        </div>
      ))}
    </div>
  );
}

function ReceivableList({ rows, onPay, onDelete }: { rows: Receivable[]; onPay: (id: string, amount?: number) => void; onDelete?: (id: string) => void }) {
  const { members } = useFinance();
  const visibleRows = rows.filter(row => !members.some(member => member.id === row.memberId && member.isOwner));
  if (!visibleRows.length) return <div className="empty-state compact">Nenhuma cobrança pendente.</div>;
  return (
    <div className="simple-list">
      {visibleRows.map(row => {
        const remaining = row.amount - row.paidAmount;
        return (
          <div className="list-row" key={row.id}>
            <div>
              <strong>{members.find(member => member.id === row.memberId)?.name || 'Membro'}</strong>
              <span>{row.description}</span>
              <small>{formatDate(row.date)} · {row.source === 'emprestimo_pix' ? 'Empréstimo/Pix' : row.source === 'divisao' ? 'Divisão' : 'Responsável pela compra'}</small>
            </div>
            <div className="row-actions">
              <strong>{formatBRL(remaining)}</strong>
              <button className="secondary-button" onClick={() => onPay(row.id)}>Marcar recebido</button>
              {onDelete ? <button className="icon-button danger" onClick={() => onDelete(row.id)} title="Apagar cobrança">x</button> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DebtsPage() {
  return (
    <>
      <DebtManager />
      <Section title="Acompanhamento de dívidas próprias"><Block4Debts /></Section>
    </>
  );
}

function DebtManager() {
  const { debts, members, addDebt, setDebts, setReceivables } = useFinance();
  const registeredDebts = debts;
  const [debtType, setDebtType] = useState<Debt['type']>('a_pagar');
  const [counterparty, setCounterparty] = useState('');
  const [customCounterparty, setCustomCounterparty] = useState('');
  const [origin, setOrigin] = useState<Debt['origin']>('emprestimo');
  const [totalAmount, setTotalAmount] = useState('');
  const [paidAmount, setPaidAmount] = useState('0');
  const [monthlyPayment, setMonthlyPayment] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [currentInstallment, setCurrentInstallment] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('');
  const [note, setNote] = useState('');
  const [editingDebtId, setEditingDebtId] = useState('');
  const [showDebtModal, setShowDebtModal] = useState(false);
  const [historyDebt, setHistoryDebt] = useState<Debt | null>(null);

  const resetForm = () => {
    setCounterparty('');
    setCustomCounterparty('');
    setDebtType('a_pagar');
    setOrigin('emprestimo');
    setTotalAmount('');
    setPaidAmount('0');
    setMonthlyPayment('');
    setInterestRate('0');
    setStartDate(new Date().toISOString().substring(0, 10));
    setCurrentInstallment('');
    setTotalInstallments('');
    setNote('');
    setEditingDebtId('');
    setShowDebtModal(false);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const creditor = counterparty === '__custom__' ? customCounterparty.trim() : counterparty.trim();
    if (!creditor) return;
    const debt: Debt = {
      id: editingDebtId || crypto.randomUUID(),
      type: debtType,
      origin,
      counterparty: creditor,
      totalAmount: numberOf(totalAmount),
      paidAmount: numberOf(paidAmount),
      monthlyPayment: numberOf(monthlyPayment),
      interestRate: numberOf(interestRate),
      startDate,
      linkedTransactionIds: debts.find(item => item.id === editingDebtId)?.linkedTransactionIds || [],
      currentInstallment: currentInstallment ? Number(currentInstallment) : undefined,
      totalInstallments: totalInstallments ? Number(totalInstallments) : undefined,
      note: note.trim() || undefined,
    };
    if (editingDebtId) {
      setDebts(previous => previous.map(item => item.id === editingDebtId ? debt : item));
    } else {
      addDebt(debt);
    }
    resetForm();
  };

  const editDebt = (debt: Debt) => {
    const matchesMember = members.some(member => member.name === debt.counterparty);
    setDebtType(debt.type);
    setCounterparty(matchesMember ? debt.counterparty : '__custom__');
    setCustomCounterparty(matchesMember ? '' : debt.counterparty);
    setOrigin(debt.origin);
    setTotalAmount(String(debt.totalAmount));
    setPaidAmount(String(debt.paidAmount));
    setMonthlyPayment(String(debt.monthlyPayment));
    setInterestRate(String(debt.interestRate));
    setStartDate(debt.startDate);
    setCurrentInstallment(debt.currentInstallment ? String(debt.currentInstallment) : '');
    setTotalInstallments(debt.totalInstallments ? String(debt.totalInstallments) : '');
    setNote(debt.note || '');
    setEditingDebtId(debt.id);
    setShowDebtModal(true);
  };

  const deleteDebt = (debtId: string) => {
    const debt = debts.find(item => item.id === debtId);
    localStorage.setItem('finance_deleted_debt_ids_v1', JSON.stringify(Array.from(new Set([...JSON.parse(localStorage.getItem('finance_deleted_debt_ids_v1') || '[]'), debtId]))));
    if (debt?.type === 'a_receber') {
      const source = debt.origin === 'emprestimo' ? 'emprestimo_pix' : debt.origin === 'cartao' ? 'divisao' : '';
      setReceivables(previous => previous.filter(receivable => {
        const member = members.find(item => item.id === receivable.memberId);
        if (!member || normalizeText(member.name) !== normalizeText(debt.counterparty)) return true;
        if (source && receivable.source !== source) return true;
        const sameAmount = Math.abs((receivable.amount - receivable.paidAmount) - (debt.totalAmount - debt.paidAmount)) < 0.01
          || Math.abs(receivable.amount - debt.totalAmount) < 0.01;
        return !sameAmount;
      }));
    }
    setDebts(previous => previous.filter(item => item.id !== debtId));
    if (editingDebtId === debtId) resetForm();
  };

  return (
    <div className="section-grid">
      {showDebtModal ? (
        <div className="modal-backdrop" onClick={resetForm}>
          <div className="modal" onClick={event => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>{editingDebtId ? 'Editar registro' : 'Cadastrar registro'}</h2>
                <p>Use para dívidas próprias ou valores manuais que alguém te deve.</p>
              </div>
              <button className="icon-button" type="button" onClick={resetForm}>x</button>
            </header>
            <section className="modal-body-section">
        <h3>{editingDebtId ? 'Editar dívida própria' : 'Cadastrar dívida própria'}</h3>
        <form className="form-grid" onSubmit={save}>
          <label>Tipo
            <select value={debtType} onChange={event => setDebtType(event.target.value as Debt['type'])}>
              <option value="a_pagar">A pagar - eu devo</option>
              <option value="a_receber">A receber - me devem</option>
            </select>
          </label>
          <label>{debtType === 'a_pagar' ? 'Quem eu devo' : 'Quem me deve'}
            <select required value={counterparty} onChange={event => setCounterparty(event.target.value)}>
              <option value="">Selecione</option>
              {members.map(member => <option key={member.id} value={member.name}>{member.name}</option>)}
              <option value="__custom__">{debtType === 'a_pagar' ? 'Outro credor' : 'Outra pessoa'}</option>
            </select>
          </label>
          {counterparty === '__custom__' ? <label>{debtType === 'a_pagar' ? 'Nome do credor' : 'Nome da pessoa'}<input required value={customCounterparty} onChange={event => setCustomCounterparty(event.target.value)} /></label> : null}
          <label>Origem<select value={origin} onChange={event => setOrigin(event.target.value as Debt['origin'])}><option value="cartao">Cartão</option><option value="emprestimo">Empréstimo</option><option value="financiamento">Financiamento</option><option value="manual">Manual</option><option value="outros">Outros</option></select></label>
          <label>Valor total<input required type="number" step="0.01" value={totalAmount} onChange={event => setTotalAmount(event.target.value)} /></label>
          <label>Valor pago<input type="number" step="0.01" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} /></label>
          <label>Parcela mensal<input type="number" step="0.01" value={monthlyPayment} onChange={event => setMonthlyPayment(event.target.value)} /></label>
          <label>Parcela atual<input type="number" min="1" step="1" value={currentInstallment} onChange={event => setCurrentInstallment(event.target.value)} placeholder="26" /></label>
          <label>Total de parcelas<input type="number" min="1" step="1" value={totalInstallments} onChange={event => setTotalInstallments(event.target.value)} placeholder="48" /></label>
          <label>Juros mensal (%)<input type="number" step="0.01" value={interestRate} onChange={event => setInterestRate(event.target.value)} /></label>
          <label>Data inicial<input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
          <label className="full">Nota<input value={note} onChange={event => setNote(event.target.value)} placeholder="Ex: financiamento do carro" /></label>
          <button className="primary-button full" type="submit">{editingDebtId ? 'Atualizar dívida' : 'Salvar dívida'}</button>
          {editingDebtId ? <button className="secondary-button full" type="button" onClick={resetForm}>Cancelar edição</button> : null}
        </form>
      </section>
          </div>
        </div>
      ) : null}

      <section className="table-card wide">
        <div className="chart-title-row">
          <div>
            <h3>Dívidas e valores manuais</h3>
            <p className="muted">Registros a pagar e a receber ficam aqui para editar, excluir ou consultar histórico.</p>
          </div>
          <button className="primary-button" type="button" onClick={() => { resetForm(); setShowDebtModal(true); }}>Cadastrar registro</button>
        </div>
        <div className="simple-list">
          {registeredDebts.map(debt => {
            const remaining = Math.max(0, debt.totalAmount - debt.paidAmount);
            return (
              <div className="list-row" key={debt.id}>
                <div>
                  <strong>{debt.counterparty}</strong>
                  <span>{debt.type === 'a_receber' ? 'A receber' : 'A pagar'} - {debt.origin} - {formatBRL(remaining)} restante</span>
                  <small>Início {formatDate(debt.startDate)} - Parcela {formatBRL(debt.monthlyPayment)}{debt.currentInstallment && debt.totalInstallments ? ` (${debt.currentInstallment}/${debt.totalInstallments})` : ''} - Juros {debt.interestRate}%</small>
                  {debt.note ? <small>{debt.note}</small> : null}
                </div>
                <div className="row-actions">
                  <button className="small-action" type="button" onClick={() => setHistoryDebt(debt)}>Ver histórico</button>
                  <button className="small-action" type="button" onClick={() => editDebt(debt)}>Editar</button>
                  <button className="icon-button danger" type="button" onClick={() => deleteDebt(debt.id)} title="Excluir dívida">x</button>
                </div>
              </div>
            );
          })}
          {!registeredDebts.length ? <div className="empty-state compact">Nenhum registro manual cadastrado.</div> : null}
        </div>
      </section>

      {historyDebt ? (
        <div className="modal-backdrop" onClick={() => setHistoryDebt(null)}>
          <div className="modal compact-modal" onClick={event => event.stopPropagation()}>
            <header className="modal-header">
              <div>
                <h2>Histórico da dívida</h2>
                <p>{historyDebt.counterparty}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setHistoryDebt(null)}>x</button>
            </header>
            <div className="simple-list modal-content-pad">
              <div className="list-row"><span>Tipo</span><strong>{historyDebt.type === 'a_receber' ? 'A receber' : 'A pagar'}</strong></div>
              <div className="list-row"><span>Origem</span><strong>{historyDebt.origin}</strong></div>
              <div className="list-row"><span>Valor total</span><strong>{formatBRL(historyDebt.totalAmount)}</strong></div>
              <div className="list-row"><span>Valor pago</span><strong>{formatBRL(historyDebt.paidAmount)}</strong></div>
              <div className="list-row"><span>Saldo restante</span><strong>{formatBRL(Math.max(0, historyDebt.totalAmount - historyDebt.paidAmount))}</strong></div>
              <div className="list-row"><span>Parcela mensal</span><strong>{formatBRL(historyDebt.monthlyPayment)}</strong></div>
              <div className="list-row"><span>Parcelas</span><strong>{historyDebt.currentInstallment && historyDebt.totalInstallments ? `${historyDebt.currentInstallment}/${historyDebt.totalInstallments}` : '-'}</strong></div>
              <div className="list-row"><span>Juros mensal</span><strong>{historyDebt.interestRate}%</strong></div>
              <div className="list-row"><span>Início</span><strong>{formatDate(historyDebt.startDate)}</strong></div>
              {historyDebt.note ? <div className="list-row"><span>Nota</span><strong>{historyDebt.note}</strong></div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImportPage({ onOpenImport }: { onOpenImport: () => void }) {
  const { processedFiles } = useFinance();
  return (
    <div className="section-grid">
      <section className="table-card">
        <h3>Importar faturas</h3>
        <p className="muted">Envie arquivos CSV ou OFX, revise categorias e confirme os lancamentos antes de salvar.</p>
        <button className="primary-button module-action" onClick={onOpenImport}><Upload size={16} /> Selecionar arquivos</button>
      </section>
      <section className="table-card">
        <h3>Arquivos processados</h3>
        <div className="simple-list">
          {processedFiles.map(file => <div className="list-row" key={file}><strong>{file}</strong><span className="badge success">Importado</span></div>)}
          {!processedFiles.length ? <div className="empty-state compact">Nenhum arquivo importado ainda.</div> : null}
        </div>
      </section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="dashboard-section"><h2>{title}</h2>{children}</section>;
}

export default function App() {
  return (
    <FinanceProvider>
      <FinanceApp />
    </FinanceProvider>
  );
}

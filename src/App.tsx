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
import { formatBRL, formatDate, formatMonth } from './utils/formatters';
import type { CategoryRule, Debt, Member, MonthlyIncome, Receivable } from './types';

type ModuleId = 'dashboard' | 'receitas' | 'transacoes' | 'membros' | 'cobrancas' | 'emprestimos' | 'dividas' | 'importacao';

const modules: Array<{ id: ModuleId; label: string; icon: ReactNode }> = [
  { id: 'dashboard', label: 'Painel', icon: <LayoutDashboard size={18} /> },
  { id: 'receitas', label: 'Receitas', icon: <Wallet size={18} /> },
  { id: 'transacoes', label: 'Transacoes', icon: <CreditCard size={18} /> },
  { id: 'membros', label: 'Membros', icon: <Users size={18} /> },
  { id: 'cobrancas', label: 'Divisoes e cobrancas', icon: <HandCoins size={18} /> },
  { id: 'emprestimos', label: 'Emprestimos e Pix', icon: <Landmark size={18} /> },
  { id: 'dividas', label: 'Dividas', icon: <BarChart3 size={18} /> },
  { id: 'importacao', label: 'Importacao', icon: <Upload size={18} /> },
];

const moduleDescriptions: Record<ModuleId, string> = {
  dashboard: 'Resumo do mes, fatura, categorias e evolucao dos gastos.',
  receitas: 'Cadastre e acompanhe a renda mensal usada nos dashboards.',
  transacoes: 'Revise, categorize e organize os lancamentos da fatura.',
  membros: 'Cadastre as pessoas usadas em divisoes, cobrancas e emprestimos.',
  cobrancas: 'Acompanhe o que outras pessoas precisam te pagar no cartao.',
  emprestimos: 'Registre Pix e dinheiro emprestado fora do cartao.',
  dividas: 'Controle financiamentos, emprestimos e compromissos a pagar.',
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
          <strong>Cartao, dividas e recebimentos</strong>
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
            <span className="eyebrow">{activeModule === 'dashboard' ? 'Analise' : 'Gestao'}</span>
            <h1>{activeLabel}</h1>
            <p>{moduleDescriptions[activeModule]}</p>
          </div>
          <div className="topbar-actions">
            {activeModule === 'dashboard' || activeModule === 'transacoes' || activeModule === 'receitas' ? (
              <div className="invoice-nav">
                <button className="icon-button" disabled={!previousMonth} onClick={() => setSelectedMonth(previousMonth)} title="Fatura anterior"><ChevronLeft size={18} /></button>
                <select value={selectedMonth} onChange={event => setSelectedMonth(event.target.value)}>
                  <option value="">Todo o periodo</option>
                  {months.map(month => <option key={month} value={month}>{formatMonth(month)}</option>)}
                </select>
                <button className="icon-button" disabled={!nextMonth} onClick={() => setSelectedMonth(nextMonth)} title="Proxima fatura"><ChevronRight size={18} /></button>
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
              <span>Comece importando CSV ou OFX na tela de importacao.</span>
              <button className="primary-button" onClick={() => setActiveModule('importacao')}><Upload size={16} /> Ir para importacao</button>
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
      <Section title="Visao geral"><Block1Overview selectedMonth={selectedMonth} /></Section>
      <Section title="Onde o dinheiro foi"><Block2WhereMoneyWent selectedMonth={selectedMonth} compareMonth={compareMonth} /></Section>
      <Section title="Fluxo de caixa e sazonalidade"><Block3Cashflow selectedMonth={selectedMonth} /></Section>
      <Section title="Planejamento futuro"><Block6Budgets selectedMonth={selectedMonth} /></Section>
      <Section title="Comportamento de consumo"><Block5Behavior selectedMonth={selectedMonth} /></Section>
    </>
  );
}

function IncomePage({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, monthlyIncomes, paidInvoiceMonths, addIncome, setMonthlyIncomes, setPaidInvoiceMonths, markPastInvoicesPaid, equalizePastInvoiceIncomes } = useFinance();
  const currentIncome = monthlyIncomes.find(item => item.month === selectedMonth);
  const [month, setMonth] = useState(selectedMonth || new Date().toISOString().substring(0, 7));
  const [amount, setAmount] = useState(currentIncome ? String(currentIncome.amount) : '');
  const [isRecurring, setIsRecurring] = useState(currentIncome?.isRecurring || false);
  const [editingMonth, setEditingMonth] = useState('');

  const sortedIncomes = useMemo(() => [...monthlyIncomes].sort((a, b) => b.month.localeCompare(a.month)), [monthlyIncomes]);
  const totalIncome = sortedIncomes.reduce((sum, item) => sum + item.amount, 0);
  const selectedInvoiceExpense = transactions
    .filter(item => item.type === 'expense' && getAccountingMonth(item) === selectedMonth)
    .reduce((sum, item) => sum + item.amount, 0);
  const selectedInvoicePaid = Boolean(selectedMonth && paidInvoiceMonths.includes(selectedMonth));

  const resetForm = () => {
    setMonth(selectedMonth || new Date().toISOString().substring(0, 7));
    setAmount('');
    setIsRecurring(false);
    setEditingMonth('');
  };

  const saveIncome = (event: FormEvent) => {
    event.preventDefault();
    const cleanAmount = numberOf(amount);
    if (!month || cleanAmount <= 0) return;
    if (editingMonth && editingMonth !== month) {
      setMonthlyIncomes(previous => previous.filter(item => item.month !== editingMonth));
    }
    addIncome({ month, amount: cleanAmount, isRecurring });
    resetForm();
  };

  const editIncome = (income: MonthlyIncome) => {
    setEditingMonth(income.month);
    setMonth(income.month);
    setAmount(String(income.amount));
    setIsRecurring(income.isRecurring);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteIncome = (incomeMonth: string) => {
    setMonthlyIncomes(previous => previous.filter(item => item.month !== incomeMonth));
    if (editingMonth === incomeMonth) resetForm();
  };

  const markSelectedInvoicePaid = () => {
    if (!selectedMonth) return;
    setPaidInvoiceMonths(previous => Array.from(new Set([...previous, selectedMonth])).sort());
  };

  const sourceLabel = (income: MonthlyIncome) => {
    if (income.source === 'adjustment') return 'Ajuste historico';
    if (income.source === 'legacy') return 'Migrada do sistema antigo';
    if (income.source === 'imported') return 'Importada';
    return 'Manual';
  };

  return (
    <div className="section-grid">
      <div className="chart-card">
        <h3>{editingMonth ? 'Editar receita' : 'Nova receita'}</h3>
        <form className="form-grid" onSubmit={saveIncome}>
          <label>Mes<input type="month" required value={month} onChange={event => setMonth(event.target.value)} /></label>
          <label>Valor recebido<input type="number" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} placeholder="Ex: 3500,00" /></label>
          <label className="checkbox-line full">
            <input type="checkbox" checked={isRecurring} onChange={event => setIsRecurring(event.target.checked)} />
            Receita recorrente
          </label>
          <button className="primary-button full" type="submit">{editingMonth ? 'Atualizar receita' : 'Salvar receita'}</button>
          {editingMonth ? <button className="secondary-button full" type="button" onClick={resetForm}>Cancelar edicao</button> : null}
        </form>
      </div>

      <div className="chart-card">
        <h3>Resumo registrado</h3>
        <div className="kpi-grid compact">
          <div className="kpi-card"><span>Meses com receita</span><strong>{sortedIncomes.length}</strong><small className="good">Registros salvos</small></div>
          <div className="kpi-card"><span>Total cadastrado</span><strong>{formatBRL(totalIncome)}</strong><small className="good">Soma historica</small></div>
        </div>
      </div>

      <div className="chart-card wide">
        <h3>Status da fatura</h3>
        <div className="invoice-balance-panel">
          <div>
            <strong>{selectedMonth ? formatMonth(selectedMonth) : 'Todo periodo'}</strong>
            <span>Fatura selecionada</span>
          </div>
          <div>
            <strong>{formatBRL(selectedInvoiceExpense)}</strong>
            <span>Valor da fatura</span>
          </div>
          <div>
            <strong className={selectedInvoicePaid ? 'good-text' : selectedInvoiceExpense > 0 ? 'bad-text' : ''}>{selectedInvoicePaid ? 'Quitada' : selectedInvoiceExpense > 0 ? 'Em aberto' : 'Sem fatura'}</strong>
            <span>Marcacao nao altera receita</span>
          </div>
        </div>
        <div className="inline-actions">
          <button className="secondary-button" type="button" disabled={!selectedMonth || !selectedInvoiceExpense || selectedInvoicePaid} onClick={markSelectedInvoicePaid}>Marcar fatura selecionada como quitada</button>
          <button className="secondary-button" type="button" onClick={() => markPastInvoicesPaid(new Date().toISOString().substring(0, 7))}>Quitar faturas antigas</button>
          <button className="primary-button" type="button" onClick={() => equalizePastInvoiceIncomes(new Date().toISOString().substring(0, 7))}>Igualar receitas as faturas antigas</button>
        </div>
      </div>

      <div className="table-card wide">
        <h3>Receitas cadastradas</h3>
        <div className="simple-list">
          {sortedIncomes.length ? sortedIncomes.map(income => (
            <div key={income.month} className="list-row">
              <div>
                <strong>{formatMonth(income.month)}</strong>
                <small>{income.isRecurring ? 'Recorrente' : 'Lancamento mensal'} - {sourceLabel(income)}</small>
              </div>
              <strong className="good-text">{formatBRL(income.amount)}</strong>
              <div className="row-actions">
                <button className="secondary-button" type="button" onClick={() => editIncome(income)}>Editar</button>
                <button className="icon-button danger" type="button" onClick={() => deleteIncome(income.month)}>x</button>
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
          {editingRuleId ? <button className="small-action" type="button" onClick={clearRuleForm}>Cancelar edicao</button> : null}
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
        <form className="form-grid embedded" onSubmit={save}>
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
        <small>Historico e saldo de cobrancas deste membro</small>
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
  const { members, receivables, addReceivable, markReceivablePaid } = useFinance();
  const [memberId, setMemberId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().substring(0, 10));
  const [description, setDescription] = useState('');
  const chargeableMembers = members.filter(member => !member.isOwner);
  const ownerIds = new Set(members.filter(member => member.isOwner).map(member => member.id));
  const rows = receivables.filter(item => item.source === 'emprestimo_pix' && !ownerIds.has(item.memberId));
  const pending = rows.filter(item => item.status !== 'quitado');

  const save = (event: FormEvent) => {
    event.preventDefault();
    addReceivable({ id: crypto.randomUUID(), memberId, source: 'emprestimo_pix', amount: numberOf(amount), paidAmount: 0, date, description, status: 'pendente' });
    setMemberId('');
    setAmount('');
    setDescription('');
  };

  return (
    <div className="section-grid">
      <section className="table-card">
        <h3>Novo emprestimo ou Pix</h3>
        <form className="form-grid embedded" onSubmit={save}>
          <label>Quem<select required value={memberId} onChange={event => setMemberId(event.target.value)}><option value="">Selecione</option>{chargeableMembers.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label>Valor<input required type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></label>
          <label>Data<input required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
          <label>Descricao<input required value={description} onChange={event => setDescription(event.target.value)} /></label>
          <button className="primary-button full" type="submit">Registrar valor a receber</button>
        </form>
      </section>
      <section className="table-card">
        <h3>Total para cada pessoa pagar</h3>
        <ReceivableTotals rows={pending} />
        <h3 className="stacked-title">Historico de emprestimos e Pix</h3>
        <ReceivableList rows={rows} onPay={markReceivablePaid} />
      </section>
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
  if (!visibleRows.length) return <div className="empty-state compact">Nenhuma cobranca pendente.</div>;
  return (
    <div className="simple-list">
      {visibleRows.map(row => {
        const remaining = row.amount - row.paidAmount;
        return (
          <div className="list-row" key={row.id}>
            <div>
              <strong>{members.find(member => member.id === row.memberId)?.name || 'Membro'}</strong>
              <span>{row.description}</span>
              <small>{formatDate(row.date)} · {row.source === 'emprestimo_pix' ? 'Emprestimo/Pix' : row.source === 'divisao' ? 'Divisao' : 'Responsavel pela compra'}</small>
            </div>
            <div className="row-actions">
              <strong>{formatBRL(remaining)}</strong>
              <button className="secondary-button" onClick={() => onPay(row.id)}>Marcar recebido</button>
              {onDelete ? <button className="icon-button danger" onClick={() => onDelete(row.id)} title="Apagar cobranca">x</button> : null}
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
      <Section title="Acompanhamento de dividas proprias"><Block4Debts /></Section>
    </>
  );
}

function DebtManager() {
  const { debts, members, addDebt, setDebts } = useFinance();
  const payableDebts = debts.filter(debt => debt.type === 'a_pagar');
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

  const resetForm = () => {
    setCounterparty('');
    setCustomCounterparty('');
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
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const creditor = counterparty === '__custom__' ? customCounterparty.trim() : counterparty.trim();
    if (!creditor) return;
    const debt: Debt = {
      id: editingDebtId || crypto.randomUUID(),
      type: 'a_pagar',
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
  };

  const deleteDebt = (debtId: string) => {
    setDebts(previous => previous.filter(item => item.id !== debtId));
    if (editingDebtId === debtId) resetForm();
  };

  return (
    <div className="section-grid">
      <section className="table-card">
        <h3>{editingDebtId ? 'Editar divida propria' : 'Cadastrar divida propria'}</h3>
        <form className="form-grid embedded" onSubmit={save}>
          <label>Quem eu devo
            <select required value={counterparty} onChange={event => setCounterparty(event.target.value)}>
              <option value="">Selecione</option>
              {members.map(member => <option key={member.id} value={member.name}>{member.name}</option>)}
              <option value="__custom__">Outro credor</option>
            </select>
          </label>
          {counterparty === '__custom__' ? <label>Nome do credor<input required value={customCounterparty} onChange={event => setCustomCounterparty(event.target.value)} /></label> : null}
          <label>Origem<select value={origin} onChange={event => setOrigin(event.target.value as Debt['origin'])}><option value="cartao">Cartao</option><option value="emprestimo">Emprestimo</option><option value="financiamento">Financiamento</option><option value="manual">Manual</option><option value="outros">Outros</option></select></label>
          <label>Valor total<input required type="number" step="0.01" value={totalAmount} onChange={event => setTotalAmount(event.target.value)} /></label>
          <label>Valor pago<input type="number" step="0.01" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} /></label>
          <label>Parcela mensal<input type="number" step="0.01" value={monthlyPayment} onChange={event => setMonthlyPayment(event.target.value)} /></label>
          <label>Parcela atual<input type="number" min="1" step="1" value={currentInstallment} onChange={event => setCurrentInstallment(event.target.value)} placeholder="26" /></label>
          <label>Total de parcelas<input type="number" min="1" step="1" value={totalInstallments} onChange={event => setTotalInstallments(event.target.value)} placeholder="48" /></label>
          <label>Juros mensal (%)<input type="number" step="0.01" value={interestRate} onChange={event => setInterestRate(event.target.value)} /></label>
          <label>Data inicial<input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
          <label className="full">Nota<input value={note} onChange={event => setNote(event.target.value)} placeholder="Ex: financiamento do carro" /></label>
          <button className="primary-button full" type="submit">{editingDebtId ? 'Atualizar divida' : 'Salvar divida'}</button>
          {editingDebtId ? <button className="secondary-button full" type="button" onClick={resetForm}>Cancelar edicao</button> : null}
        </form>
      </section>

      <section className="table-card">
        <h3>Dividas cadastradas</h3>
        <div className="simple-list">
          {payableDebts.map(debt => {
            const remaining = Math.max(0, debt.totalAmount - debt.paidAmount);
            return (
              <div className="list-row" key={debt.id}>
                <div>
                  <strong>{debt.counterparty}</strong>
                  <span>{debt.origin} - {formatBRL(remaining)} restante</span>
                  <small>Inicio {formatDate(debt.startDate)} - Parcela {formatBRL(debt.monthlyPayment)}{debt.currentInstallment && debt.totalInstallments ? ` (${debt.currentInstallment}/${debt.totalInstallments})` : ''} - Juros {debt.interestRate}%</small>
                  {debt.note ? <small>{debt.note}</small> : null}
                </div>
                <div className="row-actions">
                  <button className="small-action" type="button" onClick={() => editDebt(debt)}>Editar</button>
                  <button className="icon-button danger" type="button" onClick={() => deleteDebt(debt.id)} title="Excluir divida">x</button>
                </div>
              </div>
            );
          })}
          {!payableDebts.length ? <div className="empty-state compact">Nenhuma divida cadastrada.</div> : null}
        </div>
      </section>
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

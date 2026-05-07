import { useState } from 'react';
import type { FormEvent } from 'react';
import { X, DollarSign, CreditCard, Target, Tag } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import type { Category, Debt } from '../types';

const numberOf = (value: string) => Number(value.replace(',', '.')) || 0;

const tabs = [
  { id: 'income', label: 'Receita', icon: DollarSign },
  { id: 'debt', label: 'Dívida', icon: CreditCard },
  { id: 'budget', label: 'Meta', icon: Target },
  { id: 'category', label: 'Categoria', icon: Tag },
] as const;

type Mode = typeof tabs[number]['id'];

export function ManualEntryModal({ onClose }: { onClose: () => void }) {
  const { addIncome, addDebt, addBudget, setCategories, categories } = useFinance();
  const [mode, setMode] = useState<Mode>('income');

  const [incomeMonth, setIncomeMonth] = useState(new Date().toISOString().substring(0, 7));
  const [incomeAmount, setIncomeAmount] = useState('');
  const [debtType, setDebtType] = useState<'a_receber' | 'a_pagar'>('a_receber');
  const [origin, setOrigin] = useState<Debt['origin']>('manual');
  const [counterparty, setCounterparty] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [paidAmount, setPaidAmount] = useState('0');
  const [monthlyPayment, setMonthlyPayment] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [startDate, setStartDate] = useState(new Date().toISOString().substring(0, 10));
  const [note, setNote] = useState('');
  const [categoryName, setCategoryName] = useState('');
  const [budgetCategoryId, setBudgetCategoryId] = useState(categories[0]?.id || 'outros');
  const [budgetLimit, setBudgetLimit] = useState('');

  const saveIncome = (event: FormEvent) => {
    event.preventDefault();
    addIncome({ month: incomeMonth, amount: numberOf(incomeAmount), isRecurring: false });
    onClose();
  };

  const saveDebt = (event: FormEvent) => {
    event.preventDefault();
    const debt: Debt = {
      id: crypto.randomUUID(),
      type: debtType,
      origin,
      counterparty,
      totalAmount: numberOf(totalAmount),
      paidAmount: numberOf(paidAmount),
      monthlyPayment: numberOf(monthlyPayment),
      interestRate: numberOf(interestRate),
      startDate,
      linkedTransactionIds: [],
      note,
    };
    addDebt(debt);
    onClose();
  };

  const saveCategory = (event: FormEvent) => {
    event.preventDefault();
    const id = categoryName.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-');
    if (!id || categories.some(item => item.id === id)) return;
    const category: Category = { id, name: categoryName.trim(), color: '#64748b', keywords: [] };
    setCategories(previous => [...previous, category]);
    setCategoryName('');
  };

  const saveBudget = (event: FormEvent) => {
    event.preventDefault();
    addBudget({ categoryId: budgetCategoryId, monthlyLimit: numberOf(budgetLimit) });
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <div>
            <h2>Lançamento manual</h2>
            <p>Receitas, dívidas, metas e categorias</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Fechar">
            <X size={18} />
          </button>
        </header>

        <nav className="segmented">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                className={mode === tab.id ? 'active' : ''}
                onClick={() => setMode(tab.id)}
              >
                <Icon size={14} style={{ marginRight: 6, opacity: 0.7 }} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {mode === 'income' && (
          <form className="form-grid" onSubmit={saveIncome}>
            <label>
              Mês
              <input 
                type="month" 
                required 
                value={incomeMonth} 
                onChange={e => setIncomeMonth(e.target.value)} 
              />
            </label>
            <label>
              Valor (R$)
              <input 
                type="number" 
                step="0.01" 
                required 
                placeholder="0,00"
                value={incomeAmount} 
                onChange={e => setIncomeAmount(e.target.value)} 
              />
            </label>
            <button className="primary-button full" type="submit">
              Adicionar entrada
            </button>
          </form>
        )}

        {mode === 'debt' && (
          <form className="form-grid" onSubmit={saveDebt}>
            <label className="full">
              Tipo
              <select 
                required 
                value={debtType} 
                onChange={e => setDebtType(e.target.value as 'a_receber' | 'a_pagar')}
              >
                <option value="a_receber">A receber - alguém me deve</option>
                <option value="a_pagar">A pagar - eu devo</option>
              </select>
            </label>
            <label>
              Origem
              <select value={origin} onChange={e => setOrigin(e.target.value as Debt['origin'])}>
                <option value="manual">Manual</option>
                <option value="cartao">Cartão</option>
                <option value="emprestimo">Empréstimo</option>
                <option value="outros">Outros</option>
              </select>
            </label>
            <label>
              Pessoa/entidade
              <input 
                required 
                placeholder="Nome do credor ou devedor"
                value={counterparty} 
                onChange={e => setCounterparty(e.target.value)} 
              />
            </label>
            <label>
              Valor total
              <input 
                type="number" 
                step="0.01" 
                required 
                placeholder="0,00"
                value={totalAmount} 
                onChange={e => setTotalAmount(e.target.value)} 
              />
            </label>
            <label>
              Valor pago
              <input 
                type="number" 
                step="0.01" 
                placeholder="0,00"
                value={paidAmount} 
                onChange={e => setPaidAmount(e.target.value)} 
              />
            </label>
            <label>
              Parcela mensal
              <input 
                type="number" 
                step="0.01" 
                placeholder="0,00"
                value={monthlyPayment} 
                onChange={e => setMonthlyPayment(e.target.value)} 
              />
            </label>
            <label>
              Juros mensal (%)
              <input 
                type="number" 
                step="0.01" 
                placeholder="0"
                value={interestRate} 
                onChange={e => setInterestRate(e.target.value)} 
              />
            </label>
            <label>
              Data
              <input 
                type="date" 
                required 
                value={startDate} 
                onChange={e => setStartDate(e.target.value)} 
              />
            </label>
            <label className="full">
              Observação
              <input 
                placeholder="Detalhes opcionais"
                value={note} 
                onChange={e => setNote(e.target.value)} 
              />
            </label>
            <button className="primary-button full" type="submit">
              Salvar dívida
            </button>
          </form>
        )}

        {mode === 'budget' && (
          <form className="form-grid" onSubmit={saveBudget}>
            <label className="full">
              Categoria
              <select 
                required 
                value={budgetCategoryId} 
                onChange={e => setBudgetCategoryId(e.target.value)}
              >
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </label>
            <label className="full">
              Teto mensal (R$)
              <input 
                type="number" 
                step="0.01" 
                required 
                placeholder="0,00"
                value={budgetLimit} 
                onChange={e => setBudgetLimit(e.target.value)} 
              />
            </label>
            <button className="primary-button full" type="submit">
              Salvar meta
            </button>
          </form>
        )}

        {mode === 'category' && (
          <form className="form-grid" onSubmit={saveCategory}>
            <label className="full">
              Nome da categoria
              <input 
                required 
                placeholder="Ex: Streaming, Farmácia, Pets..."
                value={categoryName} 
                onChange={e => setCategoryName(e.target.value)} 
              />
            </label>
            <button className="primary-button full" type="submit">
              Criar categoria
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

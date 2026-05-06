import { useState } from 'react';
import type { FormEvent } from 'react';
import { X } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import type { Category, Debt } from '../types';

const numberOf = (value: string) => Number(value.replace(',', '.')) || 0;

export function ManualEntryModal({ onClose }: { onClose: () => void }) {
  const { addIncome, addDebt, addBudget, setCategories, categories } = useFinance();
  const [mode, setMode] = useState<'income' | 'debt' | 'budget' | 'category'>('income');

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
    <div className="modal-backdrop">
      <div className="modal">
        <header className="modal-header">
          <div>
            <h2>Lancamento manual</h2>
            <p>Receitas, dividas e categorias customizadas.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="segmented">
          <button className={mode === 'income' ? 'active' : ''} onClick={() => setMode('income')}>Receita</button>
          <button className={mode === 'debt' ? 'active' : ''} onClick={() => setMode('debt')}>Divida</button>
          <button className={mode === 'budget' ? 'active' : ''} onClick={() => setMode('budget')}>Meta</button>
          <button className={mode === 'category' ? 'active' : ''} onClick={() => setMode('category')}>Categoria</button>
        </div>

        {mode === 'income' ? (
          <form className="form-grid" onSubmit={saveIncome}>
            <label>Mes<input type="month" required value={incomeMonth} onChange={event => setIncomeMonth(event.target.value)} /></label>
            <label>Valor<input type="number" step="0.01" required value={incomeAmount} onChange={event => setIncomeAmount(event.target.value)} /></label>
            <button className="primary-button full" type="submit">Salvar receita</button>
          </form>
        ) : null}

        {mode === 'debt' ? (
          <form className="form-grid" onSubmit={saveDebt}>
            <label className="full">Tipo
              <select required value={debtType} onChange={event => setDebtType(event.target.value as 'a_receber' | 'a_pagar')}>
                <option value="a_receber">A receber - alguem me deve</option>
                <option value="a_pagar">A pagar - eu devo</option>
              </select>
            </label>
            <label>Origem
              <select value={origin} onChange={event => setOrigin(event.target.value as Debt['origin'])}>
                <option value="manual">Manual</option>
                <option value="cartao">Cartao</option>
                <option value="emprestimo">Emprestimo</option>
                <option value="outros">Outros</option>
              </select>
            </label>
            <label>Pessoa/entidade<input required value={counterparty} onChange={event => setCounterparty(event.target.value)} /></label>
            <label>Valor total<input type="number" step="0.01" required value={totalAmount} onChange={event => setTotalAmount(event.target.value)} /></label>
            <label>Valor pago<input type="number" step="0.01" value={paidAmount} onChange={event => setPaidAmount(event.target.value)} /></label>
            <label>Parcela mensal<input type="number" step="0.01" value={monthlyPayment} onChange={event => setMonthlyPayment(event.target.value)} /></label>
            <label>Juros mensal (%)<input type="number" step="0.01" value={interestRate} onChange={event => setInterestRate(event.target.value)} /></label>
            <label>Data<input type="date" required value={startDate} onChange={event => setStartDate(event.target.value)} /></label>
            <label className="full">Observacao<input value={note} onChange={event => setNote(event.target.value)} /></label>
            <button className="primary-button full" type="submit">Salvar divida</button>
          </form>
        ) : null}

        {mode === 'budget' ? (
          <form className="form-grid" onSubmit={saveBudget}>
            <label className="full">Categoria
              <select required value={budgetCategoryId} onChange={event => setBudgetCategoryId(event.target.value)}>
                {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label className="full">Teto mensal<input type="number" step="0.01" required value={budgetLimit} onChange={event => setBudgetLimit(event.target.value)} /></label>
            <button className="primary-button full" type="submit">Salvar meta</button>
          </form>
        ) : null}

        {mode === 'category' ? (
          <form className="form-grid" onSubmit={saveCategory}>
            <label className="full">Nome da categoria<input required value={categoryName} onChange={event => setCategoryName(event.target.value)} /></label>
            <button className="primary-button full" type="submit">Criar categoria</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

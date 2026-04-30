import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Category, Debt, MonthlyIncome, Transaction } from '../types';
import { DEFAULT_CATEGORIES } from '../utils/constants';
import { parseCSV, parseOFX } from '../utils/csvParser';
import { normalizeText } from '../utils/formatters';

interface FinanceState {
  transactions: Transaction[];
  debts: Debt[];
  monthlyIncomes: MonthlyIncome[];
  categories: Category[];
  processedFiles: string[];
}

interface FinanceContextType extends FinanceState {
  addTransactions: (transactions: Transaction[]) => void;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setDebts: React.Dispatch<React.SetStateAction<Debt[]>>;
  setMonthlyIncomes: React.Dispatch<React.SetStateAction<MonthlyIncome[]>>;
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  addIncome: (income: MonthlyIncome) => void;
  addDebt: (debt: Debt) => void;
  linkTransactionToDebt: (transactionId: string, debtId: string) => void;
  exportData: () => void;
  clearAllData: () => void;
  autoImportStatus: string;
}

const FinanceContext = createContext<FinanceContextType | undefined>(undefined);

const load = <T,>(key: string, fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const uniqueKey = (transaction: Transaction) => {
  return normalizeText(`${transaction.date}|${transaction.description}|${transaction.amount.toFixed(2)}|${transaction.installment || ''}`);
};

export const FinanceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [transactions, setTransactions] = useState<Transaction[]>(() => load('finance_transactions_v2', []));
  const [debts, setDebts] = useState<Debt[]>(() => load('finance_debts_v2', []));
  const [monthlyIncomes, setMonthlyIncomes] = useState<MonthlyIncome[]>(() => load('finance_incomes_v2', []));
  const [categories, setCategories] = useState<Category[]>(() => load('finance_categories_v2', DEFAULT_CATEGORIES));
  const [processedFiles, setProcessedFiles] = useState<string[]>(() => load('finance_processed_files_v2', []));
  const [autoImportStatus, setAutoImportStatus] = useState('Aguardando faturas');

  useEffect(() => localStorage.setItem('finance_transactions_v2', JSON.stringify(transactions)), [transactions]);
  useEffect(() => localStorage.setItem('finance_debts_v2', JSON.stringify(debts)), [debts]);
  useEffect(() => localStorage.setItem('finance_incomes_v2', JSON.stringify(monthlyIncomes)), [monthlyIncomes]);
  useEffect(() => localStorage.setItem('finance_categories_v2', JSON.stringify(categories)), [categories]);
  useEffect(() => localStorage.setItem('finance_processed_files_v2', JSON.stringify(processedFiles)), [processedFiles]);

  const addTransactions = (incoming: Transaction[]) => {
    setTransactions(previous => {
      const existingIds = new Set(previous.map(item => item.id));
      const existingKeys = new Set(previous.map(uniqueKey));
      const deduped = incoming
        .filter(item => !existingIds.has(item.id))
        .map(item => ({ ...item, status: existingKeys.has(uniqueKey(item)) ? 'possible_duplicate' as const : 'ok' as const }));
      return [...previous, ...deduped].sort((a, b) => b.date.localeCompare(a.date));
    });
  };

  useEffect(() => {
    let cancelled = false;
    const autoImport = async () => {
      try {
        const manifestResponse = await fetch('/faturas/manifest.json', { cache: 'no-store' });
        if (!manifestResponse.ok) {
          setAutoImportStatus('Sem manifesto em public/faturas');
          return;
        }
        const files: string[] = await manifestResponse.json();
        const pending = files.filter(file => !processedFiles.includes(file));
        if (!pending.length) {
          setAutoImportStatus('Faturas locais ja importadas');
          return;
        }

        const imported: Transaction[] = [];
        const importedFiles: string[] = [];
        for (const file of pending) {
          const response = await fetch(`/faturas/${file}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const content = await response.text();
          const rows = file.toLowerCase().endsWith('.ofx')
            ? parseOFX(content, categories, file)
            : await parseCSV(content, categories, file);
          imported.push(...rows);
          importedFiles.push(file);
        }

        if (!cancelled && imported.length) {
          addTransactions(imported);
          setProcessedFiles(previous => [...previous, ...importedFiles]);
          setAutoImportStatus(`${imported.length} transacoes importadas de ${importedFiles.length} arquivo(s)`);
        }
      } catch {
        if (!cancelled) setAutoImportStatus('Importacao automatica indisponivel');
      }
    };
    autoImport();
    return () => { cancelled = true; };
  }, [categories, processedFiles]);

  const addIncome = (income: MonthlyIncome) => {
    setMonthlyIncomes(previous => [...previous.filter(item => item.month !== income.month), income]);
  };

  const addDebt = (debt: Debt) => {
    setDebts(previous => [debt, ...previous]);
  };

  const linkTransactionToDebt = (transactionId: string, debtId: string) => {
    setTransactions(previous => previous.map(item => item.id === transactionId ? { ...item, debtId } : item));
    setDebts(previous => previous.map(debt => debt.id === debtId && !debt.linkedTransactionIds.includes(transactionId)
      ? { ...debt, linkedTransactionIds: [...debt.linkedTransactionIds, transactionId] }
      : debt));
  };

  const exportData = () => {
    const payload = { transactions, debts, monthlyIncomes, categories, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'controle-financeiro.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearAllData = () => {
    if (!window.confirm('Apagar todos os dados locais?')) return;
    setTransactions([]);
    setDebts([]);
    setMonthlyIncomes([]);
    setCategories(DEFAULT_CATEGORIES);
    setProcessedFiles([]);
  };

  return (
    <FinanceContext.Provider value={{
      transactions,
      debts,
      monthlyIncomes,
      categories,
      processedFiles,
      addTransactions,
      setTransactions,
      setDebts,
      setMonthlyIncomes,
      setCategories,
      addIncome,
      addDebt,
      linkTransactionToDebt,
      exportData,
      clearAllData,
      autoImportStatus,
    }}>
      {children}
    </FinanceContext.Provider>
  );
};

export const useFinance = () => {
  const context = useContext(FinanceContext);
  if (!context) throw new Error('useFinance must be used within FinanceProvider');
  return context;
};

/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Alias, Budget, Category, CategoryRule, Debt, LegacyMigrationData, Member, MonthlyIncome, Receivable, Transaction } from '../types';
import { DEFAULT_CATEGORIES } from '../utils/constants';
import { parseCSV, parseOFX } from '../utils/csvParser';
import { getAccountingMonth } from '../utils/analytics';
import { normalizeText } from '../utils/formatters';

interface FinanceState {
  transactions: Transaction[];
  debts: Debt[];
  budgets: Budget[];
  members: Member[];
  receivables: Receivable[];
  monthlyIncomes: MonthlyIncome[];
  paidInvoiceMonths: string[];
  categories: Category[];
  categoryRules: CategoryRule[];
  aliases: Alias[];
  processedFiles: string[];
}

interface FinanceContextType extends FinanceState {
  addTransactions: (transactions: Transaction[]) => void;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setDebts: React.Dispatch<React.SetStateAction<Debt[]>>;
  setBudgets: React.Dispatch<React.SetStateAction<Budget[]>>;
  setMembers: React.Dispatch<React.SetStateAction<Member[]>>;
  setReceivables: React.Dispatch<React.SetStateAction<Receivable[]>>;
  setMonthlyIncomes: React.Dispatch<React.SetStateAction<MonthlyIncome[]>>;
  setPaidInvoiceMonths: React.Dispatch<React.SetStateAction<string[]>>;
  setCategories: React.Dispatch<React.SetStateAction<Category[]>>;
  setCategoryRules: React.Dispatch<React.SetStateAction<CategoryRule[]>>;
  setAliases: React.Dispatch<React.SetStateAction<Alias[]>>;
  addIncome: (income: MonthlyIncome) => void;
  markPastInvoicesPaid: (currentMonth: string) => void;
  equalizePastInvoiceIncomes: (currentMonth: string) => void;
  addDebt: (debt: Debt) => void;
  addBudget: (budget: Budget) => void;
  addMember: (member: Member) => void;
  addAlias: (original: string, alias: string) => void;
  addCategoryRule: (keyword: string, categoryId: string) => void;
  updateCategoryRule: (ruleId: string, keyword: string, categoryId: string) => void;
  deleteCategoryRule: (ruleId: string) => void;
  addReceivable: (receivable: Receivable) => void;
  markReceivablePaid: (receivableId: string, amount?: number) => void;
  deleteReceivable: (receivableId: string) => void;
  assignTransactionResponsible: (transactionId: string, memberId: string) => void;
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

const fileSignature = (file: string, content: string) => `${file}#${content.length}`;
const fileNameFromSignature = (value: string) => value.split('#')[0];

const keywordKey = (value: string) => normalizeText(value);
const defaultKeywordKeys = new Set(DEFAULT_CATEGORIES.flatMap(category => category.keywords.map(keywordKey)));
const USER_CLEARED_DATA_KEY = 'finance_user_cleared_data_v1';
const DELETED_DEBTS_KEY = 'finance_deleted_debt_ids_v1';
const DELETED_RECEIVABLES_KEY = 'finance_deleted_receivable_ids_v1';

const deletedIds = (key: string) => new Set(load<string[]>(key, []));
const rememberDeletedId = (key: string, id: string) => {
  localStorage.setItem(key, JSON.stringify(Array.from(new Set([...deletedIds(key), id]))));
};

const sourceMonthFromFile = (sourceFile?: string) => {
  const match = sourceFile?.match(/(20\d{2})[-_](0[1-9]|1[0-2])/);
  return match ? `${match[1]}-${match[2]}` : '';
};

const addMonths = (month: string, offset: number) => {
  const date = new Date(Number(month.substring(0, 4)), Number(month.substring(5, 7)) - 1 + offset, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

const installmentParts = (installment?: string) => {
  const match = installment?.match(/(\d+)\/(\d+)/);
  return match ? { current: Number(match[1]), total: Number(match[2]) } : null;
};

const fixProjectionInstallmentDates = (rows: Transaction[]) => {
  const groups = new Map<string, Transaction[]>();
  rows.forEach(row => {
    const parts = installmentParts(row.installment);
    const sourceMonth = sourceMonthFromFile(row.sourceFile);
    if (!parts || !sourceMonth) return;
    const key = `${row.sourceFile}|${normalizeText(row.description)}|${row.amount.toFixed(2)}|${parts.total}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  });

  const nextDates = new Map<string, string>();
  groups.forEach(group => {
    const anchors = group
      .filter(row => row.source !== 'projection')
      .map(row => ({ row, parts: installmentParts(row.installment), sourceMonth: sourceMonthFromFile(row.sourceFile) }))
      .filter((item): item is { row: Transaction; parts: { current: number; total: number }; sourceMonth: string } => Boolean(item.parts && item.sourceMonth))
      .sort((a, b) => a.parts.current - b.parts.current);
    const anchor = anchors[0];
    if (!anchor) return;

    group.filter(row => row.source === 'projection').forEach(row => {
      const parts = installmentParts(row.installment);
      if (!parts) return;
      const targetMonth = addMonths(anchor.sourceMonth, parts.current - anchor.parts.current);
      const day = row.date.substring(8, 10) || anchor.row.date.substring(8, 10) || '01';
      nextDates.set(row.id, `${targetMonth}-${day}`);
    });
  });

  if (!nextDates.size) return rows;
  let changed = false;
  const next = rows.map(row => {
    const nextDate = nextDates.get(row.id);
    if (!nextDate || nextDate === row.date) return row;
    changed = true;
    return { ...row, date: nextDate };
  });
  return changed ? next : rows;
};

export const FinanceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [transactions, setTransactions] = useState<Transaction[]>(() => load('finance_transactions_v2', []));
  const [debts, setDebts] = useState<Debt[]>(() => load('finance_debts_v2', []));
  const [budgets, setBudgets] = useState<Budget[]>(() => load('finance_budgets_v2', []));
  const [members, setMembers] = useState<Member[]>(() => {
    const loaded = load<Member[]>('finance_members_v2', []);
    if (loaded.some(member => normalizeText(member.name) === 'RODRIGO')) return loaded;
    return [{ id: 'owner-rodrigo', name: 'Rodrigo', nickname: 'Titular', contact: '', isOwner: true, aliases: [] }, ...loaded];
  });
  const [receivables, setReceivables] = useState<Receivable[]>(() => load('finance_receivables_v2', []));
  const [monthlyIncomes, setMonthlyIncomes] = useState<MonthlyIncome[]>(() => load('finance_incomes_v2', []));
  const [paidInvoiceMonths, setPaidInvoiceMonths] = useState<string[]>(() => load('finance_paid_invoice_months_v1', []));
  const [categories, setCategories] = useState<Category[]>(() => load('finance_categories_v2', DEFAULT_CATEGORIES));
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>(() => load('finance_category_rules_v2', []));
  const [aliases, setAliases] = useState<Alias[]>(() => load('finance_aliases_v2', []));
  const [processedFiles, setProcessedFiles] = useState<string[]>(() => load('finance_processed_files_v2', []));
  const [autoImportStatus, setAutoImportStatus] = useState('Aguardando faturas');
  const [migrationReady, setMigrationReady] = useState(false);

  useEffect(() => localStorage.setItem('finance_transactions_v2', JSON.stringify(transactions)), [transactions]);
  useEffect(() => localStorage.setItem('finance_debts_v2', JSON.stringify(debts)), [debts]);
  useEffect(() => localStorage.setItem('finance_budgets_v2', JSON.stringify(budgets)), [budgets]);
  useEffect(() => localStorage.setItem('finance_members_v2', JSON.stringify(members)), [members]);
  useEffect(() => localStorage.setItem('finance_receivables_v2', JSON.stringify(receivables)), [receivables]);
  useEffect(() => localStorage.setItem('finance_incomes_v2', JSON.stringify(monthlyIncomes)), [monthlyIncomes]);
  useEffect(() => localStorage.setItem('finance_paid_invoice_months_v1', JSON.stringify(paidInvoiceMonths)), [paidInvoiceMonths]);
  useEffect(() => localStorage.setItem('finance_categories_v2', JSON.stringify(categories)), [categories]);
  useEffect(() => localStorage.setItem('finance_category_rules_v2', JSON.stringify(categoryRules)), [categoryRules]);
  useEffect(() => localStorage.setItem('finance_aliases_v2', JSON.stringify(aliases)), [aliases]);
  useEffect(() => localStorage.setItem('finance_processed_files_v2', JSON.stringify(processedFiles)), [processedFiles]);

  useEffect(() => {
    if (!migrationReady || categoryRules.length || localStorage.getItem('finance_category_rules_backfilled_v1')) return;
    let cancelled = false;
    const recoveredRules = categories.flatMap(category =>
      category.keywords
        .filter(keyword => !defaultKeywordKeys.has(keywordKey(keyword)))
        .map(keyword => ({
          id: crypto.randomUUID(),
          keyword,
          categoryId: category.id,
          createdAt: new Date().toISOString(),
        })));
    window.setTimeout(() => {
      if (!cancelled && recoveredRules.length) setCategoryRules(recoveredRules);
    }, 0);
    localStorage.setItem('finance_category_rules_backfilled_v1', 'true');
    return () => { cancelled = true; };
  }, [categories, categoryRules.length, migrationReady]);

  useEffect(() => {
    const ownerIds = new Set(members.filter(member => member.isOwner).map(member => member.id));
    if (!ownerIds.size || !receivables.some(item => ownerIds.has(item.memberId))) return;
    let cancelled = false;
    window.setTimeout(() => {
      if (!cancelled) setReceivables(previous => previous.filter(item => !ownerIds.has(item.memberId)));
    }, 0);
    return () => { cancelled = true; };
  }, [members, receivables]);

  useEffect(() => {
    if (!migrationReady || localStorage.getItem('finance_installment_dates_fixed_v1')) return;
    let cancelled = false;
    window.setTimeout(() => {
      if (!cancelled) setTransactions(previous => fixProjectionInstallmentDates(previous));
      localStorage.setItem('finance_installment_dates_fixed_v1', 'true');
    }, 0);
    return () => { cancelled = true; };
  }, [migrationReady]);

  useEffect(() => {
    if (!migrationReady || localStorage.getItem('finance_income_cleanup_v2')) return;
    let cancelled = false;
    const currentMonth = new Date().toISOString().substring(0, 7);
    window.setTimeout(() => {
      if (cancelled) return;
      setMonthlyIncomes(previous => previous
        .filter(item => item.month >= currentMonth || item.source === 'manual')
        .sort((a, b) => a.month.localeCompare(b.month)));
      localStorage.setItem('finance_income_cleanup_v2', 'true');
    }, 0);
    return () => { cancelled = true; };
  }, [migrationReady]);

  const addTransactions = (incoming: Transaction[]) => {
    setTransactions(previous => {
      const existingIds = new Set(previous.map(item => item.id));
      const existingKeys = new Set(previous.map(uniqueKey));
      const incomingKeys = new Set<string>();
      const deduped = incoming
        .filter(item => {
          const key = uniqueKey(item);
          if (existingIds.has(item.id) || existingKeys.has(key) || incomingKeys.has(key)) return false;
          incomingKeys.add(key);
          return true;
        })
        .map(item => ({ ...item, status: 'ok' as const }));
      return [...previous, ...deduped].sort((a, b) => b.date.localeCompare(a.date));
    });
  };

  useEffect(() => {
    let cancelled = false;
    const importLegacy = async () => {
      if (localStorage.getItem(USER_CLEARED_DATA_KEY)) {
        setMigrationReady(true);
        setAutoImportStatus('Importação automática pausada após limpeza manual');
        return;
      }
      try {
        const response = await fetch('/migration/legacy-data.json', { cache: 'no-store' });
        if (!response.ok) {
          setMigrationReady(true);
          return;
        }
        const data = await response.json() as LegacyMigrationData;
        if (localStorage.getItem('finance_legacy_migration_version') === data.schemaVersion) {
          setMigrationReady(true);
          return;
        }
        if (cancelled) return;

        setCategories(previous => {
          const byId = new Map(previous.map(item => [item.id, item]));
          data.categories.forEach(category => {
            const current = byId.get(category.id);
            byId.set(category.id, current
              ? { ...current, keywords: Array.from(new Set([...current.keywords, ...category.keywords])) }
              : category);
          });
          return Array.from(byId.values());
        });
        if (data.categoryRules?.length) {
          setCategoryRules(previous => {
            const byId = new Map(previous.map(item => [item.id, item]));
            data.categoryRules?.forEach(item => byId.set(item.id, item));
            return Array.from(byId.values());
          });
        }
        setAliases(previous => {
          const byOriginal = new Map(previous.map(item => [normalizeText(item.original), item]));
          data.aliases.forEach(alias => byOriginal.set(normalizeText(alias.original), alias));
          return Array.from(byOriginal.values());
        });
        setMonthlyIncomes(previous => {
          const byMonth = new Map(previous.map(item => [item.month, item]));
          data.monthlyIncomes.forEach(item => {
            const current = byMonth.get(item.month);
            const migrated = { ...item, source: 'legacy' as const };
            byMonth.set(item.month, current ? { ...current, amount: current.amount + item.amount } : migrated);
          });
          return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
        });
        setDebts(previous => {
          const ids = new Set(previous.map(item => item.id));
          const removed = deletedIds(DELETED_DEBTS_KEY);
          return [...data.debts.filter(item => !ids.has(item.id) && !removed.has(item.id)), ...previous];
        });
        if (data.budgets?.length) {
          setBudgets(previous => {
            const byCategory = new Map(previous.map(item => [item.categoryId, item]));
            data.budgets?.forEach(item => byCategory.set(item.categoryId, item));
            return Array.from(byCategory.values());
          });
        }
        if (data.members?.length) {
          setMembers(previous => {
            const byId = new Map(previous.map(item => [item.id, item]));
            data.members?.forEach(item => byId.set(item.id, item));
            return Array.from(byId.values());
          });
        }
        if (data.receivables?.length) {
          setReceivables(previous => {
            const byId = new Map(previous.map(item => [item.id, item]));
            const removed = deletedIds(DELETED_RECEIVABLES_KEY);
            data.receivables?.filter(item => !removed.has(item.id)).forEach(item => byId.set(item.id, item));
            return Array.from(byId.values());
          });
        }
        setTransactions(previous => {
          const ids = new Set(previous.map(item => item.id));
          const keys = new Set(previous.map(uniqueKey));
          const importedKeys = new Set<string>();
          const imported = data.transactions
            .filter(item => {
              const key = uniqueKey(item);
              if (ids.has(item.id) || keys.has(key) || importedKeys.has(key)) return false;
              importedKeys.add(key);
              return true;
            })
            .map(item => ({ ...item, status: 'ok' as const }));
          return [...previous, ...imported].sort((a, b) => b.date.localeCompare(a.date));
        });
        setProcessedFiles(previous => Array.from(new Set([...previous, ...data.processedFiles])));
        localStorage.setItem('finance_legacy_migration_version', data.schemaVersion);
        setAutoImportStatus(`${data.transactions.length} transacoes migradas do banco antigo`);
      } catch {
        setAutoImportStatus('Migracao do banco antigo indisponivel');
      } finally {
        if (!cancelled) setMigrationReady(true);
      }
    };
    importLegacy();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!migrationReady) return;
    if (localStorage.getItem(USER_CLEARED_DATA_KEY)) {
      const timer = window.setTimeout(() => setAutoImportStatus('Importação automática pausada após limpeza manual'), 0);
      return () => window.clearTimeout(timer);
    }
    let cancelled = false;
    const autoImport = async () => {
      try {
        const manifestResponse = await fetch('/faturas/manifest.json', { cache: 'no-store' });
        if (!manifestResponse.ok) {
          setAutoImportStatus('Sem manifesto em public/faturas');
          return;
        }
        const files: string[] = await manifestResponse.json();
        const imported: Transaction[] = [];
        const importedFiles: string[] = [];
        const importedSignatures: string[] = [];
        for (const file of files) {
          const response = await fetch(`/faturas/${file}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const content = await response.text();
          const signature = fileSignature(file, content);
          if (processedFiles.includes(signature)) continue;
          const rows = file.toLowerCase().endsWith('.ofx')
            ? parseOFX(content, categories, file)
            : await parseCSV(content, categories, file);
          imported.push(...rows);
          importedFiles.push(file);
          importedSignatures.push(signature);
        }

        if (!imported.length) {
          setAutoImportStatus('Faturas locais ja importadas');
          return;
        }

        if (!cancelled && imported.length) {
          addTransactions(imported);
          setProcessedFiles(previous => [...previous.filter(file => !importedFiles.includes(fileNameFromSignature(file))), ...importedSignatures]);
          setAutoImportStatus(`${imported.length} transacoes importadas de ${importedFiles.length} arquivo(s)`);
        }
      } catch {
        if (!cancelled) setAutoImportStatus('Importação automática indisponível');
      }
    };
    autoImport();
    return () => { cancelled = true; };
  }, [categories, processedFiles, migrationReady]);

  const addIncome = (income: MonthlyIncome) => {
    const nextIncome = { ...income, id: income.id || crypto.randomUUID(), source: income.source || 'manual' };
    const legacyKey = `${income.month}-${income.source || 'manual'}-${income.amount}-${income.description || ''}`;
    setMonthlyIncomes(previous => [nextIncome, ...previous.filter(item => item.id !== nextIncome.id && `${item.month}-${item.source || 'manual'}-${item.amount}-${item.description || ''}` !== legacyKey)]);
  };

  const markPastInvoicesPaid = (currentMonth: string) => {
    const months = new Set<string>();
    transactions.forEach(transaction => {
      if (transaction.type !== 'expense') return;
      const month = getAccountingMonth(transaction);
      if (month < currentMonth) months.add(month);
    });
    setPaidInvoiceMonths(previous => Array.from(new Set([...previous, ...months])).sort());
  };

  const equalizePastInvoiceIncomes = (currentMonth: string) => {
    const expenseByMonth = new Map<string, number>();
    transactions.forEach(transaction => {
      if (transaction.type !== 'expense') return;
      const month = getAccountingMonth(transaction);
      if (month >= currentMonth) return;
      expenseByMonth.set(month, (expenseByMonth.get(month) || 0) + transaction.amount);
    });

    setMonthlyIncomes(previous => {
      const byMonth = new Map(previous.filter(item => item.source !== 'adjustment').map(item => [item.id || `${item.month}-${item.source || 'manual'}-${item.amount}`, item]));
      expenseByMonth.forEach((amount, month) => {
        byMonth.set(`adjustment-${month}`, {
          id: `adjustment-${month}`,
          month,
          amount,
          isRecurring: false,
          source: 'adjustment',
          description: 'Receita ajustada para quitar fatura antiga',
        });
      });
      return Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month));
    });
    setPaidInvoiceMonths(previous => Array.from(new Set([...previous, ...expenseByMonth.keys()])).sort());
  };

  const addDebt = (debt: Debt) => {
    setDebts(previous => [debt, ...previous]);
  };

  const addBudget = (budget: Budget) => {
    setBudgets(previous => [...previous.filter(item => item.categoryId !== budget.categoryId), budget]);
  };

  const addMember = (member: Member) => {
    setMembers(previous => [member, ...previous.filter(item => item.id !== member.id)]);
  };

  const addAlias = (original: string, alias: string) => {
    const cleanOriginal = original.trim();
    const cleanAlias = alias.trim();
    if (!cleanOriginal || !cleanAlias) return;
    setAliases(previous => {
      const byOriginal = new Map(previous.map(item => [normalizeText(item.original), item]));
      byOriginal.set(normalizeText(cleanOriginal), { original: cleanOriginal, alias: cleanAlias });
      return Array.from(byOriginal.values());
    });
  };

  const keywordsForRule = (keyword: string) => {
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword) return [];
    const relatedAliasOriginals = aliases
      .filter(alias => keywordKey(alias.alias).includes(keywordKey(cleanKeyword)) || keywordKey(cleanKeyword).includes(keywordKey(alias.alias)))
      .map(alias => alias.original);
    return Array.from(new Set([cleanKeyword, ...relatedAliasOriginals].filter(Boolean)));
  };

  const addKeywordsToCategory = (rows: Category[], categoryId: string, keywords: string[]) => {
    return rows.map(category => category.id === categoryId
      ? { ...category, keywords: Array.from(new Set([...category.keywords, ...keywords])) }
      : category);
  };

  const removeUserKeywords = (rows: Category[], keywords: string[]) => {
    const removable = new Set(keywords.map(keywordKey).filter(key => !defaultKeywordKeys.has(key)));
    if (!removable.size) return rows;
    return rows.map(category => ({
      ...category,
      keywords: category.keywords.filter(keyword => !removable.has(keywordKey(keyword))),
    }));
  };

  const applyRuleToTransactions = (keywords: string[], categoryId: string) => {
    setTransactions(previous => previous.map(transaction =>
      keywords.some(item => keywordKey(transaction.description).includes(keywordKey(item)))
        ? { ...transaction, categoryId }
        : transaction));
  };

  const addCategoryRule = (keyword: string, categoryId: string) => {
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword || !categoryId) return;
    const keywords = keywordsForRule(cleanKeyword);
    const replacedRule = categoryRules.find(item => keywordKey(item.keyword) === keywordKey(cleanKeyword));
    const replacedKeywords = replacedRule ? keywordsForRule(replacedRule.keyword) : [];
    const rule: CategoryRule = { id: crypto.randomUUID(), keyword: cleanKeyword, categoryId, createdAt: new Date().toISOString() };
    setCategoryRules(previous => [rule, ...previous.filter(item => keywordKey(item.keyword) !== keywordKey(cleanKeyword))]);
    setCategories(previous => addKeywordsToCategory(removeUserKeywords(previous, replacedKeywords), categoryId, keywords));
    applyRuleToTransactions(keywords, categoryId);
  };

  const updateCategoryRule = (ruleId: string, keyword: string, categoryId: string) => {
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword || !categoryId) return;
    const previousRule = categoryRules.find(item => item.id === ruleId);
    const previousKeywords = previousRule ? keywordsForRule(previousRule.keyword) : [];
    const nextKeywords = keywordsForRule(cleanKeyword);
    setCategoryRules(previous => previous.map(item => item.id === ruleId ? { ...item, keyword: cleanKeyword, categoryId } : item));
    setCategories(previous => addKeywordsToCategory(removeUserKeywords(previous, previousKeywords), categoryId, nextKeywords));
    applyRuleToTransactions(nextKeywords, categoryId);
  };

  const deleteCategoryRule = (ruleId: string) => {
    const rule = categoryRules.find(item => item.id === ruleId);
    if (!rule) return;
    setCategoryRules(previous => previous.filter(item => item.id !== ruleId));
    setCategories(previous => removeUserKeywords(previous, keywordsForRule(rule.keyword)));
  };

  const removeMirroredReceivableDebt = (receivable: Receivable) => {
    const member = members.find(item => item.id === receivable.memberId);
    if (!member) return;
    const origin: Debt['origin'] = receivable.source === 'emprestimo_pix' ? 'emprestimo' : 'cartao';
    setDebts(previous => previous.filter(debt => {
      if (debt.type !== 'a_receber' || debt.origin !== origin) return true;
      if (normalizeText(debt.counterparty) !== normalizeText(member.name)) return true;
      const sameAmount = Math.abs((debt.totalAmount - debt.paidAmount) - (receivable.amount - receivable.paidAmount)) < 0.01
        || Math.abs(debt.totalAmount - receivable.amount) < 0.01;
      const sameDescription = !debt.note || !receivable.description || normalizeText(debt.note) === normalizeText(receivable.description);
      const shouldRemove = sameAmount && sameDescription;
      if (shouldRemove) rememberDeletedId(DELETED_DEBTS_KEY, debt.id);
      return !shouldRemove;
    }));
  };

  const addReceivable = (receivable: Receivable) => {
    if (members.some(member => member.id === receivable.memberId && member.isOwner)) return;
    removeMirroredReceivableDebt(receivable);
    setReceivables(previous => [receivable, ...previous.filter(item => item.id !== receivable.id)]);
  };

  const markReceivablePaid = (receivableId: string, amount?: number) => {
    setReceivables(previous => previous.map(item => {
      if (item.id !== receivableId) return item;
      const paidAmount = Math.min(item.amount, amount === undefined ? item.amount : item.paidAmount + amount);
      return { ...item, paidAmount, status: paidAmount >= item.amount ? 'quitado' : paidAmount > 0 ? 'parcial' : 'pendente' };
    }));
  };

  const deleteReceivable = (receivableId: string) => {
    setReceivables(previous => {
      const removed = previous.find(item => item.id === receivableId);
      if (!removed) return previous;
      rememberDeletedId(DELETED_RECEIVABLES_KEY, removed.id);
      removeMirroredReceivableDebt(removed);
      const remaining = previous.filter(item => item.id !== receivableId);
      if (removed.source !== 'divisao' || !removed.transactionId) return remaining;
      const siblings = remaining.filter(item => item.transactionId === removed.transactionId && item.source === 'divisao' && item.status !== 'quitado');
      if (!siblings.length) return remaining;
      const total = siblings.reduce((sum, item) => sum + item.amount, 0) + removed.amount;
      const share = total / siblings.length;
      return remaining.map(item => siblings.some(sibling => sibling.id === item.id) ? { ...item, amount: share } : item);
    });
  };

  const assignTransactionResponsible = (transactionId: string, memberId: string) => {
    if (members.some(member => member.id === memberId && member.isOwner)) return;
    const transaction = transactions.find(item => item.id === transactionId);
    setTransactions(previous => previous.map(item => item.id === transactionId ? { ...item, responsibleMemberId: memberId || undefined } : item));
    if (!memberId) {
      setReceivables(previous => previous.filter(item => !(item.transactionId === transactionId && item.source === 'responsavel')));
      return;
    }
    if (!transaction) return;
    setReceivables(previous => {
      const existing = previous.find(item => item.transactionId === transactionId && item.source === 'responsavel');
      const next: Receivable = {
        id: existing?.id || crypto.randomUUID(),
        memberId,
        source: 'responsavel',
        amount: transaction.amount,
        paidAmount: existing?.paidAmount || 0,
        date: transaction.date,
        description: transaction.description,
        transactionId,
        status: existing?.status || 'pendente',
      };
      return [next, ...previous.filter(item => item.id !== next.id)];
    });
  };

  const linkTransactionToDebt = (transactionId: string, debtId: string) => {
    setTransactions(previous => previous.map(item => item.id === transactionId ? { ...item, debtId } : item));
    setDebts(previous => previous.map(debt => debt.id === debtId && !debt.linkedTransactionIds.includes(transactionId)
      ? { ...debt, linkedTransactionIds: [...debt.linkedTransactionIds, transactionId] }
      : debt));
  };

  const exportData = () => {
    const payload = { transactions, debts, budgets, members, receivables, monthlyIncomes, paidInvoiceMonths, categories, categoryRules, aliases, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'controle-financeiro.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearAllData = () => {
    if (!window.confirm('Apagar todos os dados locais?')) return;
    localStorage.setItem(USER_CLEARED_DATA_KEY, new Date().toISOString());
    setTransactions([]);
    setDebts([]);
    setBudgets([]);
    setMembers([]);
    setReceivables([]);
    setMonthlyIncomes([]);
    setPaidInvoiceMonths([]);
    setCategories(DEFAULT_CATEGORIES);
    setCategoryRules([]);
    setAliases([]);
    setProcessedFiles([]);
    localStorage.removeItem('finance_category_rules_backfilled_v1');
    localStorage.removeItem('finance_installment_dates_fixed_v1');
    localStorage.setItem('finance_legacy_migration_version', 'user-cleared');
    localStorage.setItem('finance_income_cleanup_v2', 'true');
  };

  return (
    <FinanceContext.Provider value={{
      transactions,
      debts,
      budgets,
      members,
      receivables,
      monthlyIncomes,
      paidInvoiceMonths,
      categories,
      categoryRules,
      aliases,
      processedFiles,
      addTransactions,
      setTransactions,
      setDebts,
      setBudgets,
      setMembers,
      setReceivables,
      setMonthlyIncomes,
      setPaidInvoiceMonths,
      setCategories,
      setCategoryRules,
      setAliases,
      addIncome,
      markPastInvoicesPaid,
      equalizePastInvoiceIncomes,
      addDebt,
      addBudget,
      addMember,
      addAlias,
      addCategoryRule,
      updateCategoryRule,
      deleteCategoryRule,
      addReceivable,
      markReceivablePaid,
      deleteReceivable,
      assignTransactionResponsible,
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

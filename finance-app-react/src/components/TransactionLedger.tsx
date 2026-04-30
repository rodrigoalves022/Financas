import { useMemo } from 'react';
import { useFinance } from '../store/FinanceContext';
import { filterByMonth } from '../utils/analytics';
import { formatBRL, formatDate, normalizeMerchant } from '../utils/formatters';
import { DataTable, type Column } from './ui/DataTable';
import type { Transaction } from '../types';

export function TransactionLedger({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, debts, setTransactions, linkTransactionToDebt } = useFinance();
  const rows = useMemo(() => filterByMonth(transactions, selectedMonth), [transactions, selectedMonth]);

  const categoryName = (id: string) => categories.find(item => item.id === id)?.name || 'Outros';

  const updateCategory = (transactionId: string, categoryId: string) => {
    setTransactions(previous => previous.map(item => item.id === transactionId ? { ...item, categoryId } : item));
  };

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Data', accessor: row => formatDate(row.date), align: 'center', sortValue: row => row.date },
    { key: 'description', header: 'Descricao', accessor: row => row.description },
    { key: 'merchant', header: 'Local', accessor: row => row.normalizedMerchant || normalizeMerchant(row.description), filterable: true },
    { key: 'amount', header: 'Valor', accessor: row => row.amount, render: row => formatBRL(row.amount), align: 'right', sortValue: row => row.amount },
    { key: 'category', header: 'Categoria', accessor: row => categoryName(row.categoryId), align: 'center', render: row => (
      <select value={row.categoryId} onChange={event => updateCategory(row.id, event.target.value)}>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
    ) },
    { key: 'installment', header: 'Parcela', accessor: row => row.installment || '', align: 'center', render: row => row.installment || '' },
    { key: 'debt', header: 'Vinculo', accessor: row => debts.find(debt => debt.id === row.debtId)?.counterparty || '', align: 'center', render: row => (
      <select value={row.debtId || ''} onChange={event => event.target.value ? linkTransactionToDebt(row.id, event.target.value) : null}>
        <option value="">Sem vinculo</option>
        {debts.map(debt => <option key={debt.id} value={debt.id}>{debt.type === 'a_receber' ? 'Receber' : 'Pagar'} - {debt.counterparty}</option>)}
      </select>
    ) },
    { key: 'status', header: 'Status', accessor: row => row.status === 'possible_duplicate' ? 'Duplicado?' : 'OK', align: 'center', render: row => row.status === 'possible_duplicate' ? <span className="badge warning">Duplicado?</span> : <span className="badge success">OK</span> },
  ];

  return (
    <div className="table-card wide">
      <div className="chart-title-row">
        <h3>Transacoes</h3>
        <span className="muted">{selectedMonth ? 'Filtrado pelo mes selecionado' : 'Todo o periodo'}</span>
      </div>
      <DataTable rows={rows} columns={columns} searchPlaceholder="Buscar data, local, descricao, categoria..." initialPageSize={20} emptyLabel="Nenhuma transacao no periodo." />
    </div>
  );
}

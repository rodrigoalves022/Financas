import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { HandCoins, Pencil } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import { applyAlias, filterByMonth } from '../utils/analytics';
import { formatBRL, formatDate, normalizeMerchant } from '../utils/formatters';
import { DataTable, type Column } from './ui/DataTable';
import type { Member, Transaction } from '../types';

export function TransactionLedger({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, aliases, members, receivables, setTransactions, addAlias } = useFinance();
  const [aliasTransaction, setAliasTransaction] = useState<Transaction | null>(null);
  const [splitTransaction, setSplitTransaction] = useState<Transaction | null>(null);
  const rows = useMemo(() => filterByMonth(transactions, selectedMonth), [transactions, selectedMonth]);

  const categoryName = (id: string) => categories.find(item => item.id === id)?.name || 'Outros';
  const memberName = (id?: string) => members.find(member => member.id === id)?.name || 'Eu mesmo';
  const localName = (row: Transaction) => aliases.length ? applyAlias(row.description, aliases) : row.normalizedMerchant || normalizeMerchant(row.description);
  const payersOf = (row: Transaction) => {
    const linked = receivables.filter(item => item.transactionId === row.id && item.status !== 'quitado' && !members.some(member => member.id === item.memberId && member.isOwner));
    if (linked.length) return linked.map(item => memberName(item.memberId)).join(', ');
    return memberName(row.responsibleMemberId);
  };

  const updateCategory = (transactionId: string, categoryId: string) => {
    setTransactions(previous => previous.map(item => item.id === transactionId ? { ...item, categoryId } : item));
  };

  const updateNote = (transactionId: string, note: string) => {
    setTransactions(previous => previous.map(item => item.id === transactionId ? { ...item, note } : item));
  };

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Data', accessor: row => formatDate(row.date), align: 'center', sortValue: row => row.date },
    { key: 'description', header: 'Descricao', accessor: row => row.description, align: 'center' },
    { key: 'merchant', header: 'Local', accessor: row => localName(row), align: 'center', filterable: true },
    { key: 'amount', header: 'Valor', accessor: row => row.amount, render: row => formatBRL(row.amount), align: 'center', sortValue: row => row.amount },
    { key: 'category', header: 'Categoria', accessor: row => categoryName(row.categoryId), align: 'center', render: row => (
      <select value={row.categoryId} onChange={event => updateCategory(row.id, event.target.value)}>
        {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
    ) },
    { key: 'responsible', header: 'Vai pagar', accessor: row => payersOf(row), align: 'center' },
    { key: 'note', header: 'Nota', accessor: row => row.note || '', align: 'center', render: row => (
      <input className="inline-input" value={row.note || ''} onChange={event => updateNote(row.id, event.target.value)} placeholder="Observacao" />
    ) },
    { key: 'installment', header: 'Parcela', accessor: row => row.installment || '', align: 'center', render: row => row.installment || '-' },
    { key: 'actions', header: 'Acoes', accessor: () => '', align: 'center', sortable: false, filterable: false, render: row => (
      <div className="row-button-group">
        <button className="small-action" onClick={() => setAliasTransaction(row)} title="Definir alias do local"><Pencil size={14} /> Alias</button>
        <button className="small-action" onClick={() => setSplitTransaction(row)} title="Dividir compra"><HandCoins size={14} /> Dividir</button>
      </div>
    ) },
  ];

  return (
    <div className="table-card wide">
      <div className="chart-title-row">
        <h3>Transacoes</h3>
        <span className="muted">{selectedMonth ? 'Filtrado pela fatura selecionada' : 'Todo o periodo'}</span>
      </div>
      <DataTable rows={rows} columns={columns} searchPlaceholder="Buscar data, local, descricao, categoria..." initialPageSize={20} emptyLabel="Nenhuma transacao no periodo." />
      {aliasTransaction ? <AliasDialog transaction={aliasTransaction} currentAlias={localName(aliasTransaction)} onSave={addAlias} onClose={() => setAliasTransaction(null)} /> : null}
      {splitTransaction ? <SplitDialog transaction={splitTransaction} onClose={() => setSplitTransaction(null)} /> : null}
    </div>
  );
}

function AliasDialog({ transaction, currentAlias, onSave, onClose }: { transaction: Transaction; currentAlias: string; onSave: (original: string, alias: string) => void; onClose: () => void }) {
  const [alias, setAlias] = useState(currentAlias);
  const save = (event: FormEvent) => {
    event.preventDefault();
    onSave(transaction.description, alias);
    onClose();
  };

  return (
    <div className="modal-backdrop">
      <div className="modal compact-modal">
        <header className="modal-header">
          <div>
            <h2>Alias do estabelecimento</h2>
            <p>{transaction.description}</p>
          </div>
          <button className="icon-button" onClick={onClose}>x</button>
        </header>
        <form className="form-grid" onSubmit={save}>
          <label className="full">Nome correto do local<input autoFocus required value={alias} onChange={event => setAlias(event.target.value)} /></label>
          <button className="primary-button full" type="submit">Salvar alias</button>
        </form>
      </div>
    </div>
  );
}

function SplitDialog({
  transaction,
  onClose,
}: {
  transaction: Transaction;
  onClose: () => void;
}) {
  const { members, receivables, addMember, setReceivables, setTransactions } = useFinance();
  const chargeableMembers = useMemo(() => members.filter(member => !member.isOwner), [members]);
  const existingMembers = useMemo(() => receivables
    .filter(item => item.transactionId === transaction.id && item.source === 'divisao' && item.status !== 'quitado' && chargeableMembers.some(member => member.id === item.memberId))
    .map(item => item.memberId), [chargeableMembers, receivables, transaction.id]);
  const [selectedMembers, setSelectedMembers] = useState<string[]>(existingMembers);
  const [newMemberName, setNewMemberName] = useState('');
  const share = selectedMembers.length ? transaction.amount / selectedMembers.length : 0;

  const toggleMember = (memberId: string) => {
    setSelectedMembers(previous => previous.includes(memberId) ? previous.filter(item => item !== memberId) : [...previous, memberId]);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedMembers.length) {
      setReceivables(previous => previous.filter(item => !(item.transactionId === transaction.id && item.source === 'divisao')));
      setTransactions(previous => previous.map(item => item.id === transaction.id ? { ...item, responsibleMemberId: undefined } : item));
      onClose();
      return;
    }
    setReceivables(previous => [
      ...selectedMembers.map(memberId => {
        const existing = previous.find(item => item.transactionId === transaction.id && item.memberId === memberId && item.source === 'divisao');
        return {
          id: existing?.id || crypto.randomUUID(),
          memberId,
          source: 'divisao' as const,
          amount: share,
          paidAmount: existing?.paidAmount || 0,
          date: transaction.date,
          description: transaction.description,
          transactionId: transaction.id,
          status: existing?.status || 'pendente' as const,
        };
      }),
      ...previous.filter(item => !(item.transactionId === transaction.id && item.source === 'divisao')),
    ]);
    setTransactions(previous => previous.map(item => item.id === transaction.id ? { ...item, responsibleMemberId: selectedMembers.length === 1 ? selectedMembers[0] : undefined } : item));
    onClose();
  };

  const addQuickMember = () => {
    const name = newMemberName.trim();
    if (!name) return;
    const member: Member = { id: crypto.randomUUID(), name, nickname: '', contact: '', aliases: [] };
    addMember(member);
    setSelectedMembers(previous => [...previous, member.id]);
    setNewMemberName('');
  };

  return (
    <div className="modal-backdrop">
      <div className="modal compact-modal">
        <header className="modal-header">
          <div>
            <h2>Dividir compra</h2>
            <p>{transaction.description} - {formatBRL(transaction.amount)}</p>
          </div>
          <button className="icon-button" onClick={onClose}>x</button>
        </header>
        <form className="form-grid" onSubmit={save}>
          <label className="full">Adicionar pessoa rapido
            <div className="inline-form-row">
              <input value={newMemberName} onChange={event => setNewMemberName(event.target.value)} placeholder="Nome da pessoa" />
              <button type="button" className="secondary-button" onClick={addQuickMember}>Adicionar</button>
            </div>
          </label>
          <div className="member-picker full">
            {chargeableMembers.map(member => (
              <button type="button" key={member.id} className={selectedMembers.includes(member.id) ? 'selected' : ''} onClick={() => toggleMember(member.id)}>
                <strong>{member.name}</strong>
              </button>
            ))}
            {!chargeableMembers.length ? <span className="muted">Adicione uma pessoa acima para comecar.</span> : null}
          </div>
          <div className="split-summary full">
            <strong>{selectedMembers.length || 0} pessoa(s)</strong>
            <span>{selectedMembers.length === 1 ? `${formatBRL(transaction.amount)} para essa pessoa` : selectedMembers.length ? `${formatBRL(share)} para cada` : 'Clique nos nomes de quem vai pagar'}</span>
          </div>
          <button className="primary-button full" type="submit">{selectedMembers.length ? existingMembers.length ? 'Atualizar divisao' : 'Gerar cobrancas' : 'Remover divisao'}</button>
        </form>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { HandCoins, Pencil, RotateCcw, Trash2, UserPlus } from 'lucide-react';
import { useFinance } from '../store/FinanceContext';
import { useTools } from '../tools/useTools';
import { applyAlias, filterByMonth, getPossibleDuplicates, getPurchaseTransactions } from '../utils/analytics';
import { SOURCE_LABELS, isLowConfidence } from '../utils/categorizer';
import { formatBRL, formatDate, normalizeText, parseAmount, titleCase } from '../utils/formatters';
import { merchantKeyword, normalizeMerchant } from '../utils/merchant';
import { DataTable, type Column } from './ui/DataTable';
import { MobileTransactionCard } from './ui/MobileTransactionCard';
import { Avatar, Badge, Field } from './ui/Card';
import { Modal } from './ui/Modal';
import { useFeedback } from './ui/feedback';
import type { Transaction } from '../types';

export type QuickFilter = 'todas' | 'revisar' | 'manuais' | 'parceladas' | 'divididas' | 'duplicadas';

// Edita localmente e só grava ao sair do campo: gravar a cada tecla regravava
// todas as transações no IndexedDB e re-renderizava a tabela inteira.
// A observação é da compra: numa parcelada, vale para todas as parcelas dela.
function NoteInput({ transaction, className }: { transaction: Transaction; className?: string }) {
  const { callTool } = useTools();
  const [value, setValue] = useState(transaction.note || '');
  const commit = () => {
    if ((transaction.note || '') !== value.trim()) callTool('atualizar_nota_transacao', { transactionId: transaction.id, note: value, samePurchase: true });
  };
  return (
    <input
      className={className || 'inline-input'}
      value={value}
      onChange={event => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={event => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
      placeholder="Observação"
    />
  );
}

export function TransactionLedger({ selectedMonth, initialFilter = 'todas', initialCategory = '', initialSearch = '' }: {
  selectedMonth: string;
  initialFilter?: QuickFilter;
  initialCategory?: string;
  initialSearch?: string;
}) {
  const { transactions, categories, aliases, members, receivables } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const [identifyTransaction, setIdentifyTransaction] = useState<Transaction | null>(null);
  const [splitTransaction, setSplitTransaction] = useState<Transaction | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(initialFilter);
  const [categoryFilter, setCategoryFilter] = useState(initialCategory);

  const monthRows = useMemo(() => filterByMonth(transactions, selectedMonth).filter(row => row.type === 'expense'), [transactions, selectedMonth]);
  const duplicateIds = useMemo(() => new Set(getPossibleDuplicates(monthRows).flat().map(item => item.id)), [monthRows]);
  const splitIds = useMemo(() => new Set(receivables.filter(item => item.transactionId).map(item => item.transactionId as string)), [receivables]);
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);

  const counts = useMemo(() => ({
    todas: monthRows.length,
    revisar: monthRows.filter(row => !row.manualCategory && isLowConfidence(row.categorySource)).length,
    manuais: monthRows.filter(row => row.source === 'manual').length,
    parceladas: monthRows.filter(row => row.installment).length,
    divididas: monthRows.filter(row => splitIds.has(row.id)).length,
    duplicadas: monthRows.filter(row => duplicateIds.has(row.id)).length,
  }), [monthRows, splitIds, duplicateIds]);

  const rows = useMemo(() => monthRows.filter(row => {
    if (categoryFilter && row.categoryId !== categoryFilter) return false;
    if (quickFilter === 'revisar') return !row.manualCategory && isLowConfidence(row.categorySource);
    if (quickFilter === 'manuais') return row.source === 'manual';
    if (quickFilter === 'parceladas') return Boolean(row.installment);
    if (quickFilter === 'divididas') return splitIds.has(row.id);
    if (quickFilter === 'duplicadas') return duplicateIds.has(row.id);
    return true;
  }), [monthRows, quickFilter, categoryFilter, splitIds, duplicateIds]);

  const localName = (row: Transaction) => titleCase(applyAlias(row.description, aliases));
  const payersOf = (row: Transaction) => receivables
    .filter(item => item.transactionId === row.id && item.status !== 'quitado')
    .map(item => members.find(member => member.id === item.memberId)?.name)
    .filter((name): name is string => Boolean(name));

  const updateCategory = async (row: Transaction, categoryId: string) => {
    await callTool('atualizar_categoria_transacao', { transactionId: row.id, categoryId });
    const keyword = merchantKeyword(row.description);
    const siblings = transactions.filter(item => item.id !== row.id && applyAlias(item.description, aliases) === applyAlias(row.description, aliases)).length;
    toast(`Categoria alterada para ${categoryById.get(categoryId)?.name || categoryId}.`, 'success', {
      label: siblings ? `Aplicar às outras ${siblings} compras de ${localName(row)}` : `Criar regra "${titleCase(keyword)}" para as próximas`,
      onClick: async () => {
        const result = await callTool<{ ruleKeyword: string; updated: number }>('aplicar_categoria_local', { transactionId: row.id, categoryId });
        if (result.success) toast(`Regra "${result.data?.ruleKeyword}" criada — vale para compras atuais e futuras.`);
        else toast(result.message, 'error');
      },
    });
  };

  const removeManual = async (row: Transaction) => {
    if (!await confirm({ title: 'Excluir lançamento manual?', message: `${row.description} · ${formatBRL(row.amount)}`, confirmLabel: 'Excluir', tone: 'danger' })) return;
    const result = await callTool('excluir_transacao', { transactionId: row.id });
    toast(result.success ? 'Lançamento excluído.' : result.message, result.success ? 'success' : 'error');
  };

  const categorySelect = (row: Transaction, className?: string) => (
    <select className={className} value={row.categoryId} onChange={event => updateCategory(row, event.target.value)}>
      {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
    </select>
  );

  const whyBadge = (row: Transaction) => {
    const source = row.manualCategory ? 'manual' : row.categorySource;
    if (!source) return null;
    const weak = isLowConfidence(source);
    return <Badge tone={weak ? 'warn' : source === 'manual' ? 'accent' : 'neutral'} title={SOURCE_LABELS[source]}>{weak ? 'revisar' : source === 'manual' ? 'manual' : source === 'regra' ? 'regra' : 'auto'}</Badge>;
  };

  const actions = (row: Transaction) => (
    <div className="row-actions">
      <button className="icon-button sm ghost" onClick={() => setIdentifyTransaction(row)} title="Identificar compra: observação ou apelido do local"><Pencil size={14} /></button>
      <button className="icon-button sm ghost" onClick={() => setSplitTransaction(row)} title="Dividir compra"><HandCoins size={14} /></button>
      {row.source === 'manual' ? <button className="icon-button sm ghost danger" onClick={() => removeManual(row)} title="Excluir lançamento manual"><Trash2 size={14} /></button> : null}
    </div>
  );

  const columns: Column<Transaction>[] = [
    { key: 'date', header: 'Data', accessor: row => formatDate(row.date), sortValue: row => row.date, width: 96 },
    {
      key: 'merchant', header: 'Local', accessor: row => `${localName(row)} ${row.description}`, render: row => (
        <div className="merchant-cell">
          <strong>{localName(row)} {row.source === 'manual' ? <Badge tone="info">manual</Badge> : null} {duplicateIds.has(row.id) ? <Badge tone="warn">duplicada?</Badge> : null}</strong>
          <small title={row.description}>{row.description}</small>
        </div>
      ),
    },
    { key: 'category', header: 'Categoria', accessor: row => categoryById.get(row.categoryId)?.name || 'Outros', width: 290, render: row => <div className="category-cell">{categorySelect(row)}{whyBadge(row)}</div> },
    { key: 'amount', header: 'Valor', align: 'right', accessor: row => row.amount, render: row => <strong className="num">{formatBRL(row.amount)}</strong> },
    { key: 'installment', header: 'Parcela', align: 'center', accessor: row => row.installment || '', render: row => row.installment ? <Badge>{row.installment}</Badge> : <span className="muted">—</span>, width: 80 },
    {
      key: 'responsible', header: 'Dividido com', accessor: row => payersOf(row).join(', '), render: row => {
        const names = payersOf(row);
        return names.length ? <span className="nowrap" title={names.join(', ')}>{names.slice(0, 3).map(name => <Avatar key={name} name={name} size="sm" />)}</span> : <span className="muted">—</span>;
      },
    },
    { key: 'note', header: 'Nota', accessor: row => row.note || '', render: row => <NoteInput key={`${row.id}-${row.note || ''}`} transaction={row} /> },
    { key: 'actions', header: '', sortable: false, filterable: false, accessor: () => '', render: actions, width: 110 },
  ];

  const filterChips: Array<{ id: QuickFilter; label: string }> = [
    { id: 'todas', label: 'Todas' },
    { id: 'revisar', label: 'A revisar' },
    { id: 'manuais', label: 'Manuais' },
    { id: 'parceladas', label: 'Parceladas' },
    { id: 'divididas', label: 'Divididas' },
    { id: 'duplicadas', label: 'Possíveis duplicatas' },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={row => row.id}
        initialSort={{ key: 'date', direction: 'desc' }}
        searchPlaceholder="Buscar local, descrição, valor..."
        initialSearch={initialSearch}
        initialPageSize={25}
        emptyLabel="Nenhuma transação com esses filtros."
        toolbar={(
          <>
            <div className="chip-row">
              {filterChips.filter(chip => chip.id === 'todas' || counts[chip.id]).map(chip => (
                <button key={chip.id} type="button" className={`chip ${quickFilter === chip.id ? 'active' : ''}`} onClick={() => setQuickFilter(chip.id)}>
                  {chip.label} <span className="chip-count">{counts[chip.id]}</span>
                </button>
              ))}
            </div>
            <select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)} style={{ width: 200 }} aria-label="Filtrar por categoria">
              <option value="">Todas as categorias</option>
              {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
          </>
        )}
        mobileRender={row => (
          <MobileTransactionCard
            title={localName(row)}
            subtitle={`${formatDate(row.date)}${row.installment ? ` · ${row.installment}` : ''}`}
            value={formatBRL(row.amount)}
            description={row.description}
            actions={actions(row)}
          >
            <div className="mobile-card-grid">
              <label>Categoria {categorySelect(row)}</label>
              <div>{whyBadge(row)}</div>
            </div>
            <NoteInput key={`${row.id}-${row.note || ''}-m`} transaction={row} className="inline-input mobile-note" />
          </MobileTransactionCard>
        )}
      />
      {identifyTransaction ? <IdentifyDialog transaction={identifyTransaction} onClose={() => setIdentifyTransaction(null)} /> : null}
      {splitTransaction ? <SplitDialog transaction={splitTransaction} onClose={() => setSplitTransaction(null)} /> : null}
    </>
  );
}

/**
 * Duas formas de identificar um lançamento, com o alcance de cada uma à vista:
 * a observação é desta compra (e das parcelas dela); o apelido renomeia o local
 * inteiro. Antes só existia o apelido, e "celular" numa compra do Mercado Livre
 * virava o nome de todas as compras de lá.
 */
function IdentifyDialog({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const { transactions, aliases } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const merchantKey = normalizeMerchant(transaction.description);
  const currentAlias = aliases.find(item => normalizeMerchant(item.original) === merchantKey)?.alias || '';
  const purchaseSize = useMemo(() => getPurchaseTransactions(transaction, transactions).length, [transaction, transactions]);
  const merchantCount = useMemo(() => transactions.filter(item => normalizeMerchant(item.description) === merchantKey).length, [transactions, merchantKey]);
  const [note, setNote] = useState(transaction.note || '');
  const [alias, setAlias] = useState(currentAlias);
  const aliasChanged = normalizeText(alias) !== normalizeText(currentAlias);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const done: string[] = [];
    if (note.trim() !== (transaction.note || '').trim()) {
      const result = await callTool<{ updated: number }>('atualizar_nota_transacao', { transactionId: transaction.id, note, samePurchase: true });
      if (!result.success) {
        toast(result.message, 'error');
        return;
      }
      const updated = result.data?.updated || 1;
      done.push(note.trim() ? `Observação salva${updated > 1 ? ` nas ${updated} parcelas` : ''}` : 'Observação removida');
    }
    if (aliasChanged) {
      await callTool('criar_alias', { original: transaction.description, alias });
      done.push(alias.trim() ? `Apelido aplicado a ${merchantCount} compra(s) do local` : 'Local voltou ao nome do extrato');
    }
    if (done.length) toast(`${done.join(' · ')}.`);
    onClose();
  };

  return (
    <Modal title="Identificar compra" subtitle={`${transaction.description} · ${formatBRL(transaction.amount)}${transaction.installment ? ` · ${transaction.installment}` : ''}`} onClose={onClose}
      footer={(
        <>
          <Link to="/categorias?aba=apelidos" className="link-button modal-footer-start" onClick={onClose}>Ver todos os apelidos</Link>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="identify-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="identify-form" className="form-grid" onSubmit={save}>
        <Field
          full
          label="Observação desta compra"
          hint={transaction.installment
            ? `Vale para ${purchaseSize > 1 ? `as ${purchaseSize} parcelas já importadas` : 'esta parcela'} e para as próximas que chegarem. Aparece na busca e nos compromissos.`
            : 'Vale só para esta compra. Aparece na busca e na fatura.'}
        >
          <input autoFocus value={note} onChange={event => setNote(event.target.value)} placeholder="Ex.: celular, lanternagem do carro" />
        </Field>

        <div className="form-divider full" />

        <Field
          full
          label="Apelido do local"
          hint={`Renomeia ${merchantCount === 1 ? 'a única compra' : `as ${merchantCount} compras`} de ${titleCase(merchantKey)} em todas as telas e junta maquininhas diferentes do mesmo lugar.`}
        >
          <input value={alias} onChange={event => setAlias(event.target.value)} placeholder={titleCase(merchantKey)} />
        </Field>
        {currentAlias ? (
          <div className="full identify-alias-row">
            <span className="muted">Hoje aparece como <strong>{currentAlias}</strong>.</span>
            <button type="button" className="ghost-button sm" onClick={() => setAlias('')} disabled={!alias}><RotateCcw size={14} /> Voltar ao nome do extrato</button>
          </div>
        ) : null}
        {aliasChanged && alias.trim() && merchantCount > 1 ? (
          <p className="full text-warn identify-warning">
            O apelido troca o nome das {merchantCount} compras deste local. Para marcar só esta, use a observação acima.
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

function SplitDialog({ transaction, onClose }: { transaction: Transaction; onClose: () => void }) {
  const { members, receivables } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const owner = members.find(member => member.isOwner);
  const existing = receivables.filter(item => item.transactionId === transaction.id && item.source === 'divisao');
  const [selected, setSelected] = useState<string[]>(() => existing.length ? [...(owner ? [owner.id] : []), ...existing.map(item => item.memberId)] : []);
  const [custom, setCustom] = useState(false);
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(existing.map(item => [item.memberId, String(item.amount)])));
  const [newMemberName, setNewMemberName] = useState('');

  const equalShare = selected.length ? transaction.amount / selected.length : 0;
  const customTotal = selected.reduce((sum, id) => sum + parseAmount(shares[id] || '0'), 0);
  const chargeable = selected.filter(id => id !== owner?.id);

  const toggle = (memberId: string) => setSelected(previous => previous.includes(memberId) ? previous.filter(id => id !== memberId) : [...previous, memberId]);

  const addQuickMember = async () => {
    const name = newMemberName.trim();
    if (!name) return;
    const result = await callTool<{ memberId: string }>('cadastrar_membro', { member: { id: crypto.randomUUID(), name, aliases: [] } });
    if (result.data?.memberId) setSelected(previous => Array.from(new Set([...previous, result.data!.memberId])));
    setNewMemberName('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const customShares = custom ? Object.fromEntries(selected.map(id => [id, parseAmount(shares[id] || '0')])) : undefined;
    const result = await callTool<{ charged: number }>('dividir_compra', { transactionId: transaction.id, memberIds: selected, customShares });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(result.data?.charged ? `${result.data.charged} cobrança(s) gerada(s) em Pessoas e cobranças.` : 'Divisão removida.');
    onClose();
  };

  return (
    <Modal title="Dividir compra" subtitle={`${transaction.description} · ${formatBRL(transaction.amount)}`} onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="split-form" className="primary-button">{chargeable.length ? existing.length ? 'Atualizar divisão' : 'Gerar cobranças' : 'Remover divisão'}</button>
        </>
      )}>
      <form id="split-form" className="form-grid" onSubmit={save}>
        <div className="full field">
          <span className="field-label">Quem participou</span>
          <div className="member-picker">
            {members.map(member => (
              <button type="button" key={member.id} className={`member-option ${selected.includes(member.id) ? 'selected' : ''}`} onClick={() => toggle(member.id)}>
                <Avatar name={member.name} size="sm" />
                {member.isOwner ? `${member.name} (você)` : member.name}
              </button>
            ))}
          </div>
          <small className="field-hint">Você entra na conta das partes, mas nunca vira cobrança.</small>
        </div>
        <div className="full inline-form">
          <label className="field">
            <span className="field-label">Adicionar pessoa</span>
            <input value={newMemberName} onChange={event => setNewMemberName(event.target.value)} placeholder="Nome" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addQuickMember(); } }} />
          </label>
          <button type="button" className="secondary-button" onClick={addQuickMember}><UserPlus size={15} /> Adicionar</button>
        </div>
        <label className="check-line full">
          <input type="checkbox" checked={custom} onChange={event => setCustom(event.target.checked)} />
          Valores diferentes para cada pessoa
        </label>
        {custom ? (
          <div className="full" style={{ display: 'grid', gap: 8 }}>
            {selected.map(id => {
              const member = members.find(item => item.id === id);
              return (
                <div className="split-row" key={id}>
                  <span>{member?.isOwner ? `${member.name} (você)` : member?.name}</span>
                  <input type="number" step="0.01" inputMode="decimal" value={shares[id] ?? ''} onChange={event => setShares(previous => ({ ...previous, [id]: event.target.value }))} placeholder={equalShare.toFixed(2)} />
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="split-summary full">
          <strong>{selected.length} participante(s)</strong>
          <span className={custom && Math.abs(customTotal - transaction.amount) > 0.01 ? 'text-warn' : 'muted'}>
            {custom
              ? `Soma ${formatBRL(customTotal)} de ${formatBRL(transaction.amount)}`
              : selected.length ? `${formatBRL(equalShare)} para cada` : 'Toque nos nomes de quem participou'}
          </span>
        </div>
      </form>
    </Modal>
  );
}

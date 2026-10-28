import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FormEvent } from 'react';
import { Check, Clock, Copy, HandCoins, History, MessageCircle, Pencil, Plus, Trash2, Undo2, UserPlus, Users } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { getPeopleIOwe, getPeopleWhoOweMe, oldestPendingDays, type OwedItem, type PersonOwing } from '../../utils/analytics';
import { daysBetween, formatBRL, formatDate, normalizeText, parseAmount, todayISO } from '../../utils/formatters';
import { Avatar, Badge, Card, Field, StatCard, Tabs } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { DeleteMemberResult } from '../../tools/membros/membros.tool';
import type { Member } from '../../types';

type TabId = 'receber' | 'pessoas' | 'historico';

const ORIGIN_LABEL: Record<string, string> = {
  divisao: 'Divisão de compra',
  emprestimo_pix: 'Empréstimo / Pix',
  responsavel: 'Compra no seu cartão',
};
const originLabel = (item: OwedItem) => item.kind === 'debt' ? 'Registro manual' : ORIGIN_LABEL[item.origin] || item.origin;

const chargeMessage = (person: PersonOwing) => [
  `Oi, ${person.name.split(' ')[0]}! Passando para lembrar dos valores em aberto:`,
  ...person.items.map(item => `• ${formatDate(item.date)} — ${item.description}: ${formatBRL(item.remaining)}`),
  `Total: ${formatBRL(person.total)}`,
  'Obrigado! 🙂',
].join('\n');

const whatsappUrl = (contact: string | undefined, text: string) => {
  const digits = (contact || '').replace(/\D/g, '');
  const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits.length >= 12 ? digits : '';
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
};

export function PessoasPage() {
  const { receivables, debts, members, transactions } = useFinance();
  const [tab, setTab] = useState<TabId>('receber');
  // Vindo do Painel com ?pessoa=Nome: destaca e rola até o card dela.
  const [searchParams] = useSearchParams();
  const focusName = normalizeText(searchParams.get('pessoa') || '');
  const [showReceivable, setShowReceivable] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [creatingMember, setCreatingMember] = useState(false);

  const people = useMemo(() => getPeopleWhoOweMe(receivables, debts, members, transactions), [receivables, debts, members, transactions]);
  const total = people.reduce((sum, person) => sum + person.total, 0);
  const oldest = people.reduce((max, person) => Math.max(max, oldestPendingDays(person)), 0);
  const today = todayISO();
  const received30 = receivables.filter(item => item.paidAt && daysBetween(item.paidAt, today) <= 30).reduce((sum, item) => sum + item.paidAmount, 0);
  const history = receivables.filter(item => item.paidAmount > 0).sort((a, b) => (b.paidAt || b.date).localeCompare(a.paidAt || a.date));

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard label="Total a receber" value={formatBRL(total)} tone="good" icon={<HandCoins size={16} />} active={tab === 'receber'} onClick={() => setTab('receber')} />
        <StatCard label="Pessoas devendo" value={people.length} hint={`${members.filter(member => !member.isOwner).length} cadastrada(s)`} icon={<Users size={16} />} active={tab === 'pessoas'} onClick={() => setTab('pessoas')} />
        <StatCard label="Cobrança mais antiga" value={people.length ? `${oldest} dias` : '—'} tone={oldest > 30 ? 'warn' : 'neutral'} icon={<Clock size={16} />} onClick={() => setTab('receber')} />
        <StatCard label="Recebido em 30 dias" value={formatBRL(received30)} icon={<Check size={16} />} active={tab === 'historico'} onClick={() => setTab('historico')} />
      </div>

      <div className="toolbar-row">
        <Tabs<TabId> value={tab} onChange={setTab} tabs={[
          { id: 'receber', label: 'A receber', icon: <HandCoins size={15} />, count: people.length },
          { id: 'pessoas', label: 'Pessoas', icon: <Users size={15} />, count: members.length },
          { id: 'historico', label: 'Recebidos', icon: <History size={15} />, count: history.length },
        ]} />
        <div className="actions">
          <button type="button" className="secondary-button" onClick={() => setCreatingMember(true)}><UserPlus size={15} /> Pessoa</button>
          <button type="button" className="primary-button" onClick={() => setShowReceivable(true)}><Plus size={15} /> Valor a receber</button>
        </div>
      </div>

      {tab === 'receber' ? (
        people.length ? (
          <div className="person-grid">
            {people.map(person => <PersonCard key={person.memberId || person.name} person={person} highlighted={Boolean(focusName) && normalizeText(person.name) === focusName} />)}
          </div>
        ) : (
          <Card span="full"><EmptyState icon={<HandCoins size={22} />} title="Ninguém te devendo" description="Divida uma compra na Fatura ou registre um empréstimo/Pix para acompanhar aqui." /></Card>
        )
      ) : null}

      {tab === 'pessoas' ? <MembersList onEdit={setEditingMember} /> : null}

      {tab === 'historico' ? (
        <Card span="full" title="Recebimentos registrados" subtitle="Reabra se marcou como recebido por engano.">
          {history.length ? (
            <div className="list">
              {history.slice(0, 200).map(item => <HistoryRow key={item.id} receivableId={item.id} />)}
            </div>
          ) : <EmptyState compact title="Nenhum recebimento registrado ainda." />}
        </Card>
      ) : null}

      {showReceivable ? <ReceivableModal onClose={() => setShowReceivable(false)} /> : null}
      {creatingMember || editingMember ? <MemberModal member={editingMember} onClose={() => { setCreatingMember(false); setEditingMember(null); }} /> : null}
    </div>
  );
}

function PersonCard({ person, highlighted = false }: { person: PersonOwing; highlighted?: boolean }) {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
    return () => window.clearTimeout(timer);
  }, [highlighted]);
  const { members } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const [partial, setPartial] = useState<{ item?: OwedItem } | null>(null);
  const [editing, setEditing] = useState<OwedItem | null>(null);
  const member = members.find(item => item.id === person.memberId);
  const days = oldestPendingDays(person);
  const message = chargeMessage(person);

  const receiveItem = async (item: OwedItem) => {
    if (item.kind === 'receivable') await callTool('marcar_cobranca_recebida', { receivableId: item.id });
    else await callTool('quitar_divida', { debtId: item.id });
    toast(`${formatBRL(item.remaining)} de ${person.name} marcado como recebido.`);
  };

  const receiveAll = async () => {
    if (!await confirm({ title: `Receber tudo de ${person.name}?`, message: `Quita ${person.items.length} pendência(s), total de ${formatBRL(person.total)}.`, confirmLabel: 'Quitar tudo' })) return;
    await callTool('receber_da_pessoa', { memberId: person.memberId, name: person.name });
    toast(`${person.name} quitou ${formatBRL(person.total)}.`);
  };

  const removeItem = async (item: OwedItem) => {
    if (!await confirm({ title: 'Excluir pendência?', message: `${item.description} · ${formatBRL(item.remaining)}`, confirmLabel: 'Excluir', tone: 'danger' })) return;
    if (item.kind === 'receivable') await callTool('excluir_cobranca', { receivableId: item.id });
    else await callTool('excluir_divida', { debtId: item.id });
    toast('Pendência excluída.');
  };

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast('Mensagem de cobrança copiada.');
    } catch {
      toast('Não consegui copiar — use o botão do WhatsApp.', 'error');
    }
  };

  return (
    <section ref={cardRef} className={`card person-card ${highlighted ? 'highlight' : ''}`}>
      <div className="person-head">
        <Avatar name={person.name} size="lg" />
        <div className="grow">
          <strong>{person.name}</strong>
          <small>{person.items.length} pendência(s) · mais antiga há {days} dia(s) {days > 30 ? <Badge tone="warn">atrasada</Badge> : null}</small>
        </div>
        <div className="person-total">
          <strong className="text-good">{formatBRL(person.total)}</strong>
          <small>a receber</small>
        </div>
      </div>

      <div className="owed-list">
        {person.items.map(item => (
          <div className="owed-item" key={`${item.kind}-${item.id}`}>
            <div className="grow">
              <strong title={item.description}>{item.description}</strong>
              <small>{formatDate(item.date)} · {originLabel(item)}</small>
            </div>
            <span className="amount">{formatBRL(item.remaining)}</span>
            <div className="row-actions">
              <button type="button" className="icon-button sm ghost" onClick={() => receiveItem(item)} title="Marcar como recebido"><Check size={14} /></button>
              <button type="button" className="icon-button sm ghost" onClick={() => setEditing(item)} title="Editar"><Pencil size={14} /></button>
              <button type="button" className="icon-button sm ghost danger" onClick={() => removeItem(item)} title="Excluir"><Trash2 size={14} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="card-footer-actions">
        <button type="button" className="secondary-button" onClick={receiveAll}><Check size={15} /> Receber tudo</button>
        <button type="button" className="secondary-button" onClick={() => setPartial({})}>Recebi uma parte</button>
        <a className="secondary-button" href={whatsappUrl(member?.contact, message)} target="_blank" rel="noreferrer" title={member?.contact ? `Enviar para ${member.contact}` : 'Cadastre o WhatsApp da pessoa para abrir direto na conversa'}>
          <MessageCircle size={15} /> Cobrar
        </a>
        <button type="button" className="icon-button" onClick={copyMessage} title="Copiar mensagem de cobrança"><Copy size={15} /></button>
      </div>

      {partial ? <PartialModal person={person} onClose={() => setPartial(null)} /> : null}
      {editing ? <EditItemModal item={editing} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

function PartialModal({ person, onClose }: { person: PersonOwing; onClose: () => void }) {
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [amount, setAmount] = useState('');

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = Math.min(parseAmount(amount), person.total);
    if (value <= 0) return;
    const result = await callTool<{ paid: number }>('receber_da_pessoa', { memberId: person.memberId, name: person.name, amount: value });
    toast(`${formatBRL(result.data?.paid || 0)} abatido(s) de ${person.name}, das pendências mais antigas para as mais novas.`);
    onClose();
  };

  return (
    <Modal size="sm" title={`Recebimento de ${person.name}`} subtitle={`Em aberto: ${formatBRL(person.total)}`} onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="partial-form" className="primary-button">Registrar</button>
        </>
      )}>
      <form id="partial-form" className="form-grid" onSubmit={save}>
        <Field label="Quanto você recebeu" hint="Abate primeiro as pendências mais antigas." full>
          <input type="number" step="0.01" min="0.01" max={person.total} inputMode="decimal" required autoFocus value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" />
        </Field>
      </form>
    </Modal>
  );
}

function EditItemModal({ item, onClose }: { item: OwedItem; onClose: () => void }) {
  const { debts } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const debt = item.kind === 'debt' ? debts.find(row => row.id === item.id) : undefined;
  const [amount, setAmount] = useState(String(debt ? debt.totalAmount : item.remaining));
  const [description, setDescription] = useState(item.description);
  const [date, setDate] = useState(item.date.substring(0, 10));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const value = parseAmount(amount);
    if (value <= 0) return;
    if (item.kind === 'receivable') {
      await callTool('atualizar_cobranca', { receivableId: item.id, amount: value, description, date });
    } else if (debt) {
      await callTool('cadastrar_divida', { debt: { ...debt, totalAmount: value, paidAmount: Math.min(debt.paidAmount, value), note: description.trim() || debt.note, startDate: date } });
    }
    toast('Pendência atualizada.');
    onClose();
  };

  return (
    <Modal size="sm" title="Editar pendência" subtitle={originLabel(item)} onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="edit-item-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="edit-item-form" className="form-grid" onSubmit={save}>
        <Field label="Valor total"><input required type="number" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} /></Field>
        <Field label="Data"><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="Descrição" full><input value={description} onChange={event => setDescription(event.target.value)} /></Field>
        {debt && debt.paidAmount > 0 ? <p className="muted full" style={{ margin: 0, fontSize: 12.5 }}>Já recebido: {formatBRL(debt.paidAmount)}.</p> : null}
      </form>
    </Modal>
  );
}

function ReceivableModal({ onClose }: { onClose: () => void }) {
  const { members } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const chargeable = members.filter(member => !member.isOwner);
  const [memberId, setMemberId] = useState(chargeable[0]?.id || '');
  const [newName, setNewName] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO());

  const save = async (event: FormEvent) => {
    event.preventDefault();
    let targetId = memberId;
    if (memberId === '__new__') {
      const created = await callTool<{ memberId: string }>('cadastrar_membro', { member: { id: crypto.randomUUID(), name: newName, aliases: [] } });
      if (!created.success || !created.data) {
        toast(created.message, 'error');
        return;
      }
      targetId = created.data.memberId;
    }
    const result = await callTool('registrar_emprestimo_pix', {
      receivable: { id: crypto.randomUUID(), memberId: targetId, source: 'emprestimo_pix', amount: parseAmount(amount), paidAmount: 0, date, description: description.trim() || 'Valor a receber', status: 'pendente' },
    });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast('Valor a receber registrado.');
    onClose();
  };

  return (
    <Modal title="Registrar valor a receber" subtitle="Dinheiro ou Pix emprestado fora do cartão. Compras do cartão você divide direto na Fatura." onClose={onClose} icon={<HandCoins size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="receivable-form" className="primary-button">Registrar</button>
        </>
      )}>
      <form id="receivable-form" className="form-grid" onSubmit={save}>
        <Field label="Quem te deve">
          <select required value={memberId} onChange={event => setMemberId(event.target.value)}>
            {chargeable.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
            <option value="__new__">+ Nova pessoa…</option>
          </select>
        </Field>
        {memberId === '__new__' ? <Field label="Nome"><input required autoFocus value={newName} onChange={event => setNewName(event.target.value)} /></Field> : null}
        <Field label="Valor"><input required type="number" step="0.01" min="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0,00" /></Field>
        <Field label="Data"><input required type="date" value={date} onChange={event => setDate(event.target.value)} /></Field>
        <Field label="Descrição" full><input value={description} onChange={event => setDescription(event.target.value)} placeholder="Ex.: Pix emprestado, almoço" /></Field>
      </form>
    </Modal>
  );
}

function MembersList({ onEdit }: { onEdit: (member: Member) => void }) {
  const { members, receivables, debts, transactions } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();

  const balances = useMemo(() => {
    const owesMe = getPeopleWhoOweMe(receivables, debts, members, transactions);
    const iOwe = getPeopleIOwe(debts, transactions);
    return new Map(members.map(member => {
      const key = normalizeText(member.name);
      const credit = owesMe.filter(person => person.memberId === member.id || normalizeText(person.name) === key).reduce((sum, person) => sum + person.total, 0);
      const debit = iOwe.filter(person => normalizeText(person.name) === key).reduce((sum, person) => sum + person.total, 0);
      return [member.id, { credit, debit }];
    }));
  }, [members, receivables, debts, transactions]);

  const remove = async (member: Member) => {
    if (!await confirm({ title: `Excluir ${member.name}?`, message: 'Cobranças já quitadas dessa pessoa também serão removidas.', confirmLabel: 'Excluir', tone: 'danger' })) return;
    const result = await callTool<DeleteMemberResult>('excluir_membro', { memberId: member.id });
    toast(result.data?.deleted ? `${member.name} foi excluído(a).` : result.data?.reason || 'Não foi possível excluir.', result.data?.deleted ? 'success' : 'error');
  };

  return (
    <Card span="full" title="Pessoas cadastradas" subtitle="Usadas em divisões, empréstimos e no bot do Telegram. Cadastre o WhatsApp para cobrar com um toque.">
      <div className="list">
        {[...members].sort((a, b) => Number(Boolean(b.isOwner)) - Number(Boolean(a.isOwner)) || a.name.localeCompare(b.name, 'pt-BR')).map(member => {
          const balance = balances.get(member.id) || { credit: 0, debit: 0 };
          return (
            <div className="list-row" key={member.id}>
              <Avatar name={member.name} />
              <div className="grow">
                <span className="title">{member.name} {member.isOwner ? <Badge tone="accent">titular</Badge> : null}</span>
                <span className="subtitle">{[member.nickname, member.contact].filter(Boolean).join(' · ') || 'Sem apelido ou contato'}</span>
              </div>
              {balance.credit ? <Badge tone="good">te deve {formatBRL(balance.credit)}</Badge> : null}
              {balance.debit ? <Badge tone="bad">você deve {formatBRL(balance.debit)}</Badge> : null}
              <div className="row-actions">
                <button type="button" className="icon-button sm ghost" onClick={() => onEdit(member)} title="Editar"><Pencil size={14} /></button>
                <button type="button" className="icon-button sm ghost danger" disabled={member.isOwner || balance.credit > 0 || balance.debit > 0} onClick={() => remove(member)}
                  title={member.isOwner ? 'O titular não pode ser excluído' : balance.credit || balance.debit ? 'Quite os valores em aberto antes' : 'Excluir'}><Trash2 size={14} /></button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function HistoryRow({ receivableId }: { receivableId: string }) {
  const { receivables, members } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const item = receivables.find(row => row.id === receivableId);
  if (!item) return null;
  const member = members.find(row => row.id === item.memberId);
  return (
    <div className="list-row">
      <Avatar name={member?.name || '?'} size="sm" />
      <div className="grow">
        <span className="title">{member?.name || 'Pessoa removida'} · {item.description}</span>
        <span className="subtitle">{item.paidAt ? `Recebido em ${formatDate(item.paidAt)}` : 'Recebido'} · {ORIGIN_LABEL[item.source] || item.source}</span>
      </div>
      <Badge tone={item.status === 'quitado' ? 'good' : 'warn'}>{item.status === 'quitado' ? 'quitado' : 'parcial'}</Badge>
      <span className="amount">{formatBRL(item.paidAmount)}{item.status !== 'quitado' ? <span className="muted"> / {formatBRL(item.amount)}</span> : null}</span>
      <button type="button" className="icon-button sm ghost" onClick={async () => { await callTool('reabrir_cobranca', { receivableId: item.id }); toast('Cobrança reaberta.'); }} title="Reabrir"><Undo2 size={14} /></button>
    </div>
  );
}

function MemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [name, setName] = useState(member?.name || '');
  const [nickname, setNickname] = useState(member?.nickname || '');
  const [contact, setContact] = useState(member?.contact || '');
  const [isOwner, setIsOwner] = useState(Boolean(member?.isOwner));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = member
      ? await callTool('atualizar_membro', { memberId: member.id, patch: { name, nickname: nickname.trim(), contact: contact.trim(), isOwner } })
      : await callTool<{ created: boolean }>('cadastrar_membro', { member: { id: crypto.randomUUID(), name, nickname: nickname.trim(), contact: contact.trim(), isOwner, aliases: [] } });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(member ? 'Pessoa atualizada.' : 'Pessoa cadastrada.');
    onClose();
  };

  return (
    <Modal size="sm" title={member ? 'Editar pessoa' : 'Nova pessoa'} onClose={onClose} icon={<UserPlus size={18} />}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="member-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="member-form" className="form-grid" onSubmit={save}>
        <Field label="Nome" full><input required autoFocus value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Apelido" hint="O bot do Telegram também reconhece pelo apelido."><input value={nickname} onChange={event => setNickname(event.target.value)} /></Field>
        <Field label="WhatsApp" hint="Com DDD, ex.: 62 99999-0000"><input value={contact} onChange={event => setContact(event.target.value)} inputMode="tel" /></Field>
        <label className="check-line full"><input type="checkbox" checked={isOwner} disabled={member?.isOwner} onChange={event => setIsOwner(event.target.checked)} /> Titular do cartão (você)</label>
      </form>
    </Modal>
  );
}

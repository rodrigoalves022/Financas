import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, RotateCcw, StickyNote, Store } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { groupPurchases } from '../../utils/analytics';
import { formatBRL, formatDate, titleCase } from '../../utils/formatters';
import { normalizeMerchant } from '../../utils/merchant';
import { Card, Field } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { Alias, Transaction } from '../../types';

interface AliasRow {
  key: string;
  alias: Alias;
  items: Transaction[];
  purchases: number;
  total: number;
}

const installmentTotal = (installment?: string) => Number(installment?.match(/\d+\/(\d+)/)?.[1] || 0);

export function ApelidosTab() {
  const { transactions, aliases } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const [renaming, setRenaming] = useState<AliasRow | null>(null);
  const [converting, setConverting] = useState<AliasRow | null>(null);

  const rows = useMemo<AliasRow[]>(() => {
    const byMerchant = new Map<string, Transaction[]>();
    transactions.filter(item => item.type === 'expense').forEach(item => {
      const key = normalizeMerchant(item.description);
      const list = byMerchant.get(key);
      if (list) list.push(item);
      else byMerchant.set(key, [item]);
    });
    // Mais de um apelido para o mesmo local: vale o primeiro, como em applyAlias.
    const seen = new Set<string>();
    return aliases.flatMap(alias => {
      const key = normalizeMerchant(alias.original);
      if (seen.has(key)) return [];
      seen.add(key);
      const items = byMerchant.get(key) || [];
      return [{ key, alias, items, purchases: groupPurchases(items).length, total: items.reduce((sum, item) => sum + item.amount, 0) }];
    });
  }, [transactions, aliases]);

  const restore = async (row: AliasRow) => {
    if (!await confirm({
      title: 'Voltar ao nome do extrato?',
      message: `"${row.alias.alias}" deixa de aparecer ${row.purchases === 1 ? 'na compra' : `nas ${row.purchases} compras`} de ${titleCase(row.key)}.`,
      confirmLabel: 'Restaurar nome',
    })) return;
    const result = await callTool('remover_alias', { original: row.alias.original });
    toast(result.success ? `${titleCase(row.key)} voltou ao nome do extrato.` : result.message, result.success ? 'success' : 'error');
  };

  return (
    <div className="page-grid">
      <Card
        span="full"
        icon={<Store size={17} />}
        title="Apelidos de locais"
        subtitle="O apelido renomeia o estabelecimento em todas as compras dele e junta maquininhas e nomes estranhos do extrato. Para marcar uma compra só (celular, conserto do carro), use a observação."
      >
        <DataTable
          rows={rows}
          rowKey={row => row.key}
          initialSort={{ key: 'purchases', direction: 'desc' }}
          searchPlaceholder="Buscar apelido ou local..."
          emptyLabel="Nenhum apelido ainda. Crie pelo lápis de uma compra na Fatura."
          columns={[
            { key: 'alias', label: 'Apelido', value: row => row.alias.alias, render: row => <strong>{row.alias.alias}</strong> },
            {
              key: 'merchant', label: 'No extrato', value: row => row.key, render: row => (
                <div className="merchant-cell">
                  <span>{titleCase(row.key)}</span>
                  <small title={row.alias.original}>{row.alias.original}</small>
                </div>
              ),
            },
            { key: 'purchases', label: 'Compras', align: 'right', value: row => row.purchases },
            { key: 'total', label: 'Total', align: 'right', value: row => row.total, render: row => <span className="num">{formatBRL(row.total)}</span> },
            {
              key: 'actions', label: '', sortable: false, filterable: false, value: () => '', render: row => (
                <div className="row-actions">
                  <button type="button" className="icon-button sm ghost" onClick={() => setRenaming(row)} title="Renomear apelido"><Pencil size={14} /></button>
                  <button type="button" className="icon-button sm ghost" onClick={() => setConverting(row)} title="Transformar em observação de uma compra" disabled={!row.items.length}><StickyNote size={14} /></button>
                  <button type="button" className="icon-button sm ghost" onClick={() => restore(row)} title="Voltar ao nome do extrato"><RotateCcw size={14} /></button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {renaming ? <RenameModal row={renaming} onClose={() => setRenaming(null)} /> : null}
      {converting ? <ConvertModal row={converting} onClose={() => setConverting(null)} /> : null}
    </div>
  );
}

function RenameModal({ row, onClose }: { row: AliasRow; onClose: () => void }) {
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [alias, setAlias] = useState(row.alias.alias);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await callTool('criar_alias', { original: row.alias.original, alias });
    toast(alias.trim() ? 'Apelido atualizado em todas as telas.' : `${titleCase(row.key)} voltou ao nome do extrato.`);
    onClose();
  };

  return (
    <Modal size="sm" title="Renomear apelido" subtitle={row.alias.original} onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="rename-alias-form" className="primary-button">Salvar</button>
        </>
      )}>
      <form id="rename-alias-form" className="form-grid" onSubmit={save}>
        <Field full label="Como você quer ver este local" hint={`Vale para ${row.purchases === 1 ? 'a única compra' : `as ${row.purchases} compras`} de ${titleCase(row.key)}. Em branco, volta ao nome do extrato.`}>
          <input autoFocus value={alias} onChange={event => setAlias(event.target.value)} placeholder={titleCase(row.key)} />
        </Field>
      </form>
    </Modal>
  );
}

/** Escolhe qual(is) compra(s) o apelido realmente descrevia e passa o texto para a observação delas. */
function ConvertModal({ row, onClose }: { row: AliasRow; onClose: () => void }) {
  const { categories } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const purchases = useMemo(() => groupPurchases(row.items), [row.items]);
  const [selected, setSelected] = useState<string[]>(() => purchases.length === 1 ? [purchases[0][0].id] : []);
  const categoryName = (id: string) => categories.find(category => category.id === id)?.name || 'Outros';

  const toggle = (id: string) => setSelected(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = await callTool<{ updated: number; note: string }>('converter_alias_em_observacao', { original: row.alias.original, transactionIds: selected });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(`"${result.data?.note}" virou observação de ${result.data?.updated} lançamento(s) e ${titleCase(row.key)} voltou ao nome do extrato.`);
    onClose();
  };

  return (
    <Modal title="Transformar em observação" subtitle={`"${row.alias.alias}" · ${titleCase(row.key)}`} onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="convert-alias-form" className="primary-button" disabled={!selected.length}>
            {selected.length ? `Usar em ${selected.length} compra(s)` : 'Escolha a compra'}
          </button>
        </>
      )}>
      <form id="convert-alias-form" className="form-grid" onSubmit={save}>
        <p className="full muted convert-help">
          Marque a compra que é <strong>{row.alias.alias}</strong>. Ela fica com essa observação, em todas as parcelas, e o local volta ao nome do extrato.
        </p>
        <div className="full purchase-pick-list">
          {purchases.map(group => {
            const first = group[0];
            const parcels = installmentTotal(first.installment);
            const checked = selected.includes(first.id);
            return (
              <label key={first.id} className={`purchase-pick ${checked ? 'selected' : ''}`}>
                <input type="checkbox" checked={checked} onChange={() => toggle(first.id)} />
                <span className="purchase-pick-main">
                  <strong>{formatDate(first.date)} · {categoryName(first.categoryId)}</strong>
                  <small>{first.note ? `Obs.: ${first.note}` : first.description}</small>
                </span>
                <span className="purchase-pick-value num">
                  {parcels > 1 ? `${parcels}x de ${formatBRL(first.amount)}` : formatBRL(first.amount)}
                  {parcels > 1 ? <small>{group.length} parcela(s) na base</small> : null}
                </span>
              </label>
            );
          })}
        </div>
      </form>
    </Modal>
  );
}

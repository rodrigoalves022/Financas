import { useMemo, useState } from 'react';
import { ArrowRight, Check, FlaskConical, RefreshCcw } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { applyAlias } from '../../utils/analytics';
import { SOURCE_LABELS, createCategorizer, recategorizeTransactions, type RecategorizationChange } from '../../utils/categorizer';
import { formatBRL, titleCase } from '../../utils/formatters';
import { parseMerchant } from '../../utils/merchant';
import { Badge, Card, CategoryDot, Field } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { useFeedback } from '../../components/ui/feedback';

export function ReclassificarTab() {
  const { transactions, categories, categoryRules, aliases } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [includeManual, setIncludeManual] = useState(false);
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [sample, setSample] = useState('MERCADO MERCADOLIVRE   BARUERI       BRA');
  const [sampleRaw, setSampleRaw] = useState('');

  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const changes = useMemo(
    () => recategorizeTransactions(transactions, { categories, rules: categoryRules, aliases }, { force: includeManual }).changes,
    [transactions, categories, categoryRules, aliases, includeManual],
  );
  // Agrupa por estabelecimento + mudança: 40 compras no mesmo mercado viram uma linha só.
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; merchant: string; from: string; to: string; items: RecategorizationChange[]; total: number }>();
    changes.forEach(change => {
      const merchant = applyAlias(change.transaction.description, aliases);
      const key = `${merchant}|${change.from}|${change.to}`;
      const group = map.get(key) || { key, merchant, from: change.from, to: change.to, items: [], total: 0 };
      group.items.push(change);
      group.total += change.transaction.amount;
      map.set(key, group);
    });
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length || b.total - a.total);
  }, [changes, aliases]);
  const selectedIds = groups.filter(group => !deselected.has(group.key)).flatMap(group => group.items.map(item => item.transaction.id));

  const test = useMemo(() => {
    if (!sample.trim()) return null;
    const result = createCategorizer({ categories, rules: categoryRules, aliases })(sample, sampleRaw || undefined);
    return { result, parsed: parseMerchant(sample) };
  }, [sample, sampleRaw, categories, categoryRules, aliases]);

  const apply = async () => {
    const result = await callTool<{ changed: number }>('reaplicar_todas_regras', { transactionIds: selectedIds });
    toast(`${result.data?.changed || 0} lançamento(s) recategorizado(s).`);
    setDeselected(new Set());
  };

  const tag = (id: string) => {
    const category = categoryById.get(id);
    return <span className="category-tag"><CategoryDot color={category?.color || '#94a3b8'} />{category?.name || id}</span>;
  };

  return (
    <div className="page-grid">
      <Card span="full" icon={<FlaskConical size={17} />} title="Testar uma descrição" subtitle="Veja como o motor lê a descrição da fatura e qual regra decide.">
        <div className="form-grid" style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }}>
          <Field label="Descrição como vem na fatura"><input value={sample} onChange={event => setSample(event.target.value)} /></Field>
          <Field label="Categoria do banco (opcional)"><input value={sampleRaw} onChange={event => setSampleRaw(event.target.value)} placeholder="Ex.: VESTUARIO" /></Field>
        </div>
        {test ? (
          <div className="test-result" style={{ marginTop: 12 }}>
            <span>Local: <strong>{test.parsed.name}</strong></span>
            {test.parsed.city ? <span>Cidade: <strong>{test.parsed.city}</strong> <span className="muted">(ignorada)</span></span> : null}
            {test.parsed.processor ? <span>Maquininha: <strong>{test.parsed.processor}</strong> <span className="muted">(ignorada)</span></span> : null}
            <ArrowRight size={15} className="muted" />
            {tag(test.result.categoryId)}
            <Badge tone="neutral">{SOURCE_LABELS[test.result.source]}{test.result.keyword ? `: "${test.result.keyword}"` : ''}</Badge>
          </div>
        ) : null}
      </Card>

      <Card span="full" icon={<RefreshCcw size={17} />} title="Reclassificar com as regras atuais"
        subtitle="Prévia do que mudaria se o motor inteligente recategorizasse tudo agora. Nada muda até você aplicar."
        actions={(
          <>
            <label className="check-line"><input type="checkbox" checked={includeManual} onChange={event => { setIncludeManual(event.target.checked); setDeselected(new Set()); }} /> Incluir escolhas manuais</label>
            <button type="button" className="primary-button" onClick={apply} disabled={!selectedIds.length}><Check size={15} /> Aplicar {selectedIds.length}</button>
          </>
        )}>
        {groups.length ? (
          <div className="list">
            <p className="muted" style={{ margin: '0 0 8px', fontSize: 12.5 }}>{changes.length} lançamento(s) em {groups.length} estabelecimento(s).</p>
            {groups.slice(0, 150).map(group => {
              const first = group.items[0].result;
              return (
                <label className="list-row" key={group.key} style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={!deselected.has(group.key)} onChange={event => setDeselected(previous => {
                    const next = new Set(previous);
                    if (event.target.checked) next.delete(group.key); else next.add(group.key);
                    return next;
                  })} />
                  <div className="grow">
                    <span className="title">{titleCase(group.merchant)} <span className="muted">· {group.items.length} lançamento(s) · {formatBRL(group.total)}</span></span>
                    <span className="subtitle">{SOURCE_LABELS[first.source]}{first.keyword ? ` "${first.keyword}"` : ''} · ex.: {group.items[0].transaction.description}</span>
                  </div>
                  <span className="nowrap" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>{tag(group.from)}<ArrowRight size={14} className="muted" />{tag(group.to)}</span>
                </label>
              );
            })}
            {groups.length > 150 ? <p className="muted" style={{ textAlign: 'center', fontSize: 12.5 }}>Mostrando 150 de {groups.length} grupos — os demais também são aplicados se marcados.</p> : null}
          </div>
        ) : <EmptyState compact title="Tudo coerente com as regras atuais." />}
      </Card>
    </div>
  );
}

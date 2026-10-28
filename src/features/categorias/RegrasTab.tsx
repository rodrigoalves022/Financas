import { useCallback, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { keywordMatches } from '../../utils/categorizer';
import { normalizeText } from '../../utils/formatters';
import { parseMerchant } from '../../utils/merchant';
import { Badge, Card, CategoryDot, Field } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { CategoryRule, RuleMatchType } from '../../types';

const MATCH_LABELS: Record<RuleMatchType, { label: string; help: string }> = {
  auto: { label: 'Automático', help: 'Curta (até 4 letras) = palavra inteira; média = começo de palavra; longa = qualquer trecho.' },
  word: { label: 'Palavra inteira', help: '"BAR" casa com "BAR DO ZÉ", não com "BARUERI".' },
  prefix: { label: 'Começa com', help: 'O nome do local precisa começar com o texto.' },
  contains: { label: 'Contém (inclui cidade)', help: 'Qualquer trecho da descrição, inclusive a cidade.' },
};

/** Conta quantos lançamentos uma palavra-chave pega, com a mesma comparação do motor. */
const useMatchCounter = () => {
  const { transactions } = useFinance();
  const parsed = useMemo(() => transactions.map(item => {
    const merchant = parseMerchant(item.description);
    return { texts: Array.from(new Set([merchant.name, merchant.label])), full: merchant.full };
  }), [transactions]);
  return useCallback((keyword: string, mode: RuleMatchType = 'auto') => {
    const key = normalizeText(keyword);
    if (!key) return 0;
    return parsed.filter(item => [...item.texts, ...(mode === 'contains' ? [item.full] : [])].some(text => keywordMatches(text, key, mode))).length;
  }, [parsed]);
};

export function RegrasTab() {
  const { categories, categoryRules } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const countMatches = useMatchCounter();
  const [editing, setEditing] = useState<CategoryRule | null>(null);
  const [creating, setCreating] = useState(false);

  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const rows = useMemo(() => categoryRules.map(rule => ({ ...rule, matches: countMatches(rule.keyword, rule.matchType) })), [categoryRules, countMatches]);

  const remove = async (rule: CategoryRule) => {
    if (!await confirm({ title: 'Excluir regra?', message: `Lançamentos que hoje dependem de "${rule.keyword}" serão recategorizados pelas outras regras.`, confirmLabel: 'Excluir', tone: 'danger' })) return;
    const result = await callTool<{ changed: number }>('excluir_regra_categoria', { ruleId: rule.id });
    toast(`Regra excluída · ${result.data?.changed || 0} lançamento(s) recategorizado(s).`);
  };

  return (
    <div className="page-grid">
      <Card span="full" icon={<Wand2 size={17} />} title="Regras automáticas" subtitle="Valem antes de tudo: regras > palavras das categorias > dicionário embutido > categoria do banco. Escolhas manuais nunca são sobrescritas."
        actions={<button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={15} /> Nova regra</button>}>
        <DataTable
          rows={rows}
          rowKey={row => row.id}
          initialSort={{ key: 'matches', direction: 'desc' }}
          searchPlaceholder="Buscar regra..."
          emptyLabel="Nenhuma regra ainda — crie uma ou use o assistente de IA."
          columns={[
            { key: 'keyword', label: 'Palavra-chave', value: row => row.keyword, render: row => <strong>{row.keyword}</strong> },
            {
              key: 'category', label: 'Categoria', value: row => categoryById.get(row.categoryId)?.name || '', render: row => {
                const category = categoryById.get(row.categoryId);
                return category ? <span className="category-tag"><CategoryDot color={category.color} />{category.name}</span> : <Badge tone="bad">removida</Badge>;
              },
            },
            { key: 'matchType', label: 'Como compara', value: row => MATCH_LABELS[row.matchType || 'auto'].label, render: row => <span title={MATCH_LABELS[row.matchType || 'auto'].help}>{MATCH_LABELS[row.matchType || 'auto'].label}</span> },
            { key: 'origin', label: 'Origem', align: 'center', value: row => row.origin || 'manual', render: row => <Badge tone={row.origin === 'ia' ? 'accent' : 'neutral'}>{row.origin === 'ia' ? 'IA' : 'manual'}</Badge> },
            { key: 'matches', label: 'Lançamentos', align: 'right', value: row => row.matches, render: row => row.matches ? row.matches : <Badge tone="warn">nenhum</Badge> },
            {
              key: 'actions', label: '', sortable: false, filterable: false, value: () => '', render: row => (
                <div className="row-actions">
                  <button type="button" className="icon-button sm ghost" onClick={() => setEditing(row)} title="Editar"><Pencil size={14} /></button>
                  <button type="button" className="icon-button sm ghost danger" onClick={() => remove(row)} title="Excluir"><Trash2 size={14} /></button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {creating || editing ? <RuleModal rule={editing} countMatches={countMatches} onClose={() => { setCreating(false); setEditing(null); }} /> : null}
    </div>
  );
}

function RuleModal({ rule, countMatches, onClose }: { rule: CategoryRule | null; countMatches: (keyword: string, mode?: RuleMatchType) => number; onClose: () => void }) {
  const { categories } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [keyword, setKeyword] = useState(rule?.keyword || '');
  const [categoryId, setCategoryId] = useState(rule?.categoryId || categories.find(category => category.id !== 'outros')?.id || 'outros');
  const [matchType, setMatchType] = useState<RuleMatchType>(rule?.matchType || 'auto');
  const matches = countMatches(keyword, matchType);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const result = rule
      ? await callTool<{ changed: number }>('atualizar_regra_categoria', { ruleId: rule.id, keyword, categoryId, matchType })
      : await callTool<{ changed: number }>('criar_regra_categoria', { keyword, categoryId, matchType });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(`Regra salva · ${result.data?.changed || 0} lançamento(s) recategorizado(s).`);
    onClose();
  };

  return (
    <Modal title={rule ? 'Editar regra' : 'Nova regra'} subtitle="Aplica agora e em todas as próximas importações." onClose={onClose}
      footer={(
        <>
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="submit" form="rule-form" className="primary-button">Salvar e aplicar</button>
        </>
      )}>
      <form id="rule-form" className="form-grid" onSubmit={save}>
        <Field label="Palavra-chave" hint={keyword.trim() ? `Casa com ${matches} lançamento(s) existentes.` : 'Use o nome do local, sem cidade nem número de loja.'} full>
          <input required autoFocus value={keyword} onChange={event => setKeyword(event.target.value)} placeholder="Ex.: MERCADOLIVRE, SUP LARANJEIRA" />
        </Field>
        <Field label="Categoria">
          <select value={categoryId} onChange={event => setCategoryId(event.target.value)}>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </Field>
        <Field label="Como comparar" hint={MATCH_LABELS[matchType].help}>
          <select value={matchType} onChange={event => setMatchType(event.target.value as RuleMatchType)}>
            {(Object.keys(MATCH_LABELS) as RuleMatchType[]).map(mode => <option key={mode} value={mode}>{MATCH_LABELS[mode].label}</option>)}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

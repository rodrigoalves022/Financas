import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Plus, Tags, Trash2, X } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { useTools } from '../../tools/useTools';
import { expenseTransactions, filterByMonth } from '../../utils/analytics';
import { CATEGORY_COLOR_PALETTE } from '../../utils/constants';
import { formatBRL, formatMonth } from '../../utils/formatters';
import { Card, CategoryDot, Field } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { useFeedback } from '../../components/ui/feedback';
import type { Category } from '../../types';

export function CategoriasListTab({ selectedMonth }: { selectedMonth: string }) {
  const { categories, transactions, categoryRules } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [color, setColor] = useState(CATEGORY_COLOR_PALETTE[categories.length % CATEGORY_COLOR_PALETTE.length]);
  const [editing, setEditing] = useState<Category | null>(null);

  const usage = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    expenseTransactions(filterByMonth(transactions, selectedMonth)).forEach(item => {
      const current = map.get(item.categoryId) || { count: 0, total: 0 };
      map.set(item.categoryId, { count: current.count + 1, total: current.total + item.amount });
    });
    return map;
  }, [transactions, selectedMonth]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const result = await callTool<{ created: boolean }>('criar_categoria', { name, color });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(result.data?.created ? `Categoria "${name.trim()}" criada.` : 'Essa categoria já existe.', result.data?.created ? 'success' : 'info');
    setName('');
  };

  return (
    <div className="page-grid">
      <Card span="full" icon={<Tags size={17} />} title="Categorias" subtitle={`Toque para editar nome, cor e palavras-chave · uso em ${selectedMonth ? formatMonth(selectedMonth) : 'todo o período'}`}>
        <form className="inline-form" onSubmit={create} style={{ marginBottom: 18 }}>
          <Field label="Nova categoria"><input required value={name} onChange={event => setName(event.target.value)} placeholder="Ex.: Pets, Presentes, Investimentos" /></Field>
          <Field label="Cor"><input type="color" value={color} onChange={event => setColor(event.target.value)} /></Field>
          <button type="submit" className="primary-button"><Plus size={15} /> Criar</button>
        </form>
        <div className="category-grid">
          {categories.map(category => {
            const stats = usage.get(category.id);
            const rules = categoryRules.filter(rule => rule.categoryId === category.id).length;
            return (
              <button type="button" key={category.id} className="category-card" onClick={() => setEditing(category)}>
                <CategoryDot color={category.color} />
                <div className="grow">
                  <strong>{category.name}</strong>
                  <small>{stats ? `${stats.count} compras · ${formatBRL(stats.total)}` : 'Sem compras'} · {category.keywords.length + rules} termo(s)</small>
                </div>
              </button>
            );
          })}
        </div>
      </Card>
      {editing ? <CategoryModal category={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

function CategoryModal({ category, onClose }: { category: Category; onClose: () => void }) {
  const { categoryRules } = useFinance();
  const { callTool } = useTools();
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [keywords, setKeywords] = useState(category.keywords);
  const [newKeyword, setNewKeyword] = useState('');
  const rules = categoryRules.filter(rule => rule.categoryId === category.id);

  const addKeyword = () => {
    const clean = newKeyword.trim();
    if (clean && !keywords.some(keyword => keyword.toLowerCase() === clean.toLowerCase())) setKeywords([...keywords, clean]);
    setNewKeyword('');
  };

  const save = async () => {
    const result = await callTool<{ changed: number }>('atualizar_categoria', { categoryId: category.id, name, color, keywords });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(`Categoria salva${result.data?.changed ? ` · ${result.data.changed} lançamento(s) recategorizado(s)` : ''}.`);
    onClose();
  };

  const remove = async () => {
    if (!await confirm({ title: `Excluir "${category.name}"?`, message: 'Os lançamentos dela serão recategorizados pelas regras; regras e metas desta categoria também saem.', confirmLabel: 'Excluir categoria', tone: 'danger' })) return;
    const result = await callTool<{ moved: number }>('excluir_categoria', { categoryId: category.id });
    if (!result.success) {
      toast(result.message, 'error');
      return;
    }
    toast(`Categoria excluída · ${result.data?.moved || 0} lançamento(s) recategorizado(s).`);
    onClose();
  };

  return (
    <Modal title="Editar categoria" subtitle="Palavras-chave casam com o nome do local (sem a cidade)." onClose={onClose}
      footer={(
        <>
          {category.id !== 'outros' ? <button type="button" className="secondary-button danger-outline" onClick={remove} style={{ marginRight: 'auto' }}><Trash2 size={15} /> Excluir</button> : null}
          <button type="button" className="secondary-button" onClick={onClose}>Cancelar</button>
          <button type="button" className="primary-button" onClick={save}>Salvar e recategorizar</button>
        </>
      )}>
      <div className="form-grid">
        <Field label="Nome"><input value={name} onChange={event => setName(event.target.value)} /></Field>
        <Field label="Cor">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="color" value={color} onChange={event => setColor(event.target.value)} />
            {CATEGORY_COLOR_PALETTE.slice(0, 8).map(swatch => (
              <button key={swatch} type="button" onClick={() => setColor(swatch)} aria-label={`Cor ${swatch}`}
                style={{ width: 22, height: 22, borderRadius: '50%', border: swatch === color ? '2px solid var(--text)' : '2px solid transparent', background: swatch }} />
            ))}
          </div>
        </Field>
        <div className="full field">
          <span className="field-label">Palavras-chave ({keywords.length})</span>
          <div className="inline-form">
            <input value={newKeyword} onChange={event => setNewKeyword(event.target.value)} placeholder="Adicionar palavra-chave" style={{ flex: 1 }}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addKeyword(); } }} />
            <button type="button" className="secondary-button" onClick={addKeyword}><Plus size={15} /> Adicionar</button>
          </div>
          <div className="keyword-cloud">
            {keywords.map(keyword => (
              <span key={keyword} className="keyword-pill">
                {keyword}
                <button type="button" onClick={() => setKeywords(keywords.filter(item => item !== keyword))} aria-label={`Remover ${keyword}`}><X size={11} /></button>
              </span>
            ))}
            {!keywords.length ? <span className="muted" style={{ fontSize: 12.5 }}>Nenhuma palavra-chave. O dicionário embutido e as regras continuam valendo.</span> : null}
          </div>
        </div>
        {rules.length ? (
          <p className="muted full" style={{ margin: 0, fontSize: 12.5 }}>Também recebe lançamentos de {rules.length} regra(s): {rules.slice(0, 6).map(rule => rule.keyword).join(', ')}{rules.length > 6 ? '…' : ''}</p>
        ) : null}
      </div>
    </Modal>
  );
}

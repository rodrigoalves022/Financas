import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, FlaskConical, ListChecks, Loader2, Store, Tags } from 'lucide-react';
import { useFinance } from '../../store/FinanceContext';
import { isLowConfidence } from '../../utils/categorizer';
import { normalizeMerchant } from '../../utils/merchant';
import { StatCard, Tabs } from '../../components/ui/Card';
import { ApelidosTab } from './ApelidosTab';
import { useAiRun } from './aiRun';
import { AssistenteIaTab } from './AssistenteIaTab';
import { CategoriasListTab } from './CategoriasListTab';
import { ReclassificarTab } from './ReclassificarTab';
import { RegrasTab } from './RegrasTab';

type TabId = 'ia' | 'regras' | 'categorias' | 'apelidos' | 'reclassificar';
const TAB_IDS: TabId[] = ['ia', 'regras', 'categorias', 'apelidos', 'reclassificar'];

export function CategoriasPage({ selectedMonth }: { selectedMonth: string }) {
  const { transactions, categories, categoryRules, aliases } = useFinance();
  const [searchParams] = useSearchParams();
  const aiRun = useAiRun();
  const aliasCount = useMemo(() => new Set(aliases.map(alias => normalizeMerchant(alias.original))).size, [aliases]);

  const stats = useMemo(() => {
    const expenses = transactions.filter(item => item.type === 'expense');
    const review = expenses.filter(item => !item.manualCategory && isLowConfidence(item.categorySource)).length;
    return {
      review,
      coverage: expenses.length ? ((expenses.length - review) / expenses.length) * 100 : 100,
      aiRules: categoryRules.filter(rule => rule.origin === 'ia').length,
    };
  }, [transactions, categoryRules]);

  // ?aba=apelidos (vindo do lápis da Fatura) abre direto na aba pedida.
  const [tab, setTab] = useState<TabId>(() => {
    const requested = searchParams.get('aba') as TabId | null;
    if (requested && TAB_IDS.includes(requested)) return requested;
    return stats.review ? 'ia' : 'regras';
  });

  return (
    <div className="page-grid">
      <div className="stat-grid">
        <StatCard
          label="Categorizados com segurança"
          value={`${stats.coverage.toFixed(0)}%`}
          hint="Por regra, palavra-chave, dicionário ou você"
          tone={stats.coverage >= 90 ? 'good' : 'warn'}
          active={tab === 'reclassificar'}
          onClick={() => setTab('reclassificar')}
        />
        <StatCard
          label="A revisar"
          value={stats.review}
          hint="Só pela categoria do banco ou sem correspondência"
          tone={stats.review ? 'warn' : 'good'}
          active={tab === 'ia'}
          onClick={() => setTab('ia')}
        />
        <StatCard
          label="Regras"
          value={categoryRules.length}
          hint={`${stats.aiRules} criadas a partir da IA`}
          active={tab === 'regras'}
          onClick={() => setTab('regras')}
        />
        <StatCard
          label="Categorias"
          value={categories.length}
          active={tab === 'categorias'}
          onClick={() => setTab('categorias')}
        />
      </div>
      <div className="toolbar-row">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'ia', label: 'Assistente IA', icon: aiRun.progress ? <Loader2 size={15} className="spin" /> : <Bot size={15} />, count: stats.review || undefined },
            { id: 'regras', label: 'Regras', icon: <ListChecks size={15} />, count: categoryRules.length },
            { id: 'categorias', label: 'Categorias', icon: <Tags size={15} /> },
            { id: 'apelidos', label: 'Apelidos de locais', icon: <Store size={15} />, count: aliasCount || undefined },
            { id: 'reclassificar', label: 'Testar e reclassificar', icon: <FlaskConical size={15} /> },
          ]}
        />
      </div>
      <div className="span-full">
        {tab === 'ia' ? <AssistenteIaTab selectedMonth={selectedMonth} /> : null}
        {tab === 'regras' ? <RegrasTab /> : null}
        {tab === 'categorias' ? <CategoriasListTab selectedMonth={selectedMonth} /> : null}
        {tab === 'apelidos' ? <ApelidosTab /> : null}
        {tab === 'reclassificar' ? <ReclassificarTab /> : null}
      </div>
    </div>
  );
}

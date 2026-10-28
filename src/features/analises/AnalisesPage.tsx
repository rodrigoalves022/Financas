import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, PieChart, Sparkles, TrendingUp, Users } from 'lucide-react';
import { Tabs } from '../../components/ui/Card';
import { FLAGS, readFlag, writeFlag } from '../../store/storage';
import { CategoriasTab } from './CategoriasTab';
import { ComportamentoTab } from './ComportamentoTab';
import { FluxoTab } from './FluxoTab';
import { IaTab } from './IaTab';
import { PessoasDividasTab } from './PessoasDividasTab';

type TabId = 'categorias' | 'fluxo' | 'comportamento' | 'pessoas' | 'ia';
const TAB_IDS: TabId[] = ['categorias', 'fluxo', 'comportamento', 'pessoas', 'ia'];
const TAB_KEY = `${FLAGS.selectedMonth}_analises_tab`;

export function AnalisesPage({ selectedMonth, months, onSelectMonth }: { selectedMonth: string; months: string[]; onSelectMonth: (month: string) => void }) {
  const [searchParams] = useSearchParams();
  // ?aba= vem de atalhos (ex.: "Análise completa" no card de dicas do Painel).
  const [tab, setTabState] = useState<TabId>(() => {
    const fromUrl = searchParams.get('aba') as TabId | null;
    return fromUrl && TAB_IDS.includes(fromUrl) ? fromUrl : (readFlag(TAB_KEY) as TabId) || 'categorias';
  });
  const setTab = (next: TabId) => {
    setTabState(next);
    writeFlag(TAB_KEY, next);
  };

  return (
    <div className="page-grid">
      <div className="toolbar-row">
        <Tabs<TabId>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'categorias', label: 'Categorias e locais', icon: <PieChart size={15} /> },
            { id: 'fluxo', label: 'Fluxo mensal', icon: <TrendingUp size={15} /> },
            { id: 'comportamento', label: 'Comportamento', icon: <Activity size={15} /> },
            { id: 'pessoas', label: 'Pessoas e dívidas', icon: <Users size={15} /> },
            { id: 'ia', label: 'Análise com IA', icon: <Sparkles size={15} /> },
          ]}
        />
      </div>
      <div className="span-full">
        {tab === 'categorias' ? <CategoriasTab key={selectedMonth} selectedMonth={selectedMonth} months={months} /> : null}
        {tab === 'fluxo' ? <FluxoTab selectedMonth={selectedMonth} onSelectMonth={onSelectMonth} /> : null}
        {tab === 'comportamento' ? <ComportamentoTab selectedMonth={selectedMonth} /> : null}
        {tab === 'pessoas' ? <PessoasDividasTab /> : null}
        {tab === 'ia' ? <IaTab selectedMonth={selectedMonth} /> : null}
      </div>
    </div>
  );
}

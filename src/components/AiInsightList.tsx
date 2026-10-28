import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { AiInsight } from '../utils/aiClient';

const TONE_ICON = {
  positivo: <CheckCircle2 size={16} />,
  atencao: <AlertTriangle size={16} />,
  neutro: <Info size={16} />,
};

export function AiInsightList({ insights, limit, columns }: { insights: AiInsight[]; limit?: number; columns?: boolean }) {
  return (
    <div className={`insight-list${columns ? ' columns' : ''}`}>
      {insights.slice(0, limit ?? insights.length).map((item, index) => (
        <div key={index} className={`insight tone-${item.tone}`}>
          {TONE_ICON[item.tone]}
          <div><strong>{item.title}</strong>{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

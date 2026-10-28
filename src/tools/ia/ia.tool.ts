import { toolRegistry } from '../registry';
import { upsertRule } from '../transacoes/transacoes.tool';
import { recategorizeTransactions } from '../../utils/categorizer';
import { CATEGORY_COLOR_PALETTE } from '../../utils/constants';
import { normalizeText } from '../../utils/formatters';
import type { Category, RuleMatchType } from '../../types';

export interface AcceptedSuggestion {
  keyword: string;
  categoryId?: string | null;
  /** Quando a IA sugere uma categoria que ainda não existe. */
  newCategoryName?: string;
  matchType?: RuleMatchType;
}

export interface ApplySuggestionsResult {
  rules: number;
  createdCategories: string[];
  changed: number;
}

toolRegistry.register<{ suggestions: AcceptedSuggestion[] }, ApplySuggestionsResult>({
  id: 'aplicar_sugestoes_ia',
  name: 'Aplicar sugestões da IA',
  description: 'Transforma sugestões aceitas em regras (criando categorias novas quando necessário) e recategoriza de uma vez',
  category: 'ia',
  execute: (params, ctx) => {
    const createdCategories: string[] = [];
    let rules = 0;

    for (const suggestion of params.suggestions) {
      const keyword = suggestion.keyword.trim();
      if (!keyword) continue;
      let categoryId = suggestion.categoryId || '';

      if (!categoryId && suggestion.newCategoryName?.trim()) {
        const name = suggestion.newCategoryName.trim();
        const { categories } = ctx.getState();
        const existing = categories.find(category => normalizeText(category.name) === normalizeText(name));
        if (existing) {
          categoryId = existing.id;
        } else {
          let id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || crypto.randomUUID();
          while (categories.some(category => category.id === id)) id = `${id}-2`;
          const category: Category = { id, name, color: CATEGORY_COLOR_PALETTE[categories.length % CATEGORY_COLOR_PALETTE.length], keywords: [] };
          ctx.dispatch({ type: 'SET_CATEGORIES', payload: [...categories, category] });
          createdCategories.push(name);
          categoryId = id;
        }
      }

      if (!categoryId || !ctx.getState().categories.some(category => category.id === categoryId)) continue;
      upsertRule(ctx, { keyword, categoryId, matchType: suggestion.matchType || 'auto', origin: 'ia' });
      rules += 1;
    }

    // Uma recategorização só no fim, em vez de uma por regra.
    const { transactions, categories, categoryRules, aliases } = ctx.getState();
    const result = recategorizeTransactions(transactions, { categories, rules: categoryRules, aliases });
    ctx.dispatch({ type: 'SET_TRANSACTIONS', payload: result.transactions });
    return { rules, createdCategories, changed: result.changes.length };
  },
});

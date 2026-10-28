import { toolRegistry } from '../registry';

toolRegistry.register<{ categoryId: string; monthlyLimit: number }, void>({
  id: 'salvar_meta',
  name: 'Salvar meta de gasto',
  description: 'Cria ou altera o teto mensal de gasto de uma categoria',
  category: 'metas',
  execute: (params, ctx) => {
    if (!params.categoryId || !(params.monthlyLimit > 0)) throw new Error('Escolha a categoria e um teto maior que zero.');
    ctx.dispatch({ type: 'ADD_BUDGET', payload: { categoryId: params.categoryId, monthlyLimit: params.monthlyLimit } });
  },
});

toolRegistry.register<{ categoryId: string }, void>({
  id: 'excluir_meta',
  name: 'Excluir meta de gasto',
  description: 'Remove o teto mensal de uma categoria',
  category: 'metas',
  execute: (params, ctx) => {
    ctx.dispatch({ type: 'DELETE_BUDGET', payload: params.categoryId });
  },
});

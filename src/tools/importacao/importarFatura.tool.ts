import { toolRegistry } from '../registry';
import type { ToolDefinition } from '../types';
import type { Transaction } from '../../types';

interface ImportarFaturaParams {
  /** Linhas já lidas e revisadas na tela de importação. */
  transactions: Transaction[];
  fileNames: string[];
}

interface ImportarFaturaResult {
  added: number;
  skippedDuplicates: number;
  fileNames: string[];
}

/**
 * Grava as transações revisadas e registra os arquivos como processados, numa só ação.
 * A deduplicação fica no reducer; a contagem compara o antes e o depois do estado real.
 */
const importarFaturaTool: ToolDefinition<ImportarFaturaParams, ImportarFaturaResult> = {
  id: 'importar_fatura',
  name: 'Importar fatura',
  description: 'Importa transações de arquivos CSV ou OFX revisados, registra os arquivos como processados e evita duplicatas',
  category: 'importacao',

  execute: (params, ctx) => {
    const before = ctx.getState().transactions.length;
    ctx.dispatch({ type: 'ADD_TRANSACTIONS', payload: params.transactions });
    ctx.dispatch({ type: 'ADD_PROCESSED_FILES', payload: params.fileNames });
    const added = ctx.getState().transactions.length - before;
    return { added, skippedDuplicates: params.transactions.length - added, fileNames: params.fileNames };
  },
};

toolRegistry.register(importarFaturaTool);

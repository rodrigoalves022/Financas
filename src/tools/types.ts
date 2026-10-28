import type { FinanceState, FinanceAction } from '../store/actions';

// ─── Categoria das ferramentas ─────────────────────────────────────────────────

export type ToolCategory =
  | 'importacao'
  | 'receitas'
  | 'transacoes'
  | 'membros'
  | 'cobrancas'
  | 'emprestimos'
  | 'dividas'
  | 'contas'
  | 'metas'
  | 'ia'
  | 'sistema';

// ─── Contexto injetado nas ferramentas ────────────────────────────────────────

export interface ToolContext {
  /** Snapshot somente-leitura do estado atual */
  getState: () => FinanceState;
  /** Aplica uma mutação no estado via reducer */
  dispatch: (action: FinanceAction) => void;
  /** Chama outra ferramenta pelo id (composição) */
  callTool: <TResult = unknown>(toolId: string, params: unknown) => Promise<ToolResult<TResult>>;
}

// ─── Interface de uma ferramenta ──────────────────────────────────────────────

export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  /** Identificador único (snake_case) */
  id: string;
  /** Nome legível em pt-BR */
  name: string;
  /** Descrição do que a ferramenta faz */
  description: string;
  /** Módulo/feature ao qual pertence */
  category: ToolCategory;
  /** Lógica de execução — pura, sem acesso direto ao React */
  execute: (params: TParams, context: ToolContext) => Promise<TResult> | TResult;
}

// ─── Envelope de retorno padronizado ──────────────────────────────────────────

export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  message: string;
}

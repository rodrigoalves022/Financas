import { useCallback, useMemo } from 'react';
import { toolRegistry } from './registry';
import { useFinance } from '../store/FinanceContext';
import type { ToolContext, ToolResult, ToolCategory } from './types';

/**
 * Hook React para chamar ferramentas do registry.
 *
 * Uso:
 * ```tsx
 * const { callTool } = useTools();
 * const result = await callTool('importar_fatura', { transactions, fileNames });
 * ```
 */
export function useTools() {
  const { getState, dispatch } = useFinance();

  // getState lê o estado mais recente (não o do último render), então uma ferramenta
  // que despacha e depois consulta — ou que chama outra — enxerga o próprio efeito.
  const toolContext = useMemo<ToolContext>(() => {
    const context: ToolContext = {
      getState,
      dispatch,
      callTool: async <R = unknown>(id: string, params: unknown) => {
        const inner = toolRegistry.get(id);
        if (!inner) return { success: false, message: `Ferramenta "${id}" não encontrada` } as ToolResult<R>;
        try {
          const result = await inner.execute(params, context);
          return { success: true, data: result as R, message: `${inner.name} executado` };
        } catch (error) {
          return { success: false, message: String(error) } as ToolResult<R>;
        }
      },
    };
    return context;
  }, [getState, dispatch]);

  const callTool = useCallback(async <TResult = unknown>(toolId: string, params: unknown): Promise<ToolResult<TResult>> => {
    const tool = toolRegistry.get(toolId);
    if (!tool) {
      console.error(`[useTools] Ferramenta não encontrada: "${toolId}"`);
      return { success: false, message: `Ferramenta "${toolId}" não encontrada no registry` };
    }
    try {
      const result = await tool.execute(params, toolContext);
      return { success: true, data: result as TResult, message: `${tool.name} executado com sucesso` };
    } catch (error) {
      console.error(`[useTools] Erro em "${toolId}":`, error);
      return { success: false, message: `Erro em ${tool.name}: ${error instanceof Error ? error.message : String(error)}` };
    }
  }, [toolContext]);

  const getToolsByCategory = useCallback((category: ToolCategory) => toolRegistry.getByCategory(category), []);
  const getAllTools = useCallback(() => toolRegistry.getAll(), []);

  return { callTool, getToolsByCategory, getAllTools };
}

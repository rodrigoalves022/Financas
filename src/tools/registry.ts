import type { ToolDefinition, ToolCategory } from './types';

class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register<TParams, TResult>(tool: ToolDefinition<TParams, TResult>): void {
    if (this.tools.has(tool.id)) {
      console.warn(`[ToolRegistry] Ferramenta "${tool.id}" já registrada — sobrescrevendo.`);
    }
    this.tools.set(tool.id, tool as ToolDefinition);
  }

  get(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  getByCategory(category: ToolCategory): ToolDefinition[] {
    return Array.from(this.tools.values()).filter(t => t.category === category);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }
}

// Singleton — compartilhado por toda a aplicação
export const toolRegistry = new ToolRegistry();

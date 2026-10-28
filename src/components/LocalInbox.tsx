import { useEffect, useRef } from 'react';
import { useFinance } from '../store/FinanceContext';
import { FLAGS, readJsonFlag, writeFlag } from '../store/storage';
import { useTools } from '../tools/useTools';
import { useFeedback } from './ui/feedback';

// Caixa de entrada local (vite.config.ts → /api/inbox): cada pacote em inbox/*.json é uma
// lista de chamadas de ferramenta — o mesmo caminho dos botões da tela —, aplicada uma vez
// e movida para inbox/aplicados. Serve para quem está fora do navegador (o Claude Code)
// lançar dados: o IndexedDB só existe aqui dentro.

interface InboxOperation {
  tool: string;
  params: unknown;
  label?: string;
}

interface InboxPackage {
  name: string;
  data?: { id?: string; title?: string; operations?: InboxOperation[] };
  error?: string;
}

// Só ferramentas que criam ou atualizam: um pacote nunca exclui, limpa nem restaura dados.
const ALLOWED_PREFIXES = ['adicionar_', 'salvar_', 'cadastrar_', 'lancar_', 'pagar_', 'quitar_', 'criar_', 'atualizar_'];
const CHECK_INTERVAL_MS = 10_000;

export function LocalInbox() {
  const { isReady } = useFinance();
  const { callTool } = useTools();
  const { toast } = useFeedback();
  const callToolRef = useRef(callTool);
  const toastRef = useRef(toast);
  const running = useRef(false);

  useEffect(() => {
    callToolRef.current = callTool;
    toastRef.current = toast;
  }, [callTool, toast]);

  useEffect(() => {
    if (!isReady) return;
    const check = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const response = await fetch('/api/inbox', { cache: 'no-store' });
        // Build publicado/APK: a rota não existe e o servidor devolve a página.
        if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) return;
        const { packages = [] } = await response.json() as { packages?: InboxPackage[] };
        const applied = readJsonFlag<Record<string, string>>(FLAGS.inboxApplied, {});

        for (const item of packages) {
          const operations = item.data?.operations;
          if (!Array.isArray(operations)) {
            toastRef.current(`Caixa de entrada: ${item.name} não é um pacote válido${item.error ? ` (${item.error})` : ''}.`, 'error');
            continue;
          }
          const key = item.data?.id || item.name;
          const title = item.data?.title || item.name;
          // Já aplicado mas o arquivo não saiu da pasta (falha no aviso): só move de novo.
          if (!applied[key]) {
            const failures: string[] = [];
            for (const operation of operations) {
              if (!ALLOWED_PREFIXES.some(prefix => operation.tool?.startsWith(prefix))) {
                failures.push(`${operation.tool}: não permitido pela caixa de entrada`);
                continue;
              }
              const result = await callToolRef.current(operation.tool, operation.params);
              if (!result.success) failures.push(`${operation.label || operation.tool}: ${result.message}`);
            }
            applied[key] = new Date().toISOString();
            writeFlag(FLAGS.inboxApplied, JSON.stringify(applied));
            const done = operations.length - failures.length;
            toastRef.current(
              failures.length ? `${title}: ${done} de ${operations.length} aplicados. ${failures[0]}` : `Recebido: ${title} (${operations.length} item(ns)).`,
              failures.length ? 'error' : 'success',
            );
          }
          await fetch('/api/inbox/ack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: item.name }),
          }).catch(() => undefined);
        }
      } catch {
        // Sem caixa de entrada disponível: nada a fazer.
      } finally {
        running.current = false;
      }
    };
    check();
    const timer = window.setInterval(check, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isReady]);

  return null;
}

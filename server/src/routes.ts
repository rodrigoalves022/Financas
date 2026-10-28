import { Router } from 'express';
import { getEvent, getPendingEvents, markEventFailed, markEventsApplied, saveSnapshot, setEventUndo } from './db.js';
import { notifyAllowedChat, tipsKeyboard } from './bot.js';
import { handleAiRequest } from './aiCli.js';
import type { Snapshot, UndoData } from './types.js';

const SYNC_TOKEN = process.env.SYNC_TOKEN;
if (!SYNC_TOKEN) throw new Error('SYNC_TOKEN não configurado (.env)');

export const router = Router();

router.use((req, res, next) => {
  const auth = req.header('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== SYNC_TOKEN) {
    res.status(401).json({ error: 'Token inválido' });
    return;
  }
  next();
});

// Lista eventos ainda não aplicados pelo app.
router.get('/pending-events', (_req, res) => {
  res.json({ events: getPendingEvents() });
});

// Marca eventos como aplicados em lote, sem notificar o Telegram.
router.post('/pending-events/ack', (req, res) => {
  const body = req.body as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is number => typeof id === 'number') : [];
  markEventsApplied(ids);
  res.json({ acked: ids.length });
});

// O app relata o resultado de um evento — fecha o ciclo avisando no Telegram e
// guarda como desfazer aquilo depois, caso o usuário peça.
router.post('/pending-events/:id/result', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'id inválido' });
    return;
  }

  const body = req.body as { success?: unknown; message?: unknown; undo?: unknown };
  const success = Boolean(body.success);
  const message = typeof body.message === 'string' && body.message
    ? body.message
    : (success ? 'Aplicado no app.' : 'Não consegui aplicar no app.');

  if (success) {
    markEventsApplied([id]);
    if (body.undo && typeof body.undo === 'object') setEventUndo(id, body.undo as UndoData);
  } else {
    markEventFailed(id);
  }

  try {
    // Fatura importada pelo chat: oferece as dicas da IA sobre ela logo em seguida.
    const keyboard = success && getEvent(id)?.type === 'importar_fatura' ? await tipsKeyboard() : undefined;
    await notifyAllowedChat(success ? `✅ ${message}` : `⚠️ ${message}`, keyboard);
  } catch (error) {
    console.error('[routes] Falha ao notificar Telegram:', error);
  }

  res.json({ ok: true });
});

// O app envia um resumo de saldos a cada sincronização — é o que permite ao bot
// responder consultas, sugerir nomes parecidos e disparar os lembretes.
router.post('/snapshot', (req, res) => {
  const body = req.body as Partial<Snapshot>;
  if (!Array.isArray(body.people) || !Array.isArray(body.allMemberNames)) {
    res.status(400).json({ error: 'snapshot inválido' });
    return;
  }
  saveSnapshot({
    people: body.people,
    allMemberNames: body.allMemberNames,
    cardInvoice: body.cardInvoice,
    ownDebts: body.ownDebts,
    currentMonth: body.currentMonth,
    financeSummary: body.financeSummary,
    updatedAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

// Modo IA via CLIs (Claude Code / Antigravity) — só responde se o CLI estiver instalado e logado nesta máquina.
router.all('/ai/:action', async (req, res) => {
  const result = await handleAiRequest(req.method, `/${req.params.action}`, req.body);
  if (!result) {
    res.status(404).json({ error: 'Rota de IA desconhecida' });
    return;
  }
  res.status(result.status).json(result.body);
});

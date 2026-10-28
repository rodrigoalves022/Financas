import 'dotenv/config';
import express from 'express';
import { bot, registerCommands } from './bot.js';
import { router } from './routes.js';
import { startReminders } from './reminders.js';
import { describeBotAi } from './botAi.js';

const PORT = Number(process.env.PORT) || 3000;

const app = express();

// CORS liberado: o app roda em outra origem (site publicado, dev local, ou o WebView do
// Capacitor) e o acesso já é protegido pelo bearer token nas rotas, então não há necessidade
// de restringir por origem aqui.
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use('/api', router);
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`[server] Ouvindo na porta ${PORT}`);
});

describeBotAi().then(description => console.log(`[bot-ai] ${description}`)).catch(() => undefined);

registerCommands().catch(error => {
  console.warn('[bot] Não consegui registrar o menu de comandos:', error instanceof Error ? error.message : error);
});

startReminders();

bot.start().catch(error => {
  console.error('[bot] Falha ao iniciar long polling:', error);
});
console.log('[bot] Telegram bot iniciado (long polling)');

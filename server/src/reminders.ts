import { getLastReminderDate, getSnapshot, setLastReminderDate } from './db.js';
import { daysSince, formatBRL } from './format.js';
import { notifyAllowedChat } from './bot.js';

// 0 = domingo … 6 = sábado. Vazio desliga o lembrete.
const WEEKDAY = process.env.REMINDER_WEEKDAY;
const HOUR = Number(process.env.REMINDER_HOUR ?? '9');
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export const remindersEnabled = WEEKDAY !== undefined && WEEKDAY !== '';

const buildReminder = (): string | null => {
  const snapshot = getSnapshot();
  if (!snapshot?.people.length) return null;

  const total = snapshot.people.reduce((sum, person) => sum + person.total, 0);
  const lines = snapshot.people.map(person => {
    const oldest = person.items[0]?.date;
    return `• *${person.name}* — ${formatBRL(person.total)}${oldest ? ` (${daysSince(oldest)}d)` : ''}`;
  });

  return [`🔔 *Lembrete semanal* — te devem ${formatBRL(total)}`, '', ...lines].join('\n');
};

const tick = async () => {
  const now = new Date();
  if (now.getDay() !== Number(WEEKDAY) || now.getHours() !== HOUR) return;

  // A data do último envio evita repetir a cada checagem dentro da mesma hora.
  const today = now.toISOString().substring(0, 10);
  if (getLastReminderDate() === today) return;

  const message = buildReminder();
  if (!message) return;

  try {
    await notifyAllowedChat(message);
    setLastReminderDate(today);
  } catch (error) {
    console.error('[reminders] Falha ao enviar:', error);
  }
};

export const startReminders = () => {
  if (!remindersEnabled) {
    console.log('[reminders] Desativado (defina REMINDER_WEEKDAY no .env)');
    return;
  }
  console.log(`[reminders] Ativo: dia ${WEEKDAY} às ${HOUR}h`);
  setInterval(() => { tick(); }, CHECK_INTERVAL_MS);
};

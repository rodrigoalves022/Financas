import type { Snapshot, SnapshotPerson } from './types.js';

export const formatBRL = (value: number) =>
  `R$ ${value.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

export const daysSince = (isoDate: string): number => {
  const date = new Date(`${isoDate.substring(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
};

/** "há 12s" / "há 5min" — deixa claro quando o app sincronizou pela última vez. */
export const freshness = (updatedAt: string): string => {
  const elapsed = Date.now() - new Date(updatedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return 'agora';
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
};

export const NO_SNAPSHOT_TEXT =
  'Ainda não recebi os dados do app. Abra o app com a sincronização do Telegram configurada e tente de novo.';

export const formatOverview = (snapshot: Snapshot): string => {
  if (!snapshot.people.length) return `🎉 Ninguém está te devendo nada.\n\n_dados ${freshness(snapshot.updatedAt)}_`;

  const total = snapshot.people.reduce((sum, person) => sum + person.total, 0);
  const lines = snapshot.people.map(person => {
    const oldest = person.items[0]?.date;
    const age = oldest ? ` · ${daysSince(oldest)}d` : '';
    return `• *${person.name}* — ${formatBRL(person.total)}${age}`;
  });

  return [
    `💰 *Te devem ${formatBRL(total)}*`,
    '',
    ...lines,
    '',
    `_dados ${freshness(snapshot.updatedAt)}_`,
  ].join('\n');
};

export const formatPerson = (person: SnapshotPerson, snapshot: Snapshot, detailed: boolean): string => {
  const header = `*${person.name}* te deve ${formatBRL(person.total)}`;
  if (!detailed) {
    const oldest = person.items[0]?.date;
    const age = oldest ? `\nPendência mais antiga: ${daysSince(oldest)} dia(s)` : '';
    return `${header}${age}\n\n_dados ${freshness(snapshot.updatedAt)}_`;
  }

  const lines = person.items.map(item =>
    `• ${item.description} — ${formatBRL(item.remaining)} (${daysSince(item.date)}d)`);

  return [header, '', ...lines, '', `_dados ${freshness(snapshot.updatedAt)}_`].join('\n');
};

export const formatCardInvoice = (snapshot: Snapshot): string => {
  const invoice = snapshot.cardInvoice ?? 0;
  const debts = snapshot.ownDebts ?? 0;
  const total = invoice + debts;
  const monthName = snapshot.currentMonth ? snapshot.currentMonth.split('-').reverse().join('/') : 'mês atual';

  const lines = [
    '💳 *Seus compromissos a pagar:*',
    '',
    `• *Fatura do cartão (${monthName}):* ${formatBRL(invoice)}`,
  ];

  if (debts > 0) {
    lines.push(`• *Dívidas próprias / financiamentos:* ${formatBRL(debts)}`);
    lines.push(`• *Total a pagar:* ${formatBRL(total)}`);
  }

  lines.push('');
  lines.push(`_dados ${freshness(snapshot.updatedAt)}_`);

  return lines.join('\n');
};


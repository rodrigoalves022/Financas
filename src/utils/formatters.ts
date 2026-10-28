export const formatBRL = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
};

// Para eixos de gráfico: "R$ 1,2 mil" em vez de "R$1.2k".
export const formatCompactBRL = (value: number): string => {
  const safe = Number.isFinite(value) ? value : 0;
  if (Math.abs(safe) < 1000) return `R$ ${Math.round(safe)}`;
  return `R$ ${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(safe / 1000)} mil`;
};

export const formatPercent = (value: number): string => {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}%`;
};

export const formatDate = (value?: string): string => {
  if (!value) return '';
  const [year, month, day] = value.substring(0, 10).split('-');
  if (!year || !month || !day) return '';
  return `${day}/${month}/${year}`;
};

/** "28/10 14:05" — para carimbos como "gerado em". */
export const formatDateTime = (value?: string): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
};

export const formatMonth = (value?: string): string => {
  if (!value) return 'Todo o período';
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  return `${month}/${year}`;
};

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const formatMonthLong = (value?: string): string => {
  if (!value) return 'Todo o período';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return `${MONTH_NAMES[month - 1]} de ${year}`;
};

export const formatMonthShort = (value?: string): string => {
  if (!value) return '';
  const [year, month] = value.split('-').map(Number);
  if (!year || !month) return value;
  return `${MONTH_SHORT[month - 1]}/${String(year).slice(2)}`;
};

const pad = (value: number) => String(value).padStart(2, '0');

// toISOString() usa UTC: no Brasil, depois das 21h ele já devolve o dia seguinte
// (e no último dia do mês, o mês seguinte). Todas as datas "de hoje" passam por aqui.
export const todayISO = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

export const currentMonthISO = (): string => todayISO().substring(0, 7);

export const shiftMonth = (month: string, offset: number): string => {
  const date = new Date(Number(month.substring(0, 4)), Number(month.substring(5, 7)) - 1 + offset, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
};

export const daysBetween = (fromISO: string, toISO: string): number => {
  const from = new Date(`${fromISO.substring(0, 10)}T12:00:00`).getTime();
  const to = new Date(`${toISO.substring(0, 10)}T12:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
};

export const formatRefMonth = (dueMonth?: string): string => {
  if (!dueMonth) return '';
  const [yearStr, monthStr] = dueMonth.split('-');
  const y = Number(yearStr);
  const m = Number(monthStr);
  if (!y || !m) return '';
  return formatMonth(shiftMonth(dueMonth, -1));
};

export const formatInvoiceMonthLabel = (dueMonth?: string): string => {
  if (!dueMonth) return 'Todo o período';
  const ref = formatRefMonth(dueMonth);
  return ref ? `${formatMonth(dueMonth)} (Ref. ${ref})` : formatMonth(dueMonth);
};

// Aceita "1.234,56", "1234,56" e "1234.56". Inputs type="number" já chegam com ponto,
// mas valores colados ou digitados em campos de texto vêm no formato brasileiro.
export const parseAmount = (value: string | number): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  let text = value.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!text) return 0;
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma > lastDot) text = text.replace(/\./g, '').replace(',', '.');
  else if (lastDot > lastComma && lastComma >= 0) text = text.replace(/,/g, '');
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const normalizeText = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
};

const KEEP_UPPER = /^(?:II|III|IV|VI|VII|VIII|IX|XI|XII|.*\d.*)$/;

export const titleCase = (value: string): string => {
  return value
    .split(/(\s+)/)
    .map(token => {
      // Algarismos romanos e códigos ("II", "24976158HERIE") ficam como vieram.
      if (KEEP_UPPER.test(token)) return token;
      return token.toLowerCase().replace(/^(\p{L})/u, letter => letter.toUpperCase());
    })
    .join('');
};

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

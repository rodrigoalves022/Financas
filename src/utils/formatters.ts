export const formatBRL = (value: number): string => {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number.isFinite(value) ? value : 0);
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

export const formatMonth = (value?: string): string => {
  if (!value) return 'Todo o período';
  const [year, month] = value.split('-');
  if (!year || !month) return value;
  return `${month}/${year}`;
};

export const normalizeText = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
};

export const normalizeMerchant = (description: string): string => {
  let text = normalizeText(description);
  text = text.replace(/\b(APARECIDA|GOIANIA|GOINIA|SAO PAULO|OSASCO|BRA|BR|ECPC|GBU|DE)\b/g, ' ');
  text = text.replace(/\b\d{3,}\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (text.startsWith('CEA ')) return 'CEA';
  if (text.startsWith('PIX CRED')) return 'PIX CREDITO';
  if (text.includes('PORTOPNEUS')) return 'PORTOPNEUS';
  return text || normalizeText(description);
};

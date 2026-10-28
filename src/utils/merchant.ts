import { normalizeText } from './formatters';

// Maquininhas e intermediadores que aparecem antes do nome real do local
// ("PAG*Izabela", "PG TON EMPORIO", "MP *LASKABAR"). Sem removê-los, regras e
// agrupamentos enxergam a maquininha em vez do estabelecimento.
const PROCESSOR_TOKENS: Record<string, string> = {
  PAG: 'PagSeguro',
  PAGSEGURO: 'PagSeguro',
  PG: 'PagSeguro',
  TON: 'Ton',
  MP: 'Mercado Pago',
  MERCADOPAGO: 'Mercado Pago',
  ZP: 'Zoop',
  PINBANK: 'PinBank',
  FROGPAY: 'FrogPay',
  SUMUP: 'SumUp',
  STONE: 'Stone',
  IZ: 'iZettle',
  PICPAY: 'PicPay',
  CIELO: 'Cielo',
  GETNET: 'Getnet',
  EBANX: 'Ebanx',
  PAYPAL: 'PayPal',
  DL: 'dLocal',
  DLOCAL: 'dLocal',
  ASAAS: 'Asaas',
  HTM: 'HTM',
  JIM: 'Jim',
  EC: 'EC',
};

// Só faz sentido remover depois de um prefixo conhecido ("JIM.COM*", "PAG SEGURO").
const SECONDARY_PROCESSOR_TOKENS = new Set(['COM', 'SEGURO', 'TON']);

// Tokens de localização que sobram quando a descrição não segue o layout fixo.
const LOCATION_TOKENS = new Set([
  'BRA', 'BR', 'BRASIL', 'DE', 'DO', 'DA', 'APARECIDA', 'GOIANIA', 'GOINIA', 'GFOIANIA', 'SAO', 'SO', 'PAULO',
  'OSASCO', 'BARUERI', 'CAJAMAR', 'GUARULHOS', 'CERES', 'ANAPOLIS', 'BRASILIA', 'UBERABA', 'UBERLANDIA',
  'CURITIBA', 'RIO', 'JANEIRO', 'BELO', 'HORIZONTE', 'CAMPINAS', 'ARUJA', 'BERNARDO', 'ECPC', 'GBU',
]);

export interface ParsedMerchant {
  /** Nome do estabelecimento normalizado, sem maquininha nem cidade. */
  name: string;
  /** Nome ainda com o prefixo da maquininha (sem cidade). */
  label: string;
  /** Cidade, quando a descrição traz (layout do Inter). */
  city?: string;
  /** Maquininha/intermediador identificado no prefixo. */
  processor?: string;
  /** Descrição inteira normalizada. */
  full: string;
}

const stripProcessor = (tokens: string[]): { processor?: string; tokens: string[] } => {
  if (tokens.length < 2 || !PROCESSOR_TOKENS[tokens[0]]) return { tokens };
  let rest = tokens.slice(1);
  if (rest.length > 1 && SECONDARY_PROCESSOR_TOKENS.has(rest[0])) rest = rest.slice(1);
  return { processor: PROCESSOR_TOKENS[tokens[0]], tokens: rest };
};

const stripTrailingLocation = (tokens: string[]) => {
  const rest = [...tokens];
  while (rest.length > 1) {
    const last = rest[rest.length - 1];
    if (LOCATION_TOKENS.has(last) || /^\d+$/.test(last)) rest.pop();
    else break;
  }
  return rest;
};

/**
 * Quebra a descrição da fatura em maquininha, nome e cidade.
 *
 * O CSV do Inter usa colunas de largura fixa: 22 caracteres de nome, espaço,
 * 13 de cidade, espaço e o país ("MERCADO MERCADOLIVRE   BARUERI       BRA").
 * Quando esse layout aparece, a cidade é separada com precisão — é isso que impede
 * "BARUERI" de casar com a palavra-chave "bar" ou "Bento Gonçalves" com "BENTO".
 */
export const parseMerchant = (description: string): ParsedMerchant => {
  const raw = description.replace(/\s+$/, '');
  const full = normalizeText(raw);
  const fixed = raw.match(/^(.{22}) (.{13}) ([A-Za-z]{2,3})$/);

  let nameTokens: string[];
  let city: string | undefined;
  if (fixed) {
    nameTokens = normalizeText(fixed[1]).split(' ').filter(Boolean);
    city = normalizeText(fixed[2]) || undefined;
  } else {
    nameTokens = stripTrailingLocation(full.split(' ').filter(Boolean));
  }

  const { processor, tokens } = stripProcessor(nameTokens);
  const name = tokens.join(' ') || full;
  return { name, label: nameTokens.join(' ') || full, city, processor, full };
};

/** Chave de agrupamento do estabelecimento: junta variações de maquininha, cidade e número de loja. */
export const normalizeMerchant = (description: string): string => {
  const { name, full } = parseMerchant(description);
  let text = name.replace(/\b\d{3,}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.startsWith('CEA ')) return 'CEA';
  if (text.startsWith('PIX CRED')) return 'PIX CREDITO';
  if (text.includes('PORTOPNEUS')) return 'PORTOPNEUS';
  if (!text) text = full;
  // O Inter repete o nome quando o intermediador é o próprio local ("GOOGLE Google"):
  // sem isto o local aparecia como "Google Google".
  return text.replace(/\b(\w+)(?: \1\b)+/g, '$1');
};

/**
 * Trecho estável do nome para virar palavra-chave de regra:
 * sem maquininha, cidade, números de loja e siglas soltas do final.
 */
export const merchantKeyword = (description: string): string => {
  const { name } = parseMerchant(description);
  const tokens = name.split(' ').filter(token => token && !/^\d{3,}$/.test(token));
  while (tokens.length > 1 && (tokens[tokens.length - 1].length <= 2 || LOCATION_TOKENS.has(tokens[tokens.length - 1]))) tokens.pop();
  return tokens.join(' ') || name;
};

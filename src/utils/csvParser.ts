import Papa from 'papaparse';
import type { Transaction } from '../types';
import { IGNORE_TERMS } from './constants';
import { createCategorizer, type CategorizerContext } from './categorizer';
import { normalizeText, parseAmount } from './formatters';
import { normalizeMerchant } from './merchant';

export { categorize } from './categorizer';

const toIsoDate = (value: unknown): string => {
  const text = String(value ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.substring(0, 10);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
};

const getValue = (row: Record<string, string>, names: string[]) => {
  const normalizedNames = names.map(name => normalizeText(name));
  const entry = Object.entries(row).find(([key]) => normalizedNames.includes(normalizeText(key)));
  return entry?.[1] || '';
};

/** Mês de vencimento embutido no nome do arquivo ("fatura-inter-2026-06.csv"). */
export const invoiceMonthFromFileName = (fileName?: string): string => {
  const match = fileName?.match(/(20\d{2})[-_](0[1-9]|1[0-2])/);
  return match ? `${match[1]}-${match[2]}` : '';
};

const transactionId = (date: string, description: string, amount: number, sourceFile?: string, installment?: string) => {
  return normalizeText(`${date}|${description}|${amount.toFixed(2)}|${sourceFile || ''}|${installment || ''}`).toLowerCase();
};

// Linhas idênticas no mesmo arquivo são compras distintas (duas cervejas de R$ 10 no
// mesmo bar). A primeira mantém o id de sempre — compatível com o que já está salvo —
// e as seguintes ganham o número da ocorrência.
const occurrenceCounter = () => {
  const seen = new Map<string, number>();
  return (baseId: string) => {
    const count = (seen.get(baseId) || 0) + 1;
    seen.set(baseId, count);
    return count;
  };
};

const creditKindOf = (normalizedDescription: string): 'pagamento' | 'estorno' =>
  /\b(?:PAGAMENTO|PAGTO|PGTO)\b/.test(normalizedDescription) ? 'pagamento' : 'estorno';

export const parseCSV = (input: File | string, context: CategorizerContext, sourceFile?: string): Promise<Transaction[]> => {
  const run = createCategorizer(context);
  const nextOccurrence = occurrenceCounter();
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(input, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const transactions = results.data.flatMap<Transaction>(row => {
            const date = toIsoDate(getValue(row, ['data', 'date', 'data compra']));
            const description = String(getValue(row, ['descricao', 'descrição', 'description', 'lançamento', 'lancamento'])).trim();
            const amount = parseAmount(getValue(row, ['valor', 'amount']));
            const installment = String(getValue(row, ['tipo', 'parcela'])).match(/(\d+\/\d+)/)?.[1];
            const rawCategory = String(getValue(row, ['categoria', 'category'])).trim() || undefined;
            const isCredit = amount < 0;
            const normalizedDescription = normalizeText(description);
            const isPixCreditInterest = normalizedDescription.includes('JUROS') && normalizedDescription.includes('PIX CRED');
            const shouldIgnore = !isPixCreditInterest && IGNORE_TERMS.some(term => normalizedDescription.includes(normalizeText(term)));

            if (!date || !description || amount === 0) return [];

            // Valores negativos são créditos na fatura: pagamento ao banco (inclusive
            // antecipado) ou estorno. Não são despesa, mas entram no "valor a pagar".
            if (isCredit) {
              const baseId = `${transactionId(date, description, Math.abs(amount), sourceFile, installment)}|credito`;
              const occurrence = nextOccurrence(baseId);
              return [{
                id: occurrence > 1 ? `${baseId}#${occurrence}` : baseId,
                date,
                description,
                amount: Math.abs(amount),
                categoryId: 'outros',
                type: 'income' as const,
                creditKind: creditKindOf(normalizedDescription),
                source: 'csv' as const,
                sourceFile,
                rawCategory,
                occurrence: occurrence > 1 ? occurrence : undefined,
                normalizedMerchant: normalizeMerchant(description),
              }];
            }
            if (shouldIgnore) return [];

            const category = run(description, rawCategory);
            const baseId = transactionId(date, description, Math.abs(amount), sourceFile, installment);
            const occurrence = nextOccurrence(baseId);
            return [{
              id: occurrence > 1 ? `${baseId}#${occurrence}` : baseId,
              occurrence: occurrence > 1 ? occurrence : undefined,
              date,
              description,
              amount: Math.abs(amount),
              categoryId: category.categoryId,
              categorySource: category.source,
              rawCategory,
              type: 'expense' as const,
              source: 'csv' as const,
              sourceFile,
              installment,
              normalizedMerchant: normalizeMerchant(description),
            }];
          });
          resolve(transactions);
        } catch (error) {
          reject(error);
        }
      },
      error: reject,
    });
  });
};

export const parseOFX = (content: string, context: CategorizerContext, sourceFile?: string): Transaction[] => {
  const run = createCategorizer(context);
  const nextOccurrence = occurrenceCounter();
  const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>)/gi) || [];
  return blocks.flatMap<Transaction>(block => {
    const dateRaw = block.match(/<DTPOSTED>([^<\r\n]+)/i)?.[1]?.substring(0, 8);
    const description = block.match(/<MEMO>([^<\r\n]+)/i)?.[1] || block.match(/<NAME>([^<\r\n]+)/i)?.[1] || '';
    const amount = Number.parseFloat(block.match(/<TRNAMT>([^<\r\n]+)/i)?.[1] || '0');
    if (!dateRaw || !description || amount === 0) return [];
    const date = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
    if (amount > 0) {
      const baseId = `${transactionId(date, description, amount, sourceFile)}|credito`;
      const occurrence = nextOccurrence(baseId);
      return [{
        id: occurrence > 1 ? `${baseId}#${occurrence}` : baseId,
        date,
        description,
        amount,
        categoryId: 'outros',
        type: 'income' as const,
        creditKind: creditKindOf(normalizeText(description)),
        source: 'ofx' as const,
        sourceFile,
        occurrence: occurrence > 1 ? occurrence : undefined,
        normalizedMerchant: normalizeMerchant(description),
      }];
    }
    const category = run(description);
    const baseId = transactionId(date, description, Math.abs(amount), sourceFile);
    const occurrence = nextOccurrence(baseId);
    return [{
      id: occurrence > 1 ? `${baseId}#${occurrence}` : baseId,
      occurrence: occurrence > 1 ? occurrence : undefined,
      date,
      description,
      amount: Math.abs(amount),
      categoryId: category.categoryId,
      categorySource: category.source,
      type: 'expense' as const,
      source: 'ofx' as const,
      sourceFile,
      normalizedMerchant: normalizeMerchant(description),
    }];
  });
};

/** Lê um arquivo de fatura (CSV ou OFX) já com o contexto de categorização atual. */
export const parseInvoiceFile = async (fileName: string, content: string | File, context: CategorizerContext) => {
  if (fileName.toLowerCase().endsWith('.ofx')) {
    const text = typeof content === 'string' ? content : await content.text();
    return parseOFX(text, context, fileName);
  }
  return parseCSV(content, context, fileName);
};

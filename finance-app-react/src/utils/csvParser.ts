import Papa from 'papaparse';
import type { Category, Transaction } from '../types';
import { IGNORE_TERMS } from './constants';
import { normalizeMerchant, normalizeText } from './formatters';

const toNumber = (value: unknown): number => {
  const text = String(value ?? '')
    .replace('R$', '')
    .replace(/\u00a0/g, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(',', '.');
  return Number.parseFloat(text) || 0;
};

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

export const categorize = (description: string, rawCategory: string | undefined, categories: Category[]) => {
  const raw = normalizeText(rawCategory || '');
  if (raw) {
    const exact = categories.find(category => normalizeText(category.name) === raw);
    if (exact) return exact.id;
    if (raw.includes('restaurante') || raw.includes('mercado')) return 'alimentacao';
  }

  const normalizedDescription = normalizeText(description);
  const match = categories.find(category =>
    category.id !== 'outros' && category.keywords.some(keyword => normalizedDescription.includes(normalizeText(keyword))),
  );
  return match?.id || 'outros';
};

const transactionId = (date: string, description: string, amount: number, sourceFile?: string, installment?: string) => {
  return normalizeText(`${date}|${description}|${amount.toFixed(2)}|${sourceFile || ''}|${installment || ''}`).toLowerCase();
};

export const parseCSV = (input: File | string, categories: Category[], sourceFile?: string): Promise<Transaction[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(input, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const transactions = results.data.flatMap(row => {
            const date = toIsoDate(getValue(row, ['data', 'date', 'data compra']));
            const description = String(getValue(row, ['descricao', 'descrição', 'description', 'lançamento', 'lancamento'])).trim();
            const amount = toNumber(getValue(row, ['valor', 'amount']));
            const installment = String(getValue(row, ['tipo', 'parcela'])).match(/(\d+\/\d+)/)?.[1];
            const isCredit = amount < 0;
            const shouldIgnore = IGNORE_TERMS.some(term => normalizeText(description).includes(normalizeText(term)));

            if (!date || !description || amount === 0 || isCredit || shouldIgnore) return [];

            return [{
              id: transactionId(date, description, Math.abs(amount), sourceFile, installment),
              date,
              description,
              amount: Math.abs(amount),
              categoryId: categorize(description, getValue(row, ['categoria', 'category']), categories),
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

export const parseOFX = (content: string, categories: Category[], sourceFile?: string): Transaction[] => {
  const blocks = content.match(/<STMTTRN>[\s\S]*?(?=<STMTTRN>|<\/BANKTRANLIST>)/gi) || [];
  return blocks.flatMap(block => {
    const dateRaw = block.match(/<DTPOSTED>([^<\r\n]+)/i)?.[1]?.substring(0, 8);
    const description = block.match(/<MEMO>([^<\r\n]+)/i)?.[1] || block.match(/<NAME>([^<\r\n]+)/i)?.[1] || '';
    const amount = Number.parseFloat(block.match(/<TRNAMT>([^<\r\n]+)/i)?.[1] || '0');
    if (!dateRaw || !description || amount >= 0) return [];
    const date = `${dateRaw.substring(0, 4)}-${dateRaw.substring(4, 6)}-${dateRaw.substring(6, 8)}`;
    return [{
      id: transactionId(date, description, Math.abs(amount), sourceFile),
      date,
      description,
      amount: Math.abs(amount),
      categoryId: categorize(description, undefined, categories),
      type: 'expense' as const,
      source: 'ofx' as const,
      sourceFile,
      normalizedMerchant: normalizeMerchant(description),
    }];
  });
};

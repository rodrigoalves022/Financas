import type { Category } from '../types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'alimentacao', name: 'Alimentação', color: '#16a34a', keywords: ['supermercado', 'padaria', 'restaurante', 'emporio', 'dona deusa', 'hamburgueria', 'lanchonete', 'acai', 'fish', 'laranjeira'] },
  { id: 'assinaturas', name: 'Assinaturas', color: '#0ea5e9', keywords: ['netflix', 'spotify', 'amazon prime', 'disney', 'hbo', 'gympass', 'wellhub', 'claro flex'] },
  { id: 'compras-online', name: 'Compras online', color: '#8b5cf6', keywords: ['mercadolivre', 'mercado livre', 'shopee', 'aliexpress', 'amazonmktplc', 'magalu'] },
  { id: 'delivery', name: 'Delivery', color: '#f97316', keywords: ['ifood', 'rappi', 'ze delivery', '99food', 'pizza'] },
  { id: 'educacao', name: 'Educação', color: '#7c3aed', keywords: ['faculdade', 'escola', 'curso', 'udemy', 'alura', 'livro'] },
  { id: 'lazer', name: 'Lazer', color: '#f59e0b', keywords: ['cinema', 'teatro', 'show', 'ingresso', 'cerveja', 'distribuidora', 'bebidas', 'laskabar', 'bar'] },
  { id: 'moradia', name: 'Moradia', color: '#64748b', keywords: ['aluguel', 'condominio', 'luz', 'energia', 'agua', 'internet', 'iptu', 'celular'] },
  { id: 'outros', name: 'Outros', color: '#94a3b8', keywords: [] },
  { id: 'pix-via-credito', name: 'Pix no crédito', color: '#06b6d4', keywords: ['pix cred', 'pix credito'] },
  { id: 'saude', name: 'Saúde', color: '#dc2626', keywords: ['farmacia', 'drogaria', 'unimed', 'amil', 'medico', 'consulta', 'exame'] },
  { id: 'tarifas', name: 'Juros e tarifas', color: '#e11d48', keywords: ['iof', 'juros', 'encargos', 'anuidade', 'tarifa'] },
  { id: 'transporte', name: 'Transporte', color: '#2563eb', keywords: ['uber', '99', 'posto', 'gasolina', 'estacionamento', 'ipva', 'seguro auto', 'passagem', 'pedagio', 'pelicano'] },
  { id: 'vestuario', name: 'Vestuário', color: '#db2777', keywords: ['renner', 'c&a', 'cea', 'riachuelo', 'zara', 'roupa', 'calcado', 'tenis', 'shein', 'milano'] },
].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

export const IGNORE_TERMS = ['pagamento', 'pgto', 'pagto', 'cred compra', 'estorno', 'credito fatura'];

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const CATEGORY_COLOR_PALETTE = [
  '#16a34a', '#0ea5e9', '#8b5cf6', '#f97316', '#7c3aed', '#f59e0b', '#64748b', '#06b6d4',
  '#dc2626', '#e11d48', '#2563eb', '#db2777', '#14b8a6', '#84cc16', '#a855f7', '#ef4444',
];

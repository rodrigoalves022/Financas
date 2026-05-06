import type { Category } from '../types';

export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'moradia', name: 'Moradia', color: '#64748b', keywords: ['aluguel', 'condominio', 'luz', 'energia', 'agua', 'internet', 'iptu', 'celular'] },
  { id: 'alimentacao', name: 'Alimentacao', color: '#16a34a', keywords: ['supermercado', 'padaria', 'mercado', 'sup ', 'restaurante', 'emporio', 'dona deusa', 'hamburgueria', 'lanchonete', 'acai', 'fish', 'laranjeira'] },
  { id: 'transporte', name: 'Transporte', color: '#2563eb', keywords: ['uber', '99', 'posto', 'gasolina', 'estacionamento', 'ipva', 'seguro auto', 'passagem', 'pedagio', 'pelicano'] },
  { id: 'lazer', name: 'Lazer', color: '#f59e0b', keywords: ['cinema', 'teatro', 'show', 'ingresso', 'cerveja', 'distribuidora', 'bebidas', 'laskabar', 'bar '] },
  { id: 'saude', name: 'Saude', color: '#dc2626', keywords: ['farmacia', 'drogaria', 'unimed', 'amil', 'medico', 'consulta', 'exame'] },
  { id: 'assinaturas', name: 'Assinaturas', color: '#0ea5e9', keywords: ['netflix', 'spotify', 'amazon prime', 'disney', 'hbo', 'gympass', 'wellhub', 'claro flex'] },
  { id: 'educacao', name: 'Educacao', color: '#7c3aed', keywords: ['faculdade', 'escola', 'curso', 'udemy', 'alura', 'livro'] },
  { id: 'vestuario', name: 'Vestuario', color: '#db2777', keywords: ['renner', 'c&a', 'cea', 'riachuelo', 'zara', 'roupa', 'calcado', 'tenis', 'shopee', 'shein', 'milano'] },
  { id: 'delivery', name: 'Delivery', color: '#f97316', keywords: ['ifood', 'rappi', 'ze delivery', '99food', 'pizza'] },
  { id: 'outros', name: 'Outros', color: '#94a3b8', keywords: [] },
];

export const IGNORE_TERMS = ['pagamento', 'cred compra', 'iof', 'juros', 'encargos'];

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];

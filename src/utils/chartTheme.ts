import { useMemo } from 'react';
import { ACCENTS, useTheme, type ThemeMode } from '../components/ui/theme';
import { formatBRL, formatCompactBRL } from './formatters';

// Recharts desenha SVG com cores em atributos, então as cores vêm do tema em JS
// (não dá para depender só das variáveis CSS).
const PALETTES: Record<ThemeMode, {
  text: string; muted: string; grid: string; surface: string; border: string;
  good: string; bad: string; warn: string; info: string; violet: string; cursor: string;
}> = {
  dark: {
    text: '#ececef', muted: '#8b8f99', grid: '#23262c', surface: '#15171b', border: '#30333b',
    good: '#34d399', bad: '#fb7185', warn: '#fbbf24', info: '#38bdf8', violet: '#c084fc', cursor: 'rgba(255,255,255,0.04)',
  },
  light: {
    text: '#111318', muted: '#6b7280', grid: '#e8eaee', surface: '#ffffff', border: '#e3e5ea',
    good: '#059669', bad: '#e11d48', warn: '#d97706', info: '#0284c7', violet: '#9333ea', cursor: 'rgba(17,19,24,0.04)',
  },
};

export const SERIES_COLORS = ['#ff8a3d', '#34d399', '#4f8dff', '#fbbf24', '#c084fc', '#fb7185', '#2dd4bf', '#a3e635'];

export const useChartTheme = () => {
  const { theme, accent } = useTheme();
  return useMemo(() => {
    // "primary" acompanha a cor de destaque escolhida pelo usuário.
    const colors = { ...PALETTES[theme], primary: ACCENTS[accent][theme][0] };
    return {
      colors,
      axis: {
        tick: { fill: colors.muted, fontSize: 11 },
        axisLine: { stroke: colors.grid },
        tickLine: false as const,
      },
      grid: { stroke: colors.grid, strokeDasharray: '3 3' },
      moneyAxis: (value: number) => formatCompactBRL(Number(value)),
      tooltip: {
        cursor: { fill: colors.cursor },
        contentStyle: {
          backgroundColor: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: 12,
          color: colors.text,
          boxShadow: theme === 'dark' ? '0 16px 40px rgba(0,0,0,0.55)' : '0 12px 32px rgba(15,23,42,0.12)',
          padding: '10px 14px',
          fontSize: 13,
        },
        itemStyle: { color: colors.text },
        labelStyle: { color: colors.muted, fontWeight: 600, marginBottom: 4 },
        formatter: (value: unknown) => formatBRL(Number(value || 0)),
      },
    };
  }, [theme, accent]);
};

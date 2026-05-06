// Cores do tema escuro profissional
export const COLORS = {
  primary: '#3b82f6',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#0ea5e9',
  text: '#fafafa',
  textMuted: '#a1a1aa',
  border: '#262626',
  bg: '#0a0a0a',
  bgElevated: '#141414',
};

export const AXIS_PROPS = {
  tick: { fill: COLORS.textMuted, fontSize: 11 },
  axisLine: { stroke: COLORS.border },
  tickLine: { stroke: COLORS.border },
};

export const GRID_COLOR = COLORS.border;

export const TOOLTIP_PROPS = {
  cursor: false,
  contentStyle: {
    backgroundColor: COLORS.bgElevated,
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    color: COLORS.text,
    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
    padding: '12px 16px',
  },
  itemStyle: { color: COLORS.text },
  labelStyle: { color: COLORS.text, fontWeight: 600, marginBottom: 4 },
};

// Paleta de cores para graficos
export const CHART_COLORS = [
  COLORS.primary,
  COLORS.success,
  COLORS.warning,
  COLORS.info,
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
];

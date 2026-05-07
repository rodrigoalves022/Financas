import React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'elevated' | 'outlined' | 'flat';
}

export const Card: React.FC<CardProps> = ({ children, className = '', variant = 'elevated' }) => {
  return (
    <div className={`card card-${variant} ${className}`}>
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{ title: string; subtitle?: string; icon?: React.ReactNode }> = ({ title, subtitle, icon }) => (
  <div className="flex items-center mb-4 space-x-3">
    {icon && <div className="text-primary">{icon}</div>}
    <div>
      <h3 className="text-lg font-semibold text-text-main">{title}</h3>
      {subtitle && <p className="text-sm text-text-muted">{subtitle}</p>}
    </div>
  </div>
);

export const KPICard: React.FC<{ label: string; value: string; subtext?: string; valueColor?: string }> = ({ label, value, subtext, valueColor = 'text-text-main' }) => (
  <div className="bg-surface border border-white/5 rounded-xl p-5 shadow-sm">
    <p className="text-sm font-medium text-text-muted mb-1 uppercase tracking-wider">{label}</p>
    <p className={`text-3xl font-bold ${valueColor}`}>{value}</p>
    {subtext && <p className="text-sm mt-2 text-text-muted">{subtext}</p>}
  </div>
);

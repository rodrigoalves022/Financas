import type { ReactNode } from 'react';

export function Sidebar({
  children,
  brand,
}: {
  children: ReactNode;
  brand: ReactNode;
}) {
  return (
    <aside className="sidebar">
      {brand}
      {children}
    </aside>
  );
}

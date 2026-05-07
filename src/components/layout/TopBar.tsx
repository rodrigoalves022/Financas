import type { ReactNode } from 'react';

export function TopBar({ children }: { children: ReactNode }) {
  return <header className="topbar">{children}</header>;
}

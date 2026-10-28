import { setSpendingScope, useSpendingScope, type SpendingScope } from '../store/spendingScope';
import { Tabs } from './ui/Card';

/** Alterna as análises entre o gasto total (cartão + contas fixas) e só o cartão. */
export function SpendingScopeTabs() {
  const scope = useSpendingScope();
  return (
    <Tabs<SpendingScope>
      size="sm"
      value={scope}
      onChange={setSpendingScope}
      tabs={[{ id: 'tudo', label: 'Tudo' }, { id: 'cartao', label: 'Só cartão' }]}
    />
  );
}

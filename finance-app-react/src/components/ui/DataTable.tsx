import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Search } from 'lucide-react';

export interface Column<T> {
  key: string;
  label?: string;
  header?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  filterable?: boolean;
  value?: (row: T) => string | number;
  accessor?: (row: T) => string | number;
  sortValue?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  emptyLabel?: string;
  searchPlaceholder?: string;
  initialPageSize?: number;
  pageSize?: number;
}

export function DataTable<T>({
  rows,
  columns,
  emptyLabel = 'Nenhum registro encontrado.',
  searchPlaceholder = 'Buscar na tabela',
  initialPageSize,
  pageSize = 12,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState(columns[0]?.key || '');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const size = initialPageSize || pageSize;
  const getValue = (column: Column<T>, row: T) => (column.value || column.accessor || (() => ''))(row);

  const sortedRows = useMemo(() => {
    const filtered = rows.filter(row => {
      const fullText = columns.map(column => String(getValue(column, row))).join(' ').toLowerCase();
      const matchesSearch = fullText.includes(search.toLowerCase());
      const matchesColumns = columns.every(column => {
        const filter = columnFilters[column.key];
        if (!filter) return true;
        return String(getValue(column, row)).toLowerCase().includes(filter.toLowerCase());
      });
      return matchesSearch && matchesColumns;
    });

    return [...filtered].sort((a, b) => {
      const column = columns.find(item => item.key === sortKey);
      if (!column) return 0;
      const aValue = column.sortValue ? column.sortValue(a) : getValue(column, a);
      const bValue = column.sortValue ? column.sortValue(b) : getValue(column, b);
      const result = typeof aValue === 'number' && typeof bValue === 'number'
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), 'pt-BR');
      return sortDirection === 'asc' ? result : -result;
    });
  }, [rows, columns, search, columnFilters, sortKey, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / size));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = sortedRows.slice((currentPage - 1) * size, currentPage * size);

  const toggleSort = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection(previous => previous === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection('asc');
    }
  };

  return (
    <div className="table-shell">
      <div className="table-toolbar">
        <div className="table-search">
          <Search size={16} />
          <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={searchPlaceholder} />
        </div>
        <span>{sortedRows.length} registro(s)</span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column.key} className={`align-${column.align || 'left'}`}>
                  <button type="button" onClick={() => (column.sortable ?? true) && toggleSort(column.key)}>
                    {column.header || column.label}
                    {sortKey === column.key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {columns.map(column => (
                <th key={`${column.key}-filter`}>
                  {(column.filterable ?? true) ? (
                    <input
                      className="column-filter"
                      value={columnFilters[column.key] || ''}
                      onChange={event => {
                        setColumnFilters(previous => ({ ...previous, [column.key]: event.target.value }));
                        setPage(1);
                      }}
                      placeholder="Filtrar"
                    />
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={index}>
                {columns.map(column => (
                  <td key={column.key} className={`align-${column.align || 'left'}`}>
                    {column.render ? column.render(row) : getValue(column, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!visibleRows.length ? <div className="empty-state compact">{emptyLabel}</div> : null}
      <div className="table-footer">
        <button type="button" disabled={currentPage === 1} onClick={() => setPage(previous => Math.max(1, previous - 1))}>Anterior</button>
        <span>Pagina {currentPage} de {pageCount}</span>
        <button type="button" disabled={currentPage === pageCount} onClick={() => setPage(previous => Math.min(pageCount, previous + 1))}>Proxima</button>
      </div>
    </div>
  );
}

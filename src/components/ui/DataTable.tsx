import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Filter, Search } from 'lucide-react';
import { normalizeText } from '../../utils/formatters';
import { EmptyState } from './EmptyState';

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
  width?: number | string;
}

interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  emptyLabel?: string;
  searchPlaceholder?: string;
  initialPageSize?: number;
  pageSize?: number;
  mobileRender?: (row: T) => ReactNode;
  initialSort?: { key: string; direction: 'asc' | 'desc' };
  rowKey?: (row: T, index: number) => string;
  /** Controles extras na barra (filtros rápidos, botões). */
  toolbar?: ReactNode;
  searchable?: boolean;
  /** Torna a linha clicável (ex.: abrir a Fatura filtrada pela categoria). */
  onRowClick?: (row: T) => void;
  initialSearch?: string;
}

// Valores numéricos também entram na busca no formato brasileiro ("11,90").
const searchableText = (value: string | number) => typeof value === 'number'
  ? `${value} ${value.toFixed(2).replace('.', ',')}`
  : value;

export function DataTable<T>({
  rows,
  columns,
  emptyLabel = 'Nenhum registro encontrado.',
  searchPlaceholder = 'Buscar na tabela',
  initialPageSize,
  pageSize = 12,
  mobileRender,
  initialSort,
  rowKey,
  toolbar,
  searchable = true,
  onRowClick,
  initialSearch = '',
}: DataTableProps<T>) {
  const [search, setSearch] = useState(initialSearch);
  const [sortKey, setSortKey] = useState(initialSort?.key || columns[0]?.key || '');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(initialSort?.direction || 'asc');
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const size = initialPageSize || pageSize;
  const getValue = useCallback((column: Column<T>, row: T) => (column.value || column.accessor || (() => ''))(row), []);
  const hasFilters = columns.some(column => column.filterable ?? true);

  const sortedRows = useMemo(() => {
    const needle = normalizeText(search);
    const filtered = rows.filter(row => {
      if (needle) {
        const fullText = normalizeText(columns.map(column => searchableText(getValue(column, row))).join(' '));
        if (!fullText.includes(needle)) return false;
      }
      return columns.every(column => {
        const filter = columnFilters[column.key];
        if (!filter) return true;
        return normalizeText(String(searchableText(getValue(column, row)))).includes(normalizeText(filter));
      });
    });

    const column = columns.find(item => item.key === sortKey);
    if (!column) return filtered;
    return [...filtered].sort((a, b) => {
      const aValue = column.sortValue ? column.sortValue(a) : getValue(column, a);
      const bValue = column.sortValue ? column.sortValue(b) : getValue(column, b);
      const result = typeof aValue === 'number' && typeof bValue === 'number'
        ? aValue - bValue
        : String(aValue).localeCompare(String(bValue), 'pt-BR');
      return sortDirection === 'asc' ? result : -result;
    });
  }, [rows, columns, search, columnFilters, sortKey, sortDirection, getValue]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / size));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = sortedRows.slice((currentPage - 1) * size, currentPage * size);
  const keyOf = (row: T, index: number) => rowKey ? rowKey(row, index) : String((currentPage - 1) * size + index);

  const toggleSort = (key: string) => {
    setPage(1);
    if (sortKey === key) {
      setSortDirection(previous => previous === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDirection(columns.find(column => column.key === key)?.align === 'right' ? 'desc' : 'asc');
    }
  };

  return (
    <div className={`table-shell ${mobileRender ? 'has-mobile-cards' : ''}`}>
      {searchable || toolbar ? (
        <div className="table-toolbar">
          {searchable ? (
            <div className="search-box">
              <Search size={16} />
              <input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={searchPlaceholder} />
            </div>
          ) : null}
          {toolbar}
          <div className="table-toolbar-end">
            <span className="muted">{sortedRows.length} registro(s)</span>
            {hasFilters ? (
              <button type="button" className={`icon-button ghost ${showFilters ? 'active' : ''}`} onClick={() => setShowFilters(value => !value)} title="Filtros por coluna">
                <Filter size={16} />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map(column => (
                <th key={column.key} className={`align-${column.align || 'left'}`} style={column.width ? { width: column.width } : undefined}>
                  {(column.sortable ?? true) ? (
                    <button type="button" onClick={() => toggleSort(column.key)} className={sortKey === column.key ? 'sorted' : ''}>
                      {column.header || column.label}
                      {sortKey === column.key ? (sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
                    </button>
                  ) : <span>{column.header || column.label}</span>}
                </th>
              ))}
            </tr>
            {showFilters ? (
              <tr className="filter-row">
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
            ) : null}
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr key={keyOf(row, index)} className={onRowClick ? 'clickable' : undefined} onClick={onRowClick ? () => onRowClick(row) : undefined}>
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
      {mobileRender ? (
        <div className="mobile-table-list">
          {visibleRows.map((row, index) => (
            <div key={keyOf(row, index)}>{mobileRender(row)}</div>
          ))}
        </div>
      ) : null}
      {!visibleRows.length ? <EmptyState compact title={emptyLabel} /> : null}
      {pageCount > 1 ? (
        <div className="table-footer">
          <span className="muted">Página {currentPage} de {pageCount}</span>
          <div className="pager">
            <button type="button" className="icon-button" disabled={currentPage === 1} onClick={() => setPage(previous => Math.max(1, previous - 1))} aria-label="Página anterior"><ChevronLeft size={16} /></button>
            <button type="button" className="icon-button" disabled={currentPage === pageCount} onClick={() => setPage(previous => Math.min(pageCount, previous + 1))} aria-label="Próxima página"><ChevronRight size={16} /></button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

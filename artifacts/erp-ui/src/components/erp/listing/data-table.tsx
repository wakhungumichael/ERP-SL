import type { ReactNode } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type ERPTableColumn<Row> = {
  key: string;
  label: string;
  render: (row: Row) => ReactNode;
  headerClassName?: string;
  cellClassName?: string;
};

export function ERPDataTable<Row extends { id: number | string }>({
  columns,
  rows,
  selectedIds,
  onToggleSelected,
  onToggleSelectAllPage,
  onRowClick,
  rowActions,
  emptyState,
  loading,
  loadingLabel = 'Loading…',
}: {
  columns: ERPTableColumn<Row>[];
  rows: Row[];
  selectedIds?: Array<number | string>;
  onToggleSelected?: (id: number | string, checked: boolean) => void;
  onToggleSelectAllPage?: (checked: boolean) => void;
  onRowClick?: (row: Row) => void;
  rowActions?: (row: Row) => ReactNode;
  emptyState?: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
}) {
  const hasSelection = !!selectedIds && !!onToggleSelected && !!onToggleSelectAllPage;
  const allSelected = hasSelection && rows.length > 0 && rows.every((row) => selectedIds.includes(row.id));
  const someSelected = hasSelection && rows.some((row) => selectedIds.includes(row.id));
  const columnCount = columns.length + (hasSelection ? 1 : 0) + (rowActions ? 1 : 0);

  return (
    <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/35 hover:bg-muted/35">
          {hasSelection ? (
            <TableHead className="w-12">
              <Checkbox
                checked={allSelected || (someSelected && 'indeterminate')}
                onCheckedChange={(checked) => onToggleSelectAllPage(checked === true)}
              />
            </TableHead>
          ) : null}
          {columns.map((column) => (
            <TableHead key={column.key} className={column.headerClassName}>{column.label}</TableHead>
          ))}
          {rowActions ? <TableHead className="text-right">Actions</TableHead> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={columnCount} className="py-16 text-center text-sm text-muted-foreground">
              {loadingLabel}
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={columnCount} className="py-16 text-center text-sm text-muted-foreground">
              {emptyState ?? 'No records found.'}
            </TableCell>
          </TableRow>
        ) : rows.map((row) => (
          <TableRow
            key={String(row.id)}
            className={onRowClick ? 'cursor-pointer hover:bg-muted/40' : 'hover:bg-muted/40'}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
          >
            {hasSelection ? (
              <TableCell>
                <Checkbox
                  checked={selectedIds.includes(row.id)}
                  onCheckedChange={(checked) => onToggleSelected(row.id, checked === true)}
                  onClick={(event) => event.stopPropagation()}
                />
              </TableCell>
            ) : null}
            {columns.map((column) => (
              <TableCell key={`${String(row.id)}-${column.key}`} className={column.cellClassName}>{column.render(row)}</TableCell>
            ))}
            {rowActions ? <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>{rowActions(row)}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
    </div>
  );
}

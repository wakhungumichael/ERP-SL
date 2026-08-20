import type { ReactNode } from 'react';

export function ERPFilterBar({
  searchSlot,
  filterSlot,
  toolsSlot,
}: {
  searchSlot: ReactNode;
  filterSlot?: ReactNode;
  toolsSlot?: ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex min-w-[220px] flex-1 items-center gap-2">
          {searchSlot}
        </div>
        {filterSlot}
        {toolsSlot}
      </div>
    </div>
  );
}

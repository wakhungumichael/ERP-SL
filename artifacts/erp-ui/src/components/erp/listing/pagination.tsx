import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ListingPagination({
  page,
  pageSize,
  totalCount,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  const pages: (number | '...')[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push('...');
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i += 1) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-b-lg border-t bg-card px-1 py-2">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="hidden font-mono sm:inline">
          {totalCount === 0 ? 'No records' : `${from}-${to} of ${totalCount.toLocaleString()}`}
        </span>
        <Select value={String(pageSize)} onValueChange={(value) => { onPageSize(Number(value)); onPage(1); }}>
          <SelectTrigger className="h-7 w-28 border-muted text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100].map((value) => (
              <SelectItem key={value} value={String(value)} className="text-xs">
                {value} per page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(1)} title="First page">
          <ChevronsLeft className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPage(page - 1)} title="Previous">
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        {pages.map((value, index) => (
          value === '...'
            ? <span key={`ellipsis-${index}`} className="px-1.5 text-xs text-muted-foreground">...</span>
            : (
              <Button
                key={value}
                variant={value === page ? 'default' : 'outline'}
                size="icon"
                className="h-7 w-7 text-xs font-mono"
                onClick={() => onPage(value)}
              >
                {value}
              </Button>
            )
        ))}
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(page + 1)} title="Next">
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPage(totalPages)} title="Last page">
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

import { useRef } from 'react';
import { GripVertical, Plus, SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type ListingColumnDef = {
  key: string;
  label: string;
};

export function ListingColumnPicker({
  columns,
  visibleKeys,
  onChange,
  minVisible = 2,
}: {
  columns: ListingColumnDef[];
  visibleKeys: string[];
  onChange: (keys: string[]) => void;
  minVisible?: number;
}) {
  const dragIndex = useRef<number | null>(null);

  const toggle = (key: string) => {
    if (visibleKeys.includes(key)) {
      if (visibleKeys.length <= minVisible) return;
      onChange(visibleKeys.filter((item) => item !== key));
      return;
    }
    onChange([...visibleKeys, key]);
  };

  const handleDragStart = (index: number) => {
    dragIndex.current = index;
  };

  const handleDragOver = (event: React.DragEvent, index: number) => {
    event.preventDefault();
    if (dragIndex.current === null || dragIndex.current === index) return;
    const next = [...visibleKeys];
    const [moved] = next.splice(dragIndex.current, 1);
    next.splice(index, 0, moved);
    dragIndex.current = index;
    onChange(next);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 gap-2 text-xs font-medium">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Columns
          <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-bold">
            {visibleKeys.length}
          </Badge>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Columns - drag to reorder
        </div>
        <div className="mb-3 space-y-0.5">
          {visibleKeys.map((key, index) => {
            const column = columns.find((item) => item.key === key);
            if (!column) return null;
            return (
              <div
                key={key}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                className="flex cursor-grab items-center gap-2 rounded bg-muted/40 px-2 py-1.5 transition-colors hover:bg-muted/60 active:cursor-grabbing"
              >
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/50" />
                <span className="flex-1 text-xs font-medium">{column.label}</span>
                <button
                  onClick={() => toggle(key)}
                  className="flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="mb-1.5 text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
          Add columns
        </div>
        <div className="max-h-48 space-y-0.5 overflow-y-auto">
          {columns.filter((column) => !visibleKeys.includes(column.key)).map((column) => (
            <button
              key={column.key}
              onClick={() => toggle(column.key)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Plus className="h-3 w-3 shrink-0" />
              {column.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

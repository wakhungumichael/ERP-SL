import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, GripVertical, MoveLeft, MoveRight, MoveUp, MoveDown, ScanSearch, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { DashboardLayoutItem, DashboardTenantContextValue, DashboardWidgetDefinition, DashboardWidgetId } from '@/components/dashboard/types';

function useViewportColumns() {
  const [columns, setColumns] = useState(12);

  useEffect(() => {
    const sync = () => {
      if (window.innerWidth < 768) setColumns(1);
      else if (window.innerWidth < 1280) setColumns(6);
      else setColumns(12);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  return columns;
}

function ordered(items: DashboardLayoutItem[]) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

function WidgetChrome({
  item,
  definition,
  customizeMode,
  onCollapse,
  onResize,
  onMove,
  onDragStart,
  onDrop,
  children,
}: {
  item: DashboardLayoutItem;
  definition: DashboardWidgetDefinition;
  customizeMode: boolean;
  onCollapse: () => void;
  onResize: () => void;
  onMove: (direction: 'left' | 'right' | 'up' | 'down') => void;
  onDragStart: () => void;
  onDrop: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card
      draggable={customizeMode}
      onDragStart={() => customizeMode && onDragStart()}
      onDragOver={(event) => {
        if (customizeMode) event.preventDefault();
      }}
      onDrop={(event) => {
        if (!customizeMode) return;
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        'h-full overflow-hidden border-border/80 bg-card/95 shadow-sm transition-shadow',
        customizeMode && 'ring-1 ring-primary/15 hover:shadow-md',
      )}
    >
      <CardHeader className="border-b border-border/60 bg-muted/10 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {customizeMode ? <GripVertical className="h-4 w-4 text-muted-foreground" /> : null}
              <CardTitle className="text-base">{definition.title}</CardTitle>
            </div>
            {customizeMode ? <CardDescription>{definition.description}</CardDescription> : null}
          </div>
          <div className="flex items-center gap-1">
            {customizeMode ? <Badge variant="outline" className="hidden xl:inline-flex">{definition.category}</Badge> : null}
            {customizeMode ? (
              <>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onResize} title="Cycle width">
                  <ScanSearch className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onMove('left')} title="Move left">
                  <MoveLeft className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onMove('right')} title="Move right">
                  <MoveRight className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onMove('up')} title="Move up">
                  <MoveUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onMove('down')} title="Move down">
                  <MoveDown className="h-4 w-4" />
                </Button>
              </>
            ) : null}
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onCollapse} title={item.isCollapsed ? 'Expand section' : 'Collapse section'}>
              {item.isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      {!item.isCollapsed ? <CardContent className="p-4">{children}</CardContent> : null}
    </Card>
  );
}

export function DashboardCustomizer({
  widgets,
  layout,
  customizeMode,
  setCustomizeMode,
  updateItem,
  resetLayout,
  serializedPayload,
}: {
  widgets: DashboardWidgetDefinition[];
  layout: DashboardLayoutItem[];
  customizeMode: boolean;
  setCustomizeMode: (value: boolean) => void;
  updateItem: (widgetId: DashboardWidgetId, patch: Partial<DashboardLayoutItem>) => void;
  resetLayout: () => void;
  serializedPayload: DashboardLayoutItem[];
}) {
  const layoutById = useMemo(() => new Map(layout.map((item) => [item.widgetId, item])), [layout]);

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Layout
            </CardTitle>
            <CardDescription>Personal arrangement and visibility settings.</CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Customize</span>
            <Switch checked={customizeMode} onCheckedChange={setCustomizeMode} />
            <Button variant="outline" size="sm" onClick={resetLayout}>Reset</Button>
          </div>
        </div>
      </CardHeader>
      {customizeMode ? (
        <CardContent className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
          <ScrollArea className="max-h-[420px] pr-4">
            <div className="space-y-3">
              {widgets.map((widget) => {
                const item = layoutById.get(widget.id);
                if (!item) return null;
                return (
                  <div key={widget.id} className="rounded-2xl border border-border/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">{widget.title}</div>
                        <p className="mt-1 text-sm text-muted-foreground">{widget.description}</p>
                      </div>
                      <Switch checked={item.isEnabled} onCheckedChange={(checked) => updateItem(widget.id, { isEnabled: checked })} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <Badge variant="secondary">x:{item.x}</Badge>
                      <Badge variant="secondary">y:{item.y}</Badge>
                      <Badge variant="secondary">w:{item.w}</Badge>
                      <Badge variant="secondary">h:{item.h}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
          <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-4">
            <div className="text-sm font-semibold">Saved Layout</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Preview of the stored widget arrangement.
            </p>
            <Separator className="my-3" />
            <pre className="max-h-[320px] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
              {JSON.stringify(serializedPayload, null, 2)}
            </pre>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}

export function DashboardGridEngine({
  widgets,
  layout,
  tenantContext,
  canViewSensitive,
  customizeMode,
  updateItem,
  moveItem,
  swapItems,
  cycleWidgetWidth,
}: {
  widgets: DashboardWidgetDefinition[];
  layout: DashboardLayoutItem[];
  tenantContext: DashboardTenantContextValue;
  canViewSensitive: boolean;
  customizeMode: boolean;
  updateItem: (widgetId: DashboardWidgetId, patch: Partial<DashboardLayoutItem>) => void;
  moveItem: (widgetId: DashboardWidgetId, direction: 'left' | 'right' | 'up' | 'down') => void;
  swapItems: (sourceId: DashboardWidgetId, targetId: DashboardWidgetId) => void;
  cycleWidgetWidth: (widgetId: DashboardWidgetId) => void;
}) {
  const columns = useViewportColumns();
  const [draggingId, setDraggingId] = useState<DashboardWidgetId | null>(null);
  const widgetMap = useMemo(() => new Map(widgets.map((widget) => [widget.id, widget])), [widgets]);
  const rendered = ordered(layout).filter((item) => item.isEnabled && widgetMap.has(item.widgetId));

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: columns === 1 ? 'auto' : '76px',
      }}
    >
      {rendered.map((item) => {
        const definition = widgetMap.get(item.widgetId);
        if (!definition) return null;
        const span = columns === 1 ? 1 : Math.min(item.w, columns);
        const start = columns === 1 ? 1 : Math.min(item.x, Math.max(columns - span, 0)) + 1;
        const Component = definition.component;

        return (
          <div
            key={item.widgetId}
            style={{
              gridColumn: `${start} / span ${span}`,
              gridRow: columns === 1 ? 'auto' : `${Math.max(1, item.y + 1)} / span ${Math.max(1, item.h)}`,
            }}
          >
            <WidgetChrome
              item={item}
              definition={definition}
              customizeMode={customizeMode}
              onCollapse={() => updateItem(item.widgetId, { isCollapsed: !item.isCollapsed })}
              onResize={() => cycleWidgetWidth(item.widgetId)}
              onMove={(direction) => moveItem(item.widgetId, direction)}
              onDragStart={() => setDraggingId(item.widgetId)}
              onDrop={() => {
                if (draggingId && draggingId !== item.widgetId) {
                  swapItems(draggingId, item.widgetId);
                }
                setDraggingId(null);
              }}
            >
              <Component
                tenantContext={tenantContext}
                canViewSensitive={canViewSensitive}
                customizeMode={customizeMode}
              />
            </WidgetChrome>
          </div>
        );
      })}
    </div>
  );
}

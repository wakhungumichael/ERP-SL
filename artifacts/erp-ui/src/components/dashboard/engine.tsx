/* Copyright (c) 2026 Siakora Labs Limited. Author: Michael Wakhungu. */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  MoveLeft,
  MoveRight,
  MoveUp,
  MoveDown,
  ScanSearch,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  DashboardLayoutItem,
  DashboardTenantContextValue,
  DashboardWidgetDefinition,
  DashboardWidgetId,
} from "@/components/dashboard/types";

function useViewportColumns() {
  const [columns, setColumns] = useState(12);

  useEffect(() => {
    const sync = () => {
      if (window.innerWidth < 768) setColumns(1);
      else if (window.innerWidth < 1280) setColumns(6);
      else setColumns(12);
    };

    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return columns;
}

function ordered(items: DashboardLayoutItem[]) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

// Role filtering can remove widgets from the middle of a saved layout. Pack the
// remaining cards for the normal dashboard view so missing cards leave no gaps.
function compactVisibleLayout(items: DashboardLayoutItem[], columns: number) {
  if (columns === 1) return items;

  const occupied = new Set<string>();

  const isFree = (x: number, y: number, width: number, height: number) => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        if (occupied.has(`${column}:${row}`)) return false;
      }
    }
    return true;
  };

  const occupy = (x: number, y: number, width: number, height: number) => {
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        occupied.add(`${column}:${row}`);
      }
    }
  };

  return ordered(items).map((item) => {
    const width = Math.min(Math.max(1, item.w), columns);
    const height = Math.max(1, item.h);
    const preferredX = Math.min(Math.max(0, item.x), columns - width);
    let y = 0;
    let x = preferredX;

    while (true) {
      const candidates = [
        preferredX,
        ...Array.from(
          { length: columns - width + 1 },
          (_, index) => index,
        ).filter((candidate) => candidate !== preferredX),
      ];
      const available = candidates.find((candidate) =>
        isFree(candidate, y, width, height),
      );

      if (available !== undefined) {
        x = available;
        break;
      }
      y += 1;
    }

    occupy(x, y, width, height);
    return { ...item, x, y, w: width, h: height };
  });
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
  onMove: (direction: "left" | "right" | "up" | "down") => void;
  onDragStart: () => void;
  onDrop: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card
      draggable={customizeMode}
      onDragStart={(event) => {
        if (!customizeMode) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.widgetId);
        onDragStart();
      }}
      onDragOver={(event) => {
        if (!customizeMode) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (!customizeMode) return;
        event.preventDefault();
        onDrop();
      }}
      className={cn(
        "h-full overflow-hidden border-border/80 bg-card/95 shadow-sm transition-shadow",
        customizeMode && "ring-1 ring-primary/15 hover:shadow-md",
      )}
    >
      <CardHeader className="border-b border-border/60 bg-muted/10 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              {customizeMode ? (
                <GripVertical className="h-4 w-4 text-muted-foreground" />
              ) : null}
              <CardTitle className="text-base">{definition.title}</CardTitle>
            </div>
            {customizeMode ? (
              <CardDescription>{definition.description}</CardDescription>
            ) : null}
          </div>

          <div className="flex items-center gap-1">
            {customizeMode ? (
              <Badge variant="outline" className="hidden xl:inline-flex">
                {definition.category}
              </Badge>
            ) : null}

            {customizeMode ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={onResize}
                  title="Cycle width"
                  aria-label={`Change width of ${definition.title}`}
                >
                  <ScanSearch className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onMove("left")}
                  title="Move left"
                  aria-label={`Move ${definition.title} left`}
                >
                  <MoveLeft className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onMove("right")}
                  title="Move right"
                  aria-label={`Move ${definition.title} right`}
                >
                  <MoveRight className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onMove("up")}
                  title="Move up"
                  aria-label={`Move ${definition.title} up`}
                >
                  <MoveUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onMove("down")}
                  title="Move down"
                  aria-label={`Move ${definition.title} down`}
                >
                  <MoveDown className="h-4 w-4" />
                </Button>
              </>
            ) : null}

            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={onCollapse}
              title={item.isCollapsed ? "Expand section" : "Collapse section"}
              aria-label={
                item.isCollapsed
                  ? `Expand ${definition.title}`
                  : `Collapse ${definition.title}`
              }
            >
              {item.isCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {!item.isCollapsed ? (
        <CardContent className="p-4">{children}</CardContent>
      ) : null}
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
}: {
  widgets: DashboardWidgetDefinition[];
  layout: DashboardLayoutItem[];
  customizeMode: boolean;
  setCustomizeMode: (value: boolean) => void;
  updateItem: (
    widgetId: DashboardWidgetId,
    patch: Partial<DashboardLayoutItem>,
  ) => void;
  resetLayout: () => void;
}) {
  const [draggingId, setDraggingId] = useState<DashboardWidgetId | null>(null);

  const layoutById = useMemo(
    () => new Map(layout.map((item) => [item.widgetId, item])),
    [layout],
  );

  const orderedWidgets = ordered(layout)
    .map((item) => widgets.find((widget) => widget.id === item.widgetId))
    .filter((widget): widget is DashboardWidgetDefinition => Boolean(widget));

  const reorderWidgets = (targetId: DashboardWidgetId) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      return;
    }

    const enabledWidgets = orderedWidgets.filter(
      (widget) => layoutById.get(widget.id)?.isEnabled,
    );
    const disabledWidgets = orderedWidgets.filter(
      (widget) => !layoutById.get(widget.id)?.isEnabled,
    );
    const reordered = [...enabledWidgets];

    const sourceIndex = reordered.findIndex(
      (widget) => widget.id === draggingId,
    );
    const targetIndex = reordered.findIndex((widget) => widget.id === targetId);

    if (sourceIndex < 0 || targetIndex < 0) {
      setDraggingId(null);
      return;
    }

    const [movedWidget] = reordered.splice(sourceIndex, 1);
    reordered.splice(targetIndex, 0, movedWidget);

    // Repack in a 12-column layout so reordered cards don't overlap.
    let x = 0;
    let y = 0;
    let rowHeight = 0;

    [...reordered, ...disabledWidgets].forEach((widget) => {
      const item = layoutById.get(widget.id);
      if (!item) return;

      const width = Math.min(12, Math.max(1, item.w));
      const height = Math.max(1, item.h);

      if (x + width > 12) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }

      updateItem(widget.id, { x, y, w: width });
      x += width;
      rowHeight = Math.max(rowHeight, height);
    });

    setDraggingId(null);
  };

  return (
    <Card className="border-border/70 bg-card/95 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              Arrange dashboard
            </CardTitle>
            <CardDescription>
              Drag cards to reorder them. Changes save automatically.
            </CardDescription>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Customize</span>
            <Switch
              checked={customizeMode}
              onCheckedChange={setCustomizeMode}
              aria-label="Customize dashboard"
            />
            <Button variant="outline" size="sm" onClick={resetLayout}>
              Reset
            </Button>
          </div>
        </div>
      </CardHeader>

      {customizeMode ? (
        <CardContent className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Cards and visibility</h3>
            <ScrollArea className="max-h-[420px] pr-4">
              <div className="space-y-2">
                {orderedWidgets.map((widget) => {
                  const item = layoutById.get(widget.id);
                  if (!item) return null;

                  return (
                    <div
                      key={widget.id}
                      className="flex items-center justify-between gap-3 rounded-xl border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">
                          {widget.title}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                          {widget.description}
                        </p>
                      </div>
                      <Switch
                        aria-label={`Show ${widget.title}`}
                        checked={item.isEnabled}
                        onCheckedChange={(checked) =>
                          updateItem(widget.id, { isEnabled: checked })
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Visible card order</h3>
            <div className="grid grid-cols-1 gap-2 rounded-xl border border-dashed bg-muted/20 p-3 sm:grid-cols-2">
              {orderedWidgets
                .filter((widget) => layoutById.get(widget.id)?.isEnabled)
                .map((widget) => (
                  <button
                    key={widget.id}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", widget.id);
                      setDraggingId(widget.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      reorderWidgets(widget.id);
                    }}
                    onDragEnd={() => setDraggingId(null)}
                    className={cn(
                      "min-h-20 rounded-xl border bg-card p-3 text-left shadow-sm transition-opacity",
                      draggingId === widget.id && "opacity-50",
                    )}
                    aria-label={`Drag to reorder ${widget.title}`}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {widget.title}
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      {widget.description}
                    </span>
                  </button>
                ))}
            </div>
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
  updateItem: (
    widgetId: DashboardWidgetId,
    patch: Partial<DashboardLayoutItem>,
  ) => void;
  moveItem: (
    widgetId: DashboardWidgetId,
    direction: "left" | "right" | "up" | "down",
  ) => void;
  swapItems: (sourceId: DashboardWidgetId, targetId: DashboardWidgetId) => void;
  cycleWidgetWidth: (widgetId: DashboardWidgetId) => void;
}) {
  const columns = useViewportColumns();
  const [draggingId, setDraggingId] = useState<DashboardWidgetId | null>(null);
  const widgetMap = useMemo(
    () => new Map(widgets.map((widget) => [widget.id, widget])),
    [widgets],
  );
  const visibleItems = ordered(layout).filter(
    (item) => item.isEnabled && widgetMap.has(item.widgetId),
  );
  const rendered = customizeMode
    ? visibleItems
    : compactVisibleLayout(visibleItems, columns);

  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridAutoRows: columns === 1 ? "auto" : "76px",
      }}
    >
      {rendered.map((item) => {
        const definition = widgetMap.get(item.widgetId);
        if (!definition) return null;

        const span = columns === 1 ? 1 : Math.min(item.w, columns);
        const start =
          columns === 1 ? 1 : Math.min(item.x, Math.max(columns - span, 0)) + 1;
        const Component = definition.component;

        return (
          <div
            key={item.widgetId}
            style={{
              gridColumn: `${start} / span ${span}`,
              gridRow:
                columns === 1
                  ? "auto"
                  : `${Math.max(1, item.y + 1)} / span ${Math.max(1, item.h)}`,
            }}
          >
            <WidgetChrome
              item={item}
              definition={definition}
              customizeMode={customizeMode}
              onCollapse={() =>
                updateItem(item.widgetId, {
                  isCollapsed: !item.isCollapsed,
                })
              }
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

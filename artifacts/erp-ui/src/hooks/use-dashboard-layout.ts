import { useEffect, useMemo, useState } from 'react';
import type { DashboardLayoutItem, DashboardWidgetDefinition, DashboardWidgetId } from '@/components/dashboard/types';

const STORAGE_VERSION = 'v2';

function normalizeLayout(
  widgets: DashboardWidgetDefinition[],
  saved: DashboardLayoutItem[] | null,
): DashboardLayoutItem[] {
  const defaults = widgets.map((widget) => ({ ...widget.defaultLayout }));
  if (!saved || !saved.length) return defaults;

  const savedMap = new Map(saved.map((item) => [item.widgetId, item]));
  return defaults.map((fallback) => ({
    ...fallback,
    ...(savedMap.get(fallback.widgetId) ?? {}),
    widgetId: fallback.widgetId,
  }));
}

function sortLayout(items: DashboardLayoutItem[]) {
  return [...items].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function useDashboardLayout(
  widgets: DashboardWidgetDefinition[],
  storageScope: string,
) {
  const storageKey = `sl-erp-dashboard-layout:${STORAGE_VERSION}:${storageScope}`;
  const [customizeMode, setCustomizeMode] = useState(false);
  const [layout, setLayout] = useState<DashboardLayoutItem[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? (JSON.parse(raw) as DashboardLayoutItem[]) : null;
      return normalizeLayout(widgets, parsed);
    } catch {
      return normalizeLayout(widgets, null);
    }
  });

  useEffect(() => {
    setLayout((current) => normalizeLayout(widgets, current));
  }, [widgets]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {}
  }, [layout, storageKey]);

  const updateItem = (widgetId: DashboardWidgetId, patch: Partial<DashboardLayoutItem>) => {
    setLayout((current) =>
      current.map((item) => (item.widgetId === widgetId ? { ...item, ...patch } : item)),
    );
  };

  const moveItem = (widgetId: DashboardWidgetId, direction: 'left' | 'right' | 'up' | 'down') => {
    setLayout((current) =>
      current.map((item) => {
        if (item.widgetId !== widgetId) return item;
        if (direction === 'left') return { ...item, x: Math.max(0, item.x - 1) };
        if (direction === 'right') return { ...item, x: Math.min(11, item.x + 1) };
        if (direction === 'up') return { ...item, y: Math.max(0, item.y - 1) };
        return { ...item, y: item.y + 1 };
      }),
    );
  };

  const swapItems = (sourceId: DashboardWidgetId, targetId: DashboardWidgetId) => {
    setLayout((current) => {
      const source = current.find((item) => item.widgetId === sourceId);
      const target = current.find((item) => item.widgetId === targetId);
      if (!source || !target) return current;
      return current.map((item) => {
        if (item.widgetId === sourceId) {
          return { ...item, x: target.x, y: target.y };
        }
        if (item.widgetId === targetId) {
          return { ...item, x: source.x, y: source.y };
        }
        return item;
      });
    });
  };

  const cycleWidgetWidth = (widgetId: DashboardWidgetId) => {
    setLayout((current) =>
      current.map((item) => {
        if (item.widgetId !== widgetId) return item;
        const next = item.w >= 12 ? 4 : item.w >= 8 ? 12 : item.w >= 6 ? 8 : 6;
        return { ...item, w: next };
      }),
    );
  };

  const resetLayout = () => setLayout(normalizeLayout(widgets, null));

  const serializedPayload = useMemo(
    () => sortLayout(layout).map((item) => ({ ...item })),
    [layout],
  );

  return {
    layout,
    customizeMode,
    setCustomizeMode,
    updateItem,
    moveItem,
    swapItems,
    cycleWidgetWidth,
    resetLayout,
    serializedPayload,
  };
}

/* Copyright (c) 2026 Siakora Labs Limited. */
import type { ReactNode } from "react";
import { ERPTableToolbar } from "./table-toolbar";
export function ERPFilterBar({
  searchSlot,
  filterSlot,
  filterControl,
  toolsSlot,
  controlsSlot,
}: {
  searchSlot?: ReactNode;
  filterSlot?: ReactNode;
  filterControl?: ReactNode;
  toolsSlot?: ReactNode;
  controlsSlot?: ReactNode;
}) {
  return (
    <ERPTableToolbar
      external
      searchSlot={searchSlot}
      filterSlot={filterSlot}
      filterControl={filterControl}
      toolsSlot={toolsSlot}
      controlsSlot={controlsSlot}
    />
  );
}

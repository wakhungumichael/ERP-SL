/* Copyright (c) 2026 Siakora Labs Limited. */
export function csvCell(value: string): string {
  const safe = /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function tableTextRows(
  table: HTMLTableElement,
  hidden: number[],
): string[][] {
  return Array.from(table.rows)
    .filter(
      (row) =>
        row.dataset.tablePlaceholder !== "true" &&
        !row.hidden &&
        row.dataset.tableSearchHidden !== "true" &&
        row.dataset.tablePageHidden !== "true",
    )
    .map((row) =>
      Array.from(row.cells)
        .filter((_cell, index) => !hidden.includes(index))
        .map((cell) => {
          const input = cell.querySelector<
            HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
          >("input:not([type=checkbox]):not([type=radio]),select,textarea");
          return (input?.value ?? cell.innerText ?? cell.textContent ?? "")
            .replace(/\s+/g, " ")
            .trim();
        }),
    );
}
export const toCsv = (rows: string[][]) =>
  "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
export function downloadTable(table: HTMLTableElement, hidden: number[]) {
  const url = URL.createObjectURL(
    new Blob([toCsv(tableTextRows(table, hidden))], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "displayed-records.csv";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function printTable(table: HTMLTableElement, hidden: number[]) {
  const rows = tableTextRows(table, hidden);
  const frame = document.createElement("iframe");
  frame.title = "Print displayed records";
  frame.style.cssText =
    "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0";
  frame.srcdoc =
    "<!doctype html><html><head><title>Displayed records</title><style>body{font:12px Arial;margin:24px}table{width:100%;border-collapse:collapse}td{border:1px solid #ccc;padding:7px}tr:first-child{font-weight:bold;background:#eee}@page{size:landscape;margin:12mm}</style></head><body><table>" +
    rows
      .map(
        (row) =>
          "<tr>" +
          row.map((cell) => "<td>" + escapeHtml(cell) + "</td>").join("") +
          "</tr>",
      )
      .join("") +
    "</table></body></html>";
  frame.onload = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

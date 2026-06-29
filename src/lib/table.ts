// Shared table/cell helpers. Cells in ejected section components may be written
// as plain strings (no span) or objects {text,colspan,rowspan} when merged —
// both are normalized here so the components stay easy to hand-edit.

export type RawCell = string | { text: string; colspan?: number; rowspan?: number };
export type Row = RawCell[];

export type Cell = { text: string; colspan: number; rowspan: number };

export const normCell = (c: RawCell): Cell =>
  typeof c === "string"
    ? { text: c, colspan: 1, rowspan: 1 }
    : { text: c.text ?? "", colspan: c.colspan ?? 1, rowspan: c.rowspan ?? 1 };

export const cellText = (c: RawCell): string => (typeof c === "string" ? c : c.text ?? "");

// Devanagari digits (idempotent — content is already converted, this is a guard)
const NE = "०१२३४५६७८९";
export const ne = (s: string | number | null | undefined): string =>
  String(s ?? "").replace(/[0-9]/g, (d) => NE[+d]);

export const isNumericCell = (t: string) =>
  /^[\s०-९0-9.,%()\/\-–]+$/.test(t.trim()) && /[०-९0-9]/.test(t);

export const isTotalRow = (cells: Cell[]) =>
  cells.length > 0 && /जम्मा|कुल|प्रतिशत|योग/.test(cells[0].text);

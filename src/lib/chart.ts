import type { Row } from "./table";
import { cellText } from "./table";

export type Chart = { type: "bar" | "donut"; labels: string[]; values: number[] };

const toNum = (t: string): number | null => {
  const s = (t || "").replace(/[,\s%]/g, "").replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d).toString());
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const isTotalLabel = (t: string) => /जम्मा|कुल|प्रतिशत|योग/.test(t || "");

// Auto-build a chart from a table's rows: first column = labels, the numeric
// column with the most usable values = series. Returns null for text tables.
export function chartFromRows(rows: Row[]): Chart | null {
  if (!rows || rows.length < 3) return null;
  const dataRows = rows.slice(1).filter((r) => cellText(r[0]).trim() && !isTotalLabel(cellText(r[0])));
  if (dataRows.length < 2) return null;
  const ncol = Math.max(...rows.map((r) => r.length));

  let best = -1, bestScore = -1;
  for (let c = 1; c < ncol; c++) {
    let cnt = 0;
    for (const r of dataRows) if (r[c] != null && toNum(cellText(r[c])) != null) cnt++;
    if (cnt < 2) continue;
    const header = (rows[0][c] ? cellText(rows[0][c]) : "") + (rows[1] && rows[1][c] ? cellText(rows[1][c]) : "");
    const score = cnt + (/जम्मा|कुल/.test(header) ? 100 : 0) - (/प्रतिशत|%/.test(header) ? 50 : 0);
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best < 0) return null;

  let labels: string[] = [];
  let values: number[] = [];
  for (const r of dataRows) {
    const v = r[best] != null ? toNum(cellText(r[best])) : null;
    const label = cellText(r[0]).trim();
    if (v == null || v <= 0 || !label) continue;
    labels.push(label);
    values.push(v);
  }
  if (labels.length < 2) return null;
  const order = labels.map((_, i) => i).sort((a, b) => values[b] - values[a]).slice(0, 12);
  return { type: order.length <= 6 ? "donut" : "bar", labels: order.map((i) => labels[i]), values: order.map((i) => values[i]) };
}

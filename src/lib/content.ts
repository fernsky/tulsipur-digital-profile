import data from "../data/content.json";

export type Cell = { text: string; colspan: number; rowspan: number; header: boolean };
export type Block =
  | { type: "paragraph"; text: string }
  | { type: "note"; text: string }
  | { type: "heading"; level: number; text: string; id: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; caption?: string; rows: Cell[][]; source?: string }
  | { type: "image"; src: string; caption?: string; width?: number | null; height?: number | null };
export type Subsection = { id: string; title: string };
export type Section = { id: string; title: string; tableCount: number; blocks: Block[]; subsections: Subsection[] };
export type Chapter = {
  id: string;
  number: number;
  title: string;
  tableCount: number;
  paragraphCount: number;
  sections: Section[];
};
export type Meta = {
  title: string;
  subtitle: string;
  place: string;
  chapters: number;
  sections: number;
  tables: number;
  paragraphs: number;
};

export const meta = data.meta as Meta;
export const chapters = data.chapters as Chapter[];

// Convert every ASCII digit in displayed text to Devanagari numerals.
const NE = "०१२३४५६७८९";
export const ne = (s: string | number | null | undefined): string =>
  String(s ?? "").replace(/[0-9]/g, (d) => NE[+d]);

export const chapterByNumber = (n: number) => chapters.find((c) => c.number === n);

// ---- KPI extraction (verified against the source tables) -------------------

const allTables = (): { caption: string; rows: Cell[][] }[] => {
  const out: { caption: string; rows: Cell[][] }[] = [];
  for (const c of chapters)
    for (const s of c.sections)
      for (const b of s.blocks)
        if (b.type === "table") out.push({ caption: s.title, rows: b.rows });
  return out;
};

const findTable = (sub: string) => allTables().find((t) => t.caption.includes(sub));
const rowStarting = (rows: Cell[][], sub: string) =>
  rows.find((r) => r[0] && r[0].text.includes(sub));
const colIndex = (rows: Cell[][], sub: string) =>
  rows[0]?.findIndex((c) => c.text.includes(sub)) ?? -1;

export type Kpi = { label: string; value: string; unit?: string };

export function getKpis(): Kpi[] {
  const kpis: Kpi[] = [];
  const popT = findTable("जनसंख्याको विवरण");
  if (popT) {
    const pop = rowStarting(popT.rows, "जम्मा जनसंख्या");
    const lit = rowStarting(popT.rows, "साक्षरता");
    if (pop) kpis.push({ label: "जम्मा जनसंख्या", value: pop[1].text });
    if (lit) kpis.push({ label: "साक्षरता दर", value: lit[1].text, unit: "%" });
  }
  const wardT = findTable("वडागत क्षेत्रफल");
  if (wardT) {
    // The जम्मा (total) row has fixed data positions (header has merged
    // male/female columns, so name-based lookup misaligns):
    //   0 जम्मा · 1 घरधुरी · 2 २०६८ · 3 पुरुष · 4 महिला · 5 २०७८ जम्मा
    //   6 वृद्धिदर · 7 क्षेत्रफल · 8 जनघनत्व · 9 परिवार आकार · 10 लैङ्गिक अनुपात
    const jamma = rowStarting(wardT.rows, "जम्मा");
    if (jamma && jamma.length >= 8) {
      kpis.push({ label: "जम्मा घरधुरी", value: jamma[1].text });
      kpis.push({ label: "जनसंख्या वृद्धिदर", value: jamma[6].text, unit: "%" });
      kpis.push({ label: "क्षेत्रफल", value: jamma[7].text, unit: "वर्ग कि.मि." });
    }
    // ward count = highest ward number in the first column
    const wardNums = wardT.rows
      .map((r) => {
        const n = (r[0]?.text || "").trim().replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d).toString());
        return /^\d+$/.test(n) ? parseInt(n, 10) : 0;
      })
      .filter((n) => n > 0 && n < 100);
    const wards = wardNums.length ? Math.max(...wardNums) : 0;
    if (wards > 0) kpis.push({ label: "वडा संख्या", value: String(wards) });
  }
  return kpis;
}

// ---- numeric-cell detection for table rendering ----------------------------

export const isNumericCell = (t: string) =>
  /^[\s०-९0-9.,%()\/\-–]+$/.test(t.trim()) && /[०-९0-9]/.test(t);

export const isTotalRow = (cells: Cell[]) =>
  cells.length > 0 && /जम्मा|कुल|प्रतिशत|k\|ltzt/.test(cells[0].text);

// ---- curated charts (clean extractable tables only) ------------------------

export type Chart = { type: "bar" | "donut"; labels: string[]; values: number[] };

const toNum = (t: string): number | null => {
  const s = (t || "").replace(/[,\s%]/g, "").replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d).toString());
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};
const isTotalLabel = (t: string) => /जम्मा|कुल|प्रतिशत|योग|कुल जम्मा/.test(t || "");

// Auto-build a chart from ANY data table: first column = labels, the numeric
// column with the most usable values = series. Returns null for text-only tables.
export function autoChart(table: Extract<Block, { type: "table" }>): Chart | null {
  const rows = table.rows;
  if (rows.length < 3) return null;
  const dataRows = rows.slice(1).filter((r) => r[0] && r[0].text.trim() && !isTotalLabel(r[0].text));
  if (dataRows.length < 2) return null;
  const ncol = Math.max(...rows.map((r) => r.length));

  // score each column (skip col 0 = labels) by count of numeric cells, and
  // prefer an absolute-count column ("जम्मा") over a percent column.
  let best = -1, bestScore = -1, bestIsTotal = false;
  for (let c = 1; c < ncol; c++) {
    let cnt = 0;
    for (const r of dataRows) if (r[c] && toNum(r[c].text) != null) cnt++;
    if (cnt < 2) continue;
    const header = (rows[0][c]?.text || "") + (rows[1] ? rows[1][c]?.text || "" : "");
    const isTotalCol = /जम्मा|कुल/.test(header);
    const isPct = /प्रतिशत|%/.test(header);
    const score = cnt + (isTotalCol ? 100 : 0) - (isPct ? 50 : 0);
    if (score > bestScore) {
      bestScore = score; best = c; bestIsTotal = isTotalCol;
    }
  }
  if (best < 0) return null;

  let labels: string[] = [];
  let values: number[] = [];
  for (const r of dataRows) {
    const v = r[best] ? toNum(r[best].text) : null;
    const label = r[0].text.trim();
    if (v == null || v <= 0 || !label) continue;
    labels.push(label);
    values.push(v);
  }
  if (labels.length < 2) return null;
  // top 12 by value for readability
  const order = labels.map((_, i) => i).sort((a, b) => values[b] - values[a]).slice(0, 12);
  labels = order.map((i) => labels[i]);
  values = order.map((i) => values[i]);
  return { type: labels.length <= 6 ? "donut" : "bar", labels, values };
}

// Devanagari number helpers — shared across sections and viz components.
const NEd = "०१२३४५६७८९";

export const cellStr = (c: unknown): string =>
  typeof c === "string" ? c : ((c as any) && (c as any).text) || "";

/** Parse a Devanagari/ASCII numeric string (with commas / danda) to a number. */
export const toNum = (s: unknown): number =>
  parseFloat(
    cellStr(s)
      .replace(/[०-९]/g, (d) => String(NEd.indexOf(d)))
      .replace(/[,]/g, "")
  ) || 0;

/** Convert ASCII digits in a string to Devanagari. */
export const toNe = (s: unknown): string =>
  String(s).replace(/[0-9]/g, (d) => NEd[+d]);

/** Integer with thousands separators, in Devanagari. */
export const neInt = (n: number): string => toNe(Math.round(n).toLocaleString("en-US"));

/** Fixed-decimal number, in Devanagari. */
export const neDec = (n: number, d = 1): string => toNe(n.toFixed(d));

/** Look up a value cell by a substring of its first-column label. */
export const findRow = (rows: any[], sub: string) =>
  rows.find((r) => cellStr(r[0]).includes(sub));

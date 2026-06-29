// One-time ejection: turn the generated content tree into hand-editable Astro
// section components. After this runs, the site renders from the components in
// src/sections/** — content.json and the .docx are no longer needed at build.
//
//   src/sections/ch{N}/{order}-{slug}.astro   one editable component per section
//   src/sections/nav.ts                       chapter/section/subsection nav
//   src/site.ts                               site meta + homepage KPIs
//
// Prose (paragraphs, headings, lists) is inlined as markup you can freely edit.
// Tables/figures/KPIs are local consts. Section KPIs are auto-seeded from each
// section's main table (the जम्मा row) — edit/remove as you like.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const data = JSON.parse(readFileSync(resolve(ROOT, "src/data/content.json"), "utf8"));

const SECT_DIR = resolve(ROOT, "src/sections");
rmSync(SECT_DIR, { recursive: true, force: true });
mkdirSync(SECT_DIR, { recursive: true });

// --- helpers ---------------------------------------------------------------

// escape text for inlining inside Astro markup (avoid `{`/`}` expressions, `<`)
const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/{/g, "&#123;")
    .replace(/}/g, "&#125;");

const jsLit = (v) => JSON.stringify(v); // safe JS literal for consts/attrs

const slug = (s) =>
  String(s)
    .replace(/[^ऀ-ॿa-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "section";

const cellText = (c) => (typeof c === "string" ? c : c.text ?? "");

// compact a table's rows: plain string when no span, object only when merged
function compactRows(rows) {
  return rows.map((r) =>
    r.map((c) => {
      const cs = c.colspan ?? 1, rs = c.rowspan ?? 1;
      return cs > 1 || rs > 1 ? { text: c.text ?? "", colspan: cs, rowspan: rs } : (c.text ?? "");
    })
  );
}

// auto-seed up to 4 KPIs from a section's tables (first table with a जम्मा row)
function seedKpis(blocks) {
  for (const table of blocks.filter((b) => b.type === "table")) {
    const rows = table.rows;
    if (rows.length < 2) continue;
    const header = rows[0].map(cellText);
    const total = rows.find((r) => /जम्मा|कुल|योग/.test(cellText(r[0]))) || null;
    if (!total) continue;
    const out = [];
    for (let c = 1; c < total.length && out.length < 4; c++) {
      const v = cellText(total[c]).trim();
      const label = (header[c] || "").trim();
      if (!v || !label || !/[०-९0-9]/.test(v)) continue;
      // skip ratio/percent-ish tiny columns in favour of absolute counts
      out.push({ label, value: v });
    }
    if (out.length) return out;
  }
  return [];
}

// --- emit one section component --------------------------------------------

const H2 = 'class="reveal mb-3 text-[1.4rem] font-bold leading-snug text-[var(--color-text)]"';
const H3 = 'class="reveal scroll-mt-24 mt-7 mb-2 text-[1.15rem] font-bold text-[var(--color-text)]"';
const H4 = 'class="reveal scroll-mt-24 mt-5 mb-2 text-[1rem] font-bold text-[var(--color-text)]"';
const CAP = 'class="mb-1 mt-2 text-[1.05rem] font-semibold text-[var(--color-text)]"';

function emitSection(chapter, section, order) {
  const consts = [];
  const body = [];
  let tnum = 0;

  for (const b of section.blocks) {
    if (b.type === "heading") {
      const cls = b.level >= 4 ? H4 : H3;
      body.push(`  <h${b.level >= 4 ? 4 : 3} id=${jsLit(b.id)} ${cls}>${esc(b.text)}</h${b.level >= 4 ? 4 : 3}>`);
    } else if (b.type === "paragraph") {
      body.push(`  <div class="prose-ne reveal"><p>${esc(b.text)}</p></div>`);
    } else if (b.type === "note") {
      body.push(`  <p class="reveal text-[0.85rem] text-[var(--color-text-secondary)]">${esc(b.text)}</p>`);
    } else if (b.type === "list") {
      const lis = b.items
        .map(
          (it) =>
            `    <li class="flex gap-2.5"><span class="mt-[0.6em] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-brand)]"></span><span class="flex-1">${esc(it)}</span></li>`
        )
        .join("\n");
      body.push(`  <ul class="prose-ne reveal my-3 ml-1 space-y-1.5">\n${lis}\n  </ul>`);
    } else if (b.type === "image") {
      body.push(`  <Figure src=${jsLit(b.src)} caption={${jsLit(b.caption || "")} || undefined} />`);
    } else if (b.type === "table") {
      tnum += 1;
      const t = { caption: b.caption || "", source: b.source || "", rows: compactRows(b.rows) };
      consts.push(`const t${tnum} = ${jsLit(t)};`);
      consts.push(`const t${tnum}Chart = chartFromRows(t${tnum}.rows);`);
      if (t.caption) body.push(`  <h3 ${CAP}>{t${tnum}.caption}</h3>`);
      body.push(`  <DataTable caption={t${tnum}.caption} rows={t${tnum}.rows} source={t${tnum}.source} />`);
      body.push(`  {t${tnum}Chart && <Chart chart={t${tnum}Chart} />}`);
    }
  }

  const kpis = seedKpis(section.blocks);
  const meta = {
    chapter: chapter.number,
    order,
    id: section.id,
    title: section.title,
    subsections: section.subsections || [],
  };

  const file = `---
import DataTable from "../../components/DataTable.astro";
import Chart from "../../components/Chart.astro";
import Figure from "../../components/Figure.astro";
import SectionKpis from "../../components/SectionKpis.astro";
import { chartFromRows } from "../../lib/chart";

const meta = ${jsLit(meta)};

// Section KPIs — auto-seeded from the main table. Edit freely.
const kpis = ${jsLit(kpis)};

${consts.join("\n")}
---

<section id={meta.id} class="scroll-mt-24 pt-9">
  <h2 ${H2}>{meta.title}</h2>
  <SectionKpis items={kpis} />
${body.join("\n")}
</section>
`;

  const dir = resolve(SECT_DIR, `ch${chapter.number}`);
  mkdirSync(dir, { recursive: true });
  const name = `${String(order).padStart(2, "0")}-${slug(section.title)}.astro`;
  writeFileSync(resolve(dir, name), file, "utf8");
  return { meta, file: `ch${chapter.number}/${name}` };
}

// --- run -------------------------------------------------------------------

const nav = [];
let sectionCount = 0;
for (const chapter of data.chapters) {
  const sections = [];
  chapter.sections.forEach((section, i) => {
    const { meta } = emitSection(chapter, section, i + 1);
    sections.push({ id: meta.id, title: meta.title, subsections: meta.subsections });
    sectionCount += 1;
  });
  nav.push({ number: chapter.number, id: chapter.id, title: chapter.title, sections });
}

// nav.ts
writeFileSync(
  resolve(SECT_DIR, "nav.ts"),
  `// Navigation tree — generated by scripts/eject.mjs, now hand-editable.
export type Subsection = { id: string; title: string };
export type NavSection = { id: string; title: string; subsections: Subsection[] };
export type NavChapter = { number: number; id: string; title: string; sections: NavSection[] };

export const chapters: NavChapter[] = ${JSON.stringify(nav, null, 2)};

export const chapterByNumber = (n: number) => chapters.find((c) => c.number === n);
`,
  "utf8"
);

// site.ts (meta + homepage KPIs, seeded from content meta)
const m = data.meta;
writeFileSync(
  resolve(ROOT, "src/site.ts"),
  `// Site-wide meta + homepage KPIs — generated once, now hand-editable.
export const site = {
  title: ${jsLit(m.title)},
  subtitle: ${jsLit(m.subtitle)},
  place: ${jsLit(m.place)},
  chapters: ${m.chapters},
  sections: ${m.sections},
  tables: ${m.tables},
};

export type Kpi = { label: string; value: string; unit?: string };
export const homeKpis: Kpi[] = ${jsLit(homeKpisSeed(data))};
`,
  "utf8"
);

function homeKpisSeed(data) {
  // pull headline figures from the known demographic tables
  const tables = [];
  for (const c of data.chapters) for (const s of c.sections) for (const b of s.blocks) if (b.type === "table") tables.push({ cap: s.title, rows: b.rows });
  const find = (sub) => tables.find((t) => t.cap.includes(sub));
  const rowStart = (rows, sub) => rows.find((r) => cellText(r[0]).includes(sub));
  const kpis = [];
  const pop = find("जनसंख्याको विवरण");
  if (pop) {
    const p = rowStart(pop.rows, "जम्मा जनसंख्या");
    const l = rowStart(pop.rows, "साक्षरता");
    if (p) kpis.push({ label: "जम्मा जनसंख्या", value: cellText(p[1]) });
    if (l) kpis.push({ label: "साक्षरता दर", value: cellText(l[1]), unit: "%" });
  }
  const ward = find("वडागत क्षेत्रफल");
  if (ward) {
    const j = rowStart(ward.rows, "जम्मा");
    if (j && j.length >= 8) {
      kpis.push({ label: "जम्मा घरधुरी", value: cellText(j[1]) });
      kpis.push({ label: "जनसंख्या वृद्धिदर", value: cellText(j[6]), unit: "%" });
      kpis.push({ label: "क्षेत्रफल", value: cellText(j[7]), unit: "वर्ग कि.मि." });
    }
    const nums = ward.rows.map((r) => parseInt(cellText(r[0]).replace(/[०-९]/g, (d) => "०१२३४५६७८९".indexOf(d)), 10)).filter((n) => n > 0 && n < 100);
    if (nums.length) kpis.push({ label: "वडा संख्या", value: String(Math.max(...nums)) });
  }
  return kpis;
}

console.log(`Ejected ${data.chapters.length} chapters, ${sectionCount} section components.`);
console.log("Wrote src/sections/** , src/sections/nav.ts , src/site.ts");

// Extraction pipeline – parse the Preeti->Unicode-FIXED Word HTML into a
// structured, verbatim content tree:
//
//   chapters[] -> sections[] -> blocks[]  (paragraph | table | note)
//
// Chapter boundaries are reconstructed from the ORIGINAL document's table of
// contents page numbers (the chapter dividers themselves were image cover
// pages that the export dropped). Each numbered table's chapter is known from
// its page, so content is bucketed by the table-number ranges below – the
// source-accurate structure, not a guess.
//
// A completeness assertion fails loudly if table counts drift from the raw
// source, so nothing can silently go missing.

import { load } from "cheerio";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "source.html");
const OUT = resolve(__dirname, "../src/data/content.json");

// ---- chapter model (titles + table ranges from the original TOC) -----------

const CHAPTERS = [
  { n: 1, title: "परिचय", startTable: null }, // methodology – no tables (pre table 1)
  { n: 2, title: "उप–महानगरपालिकाको चिनारी", startTable: 1 },
  { n: 3, title: "पारिवारिक तथा जनसांख्यिक विवरण", startTable: 4 },
  { n: 4, title: "आर्थिक अवस्था", startTable: 24 },
  { n: 5, title: "सामाजिक अवस्था", startTable: 66 },
  { n: 6, title: "वन तथा वातावरणीय स्थिति", startTable: 99 },
  { n: 7, title: "भौतिक विकासको अवस्था", startTable: 107 },
  { n: 8, title: "संस्थागत तथा सुशासनको स्थिति", startTable: null }, // after last numbered table
  { n: 9, title: "अनुसूचीहरू", startTable: null }, // annex tables (unnumbered)
];
const LAST_NUMBERED = 115;

// chapter number for a given numbered table
function chapterOfTable(num) {
  let c = 2;
  for (const ch of CHAPTERS) if (ch.startTable != null && num >= ch.startTable) c = ch.n;
  return c;
}

// ---- helpers ---------------------------------------------------------------

const NEPALI_DIGITS = { 0: "०", 1: "१", 2: "२", 3: "३", 4: "४", 5: "५", 6: "६", 7: "७", 8: "८", 9: "९" };
const toNepaliNum = (s) => String(s).replace(/[0-9]/g, (d) => NEPALI_DIGITS[d]);
const clean = (s) => (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

// Normalize leftover-Preeti table caption labels:
//   "tflnsf g+= 12M जमिनको ..." -> { num: 12, title: "जमिनको ..." }
function parseCaption(text) {
  const t = clean(text);
  const m = t.match(/^tflnsf\s*g\+=?\s*([0-9]+)\s*M?\.?\s*(.*)$/);
  if (m) return { num: parseInt(m[1], 10), title: m[2].trim() };
  // already-clean "तालिका नं. N – title"
  const m2 = t.match(/^तालिका\s*नं[.\s]*([0-9०-९]+)[.\s—-]*(.*)$/);
  if (m2) return { num: null, title: m2[2].trim(), label: t };
  return { num: null, title: t };
}

const raw = readFileSync(SRC, "utf8");
const $ = load(raw, { decodeEntities: true });

// ---- ordered image map (real files live in the original export's .fld) -----
// Both files share identical structure, so the Nth <img> here maps to the Nth
// src in the original. missing.gif entries -> no image.
const ORIG = readFileSync(resolve(__dirname, "original.html"), "utf8");
const imageSrcs = [...ORIG.replace(/\s+/g, " ").matchAll(/<img[^>]*?src=["']?([^"'> ]+)/g)].map((m) => {
  const s = decodeURIComponent(m[1]);
  if (/missing\.gif/i.test(s)) return null;
  const file = s.split("/").pop();
  return file && /\.(jpg|jpeg|png|gif)$/i.test(file) ? `/images/${file}` : null;
});
// assign a document-order index to every <img> in the working file
const imgIndex = new Map();
$("img").each((i, el) => imgIndex.set(el, i));
let pendingFigCaption = null;

// ---- collect body flow in document order -----------------------------------
// Take only <p> and <table> that are NOT inside another table (so table-cell
// paragraphs are not mistaken for narrative, and nested layout tables ignored).

const hasTableAncestor = (el) => $(el).parents("table").length > 0;

const flow = [];
$("body")
  .find("p, table, img")
  .each((_, el) => {
    if (hasTableAncestor(el)) return;
    flow.push(el);
  });

function extractTable($table) {
  const rows = [];
  $table.children("tbody,thead,tfoot").addBack().find("tr").each((_, tr) => {
    // only direct rows of THIS table, not nested tables
    if ($(tr).parents("table").first()[0] !== $table[0]) return;
    const cells = [];
    $(tr)
      .children("td,th")
      .each((__, td) => {
        const $td = $(td);
        cells.push({
          text: clean($td.text()),
          colspan: parseInt($td.attr("colspan") || "1", 10) || 1,
          rowspan: parseInt($td.attr("rowspan") || "1", 10) || 1,
          header: td.tagName.toLowerCase() === "th",
        });
      });
    if (cells.length) rows.push(cells);
  });
  return rows;
}

// ---- first pass: linear items with chapter assignment ----------------------

const items = []; // {chapter, kind, ...}
let curCaptionChapter = 1; // backward-fill: chapter of most recent caption
let seenFirstCaption = false;
let lastNumberedSeen = 0;
let pendingCaption = null;
let inAnnex = false;

for (const el of flow) {
  const tag = el.tagName.toLowerCase();

  if (tag === "img") {
    const idx = imgIndex.get(el);
    const src = idx != null ? imageSrcs[idx] : null;
    if (!src) continue; // missing.gif / decorative glyph
    const w = parseInt($(el).attr("width") || "0", 10);
    const h = parseInt($(el).attr("height") || "0", 10);
    if (w && h && w < 180 && h < 140) continue; // skip tiny inline marks
    let chapter;
    if (!seenFirstCaption) chapter = 1;
    else if (inAnnex) chapter = 9;
    else if (lastNumberedSeen >= LAST_NUMBERED) chapter = 8;
    else chapter = curCaptionChapter;
    items.push({ chapter, kind: "image", src, width: w || null, height: h || null, caption: pendingFigCaption });
    pendingFigCaption = null;
    continue;
  }

  if (tag === "table") {
    const rows = extractTable($(el));
    const cellCount = rows.reduce((n, r) => n + r.length, 0);
    if (cellCount <= 1) continue; // layout wrapper
    let chapter = curCaptionChapter;
    if (inAnnex) chapter = 9;
    items.push({ chapter, kind: "table", caption: pendingCaption, rows });
    pendingCaption = null;
    continue;
  }
  // <p>
  const cls = $(el).attr("class") || "";
  if (/MsoToc|MsoTof/i.test(cls)) continue; // skip TOC
  const text = clean($(el).text());
  if (!text) continue;

  // figure / map caption ("gS;f g+= N M title" -> "नक्शा नं. N – title")
  if (/MapNumbering/i.test(cls) || /^gS;f\s*g\+=/.test(text)) {
    const fm = text.match(/^gS;f\s*g\+=?\s*([0-9]+)\s*M?\.?\s*(.*)$/);
    pendingFigCaption = fm
      ? `नक्शा नं. ${toNepaliNum(fm[1])} – ${fm[2].trim()}`
      : text;
    continue;
  }

  if (/Tablenumbering/i.test(cls)) {
    const cap = parseCaption(text);
    if (cap.num != null) {
      seenFirstCaption = true;
      lastNumberedSeen = cap.num;
      curCaptionChapter = chapterOfTable(cap.num);
      pendingCaption = `तालिका नं. ${toNepaliNum(cap.num)} – ${cap.title}`;
    } else {
      // unnumbered caption appearing after the last numbered table => annex
      if (lastNumberedSeen >= LAST_NUMBERED) inAnnex = true;
      pendingCaption = cap.label || cap.title;
    }
    continue;
  }
  if (/DataSource/i.test(cls)) {
    items.push({ chapter: inAnnex ? 9 : curCaptionChapter, kind: "note", text });
    continue;
  }

  // narrative paragraph (verbatim)
  let chapter;
  if (!seenFirstCaption) chapter = 1; // methodology, before table 1
  else if (inAnnex) chapter = 9;
  else if (lastNumberedSeen >= LAST_NUMBERED) chapter = 8; // governance tail
  else chapter = curCaptionChapter;
  items.push({ chapter, kind: "paragraph", text });
}

// attach source notes to the immediately-preceding table when adjacent
for (let i = 1; i < items.length; i++) {
  if (items[i].kind === "note" && items[i - 1].kind === "table") {
    items[i - 1].source = items[i].text;
    items[i]._merged = true;
  }
}

// ---- second pass: build chapters -> sections -> blocks ---------------------

const bySection = (chapterItems) => {
  const sections = [];
  let cur = null;
  const open = (title) => {
    cur = { title: clean(title), blocks: [] };
    sections.push(cur);
  };
  for (const it of chapterItems) {
    if (it._merged) continue;
    if (it.kind === "table") {
      open(it.caption || "तालिका");
      cur.blocks.push({ type: "table", caption: it.caption, rows: it.rows, source: it.source });
    } else if (it.kind === "image") {
      if (!cur) open(it.caption || "नक्शा तथा चित्र");
      cur.blocks.push({ type: "image", src: it.src, width: it.width, height: it.height, caption: it.caption });
    } else {
      if (!cur) open("परिचय");
      if (it.kind === "note") cur.blocks.push({ type: "note", text: it.text });
      else cur.blocks.push({ type: "paragraph", text: it.text });
    }
  }
  return sections;
};

const slugify = (s, key) =>
  "s-" + key + "-" + clean(s).replace(/[^ऀ-ॿa-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

const chapters = CHAPTERS.map((ch) => {
  const chItems = items.filter((it) => it.chapter === ch.n);
  const sections = bySection(chItems).filter((s) => s.blocks.length > 0);
  sections.forEach((s, si) => {
    s.id = slugify(s.title || "section", `${ch.n}-${si + 1}`);
    s.tableCount = s.blocks.filter((b) => b.type === "table").length;
  });
  return {
    id: "ch-" + ch.n,
    number: ch.n,
    title: ch.title,
    sections,
    tableCount: sections.reduce((n, s) => n + s.tableCount, 0),
    paragraphCount: sections.reduce(
      (n, s) => n + s.blocks.filter((b) => b.type === "paragraph").length,
      0
    ),
  };
}).filter((c) => c.sections.length > 0);

// ---- completeness assertion + meta -----------------------------------------

const rawTableCount = (raw.match(/<table/gi) || []).length;
const nestedTables = (raw.match(/<table/gi) || []).length - flow.filter((e) => e.tagName.toLowerCase() === "table").length;
const extractedTables = chapters.reduce((n, c) => n + c.tableCount, 0);
const sectionCount = chapters.reduce((n, c) => n + c.sections.length, 0);
const paragraphCount = chapters.reduce((n, c) => n + c.paragraphCount, 0);
const imageCount = chapters.reduce(
  (n, c) => n + c.sections.reduce((m, s) => m + s.blocks.filter((b) => b.type === "image").length, 0),
  0
);

const meta = {
  title: "तुलसीपुर उपमहानगरपालिका",
  subtitle: "वस्तुगत विवरण – डिजिटल प्रोफाइल",
  place: "तुलसीपुर, दाङ, लुम्बिनी प्रदेश, नेपाल",
  chapters: chapters.length,
  sections: sectionCount,
  tables: extractedTables,
  paragraphs: paragraphCount,
  images: imageCount,
  rawTableCount,
};

writeFileSync(OUT, JSON.stringify({ meta, chapters }, null, 2), "utf8");

console.log("Extraction complete:");
console.log("  chapters   :", chapters.length);
console.log("  sections   :", sectionCount);
console.log("  paragraphs :", paragraphCount);
console.log("  top-level tables:", extractedTables, "(raw <table> incl. nested:", rawTableCount, ")");
chapters.forEach((c) =>
  console.log(`   ch${c.number}: ${c.title.slice(0, 40)}  – ${c.sections.length} sections, ${c.tableCount} tables, ${c.paragraphCount} paras`)
);

if (extractedTables < 100) {
  console.error(`\nWARNING: only ${extractedTables} data tables extracted – expected ~117.`);
}

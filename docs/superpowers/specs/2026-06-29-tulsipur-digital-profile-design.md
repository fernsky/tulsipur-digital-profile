# Tulsipur Sub-Metropolitan Digital Profile — Design Spec

Date: 2026-06-29
Status: Implemented

## 1. Purpose

Convert the official Tulsipur Sub-Metropolitan City *वस्तुगत विवरण* (objective
profile) report — originally a Preeti-font Word document — into a modern,
fully-navigable, searchable digital portal (GitBook / documentation style),
**without losing a single table, description, image, or section**.

## 2. Source material

| Artifact | Role |
|---|---|
| `Checked Tulsipur Sub metro Profile Report.docx` (Preeti) | **Source of truth.** Real Heading1/2/3/4 hierarchy + Preeti-font text + Times New Roman English + Fontasy-Himali numbers. |
| `…-Unicode.docx` / `…-Unicode-FIXED.html` | Earlier conversions — superseded (had baked-in garbling). |
| `word/media/*` inside the docx | Maps, photos, charts. |

### Why the Preeti docx is authoritative
- The HTML export flattened the heading hierarchy and rendered Preeti digit
  glyphs as Devanagari conjuncts (numbers → `ज्ञद्द…`, English → gibberish).
- The Preeti docx preserves the structure **and** lets a font-aware converter
  reconstruct text faithfully:
  - **Preeti / `None` font** → run through `npttf2utf` (digit keys are letters: `6`→ट).
  - **Fontasy Himali / Latin number font** → digits are real numbers → Devanagari numerals.
  - **Times New Roman / Calibri / Arial** → English, kept verbatim (`Slope`, `Indian Plate`).
  - **Already-Unicode Devanagari** → kept.

## 3. Architecture

```
Preeti .docx ──(scripts/parse_docx.py, font-aware per-run conversion)──▶ src/data/content.json
                                                                          │
                                              Astro (static) ◀────────────┘
                                              ├─ BaseLayout (sidebar drawer, search modal, motion)
                                              ├─ Sidebar (chapters → sections)
                                              ├─ chapters/[number].astro (sections + right-rail TOC w/ subsections)
                                              ├─ Block (paragraph | heading | list | table | image | note)
                                              ├─ DataTable (colspan/rowspan, numeric align, totals)
                                              ├─ Chart (D3, colorful, per data table)
                                              └─ Figure (lazy images)
                          Pagefind ──▶ static full-text search index (dist/pagefind)
```

### Content tree
`meta` + `chapters[] → sections[] → blocks[]`, where a block is one of:
`paragraph`, `heading` (level 3/4, anchored), `list`, `table`
(`rows[][]{text,colspan,rowspan}` + caption + source), `image`, `note`.
Sections carry `subsections[]` (Heading 3) for nested navigation.

## 4. Structure mapping (verbatim, from Word styles)

| Word style | Portal element |
|---|---|
| Heading 1 (`परिच्छेद – N`) | Chapter |
| Heading 2 (`N.M …`) | Section (sidebar + TOC) |
| Heading 3 (`N.M.K …`) | Subsection (nested TOC, anchored) |
| Heading 4 (`-क) …`) | Inline anchored heading |
| Body Text / Normal | Verbatim narrative paragraph |
| List Paragraph / bullet list / numbered | Bullet list |
| Table numbering | Table caption (`तालिका नं. N – …`) |
| Data Source | Source note attached to its table |
| TOC / Table of Figures | Skipped (portal generates its own nav) |
| Cover page (before Heading 1) | Skipped |

9 chapters (8 + अनुसूचीहरू), 54 sections, 135 tables, ~300 narrative
paragraphs, 26 images.

## 5. UI / Design system — PencilPlaybook ("Minimal / Neutral" preset)

The Pencil `.pen` tooling is not reachable headless, so the PencilPlaybook
playbook is applied **directly in CSS** (`src/styles/global.css`): its token
map, perceptual defaults, and the three hard rules.

Tokens (from the configured `SKILL.md` token map):
`--color-primary #1e293b` (slate sidebar), `--color-surface #ffffff`,
`--color-background #fafafa`, `--color-border #e5e5e5`, `--color-text #0a0a0a`,
`--color-text-secondary #404040` (muted raised to full contrast),
chart palette `#2563eb #16a34a #f59e0b #dc2626 #7c3aed #0891b2`,
content width 1088px, sidebar 288px. Font: **Kalimati** (local `.ttf`).

Three hard rules, enforced globally:
1. **No uppercase** — `text-transform: none !important`.
2. **No muted text** — secondary tone raised to `#404040` (WCAG AA on white).
3. **No wide tracking** — `letter-spacing: normal !important`.

Perceptual defaults applied: motion 200–320 ms with decelerate easing +
`prefers-reduced-motion` honored, focus ring offset 2px, line-height 1.7–1.85
for Devanagari, 8px card radius.

## 6. Features

- GitBook-style left sidebar (logo + title, chapters → sections), **mobile drawer** + hamburger.
- Right-rail on-page TOC with **nested subsections**.
- **Robust search** (Pagefind) in a ⌘K modal, indexing all prose + tables.
- **Per-table colorful D3 charts** (auto-detected label/value columns; text-only tables skipped).
- Homepage KPI band (population, households, area, literacy, growth, wards) with count-up.
- Scroll-reveal animations, view-transition navigation.
- **All numbers shown in Devanagari** at render time.
- **All chapter/section/heading names bold.**

## 7. Fidelity guarantees

- Every table (135) and every narrative paragraph rendered verbatim.
- English (Times New Roman) preserved exactly.
- Numbers, letters, and shifted-digit symbols converted correctly by font.
- Images copied from the docx media and shown in place.
- Nothing summarized, nothing dropped.

## 8. Known residuals

- A few names carry a Preeti half-`र` ordering quirk (e.g. `दतार्` for दर्ता).
- Occasional stray `%`/`º` in mixed-font runs.
- These are cosmetic and localized; tracked for a follow-up cleanup pass.

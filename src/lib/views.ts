// Flattened, per-subsection view model.
//
// Each section in nav.ts becomes one or more "views":
//   - a section with >1 subsection is split into one view per subsection
//   - every other section is a single view
//
// Section components live at:
//   src/sections/ch{N}/{order}-{slug}.astro            (single-view section)
//   src/sections/ch{N}/{order}-{slug}/{sub}-{slug}.astro  (split section, one file per subsection)
//
// The path encodes chapter, section order and (optionally) subsection order,
// which is how each view is matched to its component.
import { chapters, type NavChapter } from "../sections/nav";

const modules = import.meta.glob("../sections/ch*/**/*.astro", { eager: true });

type CompEntry = { chapter: number; secOrder: number; subOrder: number; Comp: any };

const compEntries: CompEntry[] = Object.entries(modules)
  .map(([path, m]: [string, any]) => {
    // ch3/01-slug/02-sub.astro  OR  ch3/02-slug.astro
    const mm = path.match(/\/ch(\d+)\/(\d+)-[^/]*?(?:\/(\d+)-[^/]*)?\.astro$/);
    if (!mm) return null;
    return {
      chapter: Number(mm[1]),
      secOrder: Number(mm[2]),
      subOrder: mm[3] ? Number(mm[3]) : 0,
      Comp: m.default,
    };
  })
  .filter((e): e is CompEntry => e !== null);

const compFor = (chapter: number, secOrder: number, subOrder: number) =>
  compEntries.find((e) => e.chapter === chapter && e.secOrder === secOrder && e.subOrder === subOrder)?.Comp;

export type View = {
  chapter: number;
  secOrder: number;
  subOrder: number; // 0 = whole-section view
  id: string; // anchor / section id used by search + nav
  title: string; // view heading (subsection title, or section title)
  secId: string;
  secTitle: string;
  url: string;
  Comp: any;
};

export const views: View[] = [];

for (const c of chapters) {
  c.sections.forEach((s, i) => {
    const secOrder = i + 1;
    const subs = s.subsections || [];
    if (subs.length > 1) {
      subs.forEach((sub, j) => {
        const subOrder = j + 1;
        views.push({
          chapter: c.number,
          secOrder,
          subOrder,
          id: sub.id,
          title: sub.title,
          secId: s.id,
          secTitle: s.title,
          url: `/chapters/${c.number}/${secOrder}/${subOrder}`,
          Comp: compFor(c.number, secOrder, subOrder),
        });
      });
    } else {
      views.push({
        chapter: c.number,
        secOrder,
        subOrder: 0,
        id: s.id,
        title: s.title,
        secId: s.id,
        secTitle: s.title,
        url: `/chapters/${c.number}/${secOrder}`,
        Comp: compFor(c.number, secOrder, 0),
      });
    }
  });
}

export const viewIndex = (v: View) => views.findIndex((x) => x.url === v.url);

// A section may expand into several views; this lists the section-level entries
// (first view of each section) for chapter overviews / sidebars.
export type SectionGroup = {
  chapter: number;
  secOrder: number;
  secId: string;
  secTitle: string;
  views: View[];
  url: string; // first view url
};

export function sectionsForChapter(chapter: number): SectionGroup[] {
  const groups: SectionGroup[] = [];
  for (const v of views.filter((x) => x.chapter === chapter)) {
    let g = groups.find((x) => x.secOrder === v.secOrder);
    if (!g) {
      g = { chapter, secOrder: v.secOrder, secId: v.secId, secTitle: v.secTitle, views: [], url: v.url };
      groups.push(g);
    }
    g.views.push(v);
  }
  return groups;
}

export function chapterMeta(n: number): NavChapter | undefined {
  return chapters.find((c) => c.number === n);
}

// Site-wide meta + homepage KPIs — generated once, now hand-editable.
export const site = {
  title: "तुलसीपुर उपमहानगरपालिका",
  subtitle: "वस्तुगत विवरण – डिजिटल प्रोफाइल",
  place: "तुलसीपुर, दाङ, लुम्बिनी प्रदेश, नेपाल",
  chapters: 9,
  sections: 54,
  tables: 135,
};

export type Kpi = { label: string; value: string; unit?: string };
export const homeKpis: Kpi[] = [];

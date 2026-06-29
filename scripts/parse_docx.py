#!/usr/bin/env python3
"""
Hybrid parser — the source of truth for structure is the .docx (which keeps the
real Heading1/2/3 hierarchy that the HTML export destroyed); the source of truth
for TABLE CONTENT is the already-cleaned FIXED HTML (scripts/clean-tables.json),
because the .docx tables still carry the same baked-in garbling (serial numbers
as conjuncts, English names as gibberish).

  Heading1  -> chapter
  Heading2  -> section            (sidebar nav level)
  Heading3/4-> sub-heading block  (rendered inside the section)
  BodyText… -> verbatim narrative (per-run Preeti/Fontasy conversion)
  table     -> clean table pulled from clean-tables.json, matched by caption no.
  drawing   -> image (copied from word/media)

Output: src/data/content.json  (schema consumed by the Astro components)
"""
import json, re, os, zipfile, shutil
import docx
import npttf2utf
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.table import Table

HERE = os.path.dirname(os.path.abspath(__file__))
DOCX = os.path.join(HERE, "source-preeti.docx")  # original Preeti docx — the faithful source
OUT = os.path.join(HERE, "..", "src", "data", "content.json")
IMGDIR = os.path.join(HERE, "..", "public", "images")

# ---- Preeti / Fontasy -> Unicode (per-run, font-aware) ---------------------

mapper = npttf2utf.FontMapper(os.path.join(HERE, "map-para.json"))
def _preeti(t):
    return mapper.map_to_unicode(t, from_font="Preeti", unescape_html_input=False, escape_html_output=False)

NE = "०१२३४५६७८९"
def _devnum(t):
    return re.sub(r"[0-9]", lambda m: NE[int(m.group())], t)

DEV = re.compile(r"[ऀ-ॿ]")
NUMERIC = re.compile(r"^[0-9.,%/()\-\s–:]+$")
LATIN = re.compile(r"Times New Roman|Calibri|Arial|Cambria|Tahoma|Verdana", re.I)

NUMFONT = re.compile(r"Fontasy|Himali|Times New Roman|Calibri|Arial|Cambria|Mangal|Nirmala", re.I)
def conv_run(text, font):
    if not text or not text.strip():
        return text
    if DEV.search(text):           # already Unicode Devanagari
        return text
    # ASCII digits are NUMBERS only when set in a number/Latin font (Fontasy
    # Himali etc.). In the Preeti font (or inherited `None`), the digit keys are
    # LETTERS (6 -> ट), so those runs go through the Preeti mapper.
    if NUMERIC.match(text) and re.search(r"[0-9]", text) and font and NUMFONT.search(font):
        return _devnum(text)
    if font and LATIN.search(font):  # English (Times New Roman etc.) — verbatim
        return text
    return _preeti(text)           # Preeti letters & shifted-digit symbols (% -> ५, 6ol -> टोल)

PREETI_SYM = set(";{}[]/+~^<>\\|¿¥*`@#$&_=")
def _fix_ascii_preeti(s):
    # convert leftover Preeti ASCII segments (e.g. "jif{" -> वर्ष) but keep real
    # English (pure Latin letters with no Preeti symbol, e.g. "Aa Vi Kothari").
    def repl(m):
        seg = m.group(0)
        if any(ch in PREETI_SYM for ch in seg):
            return _preeti(seg)
        return seg
    return re.sub(r"[A-Za-z;{}\[\]/+~^<>\\|¿¥*`@#$&_=]{2,}", repl, s)

def norm_chars(s):
    if not s:
        return s
    s = _fix_ascii_preeti(s)
    s = s.replace("¥", "र्")            # Preeti eyelash-ra remnant
    s = re.sub(r"\s*ः\s*[–—-]+", "ः ", s)  # "छन् ः–" -> "छन्ः "
    s = s.replace(" ः", "ः")            # detached visarga
    s = re.sub(r"\s+", " ", s)
    return s.strip()

def conv_para(p):
    return norm_chars("".join(conv_run(r.text, r.font.name) for r in p.runs))

def collapse(s):
    return re.sub(r"\s+", " ", s or "").strip()

# tables come straight from the Preeti docx (per-run conversion), see below.

# ---- images: map embed rId -> media file, copy out -------------------------

doc = docx.Document(DOCX)
zf = zipfile.ZipFile(DOCX)
os.makedirs(IMGDIR, exist_ok=True)
rel_target = {rid: rel.target_ref for rid, rel in doc.part.rels.items()}

def emu_to_px(v):
    try:
        return int(int(v) / 9525)
    except Exception:
        return None

copied = {}
def copy_image(rid):
    target = rel_target.get(rid)
    if not target:
        return None
    name = target.split("/")[-1]
    src = "word/" + target if not target.startswith("word/") else target
    if name not in copied:
        try:
            data = zf.read(src)
        except KeyError:
            try:
                data = zf.read("word/media/" + name)
            except KeyError:
                return None
        with open(os.path.join(IMGDIR, name), "wb") as f:
            f.write(data)
        copied[name] = True
    return "/images/" + name

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
WP = "{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"

def para_images(p):
    out = []
    for dr in p._element.iter(qn("w:drawing")):
        blip = dr.find(".//" + A + "blip")
        ext = dr.find(".//" + WP + "extent")
        if blip is None:
            continue
        rid = blip.get(R + "embed")
        src = copy_image(rid) if rid else None
        if not src:
            continue
        w = emu_to_px(ext.get("cx")) if ext is not None else None
        h = emu_to_px(ext.get("cy")) if ext is not None else None
        out.append({"src": src, "width": w, "height": h})
    return out

# ---- docx table extraction (per-run conversion + grid spans) ---------------

def _cell_text(tc):
    parts = []
    for p in tc.findall(qn("w:p")):
        from docx.text.paragraph import Paragraph as _P
        parts.append("".join(conv_run(r.text, r.font.name) for r in _P(p, doc).runs))
    return norm_chars(" ".join(parts))

def extract_docx_table(tbl):
    rows_xml = tbl.findall(qn("w:tr"))
    grid = []
    vmerge_origin = {}  # col -> origin cell dict for rowspan accumulation
    for tr in rows_xml:
        col = 0
        row = []
        for tc in tr.findall(qn("w:tc")):
            tcPr = tc.find(qn("w:tcPr"))
            gs = 1
            vmerge = None
            if tcPr is not None:
                g = tcPr.find(qn("w:gridSpan"))
                if g is not None:
                    gs = int(g.get(qn("w:val")) or "1")
                vm = tcPr.find(qn("w:vMerge"))
                if vm is not None:
                    vmerge = vm.get(qn("w:val")) or "continue"
            if vmerge == "continue":
                origin = vmerge_origin.get(col)
                if origin:
                    origin["rowspan"] += 1
                col += gs
                continue
            cell = {"text": _cell_text(tc), "colspan": gs, "rowspan": 1, "header": False}
            if vmerge == "restart":
                vmerge_origin[col] = cell
            row.append(cell)
            col += gs
        if row:
            grid.append(row)
    return grid

def table_is_english(caption):
    return bool(re.search(r"विद्यालयको नाम|विद्यालयहरुको विवरण|संस्थागत विद्यालय|कार्यरत विद्यालय", caption or ""))

# ---- walk the document body in order ---------------------------------------

chapters = []
chapter = None
section = None
pending_cap_title = None
pending_fig = None
table_counter = [0]
_heading_seq = [0]
started = [False]  # ignore the cover page + front matter until the first chapter

def new_chapter(num, title):
    global chapter, section
    flush_list()
    chapter = {"number": num, "title": title, "sections": []}
    chapters.append(chapter)
    section = None

def new_section(title):
    global section
    flush_list()
    if chapter is None:
        new_chapter(len(chapters) + 1, "परिचय")
    section = {"title": title, "blocks": [], "subsections": []}
    chapter["sections"].append(section)

def heading_id(text):
    _heading_seq[0] += 1
    s = re.sub(r"[^ऀ-ॿa-zA-Z0-9]+", "-", text).strip("-")
    return f"h-{_heading_seq[0]}-{s[:28]}"

def ensure_section():
    if section is None:
        new_section("परिचय")
    return section

list_buf = []
def flush_list():
    global list_buf
    if list_buf:
        ensure_section()["blocks"].append({"type": "list", "ordered": False, "items": list_buf})
        list_buf = []

def push(block):
    flush_list()
    ensure_section()["blocks"].append(block)

def is_list_para(p, style):
    if style and ("list" in style.lower() or "bullet" in style.lower()):
        return True
    pPr = p._element.find(qn("w:pPr"))
    return pPr is not None and pPr.find(qn("w:numPr")) is not None

# chapter number from "परिच्छेद – १ः परिचय"
def split_chapter(text):
    m = re.match(r"परिच्छेद\s*[–—-]\s*([०-९0-9]+)\s*[ः:]*\s*(.*)", text)
    if m:
        num = int("".join(str(NE.index(c)) if c in NE else c for c in m.group(1)))
        return num, m.group(2).strip() or text
    return None, text

STYLE_SKIP = re.compile(r"TOC|TableofFigures|Table of Figures", re.I)

for child in doc.element.body.iterchildren():
    if child.tag == qn("w:tbl"):
        if not started[0]:
            continue  # cover / TOC tables before chapter 1
        rows = extract_docx_table(child)
        cellcount = sum(len(r) for r in rows)
        if cellcount <= 1:
            continue  # layout wrapper
        caption = None
        if pending_cap_title:
            caption = f"तालिका नं. {_devnum(str(table_counter[0]))} – {pending_cap_title}"
        push({"type": "table", "caption": caption, "rows": rows, "source": None})
        pending_cap_title = None
        continue

    if child.tag != qn("w:p"):
        continue

    p = Paragraph(child, doc)
    style = p.style.name if p.style else ""
    if STYLE_SKIP.search(style or ""):
        continue

    # skip cover page + front matter until the first chapter heading
    if not started[0] and style != "Heading 1":
        continue

    # images first (a paragraph may be just an image)
    imgs = para_images(p)
    text = conv_para(p)

    if style == "Table numbering":
        table_counter[0] += 1
        pending_cap_title = re.sub(r"^तालिका\s*नं[.\s]*[०-९0-9]*\s*[–—-]?\s*", "", text).strip()
        continue
    if style == "Map Numbering" or re.match(r"नक्शा\s*नं|चित्र", text):
        pending_fig = text
        # fallthrough to emit images below with this caption

    for im in imgs:
        w, h = im.get("width"), im.get("height")
        if w and h and w < 150 and h < 110:
            continue  # tiny decorative
        push({"type": "image", "src": im["src"], "width": w, "height": h, "caption": pending_fig})
        pending_fig = None

    if not text:
        continue

    if style == "Heading 1":
        started[0] = True
        num, title = split_chapter(text)
        # dedupe: a repeated Heading 1 with the same title continues the chapter
        if chapter is not None and collapse(chapter["title"]) == collapse(title):
            continue
        new_chapter(num if num else len(chapters) + 1, title)
        continue
    if style == "Heading 2":
        new_section(text)
        continue
    if style in ("Heading 3", "Heading 4"):
        sec = ensure_section()
        level = 3 if style == "Heading 3" else 4
        hid = heading_id(text)
        push({"type": "heading", "level": level, "text": text, "id": hid})
        if level == 3:
            sec.setdefault("subsections", []).append({"id": hid, "title": text})
        continue
    if style == "Data Source":
        # attach to last table if present else note
        flush_list()
        sec = ensure_section()
        if sec["blocks"] and sec["blocks"][-1]["type"] == "table" and not sec["blocks"][-1].get("source"):
            sec["blocks"][-1]["source"] = text
        else:
            push({"type": "note", "text": text})
        continue
    if style == "Map Numbering" or re.match(r"नक्शा\s*नं|चित्र", text):
        continue  # caption already consumed for image

    if is_list_para(p, style):
        list_buf.append(text)
        continue

    push({"type": "paragraph", "text": text})

flush_list()

# ---- finalize: ids, counts, drop empty -------------------------------------

def slug(s, key):
    s = re.sub(r"[^ऀ-ॿa-zA-Z0-9]+", "-", s).strip("-")
    return f"s-{key}-{s[:32]}"

out_chapters = []
for c in chapters:
    secs = [s for s in c["sections"] if s["blocks"]]
    if not secs:
        continue
    out_chapters.append(c)
    c["sections"] = secs

# sequential renumbering keeps chapters gapless (annex etc.)
for ci, c in enumerate(out_chapters):
    c["number"] = ci + 1
    c["id"] = f"ch-{c['number']}"
    for si, s in enumerate(c["sections"]):
        s["id"] = slug(s["title"] or "section", f"{c['number']}-{si+1}")
        s["tableCount"] = sum(1 for b in s["blocks"] if b["type"] == "table")
        s.setdefault("subsections", [])
    c["tableCount"] = sum(s["tableCount"] for s in c["sections"])
    c["paragraphCount"] = sum(1 for s in c["sections"] for b in s["blocks"] if b["type"] == "paragraph")

total_tables = sum(c["tableCount"] for c in out_chapters)
total_sections = sum(len(c["sections"]) for c in out_chapters)
total_paras = sum(c["paragraphCount"] for c in out_chapters)
total_images = sum(1 for c in out_chapters for s in c["sections"] for b in s["blocks"] if b["type"] == "image")

meta = {
    "title": "तुलसीपुर उपमहानगरपालिका",
    "subtitle": "वस्तुगत विवरण – डिजिटल प्रोफाइल",
    "place": "तुलसीपुर, दाङ, लुम्बिनी प्रदेश, नेपाल",
    "chapters": len(out_chapters),
    "sections": total_sections,
    "tables": total_tables,
    "paragraphs": total_paras,
    "images": total_images,
}

json.dump({"meta": meta, "chapters": out_chapters}, open(OUT, "w", encoding="utf-8"),
          ensure_ascii=False, indent=2)

print("Parsed from .docx (structure) + FIXED HTML (tables):")
print(f"  chapters   : {len(out_chapters)}")
print(f"  sections   : {total_sections}")
print(f"  paragraphs : {total_paras}")
print(f"  images     : {total_images}")
print(f"  tables     : {total_tables} (from Preeti docx, per-run converted)")
for c in out_chapters:
    print(f"   ch{c['number']}: {c['title'][:36]:36}  {len(c['sections']):>3} sections, {c['tableCount']:>3} tables")

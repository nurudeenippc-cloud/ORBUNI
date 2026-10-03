#!/usr/bin/env python3
"""Builds the "study by subject" pages: site/study/ and site/study/<subject>-in-turkiye/.

Students search for a subject ("study medicine in Turkey"), not a university. Each page
lists every partner university in Türkiye that teaches the subject at bachelor level,
with the published fee, straight from Orbuni's programme data.

Data: tools/data/bachelors.json, a snapshot of the live database (active bachelor
programmes at active universities), refreshed with this SQL in Supabase:

  select json_agg(json_build_array(u.name, u.city, u.country, p.course, p.language,
    p.duration, p.study_mode, p.published_fee, p.net_fee, p.discount_pct, p.is_yearly)
    order by u.name, p.course)
  from programmes p join universities u on u.id = p.university_id
  where p.active and u.active and p.degree_level ilike '%bachelor%';

Run:  python3 tools/build_study_pages.py   (then re-zip site/ and upload to Netlify)

Fees are shown exactly as stored: "/ yr" for yearly fees, "total" otherwise, as on the
university pages. Only yearly fees are used for the "from $X a year" headline, so a
fee stored as a whole-degree total never makes a subject look cheaper than it is.
"""
import html, json, os, re, unicodedata
from collections import defaultdict
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
DATA = os.path.join(ROOT, "tools", "data")
BASE = "https://myorbuni.com"

# slug, title, course names that count (exact), one factual line
SUBJECTS = [
    ("medicine", "Medicine", ["Medicine"], "Six-year medical degrees (MD) at private universities, many with their own teaching hospitals."),
    ("dentistry", "Dentistry", ["Dentistry"], "Five- and six-year dentistry degrees, taught in English or Turkish."),
    ("pharmacy", "Pharmacy", ["Pharmacy"], "Five-year pharmacy degrees at private universities."),
    ("nursing", "Nursing", ["Nursing"], "Four-year nursing degrees, in English or Turkish, with hospital placements."),
    ("computer-engineering", "Computer Engineering", ["Computer Engineering", "Computer Engineering (EN)"], "Four-year computer engineering degrees, most of them taught in English."),
    ("software-engineering", "Software Engineering", ["Software Engineering"], "Four-year software engineering degrees."),
    ("artificial-intelligence-engineering", "Artificial Intelligence Engineering", ["Artificial Intelligence Engineering", "Artificial Intelligence and Data Science"], "New four-year degrees in AI engineering and data science."),
    ("electrical-and-electronics-engineering", "Electrical & Electronics Engineering", ["Electrical and Electronics Engineering", "Electric and Electronic Engineering", "Electrical and Electronic Engineering", "Electrical Electronics Engineering", "Electrical - Electronics Engineering"], "Four-year electrical and electronics engineering degrees."),
    ("civil-engineering", "Civil Engineering", ["Civil Engineering"], "Four-year civil engineering degrees."),
    ("mechanical-engineering", "Mechanical Engineering", ["Mechanical Engineering"], "Four-year mechanical engineering degrees."),
    ("industrial-engineering", "Industrial Engineering", ["Industrial Engineering"], "Four-year industrial engineering degrees."),
    ("architecture", "Architecture", ["Architecture"], "Four-year architecture degrees."),
    ("business-administration", "Business Administration", ["Business Administration", "International Business Administration"], "Four-year business administration degrees."),
    ("economics", "Economics", ["Economics"], "Four-year economics degrees."),
    ("international-relations", "International Relations", ["International Relations", "Political Science and International Relations"], "Four-year degrees in international relations and political science."),
    ("law", "Law", ["Law"], "Four-year law degrees (most are taught in Turkish)."),
    ("psychology", "Psychology", ["Psychology"], "Four-year psychology degrees."),
    ("physiotherapy", "Physiotherapy", ["Physiotherapy and Rehabilitation", "Physiotherapy"], "Four-year physiotherapy and rehabilitation degrees."),
    ("nutrition-and-dietetics", "Nutrition & Dietetics", ["Nutrition and Dietetics"], "Four-year nutrition and dietetics degrees."),
]

ICON = {"medicine": "🩺", "dentistry": "🦷", "pharmacy": "💊", "nursing": "🏥", "computer-engineering": "💻",
        "software-engineering": "⌨️", "artificial-intelligence-engineering": "🤖", "electrical-and-electronics-engineering": "⚡",
        "civil-engineering": "🏗️", "mechanical-engineering": "⚙️", "industrial-engineering": "🏭", "architecture": "📐",
        "business-administration": "📊", "economics": "📈", "international-relations": "🌍", "law": "⚖️", "psychology": "🧠",
        "physiotherapy": "🦴", "nutrition-and-dietetics": "🥗"}

# university names whose page lives under a different address
SLUG_FIX = {"TOBB ETU University of Economics & Technology": "tobb-etu-university-of-economics-and-technology"}

esc = lambda s: html.escape(str(s if s is not None else ""), quote=True)


def slugify(n):
    if n in SLUG_FIX:
        return SLUG_FIX[n]
    n = n.replace("İ", "I").replace("ı", "i")
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-")


def places(cities):
    if len(cities) > 4:
        return ", ".join(cities[:4]) + " and more"
    return cities[0] if len(cities) == 1 else ", ".join(cities[:-1]) + " and " + cities[-1]


def photo_dirs():
    out = {}
    for d in os.listdir(os.path.join(SITE, "photos")):
        if re.match(r"u\d{3}-", d):
            out[d[5:].replace("i-stanbul", "istanbul")] = d
    return out


def photo_for(name, dirs):
    s = slugify(name)
    for key, d in dirs.items():
        if s.startswith(key) or key.startswith(s):
            if os.path.exists(os.path.join(SITE, "photos", d, "01-card.jpg")):
                return "/photos/" + d
    return None


def usd(x):
    return "$" + f"{float(x):,.0f}"


def fee_cell(pub, net, disc, yearly):
    if net is None and pub is None:
        return '<span class="note">On request</span>'
    net = net if net is not None else pub
    per = " / yr" if yearly else " total"
    was = f'<span class="was">{usd(pub)}</span>' if pub and float(pub) > float(net) else ""
    off = f' <span class="off">{int(disc)}% off</span>' if disc else ""
    return f"{was}<b>{usd(net)}</b>{per}{off}"


STYLE = open(os.path.join(DATA, "static-style.html"), encoding="utf-8").read()
MNAV = '<style id="mnav">' + open(os.path.join(DATA, "static-mobile-nav.css"), encoding="utf-8").read() + "</style>"
EXTRA_CSS = """<style>
.subj{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;list-style:none;margin:0;padding:0}
.subj a{display:block;background:var(--p1);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px;color:var(--txt);text-decoration:none;height:100%}
.subj a:hover{border-color:rgba(242,181,68,.5)}
.subj b{display:block;font:800 18px var(--disp);letter-spacing:-.02em;margin-bottom:4px}
.subj span{color:var(--dim);font-size:13.5px}
.faq details{background:var(--p1);border:1px solid var(--line);border-radius:var(--r);padding:14px 18px;margin-bottom:10px}
.faq summary{cursor:pointer;font-weight:600}
.faq p{color:var(--dim);margin:10px 0 0}
td a{color:var(--txt);text-decoration:none;font-weight:600}
td a:hover{color:var(--gold)}
.hero.photo{min-height:0}
.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;list-style:none;margin:0;padding:0}
.tile{position:relative;display:flex;flex-direction:column;justify-content:flex-end;aspect-ratio:4/3;border-radius:var(--rl);overflow:hidden;
  color:#fff;text-decoration:none;border:1px solid var(--line);background:var(--p2) var(--img) center/cover no-repeat;isolation:isolate;
  transition:transform .35s cubic-bezier(.22,1,.36,1),border-color .25s}
.tile::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(180deg,rgba(7,12,22,.05) 25%,rgba(7,12,22,.88) 82%)}
.tile:hover{transform:translateY(-4px);border-color:rgba(242,181,68,.6)}
.tile .ic{position:absolute;top:12px;left:12px;font-size:22px;line-height:1;background:rgba(7,12,22,.6);backdrop-filter:blur(6px);border-radius:12px;padding:8px}
.tile b{display:block;font:800 21px/1.15 var(--disp);letter-spacing:-.02em;padding:0 16px}
.tile span{display:block;font-size:13px;color:#d6deea;padding:4px 16px 16px}
.tile span em{font-style:normal;color:var(--gold);font-weight:700}
@media(max-width:560px){.tiles{grid-template-columns:1fr 1fr;gap:9px}.tile{aspect-ratio:3/4}.tile b{font-size:16px;padding:0 11px}.tile span{font-size:11.5px;padding:3px 11px 11px}.tile .ic{font-size:18px;padding:6px}}
.who{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}
/* subject pages: the four numbers as one slim strip instead of four boxes */
.hero .stats{display:flex;flex-wrap:wrap;gap:0;margin-top:26px;background:rgba(7,12,22,.55);backdrop-filter:blur(8px);
  border:1px solid var(--line2);border-radius:99px;padding:6px 8px;width:max-content;max-width:100%}
.hero .stat{background:none;border:0;border-radius:0;padding:6px 16px;backdrop-filter:none;display:flex;align-items:baseline;gap:7px}
.hero .stat+.stat{border-left:1px solid var(--line2)}
.hero .stat b{font-size:19px;display:inline}
.hero .stat span{font-size:12.5px}
@media(max-width:560px){.hero .stats{border-radius:18px;width:100%;padding:4px}.hero .stat{width:50%;padding:8px 10px}
  .hero .stat+.stat{border-left:0}.hero .stat:nth-child(even){border-left:1px solid var(--line2)}.hero .stat:nth-child(n+3){border-top:1px solid var(--line2)}}
</style>"""


def head(title, desc, url, ld):
    lds = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>\n' for x in ld)
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">{STYLE}{EXTRA_CSS}<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{esc(title)}</title>
<meta name="description" content="{esc(desc)}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="website"><meta property="og:site_name" content="Orbuni"><meta property="og:title" content="{esc(title)}">
<meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{url}"><meta property="og:image" content="{BASE}/share.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#070C16">
<link rel="icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
{lds}{MNAV}</head><body>
<header class="hd"><div class="wrap"><a class="brand" href="/"><span class="orb"></span>Orbuni</a>
<nav class="nav" aria-label="Main"><a href="/universities/">Universities</a><a href="/study/">Subjects</a><a href="/scholarships/">Scholarships</a><a href="/housing/">Housing</a><a href="/articles/">Guides</a><a class="go" href="/#start">Apply free</a></nav></div></header>
"""


FOOT = """<footer class="ft"><div class="wrap"><div><a class="brand" href="/"><span class="orb"></span>Orbuni</a><p>Orbuni helps students get into universities in Türkiye, N. Cyprus, the UAE, Germany, Egypt and Russia — published fees, a named counsellor, tuition paid direct to the university. Fees on these pages come from each university's published figures; your counsellor confirms the current figure in writing before you pay anything.</p></div>
<div><h4>Explore</h4><a href="/universities/">Universities &amp; fees</a><a href="/scholarships/">Scholarships</a><a href="/housing/">Student housing</a><a href="/articles/">Study guides</a><a href="/study/">Study by subject</a></div>
<div><h4>Orbuni</h4><a href="/">Home</a><a href="/#start">Start your application</a><a href="/#about">About us</a><a href="/#terms">Terms</a></div></div></footer>
</body></html>
"""

# Answers taken from what the site already promises (payment structure, scholarships page).
def faq(title):
    return [
        (f"Can international students from Nigeria, Ghana, Kenya, Pakistan or India study {title} in Turkey?",
         f"Yes. The private universities listed here accept international students from any country, including across Africa, the Middle East and Asia. You apply with your passport, your secondary school certificate (WAEC, NECO, KCSE or your country's equivalent) and your transcript, and Orbuni checks every document before it is sent."),
        (f"Can I study {title} in Türkiye in English?",
         f"Yes, at many universities. The table above shows the teaching language of every {title} programme Orbuni lists, so you can see which ones are taught in English and which in Turkish."),
        (f"How much does it cost to study {title} in Türkiye?",
         "The table shows each university's published fee in US dollars and the discount it currently gives, so the bold figure is what you pay for tuition. Living costs and housing come on top; see our guide to what a year in Türkiye actually costs."),
        ("Does it cost anything to apply through Orbuni?",
         "No. Applying is free, and there is no payment before a university sends you an offer letter. Tuition is paid directly to the university, never to Orbuni."),
        ("Who checks the fee before I pay?",
         "Your named Orbuni counsellor confirms the current fee in writing before you pay anything, because universities can change their fees during the year."),
    ]


def tiles(made):
    """Photo tiles for the subject hub (and the universities page)."""
    out = []
    for s, t, n, c, p, img in made:
        bg = f' style="--img:url(\'{img}/01-card.jpg\')"' if img else ""
        price = f' · from <em>{usd(c)}</em>/yr' if c else ""
        out.append(f'<li><a class="tile" href="{p}"{bg}><i class="ic" aria-hidden="true">{ICON.get(s, "🎓")}</i>'
                   f'<b>{esc(t)}</b><span>{n} universities{price}</span></a></li>')
    return "".join(out)


def build():
    rows = json.load(open(os.path.join(DATA, "bachelors.json"), encoding="utf-8"))
    rows = [r for r in rows if r[2] == "Türkiye"]
    unipages = set(os.listdir(os.path.join(SITE, "universities")))
    today = date.today().isoformat()
    made = []
    dirs = photo_dirs()
    used_tiles = set()
    for slug, title, names, line in SUBJECTS:
        want = {n.lower() for n in names}
        hits = [r for r in rows if (r[3] or "").strip().lower() in want]
        if len(hits) < 3:
            continue
        by_uni = defaultdict(list)
        for r in hits:
            by_uni[r[0]].append(r)
        yearly = [float(r[8] if r[8] is not None else r[7]) for r in hits if r[10] and (r[8] is not None or r[7] is not None)]
        cheapest = min(yearly) if yearly else None
        english = len({r[0] for r in hits if r[4] == "English"})
        cities = sorted({r[1] for r in hits if r[1]})
        path = f"/study/{slug}-in-turkey/"
        url = BASE + path
        ttl = f"Study {title} in Turkey (Türkiye) for international students: fees at {len(by_uni)} universities | Orbuni"
        desc = (f"Study {title} in Turkey: {len(by_uni)} universities"
                + (f", from {usd(cheapest)} a year after discount" if cheapest else "")
                + f", {english} in English. Published fees and scholarships for students from Africa, the Middle East and Asia. Apply free.")
        trs = []
        def sort_key(r):
            v = r[8] if r[8] is not None else r[7]
            return (0 if r[10] else 1, float(v) if v is not None else 1e9, r[0])
        for r in sorted(hits, key=sort_key):
            u = slugify(r[0])
            name = f'<a href="/universities/{u}/">{esc(r[0])}</a>' if u in unipages else esc(r[0])
            trs.append(f"<tr><td>{name}</td><td>{esc(r[1])}</td><td>{esc(r[4])}</td><td>{esc(r[5])}</td><td>{esc(r[6])}</td><td>{fee_cell(r[7], r[8], r[9], r[10])}</td></tr>")
        qa = faq(title)
        ld = [
            {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
                {"@type": "ListItem", "position": 1, "name": "Orbuni", "item": BASE + "/"},
                {"@type": "ListItem", "position": 2, "name": "Study by subject", "item": BASE + "/study/"},
                {"@type": "ListItem", "position": 3, "name": f"{title} in Turkey", "item": url}]},
            {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
                {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]},
        ]
        stats = [f'<div class="stat"><b>{len(by_uni)}</b><span>universities</span></div>',
                 f'<div class="stat"><b>{len(hits)}</b><span>programmes</span></div>',
                 f'<div class="stat"><b>{english}</b><span>teach it in English</span></div>']
        if cheapest:
            stats.append(f'<div class="stat"><b>{usd(cheapest)}</b><span>cheapest / year</span></div>')
        # the top photo: the campus of the university with the lowest yearly fee that has a photo
        ranked = sorted(by_uni, key=lambda u: min((float(r[8] if r[8] is not None else r[7]) for r in by_uni[u] if r[10] and (r[8] or r[7])), default=1e9))
        top = next((u for u in ranked if photo_for(u, dirs)), None)
        hero_pic = ""
        if top:
            d = photo_for(top, dirs)
            hero_pic = (f'<picture><source type="image/webp" srcset="{d}/01-hero.webp"><img src="{d}/01-hero.jpg" alt="{esc(top)} campus" '
                        f'width="870" height="338" fetchpriority="high" decoding="async"></picture>')
        cards = []
        for u in ranked:
            d = photo_for(u, dirs)
            rs = by_uni[u]
            langs = " & ".join(sorted({r[4] for r in rs}))
            yr = [float(r[8] if r[8] is not None else r[7]) for r in rs if r[10] and (r[8] or r[7])]
            price = f'from <b>{usd(min(yr))}</b> a year' if yr else "fee in the table below"
            im = (f'<picture><source type="image/webp" srcset="{d}/01-card.webp"><img src="{d}/01-card.jpg" alt="{esc(u)} campus" width="900" height="376" loading="lazy" decoding="async"></picture>'
                  if d else '<div class="ph"></div>')
            href = f"/universities/{slugify(u)}/" if slugify(u) in unipages else "/universities/"
            cards.append(f'<li><a class="card" href="{href}"><div class="im">{im}<span class="tag">{esc(langs)}</span></div>'
                         f'<div class="bd"><h3>{esc(u)}</h3><div class="mt">{esc(rs[0][1])} · {len(rs)} {esc(title)} programme{"s" if len(rs) > 1 else ""}</div>'
                         f'<div class="pr">{price}</div></div></a></li>')
        page = head(ttl, desc, url, ld) + f"""<div class="hero tall">{hero_pic}<div class="wrap"><p class="crumbs"><a href="/">Orbuni</a> › <a href="/study/">Study by subject</a> › {esc(title)}</p>
<p class="eyebrow">Bachelor's degree · Turkey (Türkiye)</p><h1>Study {esc(title)} in Turkey</h1>
<p class="lead">{esc(line)} {len(by_uni)} universities in {esc(places(cities))} teach it to international students, and every published fee is on this page.</p>
<div class="btns"><a class="btn btn-p" href="/#start">Apply free</a><a class="btn btn-o" href="/#progs">Search every programme</a></div>
<div class="stats">{''.join(stats)}</div></div></div>
<section class="s"><div class="wrap"><p class="eyebrow">Universities</p><h2>Where you can study {esc(title)} in Turkey</h2>
<ul class="cards">{''.join(cards)}</ul></div></section>
<section class="s" style="padding-top:0"><div class="wrap"><p class="eyebrow">Every programme &amp; fee</p><h2>{esc(title)} fees in Turkey, programme by programme</h2>
<p class="lead2">Fees are in US dollars, as each university publishes them. "Was" is the list fee and the bold figure is what you pay after the current discount; "/ yr" is per year and "total" is for the whole programme. Your counsellor confirms the current figure in writing before you pay anything.</p>
<div class="tw"><table><thead><tr><th>University</th><th>City</th><th>Language</th><th>Length</th><th>Study mode</th><th>Fee</th></tr></thead><tbody>
{''.join(trs)}
</tbody></table></div></div></section>
<section class="s alt"><div class="wrap faq"><p class="eyebrow">Questions</p><h2>Studying {esc(title)} in Turkey as an international student</h2>
{''.join(f'<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>' for q, a in qa)}
<p class="note" style="margin-top:14px">More: <a href="/articles/what-turkiye-actually-costs/">what a year in Türkiye actually costs</a> · <a href="/articles/how-turkish-scholarships-work/">how Turkish scholarships work</a> · <a href="/articles/do-you-need-ielts/">do you need IELTS?</a></p></div></section>
<section class="s"><div class="wrap"><div class="cta-band"><div><h2>Want {esc(title)}? Start here.</h2><p>Applying is free. A named counsellor shortlists the universities that fit your results and budget.</p></div><a class="btn btn-p" href="/#start">Start a free application</a></div></div></section>
""" + FOOT
        out = os.path.join(SITE, "study", f"{slug}-in-turkey")
        os.makedirs(out, exist_ok=True)
        open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(page)
        tile = next((photo_for(u, dirs) for u in ranked if photo_for(u, dirs) and photo_for(u, dirs) not in used_tiles), None) \
            or (photo_for(top, dirs) if top else None)
        used_tiles.add(tile)
        made.append((slug, title, len(by_uni), cheapest, path, tile))

    # hub page
    url = BASE + "/study/"
    cards = tiles(made)
    ld = [{"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Orbuni", "item": BASE + "/"},
        {"@type": "ListItem", "position": 2, "name": "Study by subject", "item": url}]},
        {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": [
            {"@type": "ListItem", "position": i + 1, "url": BASE + m[4], "name": f"{m[1]} in Turkey"} for i, m in enumerate(made)]}]
    hub = head("Study in Turkey by subject: courses and fees for international students | Orbuni",
               "Study medicine, nursing, engineering, business and more in Turkey (Türkiye): every partner university that teaches your subject, with published fees, for students from Africa, the Middle East and Asia.",
               url, ld) + f"""<div class="hero"><div class="wrap"><p class="crumbs"><a href="/">Orbuni</a> › Study by subject</p>
<p class="eyebrow">Bachelor's degrees · Turkey (Türkiye)</p><h1>Study in Turkey by subject</h1>
<p class="lead">Pick your subject to see every partner university in Turkey that teaches it to international students, the teaching language and the published fee.</p></div></div>
<section class="s"><div class="wrap"><ul class="tiles">{cards}</ul>
<p class="note" style="margin-top:18px">Not listed? <a href="/#progs">Search all programmes</a> or <a href="/universities/">browse every university</a>.</p></div></section>
""" + FOOT
    os.makedirs(os.path.join(SITE, "study"), exist_ok=True)
    open(os.path.join(SITE, "study", "index.html"), "w", encoding="utf-8").write(hub)

    # the same tiles on /universities/ ("What do you want to study in Turkey?")
    up = os.path.join(SITE, "universities", "index.html")
    t = open(up, encoding="utf-8").read()
    t = re.sub(r'<section class="s" id="by-subject">.*?</section>\n', "", t, flags=re.S)
    tile_css = re.search(r"\.tiles\{.*?\n@media\(max-width:560px\)\{[^\n]*\}", EXTRA_CSS, re.S).group(0)
    block = (f'<section class="s" id="by-subject"><div class="wrap"><style>{tile_css}</style><p class="eyebrow">Study by subject</p>'
             f'<h2>What do you want to study in Turkey?</h2><p class="lead2">Pick a subject to see every partner university that '
             f'teaches it, in English or Turkish, with the published fee.</p><ul class="tiles">{tiles(made)}</ul></div></section>\n')
    i = t.index('<section class="s')
    open(up, "w", encoding="utf-8").write(t[:i] + block + t[i:])

    # sitemap: replace any earlier study entries, add the current ones before </urlset>
    sm_path = os.path.join(SITE, "sitemap.xml")
    sm = open(sm_path, encoding="utf-8").read()
    sm = re.sub(r"\s*<url><loc>https://myorbuni\.com/study/[^<]*</loc>.*?</url>", "", sm)
    entries = [f"  <url><loc>{BASE}/study/</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>"]
    entries += [f"  <url><loc>{BASE}{m[4]}</loc><lastmod>{today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>" for m in made]
    sm = sm.replace("</urlset>", "\n".join(entries) + "\n</urlset>")
    open(sm_path, "w", encoding="utf-8").write(sm)
    rd_path = os.path.join(SITE, "_redirects")
    rd = open(rd_path, encoding="utf-8").read()
    rd = re.sub(r"/study/[a-z-]+-in-turkiye/\s+/study/[a-z-]+-in-turkey/\s+301\n", "", rd)
    lines = "".join(f"/study/{m[0]}-in-turkiye/  /study/{m[0]}-in-turkey/  301\n" for m in made)
    catch_all = "/*    /index.html   200"
    assert catch_all in rd
    rd = rd.replace(catch_all, lines + catch_all, 1)   # must come before the catch-all
    open(rd_path, "w", encoding="utf-8").write(rd)
    for m in made:
        print(f"{m[4]:55} {m[2]:3} universities  from {usd(m[3]) if m[3] else '-'}")


if __name__ == "__main__":
    build()
    import subprocess, sys   # rebuilt pages need the WhatsApp button again
    subprocess.run([sys.executable, os.path.join(ROOT, "tools", "add_whatsapp_button.py")], check=True)

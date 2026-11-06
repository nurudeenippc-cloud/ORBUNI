"""Put the five Orbuni story videos (Nov 2026) on the prerendered pages.

Safe to run again after build_info_pages.py / build_study_pages.py: each block is marked
with <!--ovid:NAME--> ... <!--/ovid:NAME--> and replaced in place, never duplicated.
Videos are vertical (9:16) H.264 files in site/video/, loaded only when played
(preload="none" + poster). Speech is captioned inside the video itself.
"""
import pathlib, re

SITE = pathlib.Path(__file__).resolve().parent.parent / "site"

CSS = """<style id="ovid-css">
.ovid-row{display:grid;grid-template-columns:minmax(200px,300px) 1fr;gap:30px;align-items:center}
.ovid-row.two{grid-template-columns:repeat(2,minmax(200px,300px)) 1fr}
.ovid-fig{margin:0}
.ovid-fig video{width:100%;aspect-ratio:9/16;object-fit:cover;border-radius:18px;background:#000;border:1px solid rgba(255,255,255,.14);display:block}
.ovid-fig.wide video{aspect-ratio:4/5}
.ovid-fig figcaption{font-size:13px;color:var(--dim,#9BABC3);margin-top:8px}
.ovid-tx p{color:var(--dim,#9BABC3);margin:0 0 12px;max-width:60ch}.ovid-tx ul{margin:0 0 12px;padding-left:18px;color:var(--dim,#9BABC3)}
.ovid-tx li{margin:0 0 6px}.ovid-tx b{color:var(--txt,#EEF3FA)}
@media(max-width:760px){.ovid-row,.ovid-row.two{grid-template-columns:1fr;gap:18px}.ovid-fig{max-width:320px;width:100%;margin:0 auto}}
</style>"""

def fig(name, label, cap, cls=""):
    return (f'<figure class="ovid-fig{cls}"><video controls playsinline preload="none" poster="/video/{name}-poster.jpg" '
            f'aria-label="{label}"><source src="/video/{name}.mp4" type="video/mp4"></video>'
            f'<figcaption>{cap}</figcaption></figure>')

BLOCKS = {
  "about": ("about/index.html", '<section class="s alt">', "before", f"""<section class="s"><div class="wrap">
<p class="eyebrow">Watch</p><h2>Orbuni in a minute</h2>
<div class="ovid-row two">
{fig("orbuni-what-is", "Video: what Orbuni is", "What Orbuni is, from our Managing Director · 1 min")}
{fig("orbuni-team", "Video: the team behind Orbuni", "The team that runs Orbuni · 1 min")}
<div class="ovid-tx">
<p><b>One place for the whole journey.</b> You apply through Orbuni to universities in Türkiye, Northern Cyprus and our other partner countries, get your acceptance letter in your portal, and book airport pickup and housing in the same place.</p>
<p><b>Built by a team, not one person.</b> Nurudeen Muh. Abdulkareem is our Managing Director. His co-founder, Godfrey Emmanuel Wudaba, is our Chief Operating Officer and runs operations end to end: applications, admissions, offers, visas and arrivals. Lenns Wordjy Coutilien is our Creative Director.</p>
</div></div></div></section>
<section class="s"><div class="wrap">
<p class="eyebrow">New on the team</p><h2>Welcome, Lenns</h2>
<div class="ovid-row">
{fig("orbuni-welcome-lenns", "Video: welcoming Lenns, our Creative Director", "Welcome to the team · 30 sec", " wide")}
<div class="ovid-tx"><p><b>Lenns Wordjy Coutilien</b> joined Orbuni as Creative Director. He leads creativity and content: the videos, reels and guides that show students exactly what we do.</p>
<p><b>We are hiring.</b> See <a href="/#careers">careers at Orbuni</a>.</p>
</div></div></div></section>
<section class="s"><div class="wrap">
<p class="eyebrow">Student life</p><h2>A night off in Istanbul</h2>
<div class="ovid-row">
{fig("orbuni-night-istanbul", "Video: a night out in Istanbul", "An evening by the water in Istanbul · 1 min")}
<div class="ovid-tx"><p>Life here is not only lectures. A walk by the Bosphorus at night, and an honest answer to “how do you feel about Türkiye?”, from someone who once sat in Nigeria wondering how to even start.</p>
<p>Every dream needs a first step. Yours can be the <a href="/#start">free 2-minute assessment</a>.</p></div>
</div></div></section>
"""),
  "housing": ("housing/index.html", '<section class="s alt" id', "before", f"""<section class="s"><div class="wrap">
<p class="eyebrow">Watch</p><h2>A room waiting when you land</h2>
<div class="ovid-row">
{fig("orbuni-housing-story", "Video: booking student housing through Orbuni", "Why we book your room before you fly · 1 min")}
<div class="ovid-tx">
<p>When our Managing Director first came to Istanbul, he had to stay with his uncle before he could find a place of his own. Finding accommodation is one of the hardest parts of moving here, so Orbuni lets you sort it out before you travel.</p>
<ul><li>Get your scholarship and acceptance letter, then your visa.</li>
<li>Book your room from your portal. Your counsellor sets everything up.</li>
<li>Book airport pickup too: you land, and you are taken straight to your accommodation.</li></ul>
</div></div></div></section>
"""),
  "schol": ("scholarships/index.html", '<section class="s alt"><div class="wrap"><p class="eyebrow">Real figures</p>', "before", f"""<section class="s"><div class="wrap">
<p class="eyebrow">Watch</p><h2>Scholarships in three steps</h2>
<div class="ovid-row">
{fig("orbuni-scholarships", "Video: how scholarships work on Orbuni", "How scholarships work on Orbuni · 1 min")}
<div class="ovid-tx">
<ul><li><b>Where.</b> Pick a country: 48 partner universities across Türkiye, Northern Cyprus and our other partner countries.</li>
<li><b>How much.</b> Scholarships go up to 100%. Bands such as 100%, 80%, 70% and 50% differ by university and depend on your grades.</li>
<li><b>Apply.</b> Search your course, then choose up to three programmes in one application. Your counsellor checks which ones your results fit.</li></ul>
<p>Applying is free. <a href="/#start">See which band you could get</a>.</p>
</div></div></div></section>
"""),
  "article": ("articles/how-turkish-scholarships-work/index.html", '<section class="s alt"><div class="wrap"><p class="eyebrow">Sources</p>', "before", f"""<section class="s" style="padding-top:0"><div class="wrap">
<div class="ovid-row">
{fig("orbuni-scholarships", "Video: how scholarships work on Orbuni", "The short version · 1 min")}
<div class="ovid-tx"><p><b>The short version.</b> Pick a country, see the scholarship band (up to 100%, with bands such as 80%, 70% and 50% depending on the university and your grades), then apply for up to three programmes in one application on Orbuni.</p></div>
</div></div></section>
"""),
}

def run():
    for key, (rel, anchor, where, html) in BLOCKS.items():
        p = SITE / rel
        t = p.read_text(encoding="utf-8")
        block = f"<!--ovid:{key}-->{html}<!--/ovid:{key}-->"
        t = re.sub(rf"<!--ovid:{key}-->.*?<!--/ovid:{key}-->", "", t, flags=re.S)
        assert t.count(anchor) >= 1, (rel, anchor)
        t = t.replace(anchor, block + anchor, 1)
        t = re.sub(r'<style id="ovid-css">.*?</style>', "", t, flags=re.S)
        t = t.replace("</head>", CSS + "</head>", 1)
        p.write_text(t, encoding="utf-8")
        print("ok", rel)

if __name__ == "__main__":
    run()

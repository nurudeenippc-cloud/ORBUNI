#!/usr/bin/env python3
"""Adds media to the generated static pages. Safe to run more than once.

1. University pages (site/universities/<slug>/): a "Campus video" section with the
   university's own YouTube film, from tools/data/university_videos.json (a copy of the
   university_videos_public view: university, video_id, channel).
2. Housing pages (site/housing/<slug>/): each page gets its own mix of three example room
   photos instead of the same three everywhere. The photos are Unsplash images
   (tools/data/housing_stock_photos.json), loaded from Unsplash itself as Unsplash asks.
   They stay labelled as example rooms: the pages keep residence names private on
   purpose, so no real residence photo (which shows the residence's branding) is used.

Run:  python3 tools/enrich_media.py
"""
import glob, html, json, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
DATA = os.path.join(ROOT, "tools", "data")
esc = lambda s: html.escape(str(s), quote=True)
SLUG_FIX = {"TOBB ETU University of Economics & Technology": "tobb-etu-university-of-economics-and-technology"}


def slugify(n):
    if n in SLUG_FIX:
        return SLUG_FIX[n]
    n = n.replace("İ", "I").replace("ı", "i")
    n = unicodedata.normalize("NFKD", n).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", n).strip("-")


def university_videos():
    vids = json.load(open(os.path.join(DATA, "university_videos.json"), encoding="utf-8"))
    done, missing = 0, []
    for name, vid, channel in vids:
        f = os.path.join(SITE, "universities", slugify(name), "index.html")
        if not os.path.exists(f):
            missing.append(name)
            continue
        s = open(f, encoding="utf-8").read()
        s = re.sub(r'<section class="s" id="campus-video">.*?</section>\n', "", s, flags=re.S)
        h1 = re.search(r"<h1>(.*?)</h1>", s)
        title = h1.group(1) if h1 else esc(name)
        block = (f'<section class="s" id="campus-video"><div class="wrap"><p class="eyebrow">Campus video</p>'
                 f'<h2>See {title} for yourself</h2>'
                 f'<div class="vbox"><iframe src="https://www.youtube-nocookie.com/embed/{esc(vid)}?playsinline=1&amp;rel=0&amp;modestbranding=1" '
                 f'title="{title} — campus film" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen '
                 f'referrerpolicy="strict-origin-when-cross-origin"></iframe></div>'
                 f'<p class="note" style="margin-top:10px">The university\'s own film, from its YouTube channel ({esc(channel)}).</p></div></section>\n')
        anchor = '<section class="s" style="padding-top:0"><div class="wrap"><p class="eyebrow">Fees &amp; programmes'
        if anchor not in s:
            anchor = '<section class="s alt" id="payment">'   # universities with no programme list yet
        if anchor not in s:
            missing.append(name + " (no place for it)")
            continue
        s = s.replace(anchor, block + anchor, 1)
        open(f, "w", encoding="utf-8").write(s)
        done += 1
    print(f"university pages with their campus video: {done}", ("missing: " + ", ".join(missing)) if missing else "")


def housing_photos():
    photos = json.load(open(os.path.join(DATA, "housing_stock_photos.json"), encoding="utf-8"))
    # Orbuni's own three room photos join the mix
    photos += [{"local": "/photos/home/dorm-desk-loft.jpg"}, {"local": "/photos/home/fcard-housing.jpg"},
               {"local": "/photos/home/dorm-bunk-seaview.jpg"}]
    pages = sorted(glob.glob(os.path.join(SITE, "housing", "*", "index.html")))
    n = len(photos)
    # a different set of three for every page, the same every run (fixed seed)
    import random
    rnd, used, mixes = random.Random(2026), set(), []
    while len(mixes) < len(pages):
        mix = tuple(rnd.sample(range(n), 3))
        if mix[0] in [m[0] for m in mixes[-6:]] or frozenset(mix) in used:
            continue
        used.add(frozenset(mix)); mixes.append(mix)

    def img(p, w, h, first):
        load = 'fetchpriority="high"' if first else 'loading="lazy"'
        src = p["local"] if "local" in p else f'{p["url"]}&auto=format&fit=crop&w={w}&h={h}&q=70'
        return (f'<img class="" src="{esc(src)}" alt="Example of a furnished student room" width="{w}" height="{h}" '
                f'{load} decoding="async">')

    for i, f in enumerate(pages):
        s = open(f, encoding="utf-8").read()
        pick = [photos[j] for j in mixes[i]]
        # hero picture
        s, a = re.subn(r'(<div class="hero[^"]*"><picture>)<img [^>]*>(</picture>)',
                       lambda m: m.group(1) + img(pick[0], 1400, 700, True) + m.group(2), s, count=1)
        # the three-photo gallery
        gal = '<div class="gal">' + "".join(f"<figure><picture>{img(p, 900, 600, False)}</picture></figure>" for p in pick) + "</div>"
        s, b = re.subn(r'<div class="gal">.*?</div>(?=\s*<p class="note")', gal, s, count=1, flags=re.S)
        s = s.replace("Photos show typical Orbuni-arranged student rooms, not this exact room.",
                      "Example rooms, not this exact residence — your counsellor sends real photos with the name and rent. Photos: Unsplash.")
        open(f, "w", encoding="utf-8").write(s)
        if not (a and b):
            print("housing page not changed fully:", f, a, b)
    print(f"housing pages with their own photo mix: {len(pages)} (from {n} photos)")
    idx = os.path.join(SITE, "housing", "index.html")
    t = open(idx, encoding="utf-8").read()
    for i, f in enumerate(pages):
        slug = os.path.basename(os.path.dirname(f))
        t = re.sub(r'(<a class="card" href="/housing/' + re.escape(slug) + r'/"><div class="im"><picture>)<img [^>]*>',
                   lambda m: m.group(1) + img(photos[mixes[i][0]], 800, 500, False), t, count=1)
    open(idx, "w", encoding="utf-8").write(t)


if __name__ == "__main__":
    university_videos()
    housing_photos()

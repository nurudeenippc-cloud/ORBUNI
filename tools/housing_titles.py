#!/usr/bin/env python3
"""Gives every page under site/housing/<slug>/ its own title and description.

Several residences share an area and a gender (three women's residences in Fatih,
three men's in Avcılar...), so their titles and descriptions were word-for-word the
same, and Google treats pages like that as duplicates and shows only one. Names,
addresses and prices stay off these pages by design, so the title is numbered the way
the address already is ("... in Fatih, Istanbul (2)") and the description lists the
page's own room types, the one public fact that differs between them.

Run after the housing pages are (re)generated:  python3 tools/housing_titles.py
Safe to run more than once.
"""
import glob, html, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOUSING = os.path.join(ROOT, "site", "housing")


def esc(s):
    return html.escape(s, quote=False).replace('"', "&quot;")


def main():
    seen = {}
    for f in sorted(glob.glob(os.path.join(HOUSING, "*", "index.html"))):
        t = open(f, encoding="utf-8").read()
        h1 = html.unescape(re.search(r"<h1>([^<]+)</h1>", t).group(1))          # Women's student residence in Fatih
        area = re.search(r" in (.+)$", h1).group(1)
        who = {"Women": "for women", "Men": "for men"}.get(re.match(r"(\w+)", h1).group(1), "for men and women")
        block = re.search(r"Room types</h2><div class=\"pills\">(.*?)</div>", t, re.S)
        pills = [html.unescape(x) for x in re.findall(r'<span class="pill[^"]*">([^<]+)</span>', block.group(1))] if block else []
        title = f"{h1}, Istanbul | Orbuni"
        n = seen.get(title, 0) + 1
        seen[title] = n
        if n > 1:  # same area and gender as an earlier page: number it, as the address does
            title = f"{h1}, Istanbul ({n}) | Orbuni"
        desc = f"Student accommodation in {area}, Istanbul {who}"
        tail = ". Ask Orbuni for the monthly rent for your dates."
        if pills:
            shown = []
            for p in pills:  # list room types while the description stays under ~160 characters
                if len(desc) + len(tail) + len(", ".join(shown + [p])) + 20 > 160:
                    break
                shown.append(p)
            more = "" if len(shown) == len(pills) else ", …"
            desc += f": {len(pills)} room type{'s' if len(pills) > 1 else ''}" + (f" ({', '.join(shown)}{more})" if shown else "")
        desc += tail
        et, ed = esc(title), esc(desc)
        t = re.sub(r"<title>[^<]*</title>", f"<title>{et}</title>", t, 1)
        t = re.sub(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{ed}">', t, 1)
        t = re.sub(r'<meta property="og:title" content="[^"]*">', f'<meta property="og:title" content="{et}">', t, 1)
        t = re.sub(r'<meta property="og:description" content="[^"]*">', f'<meta property="og:description" content="{ed}">', t, 1)
        t = re.sub(r'<meta name="twitter:title" content="[^"]*">', f'<meta name="twitter:title" content="{et}">', t, 1)
        t = re.sub(r'<meta name="twitter:description" content="[^"]*">', f'<meta name="twitter:description" content="{ed}">', t, 1)
        open(f, "w", encoding="utf-8").write(t)
        print(f"{os.path.basename(os.path.dirname(f)):32} {title}")


if __name__ == "__main__":
    main()

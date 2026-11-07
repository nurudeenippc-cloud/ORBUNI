#!/usr/bin/env python3
"""Keeps the public static pages in line with how Orbuni presents itself:
a university search and application platform, free to apply. Paid service packages
and their prices live only in the student portal. Safe to run any number of times.

Run after the generators:  python3 tools/scrub_public.py
"""
import os, re

SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "site")

FREE_SECTION = '''<section class="s alt" id="payment"><div class="wrap">
<p class="eyebrow">Applying through Orbuni</p><h2>Free to apply, with a dedicated counsellor</h2>
<p class="lead2">Searching, comparing and applying through Orbuni costs nothing. Tuition goes straight to the university.</p>
<div class="flow">
<div><b>Apply free</b><span>Your counsellor checks every document and submits your application through official partner channels.</span></div>
<div><b>Scholarship matched to you</b><span>We apply for the highest scholarship band your grades qualify for.</span></div>
<div><b>Tuition direct to the university</b><span>You pay the university itself, into its own account, and get its receipt. Government fees are paid directly too.</span></div></div>
</div></section>'''

SUBS = [
    (re.compile(r'<section class="s alt" id="payment">.*?</section>', re.S), FREE_SECTION),
    ("No. Applying is free, and there is no payment before a university sends you an offer letter. Tuition is paid directly to the university, never to Orbuni.",
     "No. Searching, comparing and applying through Orbuni is free. Tuition is paid directly to the university, never to Orbuni."),
    ('<p>Orbuni is a verified partner of <b>AskUni</b>. That is checkable, and it is on our About page rather than buried.</p>',
     '<p>Orbuni submits applications through official university partner channels, and you can follow every step in your own portal.</p>'),
    ('<a href="/pricing/">Prices</a>', '<a href="/pricing/">Is it free?</a>'),
    ('<a href="/about/">About &amp; verify us</a>', '<a href="/about/">About Orbuni</a>'),
]


def main():
    changed = 0
    for dp, _, fs in os.walk(SITE):
        for f in fs:
            if not f.endswith(".html") or f == "_uitest.html" or (f == "index.html" and os.path.abspath(dp) == os.path.abspath(SITE)):
                continue
            fp = os.path.join(dp, f)
            t = open(fp, encoding="utf-8").read()
            o = t
            for a, b in SUBS:
                t = a.sub(b, t) if hasattr(a, "sub") else t.replace(a, b)
            if t != o:
                open(fp, "w", encoding="utf-8").write(t)
                changed += 1
    print("pages updated:", changed)


if __name__ == "__main__":
    main()

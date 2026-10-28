#!/usr/bin/env python3
"""Builds the plain information pages that Google and AI assistants can read without
running any JavaScript: prices, how it works, about / how to verify us, parents, FAQ.

The main site is one page (site/index.html) whose sections open by "#hash"; search engines
and AI tools see that as a single URL. These pages give each question its own address,
with structured data (FAQPage, Service/Offer, BreadcrumbList) and llms.txt for AI tools.

Public pages say what is free and how it works. Prices for the optional paid services live only
in the student portal and the Student Service Agreement (shown before anyone pays).

Run:  python3 tools/build_info_pages.py   (then re-zip site/ and upload to Netlify)
"""
import json, os, re, sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_study_pages import head, FOOT, esc, BASE, SITE  # same look as the subject pages

TODAY = date.today().isoformat()
WA = "https://wa.me/14434481577"

ORG = {"@id": BASE + "/#org"}


def crumbs(name, path):
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": 1, "name": "Orbuni", "item": BASE + "/"},
        {"@type": "ListItem", "position": 2, "name": name, "item": BASE + path}]}


def faq_ld(qa):
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": re.sub(r"<[^>]+>", "", a)}} for q, a in qa]}


def faq_html(qa):
    return "".join(f"<details><summary>{esc(q)}</summary><p>{a}</p></details>" for q, a in qa)


def hero(crumb, eyebrow, h1, lead, btns=True):
    b = ('<div class="btns"><a class="btn btn-p" href="/#start">Free 2-minute assessment</a>'
         f'<a class="btn btn-o" href="{WA}">Ask on WhatsApp</a></div>') if btns else ""
    return (f'<div class="hero"><div class="wrap"><p class="crumbs"><a href="/">Orbuni</a> › {esc(crumb)}</p>'
            f'<p class="eyebrow">{esc(eyebrow)}</p><h1>{h1}</h1><p class="lead">{lead}</p>{b}</div></div>\n')


CTA = ('<section class="s"><div class="wrap"><div class="cta-band"><div><h2>Start with the free assessment</h2>'
       '<p>Two minutes. It looks at your grades, budget, documents and timeline, and shows which universities and scholarships fit you. '
       'Searching, comparing and applying through Orbuni is free.</p></div>'
       '<a class="btn btn-p" href="/#start">Check in 2 minutes</a></div></div></section>\n')

CSS = """<style>
.pk{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px;list-style:none;margin:0;padding:0}
.pk li{background:var(--p1);border:1px solid var(--line);border-radius:var(--rl);padding:20px 20px 18px;display:flex;flex-direction:column;gap:8px}
.pk li.hl{border-color:rgba(242,181,68,.55)}
.pk h3{font-size:21px}.pk .pr{font:800 30px var(--disp);letter-spacing:-.03em;color:var(--gold)}.pk .pr small{display:block;margin-top:4px;font:500 13px var(--sans);letter-spacing:0;color:var(--dim)}
.pk ul{margin:4px 0 0;padding-left:18px;color:var(--dim);font-size:14px}.pk ul li{background:none;border:0;padding:2px 0;display:list-item}
.pk .rf{margin-top:auto;font-size:13px;color:var(--dim);border-top:1px solid var(--line);padding-top:10px}
.steps{counter-reset:s;list-style:none;margin:0;padding:0;display:grid;gap:12px}
.steps li{background:var(--p1);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px 16px 62px;position:relative}
.steps li::before{counter-increment:s;content:counter(s);position:absolute;left:18px;top:16px;width:30px;height:30px;border-radius:50%;
  background:linear-gradient(100deg,var(--gold),var(--amber));color:#1A1204;font:800 15px/30px var(--disp);text-align:center}
.steps b{display:block;font-size:16px;margin-bottom:3px}.steps span{color:var(--dim);font-size:14.5px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:720px){.two{grid-template-columns:1fr}}
.box{background:var(--p1);border:1px solid var(--line);border-radius:var(--rl);padding:18px 20px}
.box h3{margin-bottom:8px}.box ul{margin:0;padding-left:18px;color:var(--dim)}.box ul li{margin:4px 0}
.box.ok{border-color:rgba(62,213,152,.35)}.box.no{border-color:rgba(224,138,51,.4)}
.money{width:100%;border-collapse:collapse}.money td,.money th{border-bottom:1px solid var(--line);padding:10px 8px;text-align:left;vertical-align:top}
.money th{color:var(--dim);font-size:12px;text-transform:uppercase;letter-spacing:.08em}
</style>"""


def page(path, title, desc, ld, body):
    html = head(title, desc, BASE + path, ld).replace("</head>", CSS + "</head>", 1) + body + CTA + FOOT
    out = os.path.join(SITE, path.strip("/"))
    os.makedirs(out, exist_ok=True)
    open(os.path.join(out, "index.html"), "w", encoding="utf-8").write(html)
    return path


# What every student gets, free. The paid services and their prices live in the student portal,
# shown in writing before anyone chooses one (Student Service Agreement).
FREE = [
    ("Search 2,600+ programmes", "Tuition and the current scholarship side by side, at 48 partner universities in six countries."),
    ("A dedicated counsellor", "One person who knows your file, from your first question to your first lecture."),
    ("Scholarship matching", "We apply for the highest scholarship band your grades qualify for."),
    ("Your application, done properly", "Every document checked, then submitted through official university partner channels."),
    ("Your student portal", "Every document, update and offer letter in one private place."),
    ("Housing, visa and arrival support", "Real residences chosen before you fly, a checked visa file, and help when you land."),
]

FAQ = [
    ("Does it cost anything to apply through Orbuni?",
     "No. Searching, comparing and applying through Orbuni is free, with a dedicated counsellor."),
    ("What does Orbuni do?",
     "Orbuni is a university search and application platform based in Istanbul, Türkiye. Students compare 2,600+ programmes at 48 partner universities in Türkiye, Northern Cyprus, the UAE, Germany, Egypt and Russia, apply free, and get support with scholarships, admission, visa preparation, student housing and arrival."),
    ("Do I pay my tuition to Orbuni?",
     "No. Tuition and university deposits are paid directly to the university's own account, never to Orbuni. You get the university's receipt."),
    ("How do I know Orbuni is genuine?",
     "Orbuni is based in Istanbul and submits applications through official university partner channels. Applying is free, any payment happens only on secure myorbuni.com checkout pages, tuition goes straight to the university, and documents are uploaded to your private portal, never sent over WhatsApp. See <a href=\"/about/\">about Orbuni</a>."),
    ("Can Orbuni help me get a scholarship?",
     "Yes. Most private universities in Türkiye give international students a tuition scholarship of 25% to 100%. We match your grades to each university's scholarship bands and apply for the highest band you qualify for. See <a href=\"/articles/how-turkish-scholarships-work/\">how Turkish scholarships work</a>."),
    ("What is a \"scholarship\" at a Turkish private university?",
     "Usually a discount on tuition that the university gives international students. Its size depends on the university, the programme and sometimes your grades. It is different from the Turkish government scholarship (Türkiye Bursları)."),
    ("Which documents do I need to apply?",
     "Usually your passport, your secondary school certificate (for example WAEC, NECO, KCSE or your country's equivalent), your transcript and a photograph. Some programmes ask for an English test. You upload them to your Orbuni portal."),
    ("Do I need IELTS to study in Türkiye?",
     "Not always. Many universities accept their own English test or proof of English-medium schooling. See <a href=\"/articles/do-you-need-ielts/\">do you need IELTS?</a>."),
    ("Does Orbuni help with the student visa?",
     "Yes. We prepare and check your visa file with you: what to bring, how to present it and what the consulate looks for. If a visa is refused, your file can be carried over to the next intake."),
    ("Can Orbuni help with housing in Istanbul?",
     "Yes. Orbuni shows real student residences with photos and prices, and you choose before you fly. See <a href=\"/housing/\">student housing</a>."),
    ("Which countries does Orbuni place students in?",
     "Türkiye, Northern Cyprus, the UAE, Germany, Egypt and Russia."),
    ("Who does Orbuni work with?",
     "Students and parents from Africa, the Middle East, Asia and Europe, and partner education agencies who refer students."),
    ("How fast will someone answer me?",
     "The WhatsApp assistant answers at any hour, and a counsellor replies in working hours (Istanbul time)."),
    ("How do I start?",
     "Take the free 2-minute assessment at myorbuni.com/#start. It shows which universities and scholarships fit your grades, budget, documents and timeline."),
]


def build():
    made = []
    free_cards = "".join(f"<li><h3>{esc(a)}</h3><ul><li>{esc(b)}</li></ul></li>" for a, b in FREE)

    # ---------- what it costs (free)
    ld = [crumbs("Is it free?", "/pricing/"),
          {"@context": "https://schema.org", "@type": "Service", "name": "University search and application for international students",
           "serviceType": "Study abroad admission, scholarship and arrival support", "provider": ORG, "areaServed": "Worldwide",
           "offers": {"@type": "Offer", "name": "Apply through Orbuni", "price": "0", "priceCurrency": "USD",
                      "description": "Searching, comparing and applying through Orbuni is free, with a dedicated counsellor."}},
          faq_ld([FAQ[0], FAQ[2], FAQ[3]])]
    body = hero("Is it free?", "Free to search, compare and apply", 'Apply through Orbuni <span class="grad">for free</span>',
                "Searching, comparing and applying through Orbuni costs nothing, and you get a dedicated counsellor from the start. "
                "Tuition is always paid straight to the university.") + f"""
<section class="s"><div class="wrap"><p class="eyebrow">Included, free</p><h2>Everything you need to apply</h2>
<ul class="pk">{free_cards}</ul></div></section>
<section class="s alt"><div class="wrap"><p class="eyebrow">The money map</p><h2>Who receives what</h2>
<table class="money"><thead><tr><th>What</th><th>Paid to</th></tr></thead><tbody>
<tr><td>Searching and applying through Orbuni</td><td>Nobody. It is free</td></tr>
<tr><td>Tuition and the university's deposit</td><td>The university's own account, never Orbuni</td></tr>
<tr><td>Visa and residence-permit fees</td><td>The government</td></tr>
<tr><td>Housing</td><td>The residence (contract with them)</td></tr>
</tbody></table>
<p class="note" style="margin-top:14px">Optional services such as airport pickup or full arrival support can be booked inside your student portal, with what they include shown in writing before you choose.</p></div></section>
<section class="s"><div class="wrap faq"><p class="eyebrow">Questions</p><h2>About money</h2>{faq_html([FAQ[0], FAQ[2], FAQ[3]])}</div></section>
"""
    made.append(page("/pricing/", "Is Orbuni free? Apply to universities abroad for free | Orbuni",
                     "Searching, comparing and applying to universities through Orbuni is free, with a dedicated counsellor. Tuition is paid directly to the university.",
                     ld, body))

    # ---------- how it works
    steps = [
        ("Take the free 2-minute assessment", "Your grades, budget, documents and timeline. It shows which universities and scholarships fit you, not a list of twenty."),
        ("Talk to your counsellor", "On WhatsApp or a call. Ready students get a small group with their counsellor."),
        ("Choose three routes", "One ambitious, one solid, one safe: university, programme and intake, with the published fee and current scholarship."),
        ("Upload your documents to the portal", "Passport, certificate, transcript, photo. We check every document before anything is sent."),
        ("We apply through official partner channels", "You follow every step in your portal until the offer letter arrives."),
        ("Your offer letter arrives", "We go through it with you: the programme, the scholarship and the deposit deadline."),
        ("Pay the university's deposit to the university", "Straight to its own account, by its own deadline."),
        ("Visa, housing and flight", "A checked visa file, a real room chosen before you fly, and pickup when you land."),
        ("Arrival and registration", "Registration at your university and residence-permit support in your first weeks."),
    ]
    ld = [crumbs("How it works", "/how-it-works/"),
          {"@context": "https://schema.org", "@type": "HowTo", "name": "How to apply to a university abroad with Orbuni",
           "step": [{"@type": "HowToStep", "position": i + 1, "name": a, "text": b} for i, (a, b) in enumerate(steps)]}]
    body = hero("How it works", "From first message to first lecture", 'How Orbuni works, <span class="grad">step by step</span>',
                "You don't need to learn the whole system. Your counsellor runs your file every week, and you see every step in your portal.") + f"""
<section class="s"><div class="wrap"><ol class="steps">{"".join(f"<li><b>{esc(a)}</b><span>{esc(b)}</span></li>" for a, b in steps)}</ol></div></section>
<section class="s alt"><div class="wrap two">
<div class="box ok"><h3>What you can count on</h3><ul><li>The real fee, from the university's own published figures</li><li>The highest scholarship band your grades qualify for</li><li>The university's own paperwork before any deposit</li><li>A counsellor who answers, every step of the way</li></ul></div>
<div class="box ok"><h3>How your money and documents are protected</h3><ul><li>Tuition goes straight to the university's account</li><li>Payments only on secure myorbuni.com pages</li><li>Documents in your private portal, never on WhatsApp</li><li>Partner agencies never see your documents</li></ul></div>
</div></section>
"""
    made.append(page("/how-it-works/", "How Orbuni works: apply to university abroad step by step | Orbuni",
                     "From the free 2-minute assessment to your first lecture: documents, application, scholarship, offer letter, deposit, visa, housing and arrival.",
                     ld, body))

    # ---------- about
    ld = [crumbs("About Orbuni", "/about/"),
          {"@context": "https://schema.org", "@type": "AboutPage", "url": BASE + "/about/", "about": ORG,
           "mainEntity": {"@type": "EducationalOrganization", "@id": BASE + "/#org", "name": "Orbuni",
                          "address": {"@type": "PostalAddress", "addressLocality": "Istanbul", "addressCountry": "TR"}}},
          faq_ld([FAQ[1], FAQ[3], FAQ[2]])]
    body = hero("About", "About Orbuni", 'From search <span class="grad">to first lecture</span>',
                "Orbuni is a university search and application platform based in Istanbul, Türkiye. Students from Africa and around the world use it to find the right programme, apply free, win the best available scholarship and arrive ready.") + f"""
<section class="s"><div class="wrap"><ul class="pk">
<li><h3>2,698 programmes</h3><ul><li>Tuition and the current scholarship side by side</li></ul></li>
<li><h3>48 partner universities</h3><ul><li>In Türkiye, Northern Cyprus, the UAE, Germany, Egypt and Russia</li></ul></li>
<li><h3>Free to apply</h3><ul><li>With a dedicated counsellor and a private student portal</li></ul></li>
</ul></div></section>
<section class="s alt"><div class="wrap two">
<div class="box"><h3>What Orbuni does</h3><ul>{"".join(f"<li><b>{esc(a)}.</b> {esc(b)}</li>" for a, b in FREE)}</ul></div>
<div class="box ok"><h3>How to recognise us</h3><ul>
<li>Applying is free</li>
<li>Any payment happens only on <b>myorbuni.com</b> checkout pages (Whop or Paystack), never to a personal account</li>
<li>Tuition goes to the university's own account; you get its receipt</li>
<li>We never ask for card details, passwords or codes in a chat</li>
<li>Documents go in your portal, never over WhatsApp</li>
<li>Our only WhatsApp number is <b>+1 443 448 1577</b></li>
<li>You are welcome to visit us in Istanbul</li></ul></div>
</div></section>
<section class="s"><div class="wrap faq"><p class="eyebrow">Questions</p><h2>About Orbuni</h2>{faq_html([FAQ[1], FAQ[3], FAQ[2], FAQ[12]])}
<p class="note" style="margin-top:14px">More: <a href="/articles/is-this-agency-real/">how to check whether any education agency is real</a> · <a href="/pricing/">is it free?</a> · <a href="/how-it-works/">how it works</a></p></div></section>
"""
    made.append(page("/about/", "About Orbuni: university search and application platform, Istanbul | Orbuni",
                     "Orbuni is a university search and application platform based in Istanbul. Compare 2,600+ programmes at 48 partner universities, apply free, and get scholarship, visa and housing support.",
                     ld, body))

    # ---------- parents
    pq = [
        ("Is my child safe in Istanbul?", "Istanbul is a large city with a big international student population. We show real residences with photos, help choose one before the flight, and someone can meet your child at the airport."),
        ("Who is responsible for my child's application?", "A dedicated counsellor on the file, a private portal where you can see every step, and a written agreement for any service you choose."),
        ("Who receives the tuition?", "The university, directly, on its own account. You get the university's receipt. Orbuni never takes tuition."),
        FAQ[4], FAQ[8],
    ]
    ld = [crumbs("For parents", "/parents/"), faq_ld(pq)]
    body = hero("For parents", "For parents and sponsors", 'Your child, your money, <span class="grad">your questions</span>',
                "You are usually the one paying, so you deserve straight answers: where the money goes, who is responsible, and what happens at each step.") + f"""
<section class="s"><div class="wrap two">
<div class="box"><h3>Where the money goes</h3><ul><li>Applying through Orbuni: free</li><li>Tuition and deposit: paid straight to the university</li><li>Visa and permit fees: paid to the government</li><li>Housing: paid to the residence</li></ul></div>
<div class="box"><h3>What you will see</h3><ul><li>The university's published fee and current scholarship</li><li>The university's own offer letter</li><li>The deposit deadline, set by the university</li><li>Every step of the application in the portal</li></ul></div>
</div></section>
<section class="s alt"><div class="wrap faq"><p class="eyebrow">Questions parents ask</p><h2>Straight answers</h2>{faq_html(pq)}</div></section>
"""
    made.append(page("/parents/", "For parents: safety, money and support when your child studies abroad | Orbuni",
                     "For parents and sponsors: where the money goes (tuition straight to the university), who looks after the application, and how housing, visa and arrival are handled.",
                     ld, body))

    # ---------- FAQ
    ld = [crumbs("Questions", "/faq/"), faq_ld(FAQ)]
    body = hero("Questions", "Frequently asked questions", 'Straight answers <span class="grad">to common questions</span>',
                "The questions students and parents ask us most, answered the way our counsellors answer them.") + \
        f'<section class="s"><div class="wrap faq">{faq_html(FAQ)}</div></section>\n'
    made.append(page("/faq/", "Orbuni FAQ: applying free, scholarships, documents, visas and housing | Orbuni",
                     "Is applying through Orbuni free, who receives tuition, how Turkish scholarships work, which documents you need, IELTS, visa support and housing in Istanbul.",
                     ld, body))
    return made


def llms(made):
    """llms.txt: a short, factual map of the site for AI assistants (llmstxt.org format)."""
    faqs = "\n".join(f"- {q} {re.sub(r'<[^>]+>', '', a)}" for q, a in FAQ)
    free = "\n".join(f"- {a}: {b}" for a, b in FREE)
    txt = f"""# Orbuni

> Orbuni is a university search and application platform based in Istanbul, Türkiye. International students, mainly from Africa, the Middle East and Asia, use it to compare 2,600+ programmes at 48 partner universities in Türkiye, Northern Cyprus, the UAE, Germany, Egypt and Russia, apply free with a dedicated counsellor, and get support with scholarships, admission, visa preparation, student housing and arrival. Tuition is always paid directly to the university.

Key facts:
- Based in Istanbul, Türkiye. Applications are submitted through official university partner channels.
- 2,698 programmes, 48 partner universities, 6 countries.
- Searching, comparing and applying is free, with a dedicated counsellor and a private student portal.
- Website: https://myorbuni.com · WhatsApp: +1 443 448 1577 · Instagram: https://www.instagram.com/myorbuni · YouTube: https://www.youtube.com/@myorbuni

What every student gets, free:
{free}

## Main pages
- [Is it free?]({BASE}/pricing/): what is free and who receives each payment
- [How it works]({BASE}/how-it-works/): the nine steps from assessment to arrival
- [About Orbuni]({BASE}/about/): what Orbuni does and how to recognise it
- [For parents]({BASE}/parents/): money, safety and support
- [FAQ]({BASE}/faq/): common questions answered
- [Free 2-minute assessment]({BASE}/#start): the way to start

## Universities, subjects and costs
- [Universities with published fees]({BASE}/universities/)
- [Study by subject]({BASE}/study/): medicine, nursing, engineering, business and more, with fees per university
- [Scholarships]({BASE}/scholarships/): how tuition scholarships at Turkish private universities work
- [Student housing in Istanbul]({BASE}/housing/)

## Guides
- [What a year in Türkiye actually costs]({BASE}/articles/what-turkiye-actually-costs/)
- [How Turkish scholarships work]({BASE}/articles/how-turkish-scholarships-work/)
- [Do you need IELTS?]({BASE}/articles/do-you-need-ielts/)
- [Student visa refusals and how to avoid them]({BASE}/articles/nigerian-student-visa-refusals/)
- [How to check whether an education agency is real]({BASE}/articles/is-this-agency-real/)

## Questions and answers
{faqs}
"""
    open(os.path.join(SITE, "llms.txt"), "w", encoding="utf-8").write(txt)


ROBOTS = """# Orbuni welcomes search engines and AI assistants on public pages.
User-agent: *
Allow: /
Disallow: /unsubscribe.html

# AI search and assistant crawlers (named so the choice is explicit)
User-agent: GPTBot
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-SearchBot
Allow: /
User-agent: Claude-User
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Perplexity-User
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /
User-agent: Bingbot
Allow: /

Sitemap: https://myorbuni.com/sitemap.xml
"""


def sitemap(made):
    p = os.path.join(SITE, "sitemap.xml")
    sm = open(p, encoding="utf-8").read()
    extra = made + ["/articles/", "/housing/", "/universities/", "/scholarships/"]
    for path in extra:
        sm = re.sub(r"\s*<url><loc>" + re.escape(BASE + path) + r"</loc>.*?</url>", "", sm)
    pri = {"/pricing/": "0.8", "/how-it-works/": "0.9", "/about/": "0.8", "/faq/": "0.8", "/parents/": "0.7"}
    rows = [f"  <url><loc>{BASE}{x}</loc><lastmod>{TODAY}</lastmod><changefreq>monthly</changefreq><priority>{pri.get(x, '0.8')}</priority></url>" for x in extra]
    sm = sm.replace("</urlset>", "\n".join(rows) + "\n</urlset>")
    sm = re.sub(r"(<loc>https://myorbuni\.com/</loc><lastmod>)[^<]*", r"\g<1>" + TODAY, sm)
    open(p, "w", encoding="utf-8").write(sm)


NEW_LINKS = '<a href="/pricing/">Is it free?</a><a href="/how-it-works/">How it works</a><a href="/parents/">For parents</a><a href="/faq/">Questions</a><a href="/about/">About Orbuni</a>'


def footers():
    """Link the new pages from the footer of every static page, so they are found and crawled."""
    n = 0
    for dp, _, fs in os.walk(SITE):
        for f in fs:
            if f != "index.html" or dp == SITE:
                continue
            fp = os.path.join(dp, f)
            t = open(fp, encoding="utf-8").read()
            t = t.replace('<a href="/pricing/">Prices</a>', '<a href="/pricing/">Is it free?</a>').replace('<a href="/about/">About Orbuni</a>', '<a href="/about/">About Orbuni</a>')
            if 'href="/pricing/">' in t or "<h4>Orbuni</h4>" not in t:
                open(fp, "w", encoding="utf-8").write(t)
                continue
            t = t.replace('<h4>Orbuni</h4><a href="/">Home</a>', '<h4>Orbuni</h4><a href="/">Home</a>' + NEW_LINKS, 1)
            open(fp, "w", encoding="utf-8").write(t)
            n += 1
    return n


if __name__ == "__main__":
    made = build()
    llms(made)
    open(os.path.join(SITE, "robots.txt"), "w", encoding="utf-8").write(ROBOTS)
    sitemap(made)
    print("pages:", made, "· footers updated:", footers())
    import subprocess
    subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "add_whatsapp_button.py")], check=True)

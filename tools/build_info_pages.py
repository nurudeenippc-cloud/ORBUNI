#!/usr/bin/env python3
"""Builds the plain information pages that Google and AI assistants can read without
running any JavaScript: prices, how it works, about / how to verify us, parents, FAQ.

The main site is one page (site/index.html) whose sections open by "#hash"; search engines
and AI tools see that as a single URL. These pages give each question its own address,
with structured data (FAQPage, Service/Offer, BreadcrumbList) and llms.txt for AI tools.

Facts come from what the site, the Whop products and the Student Service Agreement
(24 Sept 2026) already say. Change a price or a rule there first, then here.

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
       '<p>Two minutes. It looks at your grades, budget, documents and timeline, and shows which universities and which package fit. '
       'Applying is free; you pay our fee only after a university sends you an offer letter.</p></div>'
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


PACKAGES = [
    ("Standard", 800, "$800", "one payment, after your offer letter",
     ["University and programme selection matched to your grades, budget and goals", "Application prepared and submitted",
      "Every document checked before anything is sent", "Every update until the offer letter, then the acceptance steps",
      "A named Orbuni counsellor"],
     "If Orbuni cannot complete the service, 10% ($80) is refunded, or you carry the service over to the next intake at no extra fee."),
    ("Plus", 1650, "$1,650", "one payment, after your offer letter",
     ["Everything in Standard", "Visa assistance: what to prepare and how to apply (Orbuni is not a visa agent)",
      "Airport pickup when you land in Türkiye", "Help in your first days"],
     "If Orbuni cannot complete the service, 20% ($330) is refunded, or you carry it over to the next intake."),
    ("Premier", 2650, "2 × $1,325", "two payments 30 days apart, starting after your offer letter",
     ["Everything in Plus", "A trusted visa agent in your own country", "Escort from the airport to your university for registration",
      "Our agent with you for up to 2 days after you arrive", "Residence permit (ikamet) support and local registrations"],
     "If Orbuni cannot complete the service, 30–40% ($795–$1,060) is refunded, or you carry it over to the next intake."),
]

FAQ = [
    ("Does it cost anything to apply through Orbuni?",
     "No. Applying is free. Orbuni's service fee is paid only after a university sends you an offer letter."),
    ("How much does Orbuni charge?",
     "One service fee, once: Standard $800, Plus $1,650, or Premier $2,650 paid as two payments of $1,325. Optional extras: airport pickup $150 and escort to your university $200. See <a href=\"/pricing/\">prices</a>."),
    ("Do I pay my tuition to Orbuni?",
     "No. Tuition and university deposits are paid directly to the university's own account, never to Orbuni. You get the university's receipt."),
    ("Is Orbuni a real agency? How can I check?",
     "Orbuni is run by Nurudeen Muhammad Abdulkareem and Godfrey Emmanuel Wudaba from Istanbul, and applies through AskUni's partner channel. You never pay before an offer letter, and payment happens only on myorbuni.com checkout pages. See <a href=\"/about/\">how to verify us</a>."),
    ("Does Orbuni guarantee admission, a scholarship or a visa?",
     "No. Universities decide admission and scholarships, and embassies decide visas. Orbuni tells you honestly what your grades are likely to get and shows you the university's own paperwork before you pay."),
    ("What is a \"scholarship\" at a Turkish private university?",
     "Usually a discount on tuition that the university gives international students. Its size depends on the university, the programme and sometimes your grades. It is different from the Turkish government scholarship (Türkiye Bursları). See <a href=\"/articles/how-turkish-scholarships-work/\">how Turkish scholarships work</a>."),
    ("Which documents do I need to apply?",
     "Usually your passport, your secondary school certificate (for example WAEC, NECO, KCSE or your country's equivalent), your transcript and a photograph. Some programmes ask for an English test. You upload them to your Orbuni portal, never over WhatsApp."),
    ("Do I need IELTS to study in Türkiye?",
     "Not always. Many universities accept their own English test or proof of English-medium schooling. See <a href=\"/articles/do-you-need-ielts/\">do you need IELTS?</a>."),
    ("What happens if my visa is refused?",
     "You can carry your Orbuni service over to the next intake at no extra fee, or take the partial refund written in the Student Service Agreement for your package."),
    ("Can Orbuni help with housing in Istanbul?",
     "Yes. Orbuni shows real student residences with photos and prices, and you choose before you fly. The contract is with the residence. See <a href=\"/housing/\">student housing</a>."),
    ("Which countries does Orbuni place students in?",
     "Mainly Türkiye, plus Northern Cyprus, the UAE, Germany, Egypt and Russia."),
    ("Who does Orbuni work with?",
     "Students and parents mostly from Africa, the Middle East and Asia, and partner education agencies who refer students."),
    ("How fast will someone answer me?",
     "The WhatsApp assistant answers at any hour. A person from the team replies in working hours (Istanbul time) and steps in whenever the question needs a human."),
    ("How do I start?",
     "Take the free 2-minute assessment at myorbuni.com/#start. It shows which universities and which package fit your grades, budget, documents and timeline."),
]


def build():
    made = []

    # ---------- prices
    offers = [{"@type": "Offer", "name": f"Orbuni {n}", "price": str(p), "priceCurrency": "USD",
               "description": f"{when}. " + "; ".join(inc)} for n, p, _, when, inc, _ in PACKAGES]
    ld = [crumbs("Prices", "/pricing/"),
          {"@context": "https://schema.org", "@type": "Service", "name": "University admission service for international students",
           "serviceType": "Study abroad admission and arrival support", "provider": ORG, "areaServed": "Worldwide",
           "offers": offers},
          faq_ld(FAQ[:4])]
    cards = []
    for i, (n, p, price, when, inc, refund) in enumerate(PACKAGES):
        cards.append(f'<li class="{"hl" if i == 1 else ""}"><h3>{n}</h3><div class="pr">{price} <small>{esc(when)}</small></div>'
                     f'<ul>{"".join(f"<li>{esc(x)}</li>" for x in inc)}</ul><p class="rf">{esc(refund)}</p></li>')
    body = hero("Prices", "Prices · paid only after your offer letter",
                'What Orbuni costs, <span class="grad">and when you pay</span>',
                "Applying is free. You pay one service fee, once, and only after a university sends you an offer letter. "
                "Tuition is always paid straight to the university, never to us.") + f"""
<section class="s"><div class="wrap"><p class="eyebrow">Three packages</p><h2>Choose how much help you want after the offer</h2>
<ul class="pk">{"".join(cards)}</ul>
<p class="note" style="margin-top:14px">Add when you need it: airport pickup in Türkiye <b>$150</b>, escort from the airport to your university <b>$200</b>, booked in your portal (full refund if cancelled 48 hours before). The full terms are in the <a href="/docs/Orbuni-Student-Service-Agreement.pdf">Student Service Agreement</a> (24 September 2026).</p></div></section>
<section class="s alt"><div class="wrap"><p class="eyebrow">The money map</p><h2>Who you pay, for what, and when</h2>
<table class="money"><thead><tr><th>What</th><th>Paid to</th><th>When</th></tr></thead><tbody>
<tr><td>Applying through Orbuni</td><td>Nobody. It is free</td><td>—</td></tr>
<tr><td>Orbuni service fee ($800 / $1,650 / 2 × $1,325)</td><td>Orbuni, on a myorbuni.com checkout page</td><td>After your offer letter</td></tr>
<tr><td>Tuition and the university's deposit</td><td>The university's own account, never Orbuni</td><td>By the university's deadline</td></tr>
<tr><td>Visa and residence-permit fees</td><td>The government</td><td>When you apply</td></tr>
<tr><td>Housing</td><td>The residence (contract with them)</td><td>Before you fly, as the residence asks</td></tr>
</tbody></table></div></section>
<section class="s"><div class="wrap faq"><p class="eyebrow">Questions</p><h2>About paying</h2>{faq_html(FAQ[:4] + [FAQ[8]])}</div></section>
"""
    made.append(page("/pricing/", "Orbuni prices: $800, $1,650 or $2,650, paid only after your offer letter | Orbuni",
                     "What Orbuni costs: applying is free; one service fee after your university offer letter (Standard $800, Plus $1,650, Premier 2 × $1,325). Tuition is paid to the university, never to Orbuni.",
                     ld, body))

    # ---------- how it works
    steps = [
        ("Take the free 2-minute assessment", "Your grades, budget, documents and timeline. It shows which universities and which package fit, not a list of twenty."),
        ("Talk to a person", "On WhatsApp or a call. Ready students get a small group with their counsellor and a founder."),
        ("Choose three routes", "One ambitious, one solid, one safe: university, programme and intake, with the published fee and current discount."),
        ("Upload your documents to the portal", "Passport, certificate, transcript, photo. We check every document before anything is sent."),
        ("We apply through the official partner channel", "You follow every step in your portal until the offer letter arrives."),
        ("Offer letter: choose your package", "Standard, Plus or Premier. This is the first time you pay Orbuni anything."),
        ("Pay the university's deposit to the university", "Straight to its own account, by its own deadline, which we show you on the offer page."),
        ("Visa, housing and flight", "Visa preparation, a real room chosen before you fly, and (with Plus or Premier) pickup when you land."),
        ("Arrival and registration", "Help in your first days; with Premier, escort to registration and residence-permit support."),
    ]
    ld = [crumbs("How it works", "/how-it-works/"),
          {"@context": "https://schema.org", "@type": "HowTo", "name": "How to apply to a university in Türkiye with Orbuni",
           "step": [{"@type": "HowToStep", "position": i + 1, "name": a, "text": b} for i, (a, b) in enumerate(steps)]}]
    body = hero("How it works", "From first message to first lecture", 'How Orbuni works, <span class="grad">step by step</span>',
                "You don't need to learn the whole system. You follow a file that we run every week, and you can see every step in your portal.") + f"""
<section class="s"><div class="wrap"><ol class="steps">{"".join(f"<li><b>{esc(a)}</b><span>{esc(b)}</span></li>" for a, b in steps)}</ol></div></section>
<section class="s alt"><div class="wrap two">
<div class="box ok"><h3>What we will do</h3><ul><li>Tell you the real fee, from the university's own published figures</li><li>Tell you honestly when your grades will not win the discount you want</li><li>Show you the university's own paperwork before you pay anything</li><li>Answer you, including when the answer is bad news</li></ul></div>
<div class="box no"><h3>What we will never promise</h3><ul><li>Admission or a scholarship amount: the university decides</li><li>A visa: the embassy decides</li><li>A job or a ranking</li><li>Anything we cannot show you in writing</li></ul></div>
</div></section>
"""
    made.append(page("/how-it-works/", "How Orbuni works: apply to university in Türkiye step by step | Orbuni",
                     "From the free 2-minute assessment to your first lecture in Türkiye: documents, application, offer letter, deposit, visa, housing and arrival, and what Orbuni will and will not promise.",
                     ld, body))

    # ---------- about / verify
    ld = [crumbs("About and how to verify us", "/about/"),
          {"@context": "https://schema.org", "@type": "AboutPage", "url": BASE + "/about/", "about": ORG,
           "mainEntity": {"@type": "EducationalOrganization", "@id": BASE + "/#org", "name": "Orbuni",
                          "founder": [{"@type": "Person", "name": "Nurudeen Muhammad Abdulkareem", "jobTitle": "Founder & Managing Director"},
                                      {"@type": "Person", "name": "Godfrey Emmanuel Wudaba", "jobTitle": "Chief Operations Officer"}],
                          "employee": [{"@type": "Person", "name": "Lenns Wordjy Coutilien", "jobTitle": "Creative Director"}],
                          "address": {"@type": "PostalAddress", "addressLocality": "Istanbul", "addressCountry": "TR"}}},
          faq_ld([FAQ[3], FAQ[2], FAQ[4]])]
    body = hero("About", "About Orbuni · and how to check us", 'Who we are, <span class="grad">and how to verify it</span>',
                "Families in our market have been robbed by fake agents often enough that suspicion is the right starting point. Here is exactly who we are, and how you can check every line.") + f"""
<section class="s"><div class="wrap two">
<div class="box"><h3>Who we are</h3><p style="color:var(--dim)">Orbuni is run by two founders, <b>Nurudeen Muhammad Abdulkareem</b> (Founder &amp; Managing Director) and <b>Godfrey Emmanuel Wudaba</b> (COO), working from Istanbul, with <b>Lenns Wordjy Coutilien</b> as Creative Director. Applications go through <b>AskUni</b>'s partner channel, the university application platform that holds our access to partner universities. We are small on purpose, and we tell you that on purpose.</p>
<p style="color:var(--dim)">We started Orbuni because we watched friends and family pay agents up front for admissions that never came. So we built the opposite: published fees, a published process, and a named person on your file.</p></div>
<div class="box ok"><h3>Seven ways to check us</h3><ul>
<li>You never pay Orbuni before a university's offer letter</li>
<li>Payment happens only on <b>myorbuni.com</b> checkout pages (Whop or Paystack), never to a personal account</li>
<li>Tuition goes to the university's own account; you get its receipt</li>
<li>We never ask for card details, passwords or codes in a chat</li>
<li>Documents go in your portal, never over WhatsApp</li>
<li>Our only WhatsApp number is <b>+1 443 448 1577</b> (“MY ORBUNI”)</li>
<li>You can come and meet us in Istanbul</li></ul></div>
</div></section>
<section class="s alt"><div class="wrap faq"><p class="eyebrow">Questions</p><h2>Trust, money and promises</h2>{faq_html([FAQ[3], FAQ[2], FAQ[4], FAQ[12]])}
<p class="note" style="margin-top:14px">More: <a href="/articles/is-this-agency-real/">how to check whether any education agency is real</a> · <a href="/pricing/">prices</a> · <a href="/how-it-works/">how it works</a></p></div></section>
"""
    made.append(page("/about/", "About Orbuni: who we are and how to verify us | Orbuni",
                     "Orbuni is run by Nurudeen Muhammad Abdulkareem and Godfrey Emmanuel Wudaba from Istanbul. Seven ways to check us: no payment before an offer letter, tuition paid to the university, payment only on myorbuni.com.",
                     ld, body))

    # ---------- parents
    pq = [
        ("Is my child safe in Istanbul?", "Istanbul is a large city with a big international student population. We show real residences with photos, help choose one before the flight, and with Plus or Premier someone meets your child at the airport."),
        ("Who is accountable if something goes wrong?", "A named counsellor on the file, a written Student Service Agreement with refund rules, and a portal where you can see every step."),
        ("Can I pay the service fee for my child?", "Yes. Parents often pay. The fee is paid only after the offer letter, on a myorbuni.com checkout page, and tuition goes straight to the university."),
        FAQ[2], FAQ[4],
    ]
    ld = [crumbs("For parents", "/parents/"), faq_ld(pq)]
    body = hero("For parents", "For parents and sponsors", 'Your child, your money, <span class="grad">your questions</span>',
                "You are usually the one paying, so you deserve straight answers: what it costs, where the money goes, who is responsible, and what we will not promise.") + f"""
<section class="s"><div class="wrap two">
<div class="box"><h3>What it costs, in one minute</h3><ul><li>Applying: free</li><li>Orbuni's fee: $800, $1,650 or 2 × $1,325, only after the offer letter</li><li>Tuition and deposit: paid straight to the university</li><li>Visa and permit fees: paid to the government</li></ul><p style="margin-top:10px"><a href="/pricing/">See the full price page →</a></p></div>
<div class="box"><h3>What you will see</h3><ul><li>The university's published fee and current discount</li><li>The university's own offer letter before you pay us</li><li>The deposit deadline, set by the university</li><li>Every step of the application in the portal</li></ul></div>
</div></section>
<section class="s alt"><div class="wrap faq"><p class="eyebrow">Questions parents ask</p><h2>Answered without selling a dream</h2>{faq_html(pq)}</div></section>
"""
    made.append(page("/parents/", "For parents: costs, safety and accountability when your child studies in Türkiye | Orbuni",
                     "For parents and sponsors: what studying in Türkiye with Orbuni costs, where the money goes (tuition to the university, never to Orbuni), who is accountable, and what we will not promise.",
                     ld, body))

    # ---------- FAQ
    ld = [crumbs("Questions", "/faq/"), faq_ld(FAQ)]
    body = hero("Questions", "Frequently asked questions", 'Straight answers <span class="grad">to common questions</span>',
                "The questions students and parents actually ask us, answered the way we answer them on WhatsApp.") + \
        f'<section class="s"><div class="wrap faq">{faq_html(FAQ)}</div></section>\n'
    made.append(page("/faq/", "Orbuni FAQ: fees, scholarships, documents, visas and housing in Türkiye | Orbuni",
                     "Straight answers: is applying free, what Orbuni charges, who receives tuition, what a Turkish scholarship is, which documents you need, IELTS, visa refusal, housing in Istanbul.",
                     ld, body))
    return made


def llms(made):
    """llms.txt: a short, factual map of the site for AI assistants (llmstxt.org format)."""
    pk = "\n".join(f"- {n}: {price}, {when}. Refund if Orbuni cannot complete: {refund.split(', or')[0].replace('If Orbuni cannot complete the service, ', '')}"
                   for n, _, price, when, _, refund in PACKAGES)
    faqs = "\n".join(f"- {q} {re.sub(r'<[^>]+>', '', a)}" for q, a in FAQ)
    txt = f"""# Orbuni

> Orbuni is a small education consultancy in Istanbul that helps international students, mostly from Africa, the Middle East and Asia, apply to universities in Türkiye (and Northern Cyprus, the UAE, Germany, Egypt and Russia). Applying is free; the service fee is paid only after a university sends an offer letter; tuition is always paid directly to the university, never to Orbuni.

Key facts:
- Run by Nurudeen Muhammad Abdulkareem (Founder & Managing Director) and Godfrey Emmanuel Wudaba (COO), Istanbul, Türkiye.
- Applies through AskUni's university partner channel.
- Website: https://myorbuni.com · WhatsApp: +1 443 448 1577 ("MY ORBUNI") · Instagram: https://www.instagram.com/myorbuni
- Orbuni does not guarantee admission, scholarships or visas: universities and embassies decide.

Prices (USD, one fee, once):
{pk}
- Extras: airport pickup $150; escort from airport to university $200.

## Main pages
- [Prices and the money map]({BASE}/pricing/): what Orbuni charges, when, and who receives each payment
- [How it works]({BASE}/how-it-works/): the nine steps from assessment to arrival
- [About and how to verify Orbuni]({BASE}/about/): who runs it and seven ways to check
- [For parents]({BASE}/parents/): costs, safety, accountability
- [FAQ]({BASE}/faq/): common questions answered
- [Free 2-minute assessment]({BASE}/#start): the way to start

## Universities, subjects and costs
- [Universities in Türkiye with published fees]({BASE}/universities/)
- [Study by subject]({BASE}/study/): medicine, nursing, engineering, business and more, with fees per university
- [Scholarships]({BASE}/scholarships/): how tuition discounts at Turkish private universities work
- [Student housing in Istanbul]({BASE}/housing/)

## Guides
- [What a year in Türkiye actually costs]({BASE}/articles/what-turkiye-actually-costs/)
- [How Turkish scholarships work]({BASE}/articles/how-turkish-scholarships-work/)
- [Do you need IELTS?]({BASE}/articles/do-you-need-ielts/)
- [Nigerian student visa refusals]({BASE}/articles/nigerian-student-visa-refusals/)
- [How to check whether an education agency is real]({BASE}/articles/is-this-agency-real/)

## Optional
- [Student Service Agreement (PDF)]({BASE}/docs/Orbuni-Student-Service-Agreement.pdf)

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
    pri = {"/pricing/": "0.9", "/how-it-works/": "0.9", "/about/": "0.8", "/faq/": "0.8", "/parents/": "0.7"}
    rows = [f"  <url><loc>{BASE}{x}</loc><lastmod>{TODAY}</lastmod><changefreq>monthly</changefreq><priority>{pri.get(x, '0.8')}</priority></url>" for x in extra]
    sm = sm.replace("</urlset>", "\n".join(rows) + "\n</urlset>")
    sm = re.sub(r"(<loc>https://myorbuni\.com/</loc><lastmod>)[^<]*", r"\g<1>" + TODAY, sm)
    open(p, "w", encoding="utf-8").write(sm)


NEW_LINKS = '<a href="/pricing/">Prices</a><a href="/how-it-works/">How it works</a><a href="/parents/">For parents</a><a href="/faq/">Questions</a><a href="/about/">About &amp; verify us</a>'


def footers():
    """Link the new pages from the footer of every static page, so they are found and crawled."""
    n = 0
    for dp, _, fs in os.walk(SITE):
        for f in fs:
            if f != "index.html" or dp == SITE:
                continue
            fp = os.path.join(dp, f)
            t = open(fp, encoding="utf-8").read()
            if 'href="/pricing/">Prices</a>' in t or "<h4>Orbuni</h4>" not in t:
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

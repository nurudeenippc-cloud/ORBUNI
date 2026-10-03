#!/usr/bin/env python3
"""Adds the floating "Chat on WhatsApp" button to every public page in site/.

The button opens a WhatsApp chat with Orbuni's number (+1 443 448 1577), where the
AI assistant answers straight away and hands over to the team when needed. The
message is pre-filled with the page the student was on ("…about Sabanci University").
On the home page it hides itself while the student/staff portal is actually open
(it watches #portal.on, not the address bar: leaving the portal keeps a #portal= hash).

Safe to run again: the block sits between <!--orb-wa--> markers and is replaced.
Run:  python3 tools/add_whatsapp_button.py   (after any page builder)
"""
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site")
SKIP = {"unsubscribe.html"}
NUMBER = "14434481577"

BLOCK = """<!--orb-wa--><style>
.orb-wa{position:fixed;right:18px;bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:150;display:inline-flex;align-items:center;gap:9px;
padding:12px 18px 12px 13px;border-radius:100px;background:#25D366;color:#fff!important;text-decoration:none!important;
font:700 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 28px rgba(0,0,0,.28);transition:transform .15s}
.orb-wa:hover{transform:translateY(-2px)}.orb-wa svg{width:24px;height:24px;flex:0 0 auto;fill:#fff}
@media(max-width:600px){.orb-wa{padding:13px;right:14px;bottom:calc(14px + env(safe-area-inset-bottom,0px))}.orb-wa span{display:none}}
body:has(#portal.on) .orb-wa,.orb-wa.off{display:none!important}
@media print{.orb-wa{display:none}}
</style>
<a class="orb-wa" id="orb-wa" href="https://wa.me/NUMBER?text=Hi%20Orbuni%2C%20I%27d%20like%20to%20study%20abroad." target="_blank" rel="noopener" aria-label="Chat with Orbuni on WhatsApp">
<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C8.8 3 3 8.7 3 15.8c0 2.5.7 4.9 2 7L3 29l6.4-2c2 1.1 4.3 1.7 6.6 1.7 7.2 0 13-5.7 13-12.8S23.2 3 16 3zm0 23.4c-2.1 0-4.1-.6-5.9-1.7l-.4-.3-3.8 1.2 1.2-3.7-.3-.4c-1.2-1.8-1.9-3.9-1.9-6.1C4.9 9.8 9.9 4.9 16 4.9s11.1 4.9 11.1 10.9S22.1 26.4 16 26.4zm6.1-8.1c-.3-.2-2-1-2.3-1.1-.3-.1-.5-.2-.8.2-.2.3-.9 1.1-1.1 1.3-.2.2-.4.3-.7.1-.3-.2-1.4-.5-2.7-1.7-1-.9-1.7-2-1.9-2.3-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6l-1.1-2.6c-.3-.7-.6-.6-.8-.6h-.7c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.3 1.4 3.5c.2.2 2.4 3.6 5.8 5.1.8.3 1.4.5 1.9.7.8.3 1.6.2 2.2.1.7-.1 2-.8 2.3-1.6.3-.8.3-1.5.2-1.6-.1-.2-.3-.3-.7-.4z"/></svg><span>Chat on WhatsApp</span></a>
<script>(function(){var a=document.getElementById("orb-wa");if(!a)return;
var h=document.querySelector("h1"),t=h?h.textContent.replace(/\\s+/g," ").trim().slice(0,90):"";
var p=location.pathname,m="Hi Orbuni, I'd like to study abroad.";
if(t&&p!=="/"&&p!=="/index.html")m="Hi Orbuni, I'm on your page about \\u201c"+t+"\\u201d and I have a question.";
a.href="https://wa.me/NUMBER?text="+encodeURIComponent(m);
var P=document.getElementById("portal");function s(){a.classList.toggle("off",!!(P&&P.classList.contains("on")))}
s();if(P&&window.MutationObserver)new MutationObserver(s).observe(P,{attributes:true,attributeFilter:["class"]});})();</script>
<!--/orb-wa-->""".replace("NUMBER", NUMBER)

PAT = re.compile(r"<!--orb-wa-->.*?<!--/orb-wa-->\n?", re.S)

def main():
    n = 0
    for dp, _, files in os.walk(SITE):
        if "/video" in dp or "/vendor" in dp:
            continue
        for f in files:
            if not f.endswith(".html") or f in SKIP or f.startswith("google") or f.startswith("_"):
                continue
            path = os.path.join(dp, f)
            s = open(path, encoding="utf-8").read()
            s = PAT.sub("", s)
            i = s.rfind("</body>")
            if i < 0:
                continue
            s = s[:i] + BLOCK + "\n" + s[i:]
            open(path, "w", encoding="utf-8").write(s)
            n += 1
    print(f"WhatsApp button on {n} pages")

if __name__ == "__main__":
    main()

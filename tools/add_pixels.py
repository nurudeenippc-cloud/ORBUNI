"""Add the ad-measurement pixels (Whop + Meta) to every prerendered page under site/.

Same rule as the main app (index.html): visitors in the EU, EEA, UK or Switzerland (told apart by
browser time zone) are measured only after they press Accept on the main site; everyone else is
measured from the first page unless they switched it off in Cookie settings. Global Privacy
Control always means no.

Run after build_study_pages.py / build_info_pages.py / add_whatsapp_button.py.
Safe to run again: an existing <script id="orb-px"> block is replaced.
"""
import glob, os, re

SITE = os.path.join(os.path.dirname(__file__), "..", "site")
SNIPPET = '<script id="orb-px">/* Ad measurement (Whop + Meta pixels). EU/EEA/UK/CH visitors: only after they press Accept on the main site. Elsewhere: on, unless switched off in Cookie settings. */\n(function(){try{\nif(navigator.globalPrivacyControl===true)return;\nvar c=null;try{c=JSON.parse(localStorage.getItem("orb-consent-v1")||"null")}catch(e){}\nif(c){if(c.marketing!==true)return}else{var tz="";try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||""}catch(e){}\nif(!tz||/^(Europe\\/(?!Istanbul|Moscow|Kaliningrad|Samara|Volgograd|Saratov|Ulyanovsk|Astrakhan|Kirov|Minsk|Kiev|Kyiv|Simferopol|Chisinau|Belgrade|Sarajevo|Skopje|Podgorica|Tirane|Uzhgorod|Zaporozhye)|Atlantic\\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Africa\\/Ceuta|Arctic\\/Longyearbyen)/.test(tz))return}\n!function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");\nwindow.whop.setScope("biz_340OHdZOPCa81N");window.whop.track("page");\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");\nfbq("init","1662842908878793");fbq("track","PageView");\n}catch(e){}})();</script>\n'

n = 0
for f in glob.glob(os.path.join(SITE, "**", "index.html"), recursive=True):
    rel = os.path.relpath(f, SITE)
    if rel == "index.html" or rel.startswith("_"):
        continue
    s = open(f, encoding="utf-8").read()
    s = re.sub(r'<script id="orb-px">.*?</script>\n?', "", s, flags=re.S)
    if "</body>" not in s:
        continue
    k = s.rfind("</body>")
    open(f, "w", encoding="utf-8").write(s[:k] + SNIPPET + s[k:])
    n += 1
print("pixels on", n, "pages")

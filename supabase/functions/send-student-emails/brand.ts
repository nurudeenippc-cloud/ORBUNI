// The Orbuni email frame (23 Oct 2026 redesign). One design for every email we send:
// students (mail.ts, extra.ts), partners and the team (send-alerts), receipts
// (payment-receipts) and the staff composer (send-manual-email).
// This file is the original; the other functions carry an identical copy, kept in step by brand_copies_test.ts.
//
// Still light (Gmail on Android and Outlook wreck dark emails), but branded: a navy
// header with the gold mark, a full-width poster for the key emails, a pill label,
// a bigger headline, a gold call-to-action and a footer that gives three ways back
// to us. Images are ours, served by jsDelivr from the public repo, pinned to one commit,
// and every one has alt text so the email still reads with images off.
const INK = "#111826", LINE = "#E4E8EF", WASH = "#EEF1F6";
const GOLD = "#B8791A", GOLDBG = "#FFF3DC", NAVY = "#0E1626", BRIGHT = "#F2B544";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SITE = "https://myorbuni.com";
const WA = "https://wa.me/14434481577";
const IMG = "https://cdn.jsdelivr.net/gh/nurudeenippc-cloud/ORBUNI@e6abf68513c110b079613a06b5a679d575d9c463/site/img/email/";

// which poster goes on top of which email; the rest go without one
const HERO: Record<string, [string, string]> = {
  welcome:             ["welcome", "Welcome to Orbuni"],
  documents_needed:    ["documents_needed", "A few documents are still missing from your file"],
  offer_received:      ["offer_ready", "Your university offer is ready"],
  call_booked:         ["call_booked", "Your call with Orbuni is booked"],
  payment_receipt:     ["payment_received", "Payment received"],
  webinar_registered:  ["webinar_seat", "Your webinar seat is saved"],
  webinar_reminder:    ["webinar_reminder", "The webinar starts soon"],
  webinar_live:        ["webinar_live", "We are live now"],
  webinar_replay:      ["webinar_replay", "The webinar replay is ready"],
  webinar_next:        ["webinar_next", "Your next step after the webinar"],
  webinar_vip_welcome: ["webinar_vip", "Welcome to VIP"],
  status_change:       ["offer_ready", "There is news on your application"],
  partner_update:      ["partner_update", "There is news on a student you sent us"],
  team_alert:          ["team_alert", "Something needs the team's attention"],
};

export const hero = (template: string) => {
  const h = HERO[template];
  if(!h) return "";
  return `<tr><td style="padding:0;line-height:0;font-size:0"><img src="${IMG}${h[0]}.jpg" width="600" height="300" alt="${h[1]}" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>`;
};

// A gold pill instead of loose small caps: reads as a label at a glance.
// fg/bg let the team alerts colour the label by kind (green payment, red urgent).
export const kick = (t: string, fg = GOLD, bg = GOLDBG) => `<tr><td class="pad" style="padding:28px 32px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td bgcolor="${bg}" style="background:${bg};border-radius:20px;padding:7px 13px;font:700 11px/1 ${SANS};letter-spacing:.12em;text-transform:uppercase;color:${fg}">${t}</td>
</tr></table></td></tr>`;
export const h1 = (t: string) => `<tr><td class="pad" style="padding:14px 32px 0"><h1 style="margin:0;font:800 28px/1.22 ${SANS};color:${INK};letter-spacing:-.025em">${t}</h1></td></tr>`;
// Gold on navy text: the one bright thing in the email, so the eye lands on it.
export const button = (label: string, href: string) => `<tr><td class="pad" style="padding:28px 32px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" class="full"><tr>
<td align="center" bgcolor="${BRIGHT}" style="background:${BRIGHT};border-radius:12px">
<a href="${href}" style="display:block;padding:16px 34px;font:800 16px/1 ${SANS};color:${NAVY};text-decoration:none;border-radius:12px">${label} &rarr;</a>
</td></tr></table></td></tr>`;

// A grey panel for plain text that came from the database (already escaped by the caller).
export const panel = (html: string) => `<tr><td class="pad" style="padding:18px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F5F7FA" style="background:#F5F7FA;border-radius:12px">
<tr><td style="padding:16px 18px;font:400 15px/1.65 ${SANS};color:#3B475A">${html}</td></tr></table></td></tr>`;

export type Audience = "student" | "partner" | "team";
const FOOT: Record<Audience, { title: string; text: string; links: [string, string][] }> = {
  student: { title: "Questions? A real counsellor answers.", text: "Reply to this email, or message us on WhatsApp. We usually answer the same day.",
             links: [["WhatsApp us", WA], ["My portal", SITE + "/#portal=student"], ["Programmes", SITE]] },
  partner: { title: "Questions about a student? We are one message away.", text: "Reply to this email, or message the Orbuni team on WhatsApp.",
             links: [["WhatsApp us", WA], ["Partner portal", SITE + "/#portal=partner:home"], ["myorbuni.com", SITE]] },
  team:    { title: "You are on the Orbuni team.", text: "Change what you get told about under Team &amp; alerts in the portal.",
             links: [["Team portal", SITE + "/#portal=admin"], ["WhatsApp inbox", SITE + "/#chat"]] },
};

const footLink = (label: string, href: string) => `<a href="${href}" style="color:${BRIGHT};text-decoration:none;font-weight:700">${label}</a>`;

export function shell(preheader: string, blocks: string, audience: Audience = "student"){
  const f = FOOT[audience];
  return `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>Orbuni</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
  img{border:0;line-height:100%;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
  a{color:${GOLD}}
  @media only screen and (max-width:600px){
    .wrap{width:100%!important}
    .pad{padding-left:20px!important;padding-right:20px!important}
    .stack{display:block!important;width:100%!important;text-align:left!important;padding-bottom:0!important}
    .stack.rt{padding-top:2px!important;padding-bottom:13px!important;text-align:left!important}
    .full{width:100%!important}
    h1{font-size:24px!important;line-height:1.22!important}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${WASH};">
<div style="display:none;font-size:1px;color:${WASH};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WASH}" style="background:${WASH}">
<tr><td align="center" style="padding:24px 10px 34px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">

<tr><td bgcolor="${NAVY}" style="background:${NAVY};border-radius:16px 16px 0 0;padding:18px 28px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td><a href="${SITE}" style="text-decoration:none"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="34" style="padding-right:10px"><img src="${IMG}logo.png" width="32" height="32" alt="" style="display:block;width:32px;height:32px;border:0"></td>
    <td style="font:800 19px/1 ${SANS};color:#FFFFFF;letter-spacing:-.01em">Orbuni</td>
  </tr></table></a></td>
  <td align="right" style="font:600 12px/1 ${SANS};color:#9FB0C8">${audience === "team" ? "Team" : audience === "partner" ? "Partners" : "Study abroad, done right"}</td>
  </tr></table>
</td></tr>

<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-left:1px solid ${LINE};border-right:1px solid ${LINE}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
  <!--HERO-->
  ${blocks}
  <tr><td style="height:36px;line-height:36px;font-size:0">&nbsp;</td></tr>
  </table>
</td></tr>

<tr><td bgcolor="${NAVY}" class="pad" style="background:${NAVY};border-radius:0 0 16px 16px;padding:24px 32px">
  <p style="margin:0 0 6px;font:800 15px/1.4 ${SANS};color:#FFFFFF">${f.title}</p>
  <p style="margin:0 0 16px;font:400 13px/1.6 ${SANS};color:#9FB0C8">${f.text}</p>
  <p style="margin:0 0 18px;font:400 13px/1.8 ${SANS};color:#5D6E86">
    ${f.links.map(([l, h]) => footLink(l, h)).join("&nbsp;&nbsp;&middot;&nbsp;&nbsp;")}
  </p>
  <div style="height:1px;background:#22304A;line-height:1px;font-size:0">&nbsp;</div>
  <p style="margin:14px 0 0;font:400 11.5px/1.6 ${SANS};color:#7183A0">
    Orbuni Education &middot; Istanbul, T&uuml;rkiye. Universities in T&uuml;rkiye, N.&nbsp;Cyprus, the UAE, Germany, Egypt and Russia. Published fees, a named counsellor, no invented numbers. Tuition is always paid to the university, never to a person.
  </p>
</td></tr>

</table></td></tr></table></body></html>`;
}

// render() knows the template name, the bodies do not: it drops the poster in here.
export const withHero = (template: string, html: string) => html.replace("<!--HERO-->", hero(template));

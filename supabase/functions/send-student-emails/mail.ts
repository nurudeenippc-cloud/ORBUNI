// One shell, every Orbuni email.
//
// Rebuilt light. A dark email is a trap: Gmail on Android re-colours dark HTML and
// leaves half of it unreadable, Outlook ignores the background entirely and puts white
// text on white. Light background, dark text, one gold accent - that renders the same
// everywhere. 100% width tables with a max-width, so a phone gets the full message and
// not a squeezed column.
const INK = "#111826", BODY = "#48566B", MUTE = "#7A8798";
const LINE = "#E4E8EF", WASH = "#F5F7FA";
const GOLD = "#B8791A", GOLDBG = "#FFF6E6", GREEN = "#127A52", GREENBG = "#EAF7F1";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SITE = "https://myorbuni.com";
import { shell, kick, h1, button, withHero } from "./brand.ts";

export const esc = (s: unknown) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const para = (t: string) => `<tr><td class="pad" style="padding:14px 32px 0"><p style="margin:0;font:400 16px/1.65 ${SANS};color:${BODY}">${t}</p></td></tr>`;
const small = (t: string) => `<tr><td class="pad" style="padding:16px 32px 0"><p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTE}">${t}</p></td></tr>`;
const rule = () => `<tr><td class="pad" style="padding:26px 32px 0"><div style="height:1px;background:${LINE};line-height:1px;font-size:0">&nbsp;</div></td></tr>`;


const note = (title: string, text: string, tone: "gold" | "green" = "gold") => {
  const bg = tone === "green" ? GREENBG : GOLDBG;
  const bd = tone === "green" ? GREEN : GOLD;
  return `<tr><td class="pad" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background:${bg};border-radius:12px">
<tr><td style="padding:16px 18px;border-left:4px solid ${bd};border-radius:12px">
<div style="font:700 13.5px/1.4 ${SANS};color:${bd};margin-bottom:5px">${title}</div>
<div style="font:400 14px/1.6 ${SANS};color:${BODY}">${text}</div>
</td></tr></table></td></tr>`;
};

// Stacks to two lines per row on a narrow screen instead of squeezing.
const rows = (pairs: [string, string][]) => `<tr><td class="pad" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WASH}" style="background:${WASH};border-radius:12px">
<tr><td style="padding:6px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
  pairs.map(([k, v], i) => {
    const top = i ? `border-top:1px solid ${LINE};` : "";
    return `<tr><td class="stack" style="${top}padding:13px 0;font:400 14px/1.45 ${SANS};color:${MUTE};width:46%;vertical-align:top">${k}</td>` +
           `<td class="stack rt" style="${top}padding:13px 0;font:600 15px/1.45 ${SANS};color:${INK};text-align:right;vertical-align:top">${v}</td></tr>`;
  }).join("") + `</table></td></tr></table></td></tr>`;

// A numbered list that reads as a sequence, because it is one.
const steps = (items: [string, string][]) => `<tr><td class="pad" style="padding:22px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
  items.map(([what, who], i) => `<tr>
<td width="30" valign="top" style="padding:7px 0">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td width="24" height="24" align="center" bgcolor="${who === "you" ? GOLDBG : WASH}" style="border-radius:12px;font:700 12px/24px ${SANS};color:${who === "you" ? GOLD : MUTE}">${i + 1}</td>
  </tr></table></td>
<td style="padding:7px 0 7px 10px;font:400 15px/1.5 ${SANS};color:${BODY}">${what}
  <span style="font:600 12px/1 ${SANS};color:${who === "you" ? GOLD : MUTE}">&nbsp;&nbsp;${who === "you" ? "YOU" : who === "us" ? "ORBUNI" : "TOGETHER"}</span>
</td></tr>`).join("") + `</table></td></tr>`;


type V = Record<string, unknown>;
const g = (v: V, k: string, d = "") => esc(v[k] ?? d);
const b = (t: string) => `<strong style="color:${INK};font-weight:600">${t}</strong>`;

export const SUBJECTS: Record<string, (v: V) => string> = {
  // Subject lines are a plain mail header, not HTML — used raw here (not
  // through g(), which HTML-escapes) so a staff-typed "&" or apostrophe
  // shows correctly in the recipient's inbox instead of as "&amp;".
  custom_notice:        v => String((v as V).subject ?? "A note from Orbuni"),
  welcome:              v => `Welcome to Orbuni, ${g(v,"first_name","there")}`,
  application_submitted:v => `We have your application, ${g(v,"first_name","there")}`,
  documents_needed:     v => `One thing is missing, ${g(v,"first_name","there")}`,
  status_change:        v => `Your application moved: ${g(v,"status")}`,
  offer_received:       v => `You have an offer, ${g(v,"first_name","there")}`,
  deadline_soon:        v => `${g(v,"days")} days left on one of your choices`,
  review_reviewed:      v => `We've reviewed your Orbuni submission`,
  review_approved:      v => `Your Orbuni submission is approved — payment next`,
  review_rejected:      v => `Update on your Orbuni submission`
};

export const BODIES: Record<string, (v: V) => string> = {

  // A plain, staff-written note — the one template that isn't tied to a
  // student's application. Added for the "Send an email" composer, so a
  // one-off message to a student, teammate or partner has somewhere to go
  // that isn't shaped like an application update.
  custom_notice: v => {
    var subject = String((v as V).subject ?? "A note from Orbuni");
    var bodyText = String((v as V).body ?? "");
    var paragraphs = bodyText.split(/\n{2,}/).filter(function(p){ return p.trim(); })
      .map(function(p){ return para(esc(p).replace(/\n/g, "<br>")); }).join("");
    return shell(esc(subject),
      kick("Notice")
      + h1(esc(subject))
      + (paragraphs || para("&nbsp;"))
    );
  },

  welcome: v => shell("Your file is open. Here is exactly what happens next.",
    kick("Your file is open")
    + h1(`Welcome to Orbuni, ${g(v,"first_name","there")}`)
    + para(`You have a file with us now, and a named counsellor: ${b(g(v,"counsellor","your counsellor"))}. Not a call centre &mdash; one person, who you can message any time from your portal.`)
    + rule()
    + para(b("Here is the whole journey, in order:"))
    + steps([["Your details and photo","you"],["Your passport","you"],["Certificate and transcript","you"],
             ["Choose up to three programmes","you"],["We check every document","us"],
             ["We send your file to the universities","us"],["Offer, deposit, visa, arrival","both"]])
    + button("Continue my application", SITE)
    + note("The number you see is the number you pay",
           "Every fee on our site is the university&rsquo;s published fee, and the scholarship shown is the one you actually get. We never quote a figure we cannot show you in writing.", "green")
    + small("You are getting this because you created an account at myorbuni.com.")),

  application_submitted: v => shell("Your application is with us. Here is what we do next.",
    kick("Received")
    + h1("We have your application")
    + para(`Thank you, ${g(v,"first_name","there")}. Your choices are in front of your counsellor now.`)
    + rows([["Your choices", g(v,"choices")],["Submitted", g(v,"submitted")],["Your counsellor", g(v,"counsellor")]])
    + para(`${b("What happens now:")} we check every document against what each university requires, then send your file. If anything is missing or unclear we will tell you exactly what &mdash; we will not sit on it.`)
    + button("Track my application", SITE)
    + note("Keep yourself safe",
           "Never send documents or money over WhatsApp to anyone claiming to be from Orbuni. Tuition is always paid directly to the university, never into a personal account.")),

  documents_needed: v => shell("One thing is holding up your application.",
    kick("Action needed")
    + h1("One thing is missing")
    + para(`${g(v,"first_name","There")}, your file cannot go to the university until we have this:`)
    + note("Still needed", b(g(v,"missing")))
    + para("It takes a couple of minutes. Deadlines do not move, so the sooner this is in, the more choices stay open to you.")
    + button("Upload it now", SITE)
    + small(`Stuck? Message ${g(v,"counsellor","your counsellor")} inside the portal and they will walk you through it.`)),

  status_change: v => shell("Your application has moved to a new stage.",
    kick("Update")
    + h1("Your application has moved")
    + rows([["Programme", g(v,"programme")],["University", g(v,"university")],["Now at", g(v,"status")]])
    + para(g(v,"note"))
    + button("See the full tracker", SITE)),

  offer_received: v => shell("You have an offer. Read this carefully.",
    kick("Offer received")
    + h1("You have an offer")
    + para(`${g(v,"first_name","There")}, ${b(g(v,"university"))} has made you an offer.`)
    + rows([["Programme", g(v,"programme")],["University", g(v,"university")],
            ["Published fee", g(v,"published_fee")],["Your scholarship", g(v,"discount")],
            ["What you actually pay", g(v,"net_fee")],["Reply by", g(v,"deadline")]])
    + note("That last line is the whole cost",
           "It is what leaves your pocket for the year. Nothing is hidden underneath it. If anyone quotes you a different number, come to your counsellor first.", "green")
    + button("Read the offer", SITE)
    + small(`${g(v,"counsellor","Your counsellor")} will go through the conditions with you before you accept anything.`)),

  deadline_soon: v => shell("A deadline on one of your choices is close.",
    kick("Deadline")
    + h1(`${g(v,"days")} days left`)
    + para("One of your choices closes soon:")
    + rows([["Programme", g(v,"programme")],["University", g(v,"university")],["Closes", g(v,"deadline")]])
    + para("If anything is still missing from your file, now is the moment.")
    + button("Check my file", SITE)),

  review_reviewed: v => shell("We've looked at your submission. A decision follows next.",
    kick("Received")
    + h1("We have reviewed your submission")
    + para(`Hello ${g(v,"first_name","there")}, thank you for sending your submission for ${b(g(v,"project_name","the project"))}.`)
    + para("The team has now looked at it. A decision &mdash; approve or reject &mdash; will follow on this same email. This note is not an approval and it is not a payment.")),

  review_approved: v => shell("Your submission is approved. Payment is next.",
    kick("Approved")
    + h1("Your submission is approved")
    + para(`Hello ${g(v,"first_name","there")}, your submission for ${b(g(v,"project_name","the project"))} has been approved.`)
    + note("Payment next",
           "Payment will be made to the account you listed. When that transfer goes out, an invoice / receipt will be sent to this same email.", "green")),

  review_rejected: v => shell("An update on your submission, with the reason why.",
    kick("Update")
    + h1("Update on your submission")
    + para(`Hello ${g(v,"first_name","there")}, thank you for sending a submission for ${b(g(v,"project_name","the project"))}. After review, we are not able to accept this submission.`)
    + note("Reason", g(v,"reason","It did not meet the brief."))
    + para("If the reason above is something you can fix, you may send a new submission. This email is not a payment."))
};

export function render(template: string, vars: V){
  const body = BODIES[template];
  if(!body) return null;
  return { subject: (SUBJECTS[template] ?? (() => "Orbuni"))(vars), html: withHero(template, body(vars)) };
}

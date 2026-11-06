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
  review_rejected:      v => `Update on your Orbuni submission`,
  // 24 Oct 2026: marketing and care emails the team sends from the composer
  newsletter:           v => String((v as V).subject ?? "News from Orbuni"),
  scholarship_tips:     v => `${g(v,"first_name","Hello")}, how scholarships in Türkiye really work`,
  next_intake:          v => `Ready for the next intake, ${g(v,"first_name","there")}?`,
  visa_tips:            v => `Your student visa file: what to get right`,
  arrival_guide:        v => `Getting ready to fly, ${g(v,"first_name","there")}`,
  reengage:             v => `Still planning to study abroad, ${g(v,"first_name","there")}?`,
  referral:             v => `Know someone who wants to study in Türkiye?`,
  webinar_invite:       v => `A free seat at our live scholarship webinar`
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
    + para("If the reason above is something you can fix, you may send a new submission. This email is not a payment.")),

  // ---------- 24 Oct 2026: marketing and care emails (sent by the team from the composer) ----------
  // A short news email: a headline, the team's own words, one button. Links only go to myorbuni.com.
  newsletter: v => {
    var subject = String((v as V).subject ?? "News from Orbuni");
    var paragraphs = String((v as V).body ?? "").split(/\n{2,}/).filter(function(p){ return p.trim(); })
      .map(function(p){ return para(esc(p).replace(/\n/g, "<br>")); }).join("");
    var link = String((v as V).cta_link ?? ""); if(!/^https:\/\/(www\.)?myorbuni\.com(\/|$)/.test(link)) link = SITE;
    return shell(esc(subject), kick("Orbuni news") + h1(esc(subject)) + (paragraphs || para("&nbsp;"))
      + button(g(v,"cta_label","Open Orbuni"), link)
      + small("You are getting this because you are part of the Orbuni community."));
  },
  scholarship_tips: v => shell("Bands of 25% to 100%, and what decides yours.",
    kick("Scholarships")
    + h1("How scholarships in Türkiye really work")
    + para(`${g(v,"first_name","Hello")}, at most private universities in Türkiye a scholarship is a discount on the published fee. Here is what decides how big yours is:`)
    + steps([["Your results: stronger grades usually mean a higher band","you"],["Applying early, while places are open","you"],["A complete file the first time","both"],["Sending it the right way, through an official partner","us"]])
    + note("No invented numbers", "We only show a scholarship once the university has confirmed it in writing. What you see is what you pay.", "green")
    + button("Read the full guide", SITE + "/articles/how-turkish-scholarships-work/")
    + small("Questions? Reply to this email and your counsellor answers.")),
  next_intake: v => shell("Two minutes to see where you stand for the next intake.",
    kick("Next intake")
    + h1(`Ready for the next intake, ${g(v,"first_name","there")}?`)
    + para(`Universities fill their best scholarship places first.${v.intake ? " For " + b(g(v,"intake")) + ", the" : " The"} students who start early get the widest choice.`)
    + rows([["Step 1", "The free 2-minute assessment"],["Step 2", "Your shortlist and scholarship options"],["Step 3", "Documents ready, application sent"]])
    + button("Take the free assessment", SITE + "/#start")
    + small("Applying is free. You only pay for extra services you choose, and you see every price before you decide.")),
  visa_tips: v => shell("What usually makes a visa file strong.",
    kick("Visa")
    + h1("Your student visa file: what to get right")
    + para(`${g(v,"first_name","Hello")}, the consulate decides every visa, and nobody can influence that. What you control is the file. These are the things that matter most:`)
    + steps([["A valid passport with enough months left","you"],["Your acceptance letter from the university","both"],["Proof of funds that is steady, not sudden","you"],["Names and dates that match on every document","both"],["Health insurance and where you will live","both"]])
    + note("We check it before you go", "Your counsellor checks every document against every other one. The exact list depends on your consulate, and we confirm it with you.")
    + button("Read the visa guide", SITE + "/articles/nigerian-student-visa-refusals/")
    + small("Government visa fees are paid by the student, directly to the consulate.")),
  arrival_guide: v => shell("A short checklist for the weeks before you fly.",
    kick("Before you fly")
    + h1(`Getting ready to fly, ${g(v,"first_name","there")}`)
    + para("Congratulations on getting this far. A few things make the first week in Türkiye much easier:")
    + steps([["Book your flight and send us the details","you"],["Pack your original documents in your hand luggage","you"],["Arrange where you will stay for the first nights","both"],["Airport pickup, if you booked it","us"],["Registration at the university","both"]])
    + button("Open my portal", SITE + "/#portal=student")
    + note("Something changed?", "Flight delayed or dates moved? Update it in your portal or reply here, and we adjust everything on our side.", "green")),
  reengage: v => shell("Your plans, your pace. We are still here.",
    kick("Checking in")
    + h1(`Still planning to study abroad, ${g(v,"first_name","there")}?`)
    + para("Plans change, and that is fine. If studying in Türkiye is still on your mind, the next step takes two minutes and costs nothing.")
    + button("See where I stand", SITE + "/#start")
    + para("Prefer to talk? Reply to this email with a good time and a counsellor will call you.")
    + small("You are getting this because you showed interest in Orbuni. Reply STOP and we will not email you about this again.")),
  referral: v => shell("Share Orbuni with a friend who is thinking about it.",
    kick("Share Orbuni")
    + h1("Know someone who wants to study in Türkiye?")
    + para(`${g(v,"first_name","Hello")}, if a friend, brother, sister or classmate is thinking about studying abroad, send them our free assessment. They get the same honest advice you did.`)
    + button("Get the link to share", SITE + "/")
    + small("They apply for free, and their counsellor is a real person they can message any time.")),
  webinar_invite: v => shell("Free, live, and questions answered on the spot.",
    kick("Free webinar")
    + h1("A free seat at our live scholarship webinar")
    + para(`${g(v,"first_name","Hello")}, we are hosting a free live session on how international students win 25% to 100% scholarships at universities in Türkiye.`)
    + rows([["What", "Scholarships, real fees, how to apply"],["Where", "Online, from your phone or laptop"],["Cost", "Free"]])
    + button("Save my free seat", SITE + "/webinar")
    + small("Can't make it live? Free seats keep the replay for 3 days."))
};

export function render(template: string, vars: V){
  const body = BODIES[template];
  if(!body) return null;
  return { subject: (SUBJECTS[template] ?? (() => "Orbuni"))(vars), html: withHero(template, body(vars)) };
}

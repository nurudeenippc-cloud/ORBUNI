// Extra templates: checkout follow-ups and extra-service bookings.
// Same light shell and tone as mail.ts; kept in their own file so mail.ts
// stays as it was.
import { esc } from "./mail.ts";

const INK = "#111826", BODY = "#48566B", MUTE = "#7A8798", LINE = "#E4E8EF", WASH = "#F5F7FA";
const GOLD = "#B8791A", GOLDBG = "#FFF6E6", GREEN = "#127A52", GREENBG = "#EAF7F1", DARK = "#0E1626";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SITE = "https://myorbuni.com";
type V = Record<string, unknown>;
const g = (v: V, k: string, d = "") => esc(v[k] ?? d);
const safeLink = (u: unknown) => { const s = String(u ?? ""); return /^https:\/\/(www\.)?myorbuni\.com(\/|$)/.test(s) ? s : SITE; };
// the signed "stop these emails" link made by public.optout_link(); nothing else is accepted
const unsubLink = (u: unknown) => { const x = String(u ?? ""); return /^https:\/\/ytsebzdykfeiiuxbdtvr\.supabase\.co\/functions\/v1\/email-optout\?e=[^"<>\s]+&t=[0-9a-f]{32}$/.test(x) ? x : ""; };

const kick = (t: string) => `<tr><td class="pad" style="padding:26px 32px 0"><div style="font:700 11px/1 ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${GOLD}">${t}</div></td></tr>`;
const h1 = (t: string) => `<tr><td class="pad" style="padding:6px 32px 0"><h1 style="margin:0;font:700 25px/1.28 ${SANS};color:${INK};letter-spacing:-.02em">${t}</h1></td></tr>`;
const para = (t: string) => `<tr><td class="pad" style="padding:14px 32px 0"><p style="margin:0;font:400 16px/1.65 ${SANS};color:${BODY}">${t}</p></td></tr>`;
const small = (t: string) => `<tr><td class="pad" style="padding:16px 32px 0"><p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTE}">${t}</p></td></tr>`;
const button = (label: string, href: string) => `<tr><td class="pad" style="padding:26px 32px 0">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${DARK}" style="border-radius:10px">
<a href="${href}" style="display:block;padding:15px 30px;font:700 16px/1 ${SANS};color:#FFFFFF;text-decoration:none;border-radius:10px">${label}</a>
</td></tr></table></td></tr>`;
const note = (title: string, text: string, tone: "gold" | "green" = "gold") => {
  const bg = tone === "green" ? GREENBG : GOLDBG, bd = tone === "green" ? GREEN : GOLD;
  return `<tr><td class="pad" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background:${bg};border-radius:12px">
<tr><td style="padding:16px 18px;border-left:4px solid ${bd};border-radius:12px">
<div style="font:700 13.5px/1.4 ${SANS};color:${bd};margin-bottom:5px">${title}</div>
<div style="font:400 14px/1.6 ${SANS};color:${BODY}">${text}</div></td></tr></table></td></tr>`;
};
const rows = (pairs: [string, string][]) => `<tr><td class="pad" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WASH}" style="background:${WASH};border-radius:12px"><tr><td style="padding:6px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
  pairs.filter(([, v]) => v).map(([k, v], i) => {
    const top = i ? `border-top:1px solid ${LINE};` : "";
    return `<tr><td class="stack" style="${top}padding:13px 0;font:400 14px/1.45 ${SANS};color:${MUTE};width:40%;vertical-align:top">${k}</td>` +
           `<td class="stack rt" style="${top}padding:13px 0;font:600 15px/1.45 ${SANS};color:${INK};text-align:right;vertical-align:top">${v}</td></tr>`;
  }).join("") + `</table></td></tr></table></td></tr>`;

function shell(preheader: string, blocks: string){
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>Orbuni</title>
<style>body,table,td,a{-webkit-text-size-adjust:100%}a{color:${GOLD}}
@media only screen and (max-width:600px){.wrap{width:100%!important}.pad{padding-left:20px!important;padding-right:20px!important}
.stack{display:block!important;width:100%!important;text-align:left!important;padding-bottom:0!important}
.stack.rt{padding-top:2px!important;padding-bottom:13px!important}h1{font-size:22px!important}}</style></head>
<body style="margin:0;padding:0;background:${WASH}">
<div style="display:none;font-size:1px;color:${WASH};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WASH}"><tr><td align="center" style="padding:26px 12px 34px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px">
<tr><td bgcolor="${DARK}" style="background:${DARK};border-radius:14px 14px 0 0;padding:20px 32px;font:800 18px/1 ${SANS};color:#FFFFFF">Orbuni</td></tr>
<tr><td bgcolor="#FFFFFF" style="background:#FFFFFF;border-left:1px solid ${LINE};border-right:1px solid ${LINE}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${blocks}<tr><td style="height:34px;line-height:34px;font-size:0">&nbsp;</td></tr></table></td></tr>
<tr><td bgcolor="${WASH}" class="pad" style="background:${WASH};border:1px solid ${LINE};border-top:0;border-radius:0 0 14px 14px;padding:22px 32px">
<p style="margin:0;font:400 12.5px/1.65 ${SANS};color:${MUTE}"><a href="${SITE}" style="color:${GOLD};text-decoration:none;font-weight:600">myorbuni.com</a> · Istanbul, Türkiye</p>
</td></tr></table></td></tr></table></body></html>`;
}

export const EXTRA_SUBJECTS: Record<string, (v: V) => string> = {
  checkout_reminder: v => Number(v.step) === 3 ? `Last note about your Orbuni checkout` : Number(v.step) === 2 ? `Still thinking it over, ${String(v.first_name ?? "there")}?` : `You were one step away, ${String(v.first_name ?? "there")}`,
  payment_failed:    v => Number(v.step) === 2 ? `Your payment still didn't go through` : `Your payment didn't go through, ${String(v.first_name ?? "there")}`,
  lead_nurture:      v => Number(v.step) === 3 ? `Want us to look at your options with you, ${String(v.first_name ?? "there")}?` : Number(v.step) === 2 ? `How Orbuni students get their scholarships` : `Your study plan, ${String(v.first_name ?? "there")}: the next step`,
  call_reminder:     v => `Starting soon: your call with Orbuni — ${String(v.when ?? "")}`,
  call_missed:       _v => `We missed you on the call — let's find another time`,
  extra_booked:      v => `Booked: ${String(v.service ?? "your extra service")}`,
  extra_assigned:    v => `Who is coming for you — ${String(v.service ?? "your booking")}`,
  call_booked:       v => `Your call with Orbuni — ${String(v.when ?? "")}`,
  payment_receipt:   v => `Receipt ${String(v.receipt_no ?? "")} — payment received, thank you`
};

export const EXTRA_BODIES: Record<string, (v: V) => string> = {
  // Invoice and receipt in one: what was bought, for how much, how it was paid, and
  // that it is settled. Sent for every Whop (dollars) and Paystack (naira) payment.
  payment_receipt: v => {
    const local = String(v.amount_local ?? "").trim();
    return shell(`Payment received: ${String(v.amount ?? "")} for ${String(v.item ?? "your Orbuni purchase")}.`,
      kick("Payment received")
      + h1(`Thank you, ${g(v,"first_name","there")}. You're paid.`)
      + para(`This email is your invoice and your receipt. Keep it for your records.`)
      + rows([["Receipt / invoice no.", g(v,"receipt_no")], ["Date", g(v,"date")], ["Billed to", g(v,"billed_to")],
              ["Item", g(v,"item")], ["Amount", g(v,"amount") + (local ? " (" + esc(local) + ")" : "")],
              ["Paid with", g(v,"method")], ["Status", `<span style="color:${GREEN}">PAID</span>`]])
      + note("What happens next", g(v,"next","Your counsellor has been told and your portal is already updated. Open it any time to see where things stand."), "green")
      + button("Open my portal", safeLink(v.link))
      + small("Orbuni Education · Istanbul, Türkiye. Tuition is always paid directly to the university, never to Orbuni or a person. Questions about this payment? Reply to this email."));
  },
  checkout_reminder: v => {
    const step = Number(v.step) || 1, second = step === 2, third = step === 3;
    const stop = unsubLink(v.unsub);
    return shell(third ? "We will not remind you again. Here is the link if you still want it." : second ? "Your place is still open. Here is the link." : "You accepted the terms but the payment did not go through.",
      kick(third ? "Last reminder" : second ? "Still open" : "Almost there")
      + h1(third ? "We are here if you want us" : second ? "Still thinking it over?" : "You were one step away")
      + para(`Hello ${g(v,"first_name","there")}, you started paying for ${g(v,"what","your Orbuni purchase")}${v.amount ? " (" + g(v,"amount") + ")" : ""} and did not finish. Nothing was charged.`)
      + (third
          ? para("We will not keep emailing you about it. If the timing is wrong or you are still deciding, that is fine — reply to this email with any question, or book a free call and a counsellor will talk it through with you.")
          : second
            ? para("If something stopped you — the card was refused, the page was slow, or you have a question — reply to this email and a real person on our team will help.")
            : para("It takes a minute. The payment opens right on our page, by Whop, with card, bank transfer and local methods."))
      + button("Finish on Orbuni", safeLink(v.link))
      + (third ? note("Prefer to talk first?", "Reply with two times that suit you and a counsellor will call you on WhatsApp or Google Meet.", "green") : "")
      + small((third ? "This is the last reminder we send about this." : second ? "One more short reminder may follow in two days." : "You are getting this because you started a checkout at myorbuni.com.")
          + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop these reminders</a>.` : "")));
  },
  payment_failed: v => {
    const stop = unsubLink(v.unsub), second = Number(v.step) === 2;
    return shell("Nothing was charged. Here is how to finish.",
      kick(second ? "Still open" : "Payment not completed")
      + h1(second ? "Your payment still didn't go through" : "Your payment didn't go through")
      + para(`Hello ${g(v,"first_name","there")}, your payment for ${g(v,"what","your Orbuni purchase")}${v.amount ? " (" + g(v,"amount") + ")" : ""} was not completed, so nothing was charged.`)
      + note("What usually fixes it", "Many banks block online payments abroad the first time. Try again and approve it in your bank app, use a different card, or pick bank transfer or a local method in the payment window.")
      + button("Try the payment again", safeLink(v.link))
      + para("Still stuck? Reply to this email and tell us what the screen said — we will sort it out with you.")
      + small((second ? "This is the last email we send about this payment." : "You are getting this because a payment to Orbuni did not go through.")
          + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop these emails</a>.` : "")));
  },
  lead_nurture: v => {
    const stop = unsubLink(v.unsub), step = Number(v.step) || 1;
    const path = String(v.pathway ?? "middle");
    const lower = /low/.test(path), higher = /high/.test(path);
    const prog = String(v.programme ?? "").trim();
    let body = "";
    if(step === 1){
      body = kick("Your plan")
        + h1(`Thanks for taking the quiz, ${g(v,"first_name","there")}`)
        + para(`You told us what you want${prog ? " (" + esc(prog) + ")" : ""}. Here is the simplest next step for where you are right now.`)
        + (lower
            ? note("Start by learning how it works", "Join the free Orbuni community and watch how students like you pick a university, apply and win a scholarship. When you are ready, the $10 Scholarship Masterclass walks you through it step by step.", "green")
              + button("Join the free community", /^https:\/\/(whop\.com|myorbuni\.com)\//.test(String(v.community ?? "")) ? String(v.community) : SITE + "/#start")
            : higher
              ? note("You are ready to apply", "Book a free 30-minute call. A counsellor will check your results, shortlist universities that fit your budget and tell you exactly which documents to get ready.", "green")
                + button("Start my application", SITE + "/#start")
              : note("You are nearly ready", "Pick the package that fits you, or talk to a counsellor first. We handle the application, the scholarship, the offer letter and your arrival.", "green")
                + button("See my options", SITE + "/#start"));
    } else if(step === 2){
      body = kick("How it works")
        + h1("How Orbuni students get their scholarships")
        + para(`${g(v,"first_name","Hello")}, most universities in Türkiye and Northern Cyprus give international students 25% to 100% off the published fee — but only if the application is complete, on time and sent the right way.`)
        + rows([["1. Shortlist", "Programmes that match your results and budget"], ["2. Documents", "Passport, diploma, transcript — we check them first"], ["3. Apply", "We submit to the universities for you"], ["4. Offer & visa", "Offer letter, deposit, visa letter, airport pickup"]])
        + para("You can do all of it from your phone. Your counsellor is on WhatsApp the whole way.")
        + button(lower ? "Learn the steps — $10 Masterclass" : "Start my application", SITE + (lower ? "/?buy=masterclass#start" : "/#start"));
    } else {
      body = kick("A quick question")
        + h1("Is anything stopping you?")
        + para(`${g(v,"first_name","Hello")}, it has been a week since you took the quiz. Usually one of three things holds people back: money, documents, or not being sure which university is right.`)
        + para("Reply to this email with one line about what is on your mind, and a counsellor will answer you personally — no sales script. Or pick a time for a free call.")
        + button("Talk to a counsellor", SITE + "/#start")
        + small("This is the last email in this short series.");
    }
    return shell(step === 1 ? "The next step for where you are right now." : step === 2 ? "25% to 100% off — here is how it works." : "One line back is enough.",
      body + small("You are getting this because you took the Orbuni study quiz." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop these emails</a>.` : "")));
  },
  call_reminder: v => {
    const link = String(v.link ?? "");
    const meet = /^https:\/\/meet\.google\.com\//.test(link) ? link : "";
    return shell("Your free call starts soon.",
      kick("Starting soon")
      + h1(`Your call is today, ${g(v,"first_name","there")}`)
      + rows([["When", g(v,"when")], ["With", g(v,"host","the Orbuni team")], ["Where", meet ? "Google Meet (link below)" : "We will send the link on WhatsApp"]])
      + (meet ? button("Join the call", meet) : "")
      + note("Have these ready if you can", "Your latest results or transcript, your passport, and the country or city you prefer. It is fine if you don't have them yet.", "green")
      + small("Can't make it? Reply to this email and we will move it."));
  },
  call_missed: v => shell("No problem — pick another time.",
    kick("We missed you")
    + h1(`Sorry we missed you, ${g(v,"first_name","there")}`)
    + para(`We waited for you on the call (${g(v,"when")}). Things come up — it happens.`)
    + para("Reply to this email with two times that work for you and we will book it, or message us on WhatsApp. A counsellor will make sure you are looked after.")
    + button("Go to Orbuni", SITE + "/#start")
    + small("You are getting this because you booked a call at myorbuni.com.")),
  extra_booked: v => shell("Your booking is with the team.",
    kick("Booked")
    + h1(`${g(v,"service","Your extra service")} is booked`)
    + para(`Thank you, ${g(v,"first_name","there")}. Your booking is with the Orbuni team.`)
    + rows([["When", g(v,"when")], ["Flight", g(v,"flight")], ["Airport", g(v,"airport")], ["Price", g(v,"price")]])
    + note("What happens next", "At least 24 hours before, we send you the name and phone number of the person coming for you. Flight delayed? Update it in your portal, or message your counsellor.", "green")
    + button("See my booking", SITE + "/#portal=student:extras")
    + small("Cancel at least 48 hours before and you get the full price back.")),
  extra_assigned: v => shell("The name and number of the person meeting you.",
    kick("Your contact")
    + h1(`${g(v,"who","Your contact")} is coming for you`)
    + para(`${g(v,"first_name","There")}, here is who will meet you for ${g(v,"service","your booking")}.`)
    + rows([["Who", g(v,"who")], ["Phone / WhatsApp", g(v,"phone")], ["When", g(v,"when")]])
    + note("Stay safe", "Only go with the person named here. If anyone else says they are from Orbuni, call your counsellor first.")
    + button("See my booking", SITE + "/#portal=student:extras")),
  call_booked: v => {
    const link = String(v.link ?? "");
    const meet = /^https:\/\/meet\.google\.com\//.test(link) ? link : "";
    return shell("Your free call is booked.",
      kick("Call booked")
      + h1(`See you soon, ${g(v,"first_name","there")}`)
      + para("Your free call with the Orbuni team is booked. Bring your questions — and your latest results if you have them.")
      + rows([["When", g(v,"when")], ["With", g(v,"host","the Orbuni team")], ["Where", meet ? "Google Meet (link below)" : "We will send the link on WhatsApp"]])
      + (meet ? button("Join the call", meet) : "")
      + note("Can't make it?", "Reply to this email or message us on WhatsApp and we will move it. The Google Calendar invitation has the same link.", "green")
      + small("You are getting this because you booked a call at myorbuni.com."));
  }
};

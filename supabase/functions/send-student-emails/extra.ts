// Extra templates: checkout follow-ups and extra-service bookings.
// Same light shell and tone as mail.ts; kept in their own file so mail.ts
// stays as it was.
import { esc } from "./mail.ts";
import { shell, kick, h1, button } from "./brand.ts";

const INK = "#111826", BODY = "#48566B", MUTE = "#7A8798", LINE = "#E4E8EF", WASH = "#F5F7FA";
const GOLD = "#B8791A", GOLDBG = "#FFF6E6", GREEN = "#127A52", GREENBG = "#EAF7F1";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SITE = "https://myorbuni.com";
type V = Record<string, unknown>;
const g = (v: V, k: string, d = "") => esc(v[k] ?? d);
const safeLink = (u: unknown) => { const s = String(u ?? ""); return /^https:\/\/(www\.)?myorbuni\.com(\/|$)/.test(s) ? s : SITE; };
// the Google Calendar link made by public.webinar_queue_email(); nothing else is accepted
const gcalLink = (u: unknown) => { const x = String(u ?? ""); return /^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE&[^"<>\s]+$/.test(x) ? x.replace(/&/g, "&amp;") : ""; };
// the signed "stop these emails" link made by public.optout_link(); nothing else is accepted
const unsubLink = (u: unknown) => { const x = String(u ?? ""); return /^https:\/\/ytsebzdykfeiiuxbdtvr\.supabase\.co\/functions\/v1\/email-optout\?e=[^"<>\s]+&t=[0-9a-f]{32}$/.test(x) ? x : ""; };

const para = (t: string) => `<tr><td class="pad" style="padding:14px 32px 0"><p style="margin:0;font:400 16px/1.65 ${SANS};color:${BODY}">${t}</p></td></tr>`;
const small = (t: string) => `<tr><td class="pad" style="padding:16px 32px 0"><p style="margin:0;font:400 13px/1.6 ${SANS};color:${MUTE}">${t}</p></td></tr>`;
const note = (title: string, text: string, tone: "gold" | "green" = "gold") => {
  const bg = tone === "green" ? GREENBG : GOLDBG, bd = tone === "green" ? GREEN : GOLD;
  return `<tr><td class="pad" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${bg}" style="background:${bg};border-radius:12px">
<tr><td style="padding:16px 18px;border-left:4px solid ${bd};border-radius:12px">
<div style="font:700 13.5px/1.4 ${SANS};color:${bd};margin-bottom:5px">${title}</div>
<div style="font:400 14px/1.6 ${SANS};color:${BODY}">${text}</div></td></tr></table></td></tr>`;
};
// A short video: email can't play video, so it is the poster (with a play button drawn on it) linking to the
// video itself. Only our own videos, served by jsDelivr from the public repo, pinned to one commit.
const VID = "https://cdn.jsdelivr.net/gh/nurudeenippc-cloud/ORBUNI@c895a6d93c78816da1c653609651987f6c561ca6/site/video/wa/";
const video = (key: "webinar_invite" | "vip_offer" | "assessment", caption: string) => `<tr><td class="pad" style="padding:24px 32px 0" align="center">
<a href="${VID}${key}.mp4" style="text-decoration:none"><img src="${VID}${key}-poster.jpg" width="300" height="300" alt="Play the video: ${caption}" style="display:block;width:300px;max-width:100%;height:auto;border:0;border-radius:16px"></a>
<div style="font:400 13px/1.5 ${SANS};color:${MUTE};margin-top:8px">${caption}</div></td></tr>`;
const rows = (pairs: [string, string][]) => `<tr><td class="pad" style="padding:24px 32px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WASH}" style="background:${WASH};border-radius:12px"><tr><td style="padding:6px 18px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
  pairs.filter(([, v]) => v).map(([k, v], i) => {
    const top = i ? `border-top:1px solid ${LINE};` : "";
    return `<tr><td class="stack" style="${top}padding:13px 0;font:400 14px/1.45 ${SANS};color:${MUTE};width:40%;vertical-align:top">${k}</td>` +
           `<td class="stack rt" style="${top}padding:13px 0;font:600 15px/1.45 ${SANS};color:${INK};text-align:right;vertical-align:top">${v}</td></tr>`;
  }).join("") + `</table></td></tr></table></td></tr>`;


export const EXTRA_SUBJECTS: Record<string, (v: V) => string> = {
  checkout_reminder: v => Number(v.step) === 3 ? `Last note about your Orbuni checkout` : Number(v.step) === 2 ? `Still thinking it over, ${String(v.first_name ?? "there")}?` : `You were one step away, ${String(v.first_name ?? "there")}`,
  payment_failed:    v => Number(v.step) === 2 ? `Your payment still didn't go through` : `Your payment didn't go through, ${String(v.first_name ?? "there")}`,
  lead_nurture:      v => Number(v.step) === 3 ? `Want us to look at your options with you, ${String(v.first_name ?? "there")}?` : Number(v.step) === 2 ? `How Orbuni students get their scholarships` : `Your study plan, ${String(v.first_name ?? "there")}: the next step`,
  call_reminder:     v => `Starting soon: your call with Orbuni — ${String(v.when ?? "")}`,
  call_missed:       _v => `We missed you on the call — let's find another time`,
  extra_booked:      v => `Booked: ${String(v.service ?? "your extra service")}`,
  extra_assigned:    v => `Who is coming for you — ${String(v.service ?? "your booking")}`,
  call_booked:       v => `Your call with Orbuni — ${String(v.when ?? "")}`,
  payment_receipt:   v => `Receipt ${String(v.receipt_no ?? "")} — payment received, thank you`,
  // the webinar (Scholarship 1.0)
  webinar_registered:      v => `Your seat is saved: ${String(v.title ?? "the Orbuni webinar")}`,
  webinar_reminder:        v => `${String(v.when_short ?? "Soon") === "tomorrow" ? "Tomorrow" : "In one hour"}: ${String(v.title ?? "the Orbuni webinar")}`,
  webinar_live:            _v => `We are live now. Your seat is waiting`,
  webinar_replay:          v => `You missed it, ${String(v.first_name ?? "there")}. The replay is ready`,
  webinar_next:            v => `Your next step after the webinar, ${String(v.first_name ?? "there")}`,
  webinar_vip_offer:       v => `Start before the webinar, ${String(v.first_name ?? "there")}?`,
  webinar_vip_unpaid:      _v => `Your VIP seat is not confirmed yet`,
  webinar_vip_welcome:     v => `You're VIP, ${String(v.first_name ?? "there")}. Here is what you get`,
  webinar_vip_scholarship: _v => `Your early access: 100% scholarship places`,
  partner_share:           v => String(v.link) === "vip" ? `${String(v.agency ?? "Your agency")} sent you a VIP webinar seat` : String(v.link) === "webinar" ? `${String(v.agency ?? "Your agency")} invited you to a free scholarship webinar` : `${String(v.agency ?? "Your agency")} sent you a free 2-minute assessment`
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
        + video("webinar_invite", "40 seconds: the free live scholarship webinar")
        + para(`Want the whole picture first? Save a free seat at the live webinar: <a href="${SITE}/webinar" style="color:${GOLD};font-weight:600">myorbuni.com/webinar</a>.`)
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
  },

  // ---------- the webinar (Scholarship 1.0) ----------
  webinar_registered: v => {
    const stop = unsubLink(v.unsub), vip = String(v.ticket) === "vip", cal = gcalLink(v.gcal);
    return shell(`You're in. ${String(v.when ?? "")}`,
      kick(vip ? "VIP seat saved" : "Free seat saved")
      + h1(`You're in, ${g(v,"first_name","there")}`)
      + para(`Your seat for <b>${g(v,"title","the Orbuni webinar")}</b> is saved. Bring your questions, and bring your parents if they help decide. Invited university representatives and academic experts join us live.`)
      + rows([["When", g(v,"when")], ["Where", "Online. The join link is on your seat page"], ["Your seat", vip ? "VIP" : "Free"]])
      + button("Open my seat", safeLink(v.seat))
      + (cal ? para(`<a href="${cal}" style="color:${GOLD};font-weight:600">Add it to Google Calendar</a> so you don't miss it.`) : "")
      + note("Keep this email", "The button above is your personal seat link. It shows the countdown, the join button on the day and, afterwards, the replay. We will also remind you on WhatsApp.", "green")
      + (vip ? "" : note("Want to start now?", `The VIP seat (${g(v,"vip_price","$10")}) gives you the Scholarship Masterclass today, a free ticket to our Istanbul meetup, the replay for life and 48-hour early access to 100% scholarship places. You can upgrade from your seat page.`)
                 + video("vip_offer", "30 seconds: what the VIP seat adds"))
      + small("You are getting this because you signed up for an Orbuni webinar." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_reminder: v => {
    const stop = unsubLink(v.unsub), soon = String(v.when_short ?? "") !== "tomorrow";
    return shell(soon ? "We start in about an hour." : "See you tomorrow.",
      kick(soon ? "Starting soon" : "Tomorrow")
      + h1(soon ? `We start in about an hour, ${g(v,"first_name","there")}` : `See you tomorrow, ${g(v,"first_name","there")}`)
      + para(`<b>${g(v,"title","The Orbuni webinar")}</b><br>${g(v,"when")}`)
      + (soon ? para("The join button on your seat page switches on 15 minutes before we start. Find a quiet place, and have a pen ready: we will show real prices.")
              : para("Write down your biggest question tonight. We answer as many as we can live, and VIP questions go first."))
      + button(soon ? "Open my seat" : "See my seat", safeLink(v.seat))
      + small("You are getting this because you signed up for an Orbuni webinar." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_live: v => {
    const stop = unsubLink(v.unsub);
    return shell("We are live. Tap to join.",
      kick("Live now")
      + h1("We are live. Join us")
      + para(`Hello ${g(v,"first_name","there")}, <b>${g(v,"title","the Orbuni webinar")}</b> has started. The real numbers come in the first 20 minutes, so jump in now.`)
      + button("Join now", safeLink(v.seat))
      + small("You are getting this because you signed up for an Orbuni webinar." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_replay: v => {
    const stop = unsubLink(v.unsub), vip = String(v.ticket) === "vip";
    return shell("The replay is ready.",
      kick("Replay")
      + h1(`We missed you, ${g(v,"first_name","there")}`)
      + para(`Life happens. The full recording of <b>${g(v,"title","the webinar")}</b> is on your seat page.`)
      + button("Watch the replay", safeLink(v.seat))
      + (vip ? note("Yours for life", "As a VIP, the replay stays on your seat page for good.", "green")
             : note("It comes down in 3 days", `Free seats keep the replay for 3 days. The VIP seat (${g(v,"vip_price","$10")}) keeps it for life and includes the Scholarship Masterclass.`))
      + para(`After watching, take the free 2-minute assessment. It skips the video and tells you where you stand: <a href="${safeLink(v.quiz)}" style="color:${GOLD};font-weight:600">start the assessment</a>.`)
      + small("You are getting this because you signed up for an Orbuni webinar." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_next: v => {
    const stop = unsubLink(v.unsub);
    return shell("Two minutes: see exactly where you stand.",
      kick("Your next step")
      + h1(`Thank you for coming, ${g(v,"first_name","there")}`)
      + para("You now know how Turkish scholarships really work. The next step is to see where <b>you</b> stand: which universities fit your results, and what your place would really cost.")
      + para("The free assessment takes 2 minutes. It skips the video you have already seen and goes straight to the questions.")
      + video("assessment", "25 seconds: how the assessment works")
      + button("Take the 2-minute assessment", safeLink(v.quiz))
      + note("Prefer to talk?", "At the end of the assessment you can book a free call with a counsellor, or just reply to this email.", "green")
      + small("You are getting this because you joined an Orbuni webinar." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_vip_offer: v => {
    const stop = unsubLink(v.unsub);
    return shell("The Scholarship Masterclass today, before the webinar.",
      kick("Optional upgrade")
      + h1("Want to start before the webinar?")
      + para(`Hello ${g(v,"first_name","there")}, your free seat is saved and that is all you need to attend. Some people want to move faster, so there is a VIP seat for ${g(v,"vip_price","$10")}, paid once:`)
      + video("vip_offer", "Watch: what the VIP seat adds (30 seconds)")
      + rows([["Today", "The Scholarship Masterclass: 9 short lessons, yours for life"], ["In Istanbul", "A free ticket to the Orbuni Istanbul Meetup: our team, students from all over the world, food, drinks and prize games"], ["On the day", "Your question goes first in the live Q&amp;A"], ["After", "The replay for life (free seats: 3 days)"], ["First", "48-hour early access to 100% scholarship places"]])
      + button("Upgrade from my seat page", safeLink(v.seat))
      + small("We send this offer once. Your free seat stays whatever you decide." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_vip_unpaid: v => {
    const stop = unsubLink(v.unsub);
    return shell("Nothing was charged. Your free seat is still saved.",
      kick("Not finished")
      + h1("Your VIP seat is not confirmed yet")
      + para(`Hello ${g(v,"first_name","there")}, you started the VIP upgrade (${g(v,"vip_price","$10")}) but the payment did not finish, so nothing was charged. Your free seat is still saved.`)
      + note("What usually fixes it", "Approve the payment in your bank app, try another card, or pick a local method in the payment window.")
      + button("Finish the upgrade", safeLink(v.seat))
      + para("Stuck? Reply to this email and tell us what the screen said. A real person will help.")
      + small("This is the only reminder we send about it." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_vip_welcome: v => shell("Your VIP seat is confirmed.",
      kick("VIP confirmed")
      + h1(`You're VIP, ${g(v,"first_name","there")}`)
      + para(`Payment received. Your VIP seat for <b>${g(v,"title","the webinar")}</b> is confirmed. Here is everything that comes with it:`)
      + rows([["Masterclass", "Create your free Orbuni account with this email and the 9 lessons unlock by themselves"], ["Istanbul Meetup", "Your free ticket. We send the date and venue to your WhatsApp and this email"], ["Live Q&amp;A", "Your question goes first"], ["Replay", "Yours for life, on your seat page"], ["100% scholarship places", "You see them 48 hours before everyone else"]])
      + button("Open my VIP seat", safeLink(v.seat))
      + note("Your receipt", "Your payment receipt comes in a separate email. Questions? Reply to this email.", "green")
      + small("You are getting this because you bought a VIP seat at myorbuni.com.")),
  // sent by a partner agency from their portal (public.partner_share_link checks who may send what)
  partner_share: v => {
    const stop = unsubLink(v.unsub), k = String(v.link), url = safeLink(v.url);
    const P: Record<string, [string, string, string, string]> = {
      assessment: ["Free assessment", "Two minutes to see where you stand", "Eight honest questions. At the end you see which universities and scholarship bands fit your results, and your next step. Free, and nothing to pay.", "Start the assessment"],
      webinar: ["Free live webinar", "A free seat at the scholarship webinar", "90 minutes, live: how international students win 25% to 100% scholarships at universities in Türkiye, with our team and invited university guests. Save your free seat; the link and reminders follow by email and WhatsApp.", "Save my free seat"],
      vip: ["VIP seat", "The VIP seat for the scholarship webinar", "One payment of $10: the Scholarship Masterclass today, a free ticket to the Orbuni Istanbul Meetup, the replay for life, your question answered first and early access to 100% scholarship places.", "See the VIP seat"],
    };
    const x = P[k] || P.assessment;
    return shell(x[1] + ".",
      kick(x[0])
      + h1(`${g(v,"first_name","Hello")}, ${esc(x[1].charAt(0).toLowerCase() + x[1].slice(1))}`)
      + para(`<b>${g(v,"agency","Your education agency")}</b> works with Orbuni and sent you this. ${esc(x[2])}`)
      + button(x[3], url)
      + small("You are getting this because your education agency sent it from their Orbuni portal." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  },
  webinar_vip_scholarship: v => {
    const stop = unsubLink(v.unsub);
    return shell("You see these places 48 hours before everyone else.",
      kick("VIP early access")
      + h1("Your early access is open")
      + para(`Hello ${g(v,"first_name","there")}, as promised in the webinar: the current list of 100% scholarship places is open to you now, 48 hours before we share it with everyone else.`)
      + para("These places are limited and go in the order complete applications arrive. A 100% scholarship covers tuition; you still plan for housing, living costs and the visa, and we show you those numbers honestly.")
      + button("See the 100% scholarship places", safeLink(SITE + "/#schol"))
      + note("Want help choosing?", "Reply to this email with your results and the course you want, and a counsellor will tell you which places fit.", "green")
      + small("You are getting this because you are a VIP on an Orbuni webinar." + (stop ? ` <a href="${stop}" style="color:${MUTE}">Stop Orbuni emails</a>.` : "")));
  }
};

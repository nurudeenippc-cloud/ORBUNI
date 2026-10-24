// Orbuni WhatsApp — creates the message templates in Twilio, submits them to Meta
// for approval, and keeps public.wa_templates in step with Meta's decision.
// Called by pg_cron (x-orb-secret) — safe to run any number of times: a template
// that already exists is only re-checked, never duplicated.
// {{1}} is the student's first name, except in orbuni_staff_alert (sent to the team:
// {{1}} what happened, {{2}} the details).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = () => createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", { auth: { persistSession: false } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SID = (Deno.env.get("TWILIO_ACCOUNT_SID") ?? "").trim();
const TOKEN = (Deno.env.get("TWILIO_AUTH_TOKEN") ?? "").trim();
const CRON = (Deno.env.get("ORB_CRON_SECRET") ?? "").trim();
const AUTH = { Authorization: "Basic " + btoa(SID + ":" + TOKEN) };

// Keep these short and factual: Meta rejects pushy or vague marketing wording,
// and "utility" templates (about something the student already started) are cheaper.
type Btn = { title: string; id?: string; url?: string };
// Videos for the "_vid" templates live in the public repo and are served by jsDelivr, pinned to one commit.
const VID = "https://cdn.jsdelivr.net/gh/nurudeenippc-cloud/ORBUNI@c895a6d93c78816da1c653609651987f6c561ca6/site/video/wa/";
// Posters for the "_card" templates (1080×1080), same hosting, pinned to the commit that added them.
const IMG = "https://cdn.jsdelivr.net/gh/nurudeenippc-cloud/ORBUNI@118b1e9be93b8349be9e1fa9151da461b9f2c08d/site/img/wa/";
export const TEMPLATES: { key: string; metaName?: string; category: "UTILITY" | "MARKETING"; body: string; lang?: string; vars?: Record<string, string>; quick?: Btn[]; link?: Btn; media?: string; footer?: string }[] = [
  { key: "orbuni_welcome", category: "UTILITY",
    body: "Hi {{1}}, this is Orbuni. Thanks for your interest in studying in Türkiye. Reply here with any question about universities, fees or scholarships and we will help you. Reply STOP to opt out." },
  { key: "orbuni_quiz_followup", category: "MARKETING",
    body: "Hi {{1}}, thanks for taking the Orbuni study assessment. Would you like help choosing a university and applying for a scholarship? Reply YES and we will guide you. Reply STOP to opt out." },
  { key: "orbuni_payment_help", category: "UTILITY",
    body: "Hi {{1}}, it looks like your Orbuni checkout was not completed and nothing was charged. If something went wrong with the payment, reply here and we will help you finish. Reply STOP to opt out." },
  { key: "orbuni_documents_needed", category: "UTILITY",
    body: "Hi {{1}}, your Orbuni application is waiting for one or more documents. Please log in at myorbuni.com and upload them under Documents so we can send your file to the university. Reply here if you need help." },
  { key: "orbuni_offer_ready", category: "UTILITY",
    body: "Hi {{1}}, good news: there is an update on your university application. Please log in at myorbuni.com to see it, and reply here if you have any questions." },
  { key: "orbuni_checkin", category: "MARKETING",
    body: "Hi {{1}}, it is Orbuni checking in. Are you still planning to study in Türkiye? Reply here with any question and we will help with your next step. Reply STOP to opt out." },
  { key: "orbuni_team_reply", category: "UTILITY",
    body: "Hi {{1}}, this is the Orbuni team following up on your message. Reply here and we will continue where we left off." },
  { key: "orbuni_staff_alert", category: "UTILITY",
    body: "Orbuni team alert: {{1}}. Details: {{2}}. Open the Orbuni portal to see it and take action.",
    vars: { "1": "Call booked with Aisha Bello", "2": "Mon 6 Oct, 14:00 Turkiye time with Nurudeen" } },
  // Button versions: wa-followups uses "<key>_btn" once Meta approves it, and the plain one until then.
  { key: "orbuni_quiz_followup_btn", category: "MARKETING",
    body: "Hi {{1}}, thanks for taking the Orbuni study assessment. Would you like help choosing a university and applying for a scholarship?",
    quick: [{ title: "Yes, help me", id: "YES" }, { title: "Not now", id: "LATER" }, { title: "Stop messages", id: "STOP" }] },
  { key: "orbuni_checkin_btn", category: "MARKETING",
    body: "Hi {{1}}, it is Orbuni checking in. Are you still planning to study in Türkiye?",
    quick: [{ title: "Yes, still planning", id: "YES" }, { title: "Maybe later", id: "LATER" }, { title: "Stop messages", id: "STOP" }] },
  { key: "orbuni_payment_help_btn", category: "UTILITY",
    body: "Hi {{1}}, it looks like your Orbuni checkout was not completed and nothing was charged. Would you like help finishing it?",
    quick: [{ title: "Help me pay", id: "PAY_HELP" }, { title: "I will do it later", id: "LATER" }] },
  { key: "orbuni_documents_needed_btn", category: "UTILITY",
    body: "Hi {{1}}, your Orbuni application is waiting for one or more documents. Please upload them in your portal under Documents so we can send your file to the university.",
    link: { title: "Upload documents", url: "https://myorbuni.com/" } },
  { key: "orbuni_offer_ready_btn", category: "UTILITY",
    body: "Hi {{1}}, good news: there is an update on your university application. Open your portal to see it, and reply here if you have any questions.",
    link: { title: "See the update", url: "https://myorbuni.com/" } },
  { key: "orbuni_welcome_btn", category: "UTILITY",
    body: "Hi {{1}}, this is Orbuni. Thanks for your interest in studying in Türkiye. Start with the free 2-minute assessment, or reply here with any question about universities, fees or scholarships.",
    link: { title: "Free assessment", url: "https://myorbuni.com/#start" } },
  // 8 Oct 2026: sent seconds after the assessment / a booked call (lead-instant)
  { key: "orbuni_required_docs", category: "UTILITY",
    body: "Hi {{1}}, thank you for completing the Orbuni assessment. Here is the checklist of documents needed for a {{2}} application: {{3}} Keep it handy and reply here if you have any questions.",
    vars: { "1": "Aisha", "2": "bachelor's degree", "3": "https://myorbuni.com/docs/Orbuni-Required-Documents-Bachelors.pdf" } },
  { key: "orbuni_call_booked", category: "UTILITY",
    body: "Hi {{1}}, your free call with Orbuni is booked for {{2}} (Türkiye time). Join with this Google Meet link: {{3}} Reply here if you need to change the time.",
    vars: { "1": "Aisha", "2": "Mon 13 Oct, 14:00", "3": "https://meet.google.com/abc-defg-hij" } },
  // 14 Oct 2026: the webinar (webinar-followups). Only to people who ticked the consent box on the sign-up form.
  { key: "orbuni_webinar_seat", category: "UTILITY",
    body: "Hi {{1}}, your seat for the free Orbuni scholarship webinar is saved. It starts {{2}}. Your personal seat link, with the join button and the countdown: {{3}} We will remind you before we start.",
    vars: { "1": "Aisha", "2": "Sat 6 Feb, 16:00 WAT (18:00 Türkiye)", "3": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_reminder", category: "UTILITY",
    body: "Hi {{1}}, a reminder: the Orbuni scholarship webinar starts {{2}}. Join from your seat page: {{3}} Bring your questions.",
    vars: { "1": "Aisha", "2": "in about one hour", "3": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_live", category: "UTILITY",
    body: "Hi {{1}}, the Orbuni scholarship webinar is live now. Join from your seat page: {{2}} See you inside.",
    vars: { "1": "Aisha", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_vip", category: "UTILITY",
    body: "Hi {{1}}, your VIP seat for the Orbuni webinar is confirmed. Create your free account at myorbuni.com with the email you paid with and the Scholarship Masterclass unlocks. Your seat: {{2}} Reply here with any question.",
    vars: { "1": "Aisha", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_vip_unpaid", category: "UTILITY",
    body: "Hi {{1}}, your VIP upgrade for the Orbuni webinar was not completed and nothing was charged. Your free seat is still saved. You can finish the upgrade from your seat page: {{2}} Reply here if the payment gave you trouble.",
    vars: { "1": "Aisha", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_replay", category: "MARKETING",
    body: "Hi {{1}}, we missed you at the Orbuni scholarship webinar. The replay is on your seat page: {{2}} Free seats keep it for 3 days. Reply STOP to opt out.",
    vars: { "1": "Aisha", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_next", category: "MARKETING",
    body: "Hi {{1}}, thank you for joining the Orbuni scholarship webinar. Your next step is the free 2-minute assessment, which skips the video: {{2}} Reply here with any question. Reply STOP to opt out.",
    vars: { "1": "Aisha", "2": "https://myorbuni.com/quiz" } },
  // 16 Oct 2026: the team alert, laid out properly (send-alerts uses it once approved, the old one until then)
  { key: "orbuni_team_alert_v2", category: "UTILITY",
    body: "*Orbuni · Team alert*\n\n*{{1}}*\n{{2}}\n\n*Who:* {{3}}\n*Next step:* {{4}}\n\nSent automatically by the Orbuni system.",
    vars: { "1": "A WhatsApp chat needs a reply", "2": "Reason: payment problem. Last message: \"My card was declined\"", "3": "Aisha Bello, +234 801 234 5678", "4": "Reply in the WhatsApp inbox, then press Done" },
    link: { title: "Open the team portal", url: "https://myorbuni.com/#portal=admin" } },
  // 22 Oct 2026: application updates for students and partners (sent by send-alerts on status changes).
  { key: "orbuni_application_update", category: "UTILITY",
    body: "*Orbuni · Application update*\n\nHello {{1}},\n\n*{{2}}*\n{{3}}\n\nYour counsellor is following your file. Open your portal for the details.",
    vars: { "1": "Aisha", "2": "Istinye University: offer received", "3": "Your offer letter is in your portal under My offers." },
    link: { title: "Open my portal", url: "https://myorbuni.com/#portal=student:track" } },
  { key: "orbuni_partner_update", category: "UTILITY",
    body: "*Orbuni · Partner update*\n\nHello {{1}},\n\n*{{2}}*\n{{3}}\n\nOpen the partner portal for the full file.",
    vars: { "1": "Lagos Study Hub", "2": "Aisha Bello · offer received", "3": "Istinye University sent the offer letter. The next step is the deposit." },
    link: { title: "Open the partner portal", url: "https://myorbuni.com/#portal=partner:home" } },
  // 22 Oct 2026: French and Arabic versions of the webinar messages. webinar-followups uses "<key>_fr" / "<key>_ar"
  // for people who signed up in that language (or from a French / Arabic speaking country), once Meta approves them.
  { key: "orbuni_webinar_seat_fr", category: "UTILITY", lang: "fr",
    body: "Bonjour {{1}}, votre place pour le webinaire gratuit d'Orbuni sur les bourses est réservée. Il commence {{2}}. Votre lien personnel, avec le bouton pour rejoindre et le compte à rebours : {{3}} Nous vous enverrons un rappel avant le début.",
    vars: { "1": "Aminata", "2": "sam. 6 févr., 16:00 WAT (18:00 Turquie)", "3": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_seat_ar", category: "UTILITY", lang: "ar",
    body: "مرحباً {{1}}، تم حجز مقعدك في ندوة Orbuni المجانية عن المنح الدراسية. تبدأ الندوة {{2}}. رابط مقعدك الشخصي مع زر الدخول والعدّ التنازلي: {{3}} سنذكّرك قبل البدء.",
    vars: { "1": "أحمد", "2": "السبت 6 فبراير، 16:00 بتوقيت غرب أفريقيا (18:00 بتوقيت تركيا)", "3": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_reminder_fr", category: "UTILITY", lang: "fr",
    body: "Bonjour {{1}}, petit rappel : le webinaire d'Orbuni sur les bourses commence {{2}}. Rejoignez-le depuis votre page : {{3}} Préparez vos questions.",
    vars: { "1": "Aminata", "2": "dans environ une heure", "3": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_reminder_ar", category: "UTILITY", lang: "ar",
    body: "مرحباً {{1}}، تذكير: ندوة Orbuni عن المنح الدراسية تبدأ {{2}}. ادخل من صفحة مقعدك: {{3}} جهّز أسئلتك.",
    vars: { "1": "أحمد", "2": "بعد ساعة تقريباً", "3": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_live_fr", category: "UTILITY", lang: "fr",
    body: "Bonjour {{1}}, le webinaire d'Orbuni sur les bourses est en direct maintenant. Rejoignez-le depuis votre page : {{2}} À tout de suite.",
    vars: { "1": "Aminata", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_live_ar", category: "UTILITY", lang: "ar",
    body: "مرحباً {{1}}، ندوة Orbuni عن المنح الدراسية مباشرة الآن. ادخل من صفحة مقعدك: {{2}} نراك هناك.",
    vars: { "1": "أحمد", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_vip_fr", category: "UTILITY", lang: "fr",
    body: "Bonjour {{1}}, votre place VIP pour le webinaire d'Orbuni est confirmée. Créez votre compte gratuit sur myorbuni.com avec l'e-mail utilisé pour payer et la Masterclass Bourses se débloque. Votre place : {{2}} Répondez ici pour toute question.",
    vars: { "1": "Aminata", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_vip_ar", category: "UTILITY", lang: "ar",
    body: "مرحباً {{1}}، تم تأكيد مقعد VIP الخاص بك في ندوة Orbuni. أنشئ حسابك المجاني على myorbuni.com بالبريد الذي دفعت به وسيُفتح لك ماستركلاس المنح. مقعدك: {{2}} راسلنا هنا لأي سؤال.",
    vars: { "1": "أحمد", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_vip_unpaid_fr", category: "UTILITY", lang: "fr",
    body: "Bonjour {{1}}, votre passage en VIP pour le webinaire d'Orbuni n'a pas été finalisé et rien n'a été débité. Votre place gratuite reste réservée. Vous pouvez terminer depuis votre page : {{2}} Répondez ici si le paiement vous a posé problème.",
    vars: { "1": "Aminata", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_vip_unpaid_ar", category: "UTILITY", lang: "ar",
    body: "مرحباً {{1}}، لم تكتمل ترقيتك إلى VIP في ندوة Orbuni ولم يُخصم أي مبلغ. مقعدك المجاني ما زال محجوزاً. يمكنك إكمال الترقية من صفحة مقعدك: {{2}} راسلنا هنا إن واجهت مشكلة في الدفع.",
    vars: { "1": "أحمد", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_replay_fr", category: "MARKETING", lang: "fr",
    body: "Bonjour {{1}}, vous n'avez pas pu assister au webinaire d'Orbuni sur les bourses. La rediffusion est sur votre page : {{2}} Les places gratuites la gardent 3 jours. Répondez STOP pour ne plus recevoir de messages.",
    vars: { "1": "Aminata", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_replay_ar", category: "MARKETING", lang: "ar",
    body: "مرحباً {{1}}، فاتتك ندوة Orbuni عن المنح الدراسية. التسجيل متاح في صفحة مقعدك: {{2}} يبقى متاحاً للمقاعد المجانية 3 أيام. أرسل STOP لإيقاف الرسائل.",
    vars: { "1": "أحمد", "2": "https://myorbuni.com/s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" } },
  { key: "orbuni_webinar_next_fr", category: "MARKETING", lang: "fr",
    body: "Bonjour {{1}}, merci d'avoir participé au webinaire d'Orbuni sur les bourses. Prochaine étape : l'évaluation gratuite de 2 minutes, sans la vidéo : {{2}} Répondez ici pour toute question. Répondez STOP pour ne plus recevoir de messages.",
    vars: { "1": "Aminata", "2": "https://myorbuni.com/quiz" } },
  { key: "orbuni_webinar_next_ar", category: "MARKETING", lang: "ar",
    body: "مرحباً {{1}}، شكراً لحضورك ندوة Orbuni عن المنح الدراسية. خطوتك التالية هي التقييم المجاني في دقيقتين، دون الفيديو: {{2}} راسلنا هنا لأي سؤال. أرسل STOP لإيقاف الرسائل.",
    vars: { "1": "أحمد", "2": "https://myorbuni.com/quiz" } },
  // 15 Oct 2026: video versions (a short video on top, one button). Senders prefer "<key>_vid" once Meta approves it.
  { key: "orbuni_quiz_followup_vid", category: "MARKETING", media: VID + "webinar_invite.mp4", footer: "Reply STOP to opt out",
    body: "Hi {{1}}, thanks for taking the Orbuni study assessment. This short video explains our free live scholarship webinar: how international students win 25% to 100% scholarships at universities in Türkiye.",
    link: { title: "Save my free seat", url: "https://myorbuni.com/webinar" } },
  { key: "orbuni_checkin_vid", category: "MARKETING", media: VID + "assessment.mp4", footer: "Reply STOP to opt out",
    body: "Hi {{1}}, it is Orbuni checking in. Are you still planning to study in Türkiye? This short video shows how to see where you stand in two minutes.",
    link: { title: "Start the assessment", url: "https://myorbuni.com/quiz" } },
  { key: "orbuni_webinar_vip_vid", category: "MARKETING", media: VID + "vip_offer.mp4", footer: "Reply STOP to opt out",
    body: "Hi {{1}}, your free seat for the Orbuni scholarship webinar is saved. Want a head start? This short video shows what the 10 dollar VIP seat adds. Your free seat stays either way.",
    vars: { "1": "Aisha", "2": "3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" },
    link: { title: "See the VIP seat", url: "https://myorbuni.com/s/{{2}}" } },
  // 23 Oct 2026: poster versions of the key messages (a branded poster on top, a structured message,
  // one button, "Reply STOP" footer; the team alert says "Orbuni team alerts" instead). Senders prefer "<key>_card" once Meta approves it.
  // Same variables as the plain template, except that a link variable carries only the part after the
  // button's fixed address (e.g. "s/<token>" for https://myorbuni.com/s/<token>) — see cardVars() in the senders.
  ...([
    ["orbuni_required_docs_card", "UTILITY", "required_docs",
      "📋 *Your document checklist is ready, {{1}}*\n\nFor a *{{2}}* application in Türkiye, here is what to prepare:\n✅ Passport\n✅ Certificates and transcripts\n✅ Photo and supporting papers\n\nThe full checklist is one tap away. Keep it handy, and reply here with any question.",
      { "1": "Aisha", "2": "bachelor's degree", "3": "docs/Orbuni-Required-Documents-Bachelors.pdf" }, { title: "Open my checklist", url: "https://myorbuni.com/{{3}}" }],
    ["orbuni_call_booked_card", "UTILITY", "call_booked",
      "✅ *Your free call is booked, {{1}}!*\n\n📅 {{2}} (Türkiye time)\n⏱ 30 minutes with the Orbuni team\n💻 Google Meet, on your phone or laptop\n\nBring your questions about universities, fees and scholarships. Need another time? Just reply here.",
      { "1": "Aisha", "2": "Mon 13 Oct, 14:00", "3": "abc-defg-hij" }, { title: "Join Google Meet", url: "https://meet.google.com/{{3}}" }],
    ["orbuni_webinar_seat_card", "UTILITY", "webinar_seat",
      "🎓 *Your seat is saved, {{1}}!*\n\n*Orbuni Scholarship Webinar*\n📅 {{2}}\n📍 Online, from your personal seat page\n\n*In this free live session:*\n✅ How international students win 25% to 100% scholarships in Türkiye\n✅ Real fees and real examples\n✅ Your questions, answered live\n\nWe will remind you before we start. Tap below to see your seat and the countdown.",
      { "1": "Aisha", "2": "Sat 6 Feb, 16:00 WAT (18:00 Türkiye)", "3": "s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" }, { title: "Open my seat", url: "https://myorbuni.com/{{3}}" }],
    ["orbuni_webinar_reminder_card", "UTILITY", "webinar_reminder",
      "⏰ *Reminder, {{1}}: the webinar starts {{2}}*\n\n*Orbuni Scholarship Webinar*\n📍 Online, from your seat page\n\nCome ready with your questions on:\n✅ Scholarships of 25% to 100%\n✅ Fees and living costs\n✅ How to apply\n\nTap below to open your seat.",
      { "1": "Aisha", "2": "in about one hour", "3": "s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" }, { title: "Open my seat", url: "https://myorbuni.com/{{3}}" }],
    ["orbuni_webinar_live_card", "UTILITY", "webinar_live",
      "🔴 *We are LIVE now, {{1}}!*\n\nThe Orbuni Scholarship Webinar has started.\n\n✅ Scholarships explained\n✅ Real fees, real examples\n✅ Live questions\n\nTap below to take your seat. See you inside!",
      { "1": "Aisha", "2": "s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" }, { title: "Join now", url: "https://myorbuni.com/{{2}}" }],
    ["orbuni_webinar_replay_card", "MARKETING", "webinar_replay",
      "🎬 *Missed it, {{1}}? The replay is ready.*\n\nThe full Orbuni Scholarship Webinar is waiting on your seat page.\n\n✅ Watch at your own pace\n✅ Pause and take notes\n⚠️ Free seats keep the replay for 3 days\n\nTap below to watch now.",
      { "1": "Aisha", "2": "s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" }, { title: "Watch the replay", url: "https://myorbuni.com/{{2}}" }],
    ["orbuni_webinar_next_card", "MARKETING", "webinar_next",
      "🙌 *Thank you for joining, {{1}}!*\n\nYour next step takes 2 minutes: the free Orbuni assessment.\n\n✅ See the universities that fit you\n✅ See the scholarships you can aim for\n✅ Get a clear next step\n\nTap below to start.",
      { "1": "Aisha", "2": "quiz" }, { title: "Start the assessment", url: "https://myorbuni.com/{{2}}" }],
    ["orbuni_webinar_vip_card", "UTILITY", "webinar_vip",
      "🌟 *You are in, {{1}}! Your VIP seat is confirmed.*\n\n*What you get:*\n✅ Your VIP seat at the webinar\n✅ The Scholarship Masterclass\n\n*One step to unlock it:* create your free account at myorbuni.com with the email you paid with.\n\nTap below to open your seat.",
      { "1": "Aisha", "2": "s/3f9a1c2e7b8d4e6f9a0b1c2d3e4f5a6b7c8d9e0f1a" }, { title: "Open my seat", url: "https://myorbuni.com/{{2}}" }],
    ["orbuni_offer_ready_card", "UTILITY", "offer_ready",
      "🎉 *Good news, {{1}}!*\n\nThere is an update on your university application.\n\n✅ Open your portal to see it\n✅ Read your next steps\n✅ Reply here with any question\n\nYour counsellor is following your file.",
      { "1": "Aisha" }, { title: "See the update", url: "https://myorbuni.com/#portal=student:track" }],
    ["orbuni_documents_needed_card", "UTILITY", "documents_needed",
      "📎 *One step left, {{1}}*\n\nYour Orbuni application is waiting for one or more documents.\n\n1️⃣ Open your portal\n2️⃣ Go to *Documents*\n3️⃣ Upload, and we send your file to the university\n\nNeed help? Just reply here.",
      { "1": "Aisha" }, { title: "Upload documents", url: "https://myorbuni.com/#portal=student:docs" }],
    ["orbuni_payment_received_card", "UTILITY", "payment_received",
      "✅ *Payment received. Thank you, {{1}}!*\n\n💳 {{2}}\n🎓 {{3}}\n\n✅ Your receipt is in your email\n✅ Your Orbuni portal is already updated\n✅ Your counsellor has been told\n\nQuestions about this payment? Reply here.",
      { "1": "Aisha", "2": "$10.00", "3": "The Scholarship Masterclass" }, { title: "Open my portal", url: "https://myorbuni.com/" }],
    // the team and partners: same variables as orbuni_team_alert_v2 / orbuni_application_update / orbuni_partner_update
    ["orbuni_team_alert_card", "UTILITY", "team_alert",
      "🔔 *Orbuni team alert*\n\n*{{1}}*\n{{2}}\n\n👤 *Who:* {{3}}\n➡️ *Next step:* {{4}}\n\nSent automatically by the Orbuni system.",
      { "1": "A WhatsApp chat needs a reply", "2": "Reason: payment problem. Last message: \"My card was declined\"", "3": "Aisha Bello, +234 801 234 5678", "4": "Reply in the WhatsApp inbox, then press Done" },
      { title: "Open the team portal", url: "https://myorbuni.com/#portal=admin" }],
    ["orbuni_application_update_card", "UTILITY", "offer_ready",
      "📬 *Application update for you, {{1}}*\n\n*{{2}}*\n{{3}}\n\n✅ Your counsellor is following your file\n✅ The details are in your portal\n\nQuestions? Just reply here.",
      { "1": "Aisha", "2": "Istinye University: offer received", "3": "Your offer letter is in your portal under My offers." },
      { title: "Open my portal", url: "https://myorbuni.com/#portal=student:track" }],
    ["orbuni_partner_update_card", "UTILITY", "partner_update",
      "🤝 *Partner update for {{1}}*\n\n*{{2}}*\n{{3}}\n\n✅ The full file is in your partner portal\n✅ Your Orbuni contact is on it\n\nQuestions about this student? Reply here.",
      { "1": "Lagos Study Hub", "2": "Aisha Bello · offer received", "3": "Istinye University sent the offer letter. The next step is the deposit." },
      { title: "Open the partner portal", url: "https://myorbuni.com/#portal=partner:home" }],
    // 24 Oct 2026: poster messages the team sends from the WhatsApp inbox (first name only; the poster rotates)
    ["orbuni_scholarship_tips_card", "MARKETING", "webinar_next",
      "🎓 *How scholarships in Türkiye really work, {{1}}*\n\nAt most private universities a scholarship is a discount on the published fee, from 25% up to 100%.\n\n✅ Stronger results, higher band\n✅ Apply early, while places are open\n✅ A complete file the first time\n\nTap below for the full guide.",
      { "1": "Aisha" }, { title: "Read the guide", url: "https://myorbuni.com/articles/how-turkish-scholarships-work/" }],
    ["orbuni_next_intake_card", "MARKETING", "offer_ready",
      "📣 *Ready for the next intake, {{1}}?*\n\nThe best scholarship places go to students who start early.\n\n1️⃣ Free 2-minute assessment\n2️⃣ Your shortlist and scholarship options\n3️⃣ Documents ready, application sent\n\nApplying is free.",
      { "1": "Aisha" }, { title: "Start the assessment", url: "https://myorbuni.com/#start" }],
    ["orbuni_visa_tips_card", "MARKETING", "required_docs",
      "🛂 *Your student visa file, {{1}}*\n\nThe consulate decides, but the file is yours to get right:\n\n✅ Valid passport\n✅ Acceptance letter\n✅ Steady proof of funds\n✅ Names that match on every document\n\nYour counsellor checks it all before you go.",
      { "1": "Aisha" }, { title: "Read the visa guide", url: "https://myorbuni.com/articles/nigerian-student-visa-refusals/" }],
    ["orbuni_arrival_card", "UTILITY", "welcome",
      "✈️ *Getting ready to fly, {{1}}?*\n\n✅ Send us your flight details\n✅ Originals in your hand luggage\n✅ Your first nights' stay sorted\n✅ Airport pickup, if you booked it\n\nDates changed? Just reply here.",
      { "1": "Aisha" }, { title: "Open my portal", url: "https://myorbuni.com/#portal=student" }],
    ["orbuni_reengage_card", "MARKETING", "call_booked",
      "👋 *Still planning to study abroad, {{1}}?*\n\nPlans change, and that is fine. If Türkiye is still on your mind, the next step takes two minutes and costs nothing.\n\nPrefer to talk? Reply with a good time and a counsellor will call you.",
      { "1": "Aisha" }, { title: "See where I stand", url: "https://myorbuni.com/#start" }],
    ["orbuni_referral_card", "MARKETING", "partner_update",
      "🤝 *Know someone who wants to study in Türkiye, {{1}}?*\n\nSend them our free assessment. They get the same honest advice you did, and a real counsellor they can message any time.",
      { "1": "Aisha" }, { title: "Get the link", url: "https://myorbuni.com/" }],
    ["orbuni_webinar_invite_card", "MARKETING", "webinar_seat",
      "🎓 *A free seat for you, {{1}}*\n\nOur live webinar: how international students win 25% to 100% scholarships in Türkiye.\n\n✅ Real fees, real examples\n✅ Questions answered live\n✅ Free",
      { "1": "Aisha" }, { title: "Save my free seat", url: "https://myorbuni.com/webinar" }],
    ["orbuni_housing_card", "MARKETING", "welcome",
      "🏠 *Student housing in Istanbul, {{1}}*\n\nResidences near your university, for male, female and mixed students, with photos and what each one includes.\n\nYour counsellor helps you book once you have your offer.",
      { "1": "Aisha" }, { title: "See residences", url: "https://myorbuni.com/housing/" }],
  ] as [string, "UTILITY" | "MARKETING", string, string, Record<string, string>, Btn][]).map(([key, category, img, body, vars, link]) => {
    // 24 Oct 2026 (posters v3): the poster is a variable at the end of the image address, the next number
    // after the message's own variables, so senders can rotate the three designs ("<img>_1.jpg" .. "_3.jpg").
    // Submitted to Meta as "<key>3": the first poster versions (same keys, fixed older images) are retired.
    const n = String(Math.max(...Object.keys(vars).map(Number)) + 1);
    return { key, metaName: key + "3", category, body, vars: { ...vars, [n]: img + "_1.jpg" }, link, media: IMG + "{{" + n + "}}",
      footer: key === "orbuni_team_alert_card" ? "Orbuni team alerts" : "Reply STOP to unsubscribe" };
  }),
];
function typesFor(t: typeof TEMPLATES[number]) {
  if (t.media) return { "twilio/card": { title: t.body, ...(t.footer ? { subtitle: t.footer } : {}), media: [t.media],
    actions: t.link ? [{ type: "URL", title: t.link.title, url: t.link.url }] : (t.quick || []).map((q) => ({ type: "QUICK_REPLY", title: q.title, id: q.id || q.title })) } };
  if (t.quick) return { "twilio/quick-reply": { body: t.body, actions: t.quick.map((q) => ({ title: q.title, id: q.id || q.title })) } };
  if (t.link) return { "twilio/call-to-action": { body: t.body, actions: [{ type: "URL", title: t.link.title, url: t.link.url }] } };
  return { "twilio/text": { body: t.body } };
}

async function tw(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { ...AUTH, ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

Deno.serve(async (req) => {
  if ((req.headers.get("x-orb-secret") || "") !== CRON || !CRON) return json(403, { error: "forbidden" });
  const db = sb();
  const { data: rows } = await db.from("wa_templates").select("*");
  const have: Record<string, any> = {};
  for (const r of rows || []) have[r.key] = r;
  const report: any[] = [];

  for (const t of TEMPLATES) {
    let row = have[t.key];
    // 1. create the content in Twilio once
    if (!row?.content_sid) {
      const c = await tw("https://content.twilio.com/v1/Content", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendly_name: t.metaName || t.key, language: t.lang || "en", variables: t.vars || { "1": "Aisha" }, types: typesFor(t) }),
      });
      if (!c.ok) { report.push({ key: t.key, step: "create", error: c.j.message || c.status }); continue; }
      row = { key: t.key, content_sid: c.j.sid, approval: "not_submitted", body: t.body };
      await db.from("wa_templates").upsert({ ...row, updated_at: new Date().toISOString() });
    }
    // 2. submit to Meta once
    if (row.approval === "not_submitted") {
      const s = await tw(`https://content.twilio.com/v1/Content/${row.content_sid}/ApprovalRequests/whatsapp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: t.metaName || t.key, category: t.category }),
      });
      if (!s.ok) { report.push({ key: t.key, step: "submit", error: s.j.message || s.status }); continue; }
      row.approval = "received";
      await db.from("wa_templates").update({ approval: "received", updated_at: new Date().toISOString() }).eq("key", t.key);
    }
    // 3. read Meta's decision
    const a = await tw(`https://content.twilio.com/v1/Content/${row.content_sid}/ApprovalRequests`);
    const st = String(a.j?.whatsapp?.status || row.approval || "").toLowerCase();
    const why = a.j?.whatsapp?.rejection_reason || null;
    if (st && st !== row.approval) {
      await db.from("wa_templates").update({ approval: st, updated_at: new Date().toISOString() }).eq("key", t.key);
    }
    report.push({ key: t.key, approval: st, ...(why ? { why } : {}) });
  }
  return json(200, { templates: report });
});

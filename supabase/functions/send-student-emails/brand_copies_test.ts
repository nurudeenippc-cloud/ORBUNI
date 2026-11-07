// deno test --allow-env supabase/functions/send-student-emails/brand_copies_test.ts
// brand.ts (and mail.ts for the composer) live here; the other email functions carry copies,
// because each function deploys on its own. These tests fail the build if a copy drifts.
import { assertEquals } from "jsr:@std/assert@1";
import * as main from "./brand.ts";
import * as alerts from "../send-alerts/brand.ts";
import * as receipts from "../payment-receipts/brand.ts";
import * as composer from "../send-manual-email/brand.ts";
import { render as mainRender, BODIES } from "./mail.ts";
import { render as composerRender } from "../send-manual-email/mail.ts";

const sample = (b: typeof main) => [
  ...(["student", "partner", "team"] as const).map(a => b.shell("pre", "<tr><td>x</td></tr>", a)),
  ...["welcome", "status_change", "partner_update", "team_alert", "payment_receipt", "nothing"].map(t => b.withHero(t, "<!--HERO-->")),
  b.kick("Label"), b.kick("Label", "#127A52", "#EAF7F1"), b.h1("Title"), b.button("Go", "https://myorbuni.com"), b.panel("text"),
];

for (const [name, copy] of [["send-alerts", alerts], ["payment-receipts", receipts], ["send-manual-email", composer]] as const) {
  Deno.test(`${name}/brand.ts is the same as send-student-emails/brand.ts`, () => {
    assertEquals(sample(copy), sample(main));
  });
}

Deno.test("send-manual-email/mail.ts renders every template like send-student-emails/mail.ts", () => {
  const v = { first_name: "Aisha", university: "Istinye University", programme: "Medicine", status: "Sent", subject: "Hello", body: "Text" };
  for (const k of Object.keys(BODIES)) assertEquals(composerRender(k, v), mainRender(k, v));
});

Deno.test("key emails carry their poster, the rest do not", () => {
  const welcome = mainRender("welcome", { first_name: "Aisha" })!.html;
  if (!/\/site\/img\/email\/welcome_[1-3]\.jpg/.test(welcome)) throw new Error("welcome email lost its poster");
  if (!welcome.includes("Follow Orbuni") || !welcome.includes("soc_instagram.png")) throw new Error("welcome email lost its social links");
  const custom = mainRender("custom_notice", { first_name: "Aisha", subject: "Hi", body: "x" })!.html;
  if (/\/site\/img\/email\/\w+\.jpg/.test(custom)) throw new Error("custom_notice should have no poster");
  if (custom.includes("<!--HERO-->")) throw new Error("the poster placeholder leaked into the email");
});

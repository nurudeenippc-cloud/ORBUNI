// deno test --allow-env supabase/functions/_wa/wa_test.ts
// Pure helpers only: no network, no database. wa.ts reads its secrets when it is
// imported, so the token is set before the dynamic import below.
import { assert, assertEquals } from "jsr:@std/assert@1";

Deno.env.set("TWILIO_AUTH_TOKEN", "test-token");
const wa = await import("./wa.ts");

Deno.test("twilioSignature matches Twilio's published example", async () => {
  // https://www.twilio.com/docs/usage/security#validating-requests
  const sig = await wa.twilioSignature("12345", "https://mycompany.com/myapp.php?foo=1&bar=2", {
    CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234", From: "+12349013030", To: "+18005551212",
  });
  assertEquals(sig, "0/KCTR6DLpKmkAf8muzZqo1nDgQ=");
});

Deno.test("twilioValid accepts a correctly signed webhook and rejects a tampered one", async () => {
  const params = { From: "whatsapp:+2348012345678", Body: "Hello", MessageSid: "SM123" };
  const good = await wa.twilioSignature("test-token", wa.WEBHOOK_URL, params);
  const req = (sig: string) => new Request(wa.WEBHOOK_URL, { method: "POST", headers: { "x-twilio-signature": sig } });
  assert(await wa.twilioValid(req(good), params));
  assert(!(await wa.twilioValid(req(good), { ...params, Body: "Hello!" })), "changed body must fail");
  assert(!(await wa.twilioValid(req(""), params)), "missing signature must fail");
  assert(!(await wa.twilioValid(req(good.slice(0, -2) + "AA"), params)), "altered signature must fail");
});

Deno.test("sameText compares exactly", () => {
  assert(wa.sameText("abc", "abc"));
  assert(!wa.sameText("abc", "abd"));
  assert(!wa.sameText("abc", "abcd"));
  assert(wa.sameText("", ""));
});

Deno.test("e164 normalises WhatsApp and local formats", () => {
  assertEquals(wa.e164("whatsapp:+2348012345678"), "+2348012345678");
  assertEquals(wa.e164("+234 801-234 5678"), "+2348012345678");
  assertEquals(wa.e164("WhatsApp:+90 532 000 0000"), "+905320000000");
  assertEquals(wa.e164(""), "");
  assertEquals(wa.e164("no digits"), "");
});

/**
 * Conversation scripts for demo mode and the demo seed. Each is a realistic
 * Focus Realm outbound call, written so the call analyser has something real
 * to score: good discovery in some, missed openings and fumbled objections in
 * others. Placeholders: {rep} {prospect} {first} {company} {city}.
 */

export type Line = ["rep" | "prospect", string];

export interface Script {
  key: string;
  outcome: string;
  lines: Line[];
}

export const SCRIPTS: Script[] = [
  {
    key: "meeting_booked_strong",
    outcome: "meeting_booked",
    lines: [
      ["prospect", "Hello?"],
      ["rep", "Hi {first}, this is {rep} from Focus Realm. I'll be quick — is this an okay moment for two minutes?"],
      ["prospect", "Uh, yeah, go ahead. Two minutes."],
      ["rep", "Thanks. We build custom software and AI automation for growing companies in {city}. I noticed {company} has been hiring a lot of operations staff — how are you handling order tracking and follow-ups today?"],
      ["prospect", "Honestly, mostly Excel and WhatsApp groups. It's getting messy, we lose track of things."],
      ["rep", "When you say you lose track — what does that cost you? Missed orders, delayed payments?"],
      ["prospect", "Both. Last quarter we had maybe fifteen orders delayed because nobody updated the sheet. Clients were not happy."],
      ["rep", "Fifteen delayed orders in a quarter — and if that continues while you scale, what happens?"],
      ["prospect", "It gets worse. We're planning to double the team by March."],
      ["rep", "That makes sense. Who else would be involved in deciding on a system like this?"],
      ["prospect", "Me and our MD, Mr. Kapoor. He signs off on anything above five lakhs."],
      ["rep", "Got it. Is there a budget set aside for operations tooling this year?"],
      ["prospect", "We had kept something for an ERP, but the ones we saw were too generic."],
      ["rep", "That's exactly where we fit — we build around how your team already works. Would it be useful to see how we did this for a similar distributor? Our Legion team can walk you and Mr. Kapoor through it."],
      ["prospect", "Yes, that would be useful. Can we do Thursday?"],
      ["rep", "Thursday at 4 PM works. I'll send an invite to you and Mr. Kapoor. Anything specific you'd want us to cover?"],
      ["prospect", "Mainly the order tracking and the payment reminders."],
      ["rep", "Perfect. Order tracking and payment reminders, Thursday 4 PM. Thank you, {first} — speak soon."],
    ],
  },
  {
    key: "follow_up_send_info",
    outcome: "follow_up_agreed",
    lines: [
      ["prospect", "Haan, hello?"],
      ["rep", "Hello {first} ji, {rep} here from Focus Realm. Do you have a minute?"],
      ["prospect", "Who? Focus what?"],
      ["rep", "Focus Realm — we do software development. Websites, apps, CRMs, automation, everything."],
      ["prospect", "We already have a website."],
      ["rep", "Okay, but we also do apps and CRMs and AI. We have worked with many companies."],
      ["prospect", "Look, I'm in the middle of something. Can you just send me the details on email?"],
      ["rep", "Sure sure, I will send. What is your email?"],
      ["prospect", "It's on our website. Info at {company} dot com."],
      ["rep", "Okay, I'll send it. Can I call you next week?"],
      ["prospect", "Fine, call next Wednesday. After lunch."],
      ["rep", "Okay, Wednesday after lunch. Thank you."],
    ],
  },
  {
    key: "price_objection_handled",
    outcome: "interested",
    lines: [
      ["prospect", "Yes, {first} speaking."],
      ["rep", "Hi {first}, it's {rep} from Focus Realm — we spoke last week about automating your dealer onboarding. Is now still a good time?"],
      ["prospect", "Yes, I looked at the brochure. Honestly, it looks expensive for us."],
      ["rep", "I appreciate you being direct. When you say expensive — expensive compared to what you're spending today, or compared to what you expected?"],
      ["prospect", "Compared to what I expected. We thought something like this would be one or two lakhs."],
      ["rep", "That's fair. Can I ask — how many hours does your team spend on dealer onboarding each week right now?"],
      ["prospect", "Three people, maybe half their week. Paperwork, KYC, calling dealers back."],
      ["rep", "So roughly sixty hours a week. If we brought that down to fifteen, what would those three people do instead?"],
      ["prospect", "They'd go back to sales support. That's what they were hired for."],
      ["rep", "Then the comparison is less about the price of the software and more about getting a sales support team back. We can also phase it — start with KYC automation, which is the biggest time sink."],
      ["prospect", "Phasing could work. I'd need to see numbers."],
      ["rep", "Absolutely. I'll have our team prepare a phased estimate. Would you be open to a session with our Legion team to go through it?"],
      ["prospect", "Yes, but first send me the phased numbers."],
      ["rep", "Done — numbers by Friday, and I'll call you Monday to set up the session."],
    ],
  },
  {
    key: "not_interested_competitor",
    outcome: "not_interested",
    lines: [
      ["prospect", "Hello."],
      ["rep", "Hi, am I speaking with {first}?"],
      ["prospect", "Yes."],
      ["rep", "This is {rep} from Focus Realm, we are a software company and we wanted to know if you need any software."],
      ["prospect", "No, we're already working with another vendor. They built our app last year."],
      ["rep", "Oh okay. But we are better and cheaper."],
      ["prospect", "We're happy with them. Thanks."],
      ["rep", "Okay sir, if you need anything in the future please call us."],
      ["prospect", "Sure. Bye."],
    ],
  },
  {
    key: "callback_busy",
    outcome: "callback_requested",
    lines: [
      ["prospect", "Hello, I'm driving right now."],
      ["rep", "Oh, sorry {first}! This is {rep} from Focus Realm — when's a better time to call you?"],
      ["prospect", "Call me tomorrow morning, around eleven."],
      ["rep", "Tomorrow at eleven. Drive safe — talk then."],
    ],
  },
  {
    key: "discovery_weak",
    outcome: "follow_up_agreed",
    lines: [
      ["prospect", "Hello, {company}."],
      ["rep", "Hi, can I speak to {first}?"],
      ["prospect", "Speaking."],
      ["rep", "Hi {first}, {rep} from Focus Realm. We build custom software. So basically we make CRMs, ERPs, mobile apps, websites, AI chatbots, WhatsApp automation, dashboards, inventory systems, billing systems and also we do UI UX design and cloud hosting and maintenance."],
      ["prospect", "Okay... and?"],
      ["rep", "So we wanted to know if you are interested in any of these."],
      ["prospect", "I mean, maybe the inventory thing. We have some problems with stock mismatch."],
      ["rep", "Yes, our inventory system is very good, it has barcode scanning, reports, multi-warehouse, everything."],
      ["prospect", "How much does it cost?"],
      ["rep", "It depends, starting from around three lakhs."],
      ["prospect", "Hmm. Let me think about it. Call me after two weeks."],
      ["rep", "Okay, I'll call after two weeks."],
    ],
  },
  {
    key: "meeting_booked_authority",
    outcome: "meeting_booked",
    lines: [
      ["prospect", "Good afternoon."],
      ["rep", "Good afternoon {first}, this is {rep} with Focus Realm. I'm calling because a lot of clinics in {city} have told us patient follow-ups are slipping through the cracks — is that something you see at {company}?"],
      ["prospect", "Follow-ups, yes. Patients don't come back for reviews and nobody calls them."],
      ["rep", "How are reminders handled now?"],
      ["prospect", "Front desk tries to call, but they're busy with walk-ins."],
      ["rep", "What would it mean for you if every patient got an automatic WhatsApp reminder and a booking link?"],
      ["prospect", "More repeat visits for sure. Maybe ten, fifteen percent more."],
      ["rep", "Who decides on something like this — you, or the clinic owners together?"],
      ["prospect", "Dr. Mehta decides. I run operations."],
      ["rep", "Would Dr. Mehta be open to a short session with our Legion team if you sit in as well? We'd show the reminder flow live."],
      ["prospect", "I think so. Let me check her calendar — maybe Monday morning."],
      ["rep", "Monday morning is great. I'll send a tentative invite for 10:30 and you can move it if needed."],
      ["prospect", "Okay, send it."],
    ],
  },
  {
    key: "wrong_number",
    outcome: "wrong_number",
    lines: [
      ["prospect", "Hello?"],
      ["rep", "Hi, is this {first} from {company}?"],
      ["prospect", "No, wrong number. There's no one by that name here."],
      ["rep", "Sorry for the trouble. Have a good day."],
    ],
  },
];

export function scriptFor(outcome: string, seed = 0): Script | null {
  const matches = SCRIPTS.filter((s) => s.outcome === outcome);
  if (!matches.length) return null;
  return matches[seed % matches.length];
}

export interface Utterance {
  speaker: string;
  role?: "rep" | "prospect";
  start: number;
  end: number;
  text: string;
}

/** Turns a script into a timed transcript, filling the placeholders. */
export function renderScript(
  script: Script,
  vars: { rep: string; prospect: string; company: string; city: string },
): { utterances: Utterance[]; duration: number } {
  const first = vars.prospect.split(" ")[0];
  const fill = (t: string) =>
    t.replace(/\{rep\}/g, vars.rep.split(" ")[0]).replace(/\{prospect\}/g, vars.prospect).replace(/\{first\}/g, first)
      .replace(/\{company\}/g, vars.company).replace(/\{city\}/g, vars.city);
  let t = 1.2;
  const utterances: Utterance[] = script.lines.map(([who, text]) => {
    const filled = fill(text);
    const secs = Math.max(1.2, filled.split(/\s+/).length / 2.6);
    const u = { speaker: who === "rep" ? "A" : "B", role: who, start: +t.toFixed(1), end: +(t + secs).toFixed(1), text: filled };
    t += secs + 0.6;
    return u;
  });
  return { utterances, duration: Math.round(t) };
}

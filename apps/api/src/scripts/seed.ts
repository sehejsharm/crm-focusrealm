import { connect, db, json, migrate } from "../db/index.js";
import { hashPassword } from "../lib/auth.js";
import { phoneKey } from "../lib/phone.js";
import { addDays, dayBounds, todayLocal } from "../lib/time.js";
import { heuristicAnalysis, heuristicDailyReport } from "../services/analysis-heuristic.js";
import { persistAnalysis } from "../services/analysis.js";
import { computeMetrics } from "../services/reports.js";
import { putSetting } from "../services/settings.js";
import { renderScript, SCRIPTS } from "../seed/scripts.js";

/**
 * Demo data: a believable Focus Realm sales floor — founders, a sales head,
 * five salespeople, two Legion members, ~200 prospects and two weeks of calls
 * with transcripts, coaching and daily reports. Everything is fictional and
 * marked source = 'seed'. The analyses here are rule-based (no AI calls), so
 * seeding is free and offline. Telephony is set to demo mode, so pressing
 * Call never dials a real number.
 *
 *   npm run seed            seed an empty database
 *   npm run seed -- --force wipe CRM tables first (destroys data!)
 */

export const DEMO_PASSWORD = "focus-realm-demo";

// Deterministic randomness so every seed looks the same.
let s = 20261014;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const PEOPLE = [
  { code: "FR-0001", name: "Aarav Mehta", role: "founder", title: "Co-founder & CEO", email: "aarav@focusrealm.example", hue: 214 },
  { code: "FR-0002", name: "Kavya Rao", role: "founder", title: "Co-founder & COO", email: "kavya@focusrealm.example", hue: 228 },
  { code: "FR-0010", name: "Rohan Kapoor", role: "sales_head", title: "Head of Sales", email: "rohan@focusrealm.example", hue: 200 },
  { code: "FR-0021", name: "Ananya Iyer", role: "sales_rep", title: "Sales Team Member", email: "ananya@focusrealm.example", hue: 190, skill: 0.85 },
  { code: "FR-0022", name: "Vikram Singh", role: "sales_rep", title: "Sales Team Member", email: "vikram@focusrealm.example", hue: 205, skill: 0.55 },
  { code: "FR-0023", name: "Priya Nair", role: "sales_rep", title: "Sales Team Member", email: "priya@focusrealm.example", hue: 220, skill: 0.75 },
  { code: "FR-0024", name: "Arjun Malhotra", role: "sales_rep", title: "Sales Team Member", email: "arjun@focusrealm.example", hue: 236, skill: 0.4 },
  { code: "FR-0025", name: "Neha Gupta", role: "sales_rep", title: "Sales Team Member", email: "neha@focusrealm.example", hue: 196, skill: 0.65 },
  { code: "FR-0031", name: "Ishaan Verma", role: "legion", title: "Legion Lead", email: "ishaan@focusrealm.example", hue: 210 },
  { code: "FR-0032", name: "Meera Joshi", role: "legion", title: "Legion Closer", email: "meera@focusrealm.example", hue: 224 },
] as const;

const FIRST = ["Rahul", "Sanjay", "Deepak", "Pooja", "Amit", "Sneha", "Karan", "Ritu", "Manish", "Divya", "Suresh", "Anjali", "Nikhil", "Shreya", "Gaurav", "Swati", "Rajesh", "Kiran", "Varun", "Megha", "Harsh", "Tanvi", "Aditya", "Nisha", "Mohit", "Ayesha", "Farhan", "Simran", "Yash", "Rekha"];
const LAST = ["Sharma", "Verma", "Agarwal", "Bansal", "Chopra", "Khanna", "Reddy", "Patel", "Desai", "Menon", "Pillai", "Saxena", "Bhatia", "Sethi", "Kulkarni", "Jain", "Mishra", "Arora", "Chawla", "Dutta"];
const DESIG = ["Founder", "Managing Director", "Operations Head", "CTO", "General Manager", "Owner", "Director", "Head of Sales", "Admin Manager", "Business Head"];
const CITIES = ["Delhi", "Gurugram", "Noida", "Mumbai", "Pune", "Bengaluru", "Jaipur", "Chandigarh", "Ahmedabad", "Lucknow"];
const SEGMENTS = [
  { seg: "Distribution", words: ["Traders", "Distributors", "Wholesale", "Supply Co", "Enterprises"], camp: "Q4 Distributors — NCR" },
  { seg: "Healthcare", words: ["Clinics", "Diagnostics", "Health", "Dental Care", "Hospitals"], camp: "Clinics Outreach" },
  { seg: "D2C Brands", words: ["Organics", "Studio", "Wear", "Naturals", "Labs"], camp: "D2C Growth" },
  { seg: "Manufacturing", words: ["Industries", "Auto Components", "Polymers", "Engineering", "Fabricators"], camp: "SME Manufacturing" },
  { seg: "Education", words: ["Academy", "Learning", "Institute", "Coaching Centre", "EdTech"], camp: "Education Push" },
];
const BRAND = ["Shree Balaji", "Nova", "Apex", "Vedic", "Urban", "Bluepeak", "Sunrise", "Greenfield", "Prime", "Lotus", "Silverline", "Orbit", "Zenith", "Trident", "Kaveri", "Everest", "Crescent", "Indus", "Pioneer", "Saffron"];

const OUTCOME_WEIGHTS: [string, number][] = [
  ["no_answer", 30], ["busy", 8], ["switched_off", 5], ["wrong_number", 3], ["not_interested", 14], ["callback_requested", 12],
  ["follow_up_agreed", 14], ["interested", 8], ["meeting_booked", 6],
];

function weightedOutcome(skill: number) {
  const ws = OUTCOME_WEIGHTS.map(([o, w]) => [o, ["interested", "meeting_booked", "follow_up_agreed"].includes(o) ? w * (0.5 + skill) : w] as [string, number]);
  const total = ws.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [o, w] of ws) if ((r -= w) <= 0) return o;
  return "no_answer";
}

/** Better reps get the better-run scripts more often. */
function scriptFor(outcome: string, skill: number) {
  const options = SCRIPTS.filter((x) => x.outcome === outcome);
  if (!options.length) return null;
  if (outcome === "follow_up_agreed") return rnd() < skill ? options.find((o) => o.key !== "discovery_weak") ?? options[0] : options.find((o) => o.key === "discovery_weak") ?? options[0];
  return pick(options);
}

/** A weekday-ish business hour (IST) N days from today. */
function businessTime(days: number) {
  const date = addDays(todayLocal(), days);
  const slots = [11, 12.5, 15, 16.5];
  return new Date(dayBounds(date).from.getTime() + pick(slots) * 3600_000);
}

export async function seedDemo(opts: { force?: boolean } = {}) {
  const existing = await db.one<{ n: number }>("select count(*)::int as n from crm_users");
  if (existing.n > 0 && !opts.force) {
    console.log("[seed] database already has people — skipping (use --force to wipe and reseed)");
    return;
  }
  if (opts.force) {
    await db.query(`truncate crm_activities, crm_call_insights, crm_calls, crm_tasks, crm_handoffs, crm_meetings, crm_assignments,
      crm_allocation_batches, crm_contacts, crm_companies, crm_import_batches, crm_daily_reports, crm_report_recipients,
      crm_notifications, crm_audit_log, crm_jobs, crm_hr_events, crm_users cascade`);
    await db.query(`delete from crm_settings`);
  }
  console.log("[seed] creating the demo sales floor…");
  const hash = await hashPassword(DEMO_PASSWORD);
  const users: Record<string, { id: string; name: string; role: string; skill: number }> = {};
  for (const p of PEOPLE) {
    const row = await db.one(
      `insert into crm_users (employee_code, email, full_name, phone, role, title, department, status, password_hash, must_change_password, source, avatar_hue, daily_call_target, start_date)
       values ($1,$2,$3,$4,$5,$6,$7,'active',$8,false,'seed',$9,$10,$11) returning id`,
      [p.code, p.email, p.name, `+91 9${int(100000000, 999999999)}`, p.role, p.title, p.role === "legion" ? "Legion" : p.role === "founder" ? "Founders" : "Sales", hash, p.hue, 40, addDays(todayLocal(), -int(30, 200))],
    );
    users[p.code] = { id: row.id, name: p.name, role: p.role, skill: "skill" in p ? p.skill : 0.7 };
  }
  const reps = Object.values(users).filter((u) => u.role === "sales_rep");
  const legion = Object.values(users).filter((u) => u.role === "legion");
  const head = users["FR-0010"];

  // Demo mode never dials anyone.
  await putSetting("telephony", { mode: "demo" }, null);

  // ---- companies & prospects
  const contacts: { id: string; name: string; company: string; city: string; owner: string | null; seg: string; designation: string }[] = [];
  const usedPhones = new Set<string>();
  for (let i = 0; i < 540; i++) {
    const seg = SEGMENTS[i % SEGMENTS.length];
    const company = `${pick(BRAND)} ${pick(seg.words)}`;
    const city = pick(CITIES);
    const nameKey = company.toLowerCase().replace(/[^a-z0-9]/g, "");
    const co = await db.one(
      `insert into crm_companies (name, name_key, industry, city) values ($1,$2,$3,$4)
       on conflict (name_key) do update set name = excluded.name returning id`,
      [company, nameKey, seg.seg, city],
    );
    let phone: string;
    do phone = `9${int(100000000, 999999999)}`; while (usedPhones.has(phone));
    usedPhones.add(phone);
    const name = `${pick(FIRST)} ${pick(LAST)}`;
    const desig = pick(DESIG);
    // ~90 prospects per rep, the rest unassigned for the allocation demo.
    const owner = i < reps.length * 90 ? reps[i % reps.length] : null;
    const row = await db.one(
      `insert into crm_contacts (company_id, full_name, designation, phone, phone_key, email, email_key, city, source, campaign, segment, owner_id, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11, now() - make_interval(days => $12::int), now() - make_interval(hours => $13::int)) returning id`,
      [co.id, name, desig, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`, phoneKey(phone), `${name.split(" ")[0].toLowerCase()}@${nameKey.slice(0, 14)}.example`, city,
        pick(["Database import", "LinkedIn", "IndiaMART", "Referral", "Trade fair"]), seg.camp, seg.seg, owner?.id ?? null, int(16, 40), int(1, 200)],
    );
    if (owner) {
      await db.query(`insert into crm_assignments (contact_id, user_id, assigned_by, kind, created_at) values ($1,$2,$3,'allocation', now() - interval '15 days')`, [row.id, owner.id, head.id]);
    }
    contacts.push({ id: row.id, name, company, city, owner: owner?.id ?? null, seg: seg.seg, designation: desig });
  }

  // ---- two weeks of calls
  console.log("[seed] simulating two weeks of calls, transcripts and coaching…");
  const today = todayLocal();
  const owned = (uid: string) => contacts.filter((c) => c.owner === uid);
  const contactState = new Map<string, { outcome: string; calls: number }>();
  for (let d = 13; d >= 0; d--) {
    const date = addDays(today, -d);
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (dow === 0) continue; // Sundays off
    const { from } = dayBounds(date);
    for (const rep of reps) {
      const isToday = d === 0;
      const n = isToday ? int(5, 11) : int(14, 30) + Math.round(rep.skill * 6);
      const mine = owned(rep.id);
      let t = from.getTime() + (9.5 + rnd()) * 3600_000; // ~9:30–10:30 IST start
      for (let k = 0; k < n; k++) {
        t += int(6, 22) * 60_000;
        if (isToday && t > Date.now() - 5 * 60_000) break;
        const c = pick(mine);
        const st = contactState.get(c.id) ?? { outcome: "", calls: 0 };
        if (["meeting_booked", "wrong_number", "not_interested"].includes(st.outcome) && rnd() < 0.85) continue;
        if (st.calls >= 4 && rnd() < 0.8) continue;
        const outcome = weightedOutcome(rep.skill);
        const script = scriptFor(outcome, rep.skill);
        const started = new Date(t);
        const code = `FRC-${date.slice(2).replace(/-/g, "")}-${String((await db.one("select nextval('crm_call_seq') as n")).n).padStart(5, "0")}`;
        let transcript: any = null;
        let duration = outcome === "no_answer" || outcome === "switched_off" ? 0 : outcome === "busy" ? 4 : int(20, 60);
        if (script) {
          const r = renderScript(script, { rep: rep.name, prospect: c.name, company: c.company, city: c.city });
          transcript = { provider: "demo", utterances: r.utterances, roles: { A: "rep", B: "prospect" } };
          duration = r.duration + int(10, 90);
        }
        const call = await db.one(
          `insert into crm_calls (call_code, contact_id, user_id, mode, provider, phone_dialed, status, outcome, started_at, answered_at, ended_at, duration_sec,
             recording_status, transcript, transcript_status, consent_notice, created_at, updated_at)
           values ($1,$2,$3,'demo','demo',null,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,true,$6,$8) returning id`,
          [code, c.id, rep.id, outcome === "busy" ? "busy" : ["no_answer", "switched_off"].includes(outcome) ? "no_answer" : "completed", outcome, started,
            duration ? new Date(t + 15_000) : null, new Date(t + duration * 1000 + 15_000), duration, "unavailable", transcript ? json(transcript) : null, transcript ? "done" : "none"],
        );
        if (transcript) {
          const analysis = heuristicAnalysis(transcript, { outcome, user_name: rep.name, contact_name: c.name, designation: c.designation });
          // Spread scores by rep skill so the dashboards tell a story.
          analysis.overall_score = Math.max(20, Math.min(97, Math.round(analysis.overall_score * (0.75 + rep.skill * 0.35) + int(-6, 6))));
          await persistAnalysis({ id: call.id, user_id: rep.id, contact_id: c.id }, transcript, analysis, "demo-heuristic", new Date(t + duration * 1000 + 120_000));
        }
        t += duration * 1000;
        contactState.set(c.id, { outcome, calls: st.calls + 1 });
        await db.query(
          `update crm_contacts set call_count = call_count + 1, last_contacted_at = $2, last_call_outcome = $3,
             status = case when $3 in ('callback_requested','follow_up_agreed') then 'follow_up'
                           when $3 in ('interested','meeting_booked') then 'qualification_review'
                           when status = 'new' then 'outreach' else status end,
             is_invalid = ($3 = 'wrong_number') or is_invalid
           where id = $1`,
          [c.id, started, outcome],
        );
        if (outcome !== "no_answer" && outcome !== "busy" && outcome !== "switched_off") {
          await db.query(
            `insert into crm_activities (contact_id, user_id, kind, title, meta, created_at) values ($1,$2,'call',$3,$4::jsonb,$5)`,
            [c.id, rep.id, `Call ${code}: ${outcome.replace(/_/g, " ")}`, json({ callId: call.id, outcome }), started],
          );
        }
      }
    }
  }

  // ---- move the pipeline along: qualified, handoffs, Legion meetings, wins
  console.log("[seed] building the pipeline…");
  const hot = contacts.filter((c) => c.owner && ["meeting_booked", "interested"].includes(contactState.get(c.id)?.outcome ?? ""));
  const qual = { decision_maker: true, need: true, interest: true, budget: true, timeline: false };
  for (const [i, c] of hot.entries()) {
    const owner = c.owner!;
    const lg = legion[i % legion.length];
    const phase = i % 6; // 0: qualification review, 1: qualified, 2: handoff pending, 3: meet 1, 4: meet 2, 5: won
    if (phase === 0) continue;
    await db.query(`update crm_contacts set qualification = $2::jsonb, status = 'qualified', stage = 'qualified' where id = $1`, [c.id, json(qual)]);
    await db.query(`insert into crm_activities (contact_id, user_id, kind, title, meta, created_at) values ($1,$2,'status','Status: Qualification review → Qualified','{"to":"qualified"}'::jsonb, now() - make_interval(days => $3::int))`, [c.id, owner, int(1, 6)]);
    if (phase === 1) continue;
    const decided = phase >= 3;
    await db.query(
      `insert into crm_handoffs (contact_id, from_user_id, to_user_id, status, note, checklist, decided_by, decided_at, created_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8, now() - make_interval(days => $9::int))`,
      [c.id, owner, decided ? lg.id : null, decided ? "accepted" : "pending", "Decision-maker on board, wants to see a similar case study.",
        json({ "Decision-maker identified": true, "Clear need or pain point": true, "Agreed to a Legion meeting": true }), decided ? lg.id : null, decided ? new Date(Date.now() - 2 * 86400_000) : null, int(2, 5)],
    );
    await db.query(`update crm_contacts set status = $2 where id = $1`, [c.id, decided ? "handed_off" : "handoff_pending"]);
    if (!decided) continue;
    const stage = phase === 3 ? "legion_meet_1" : "legion_meet_2";
    await db.query(`update crm_contacts set stage = $2, legion_owner_id = $3, status = $4 where id = $1`, [c.id, stage, lg.id, phase === 5 ? "closed_won" : "handed_off"]);
    await db.query(
      `insert into crm_meetings (contact_id, stage, scheduled_at, location, legion_user_id, sales_user_id, status, created_by)
       values ($1,'legion_meet_1', $2, 'Google Meet', $3, $4, $5, $3)`,
      [c.id, businessTime(phase === 3 ? int(1, 4) : -int(3, 6)), lg.id, owner, phase === 3 ? "scheduled" : "completed"],
    );
    if (phase >= 4) {
      await db.query(
        `insert into crm_meetings (contact_id, stage, scheduled_at, location, legion_user_id, sales_user_id, status, outcome, created_by)
         values ($1,'legion_meet_2', $2, 'On-site demo', $3, $4, $5, $6, $3)`,
        [c.id, businessTime(phase === 4 ? int(1, 5) : -1), lg.id, owner, phase === 4 ? "scheduled" : "completed", phase === 5 ? "Signed phase 1 — order tracking + reminders" : null],
      );
    }
  }

  // ---- follow-ups at sensible business hours: some overdue, some today, some later
  const followUps = contacts.filter((x) => x.owner && contactState.get(x.id)?.outcome && ["callback_requested", "follow_up_agreed"].includes(contactState.get(x.id)!.outcome));
  for (const [i, c] of followUps.entries()) {
    const dayOffset = [-1, 0, 0, 1, 1, 2, 3, 5][i % 8];
    const date = addDays(today, dayOffset);
    const at = new Date(dayBounds(date).from.getTime() + (10 + (i % 8)) * 3600_000 + (i % 4) * 15 * 60_000);
    await db.query(
      `insert into crm_tasks (contact_id, assigned_to, created_by, kind, title, reason, due_at, reminder_at, priority, status)
       values ($1,$2,$2,'follow_up',$3,$4,$5,$6,$7,'open')
       on conflict do nothing`,
      [c.id, c.owner, `Follow up with ${c.name}`, contactState.get(c.id)!.outcome === "callback_requested" ? "Asked for a callback" : "Agreed to talk again", at, new Date(at.getTime() - 15 * 60_000), at < new Date() ? "high" : "normal"],
    );
  }
  // History: most past follow-ups were done, some were missed (compliance metric).
  for (const [i, c] of contacts.filter((x) => x.owner && contactState.has(x.id)).slice(0, 220).entries()) {
    const due = new Date(dayBounds(addDays(today, -int(1, 13))).from.getTime() + (10 + (i % 7)) * 3600_000);
    const done = rnd() < (reps.find((r) => r.id === c.owner)?.skill ?? 0.6) + 0.15;
    await db.query(
      `insert into crm_tasks (contact_id, assigned_to, created_by, kind, title, due_at, status, completed_at, escalated_at, created_at)
       values ($1,$2,$2,'call',$3,$4,$5,$6,$7,$4)`,
      [c.id, c.owner, `Call back ${c.name}`, due, done ? "done" : "missed", done ? due : null, done ? null : new Date(due.getTime() + 86400_000)],
    );
  }
  await db.query(
    `update crm_contacts c set next_action_at = (select min(due_at) from crm_tasks t where t.contact_id = c.id and t.status = 'open')`,
  );
  // A founder-assigned task to show the flow.
  await db.query(
    `insert into crm_tasks (assigned_to, created_by, kind, title, reason, due_at, priority) values ($1,$2,'review',$3,$4, now() + interval '5 hours', 'high')`,
    [head.id, users["FR-0001"].id, "Review Arjun's objection handling", "His price-objection calls are scoring below 50 — sit in on two calls tomorrow."],
  );

  // ---- daily reports for the last 3 working days (rule-based, no AI cost)
  console.log("[seed] writing daily reports…");
  for (let d = 3; d >= 1; d--) {
    const date = addDays(today, -d);
    for (const rep of reps) {
      const { user, calls, metrics } = await computeMetrics(rep.id, date);
      if (!calls.length) continue;
      const report = heuristicDailyReport({ repName: user.full_name, date, metrics, calls: calls.map((c) => ({ call_code: c.call_code, outcome: c.outcome, analysis: c.analysis })) });
      await db.query(
        `insert into crm_daily_reports (user_id, report_date, status, metrics, report, model, updated_at)
         values ($1,$2,'ready',$3::jsonb,$4::jsonb,'demo-heuristic',$5)`,
        [rep.id, date, json(metrics), json(report), new Date(dayBounds(date).from.getTime() + 20.5 * 3600_000)],
      );
    }
  }

  await db.query(`insert into crm_report_recipients (name, email, label) values ('Sales Advisor', 'advisor@focusrealm.example', 'Advisor')`);
  for (const u of Object.values(users)) {
    await db.query(`insert into crm_notifications (user_id, kind, title, body, link) values ($1,'welcome',$2,$3,$4)`, [
      u.id,
      "Welcome to Focus Realm CRM ✨",
      "This is demo data — explore freely. Press ⌘K to search anything.",
      "/",
    ]);
  }
  console.log(`[seed] done — sign in with any demo ID (e.g. FR-0021) and password "${DEMO_PASSWORD}"`);
}

// CLI entry: `npm run seed`
const isMain = process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  (async () => {
    await connect();
    await migrate();
    await seedDemo({ force: process.argv.includes("--force") });
    await db.close();
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

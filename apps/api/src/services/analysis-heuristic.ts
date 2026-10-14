import type { CallAnalysis, DailyReport } from "./analysis.js";
import { FRAMEWORKS, SKILLS } from "./analysis.js";
import type { Transcript } from "./transcription.js";

/**
 * A rules-based stand-in for the AI, used only when no ANTHROPIC_API_KEY is
 * configured, so the CRM is fully explorable in a demo. Every result it
 * produces is labelled "demo-heuristic" in the UI. It is deliberately simple:
 * keyword spotting and talk-time arithmetic, nothing more.
 */

const OBJECTION_PATTERNS: [CallAnalysis["objections"][number]["category"], RegExp][] = [
  ["price", /\b(expensive|costly|too much|cheaper|can't afford|out of (our )?budget|how much does it cost)\b/i],
  ["competitor", /\b(already (have|working|using)|another vendor|other company|happy with them)\b/i],
  ["timing", /\b(not now|later|next (month|quarter|year)|after two weeks|think about it)\b/i],
  ["send_info", /\b(send (me )?(the )?(details|info|brochure|email)|on email)\b/i],
  ["busy", /\b(i'?m busy|i am busy|i'?m driving|in a meeting|middle of something)\b/i],
  ["no_need", /\b(not interested|don't need|no need|we're fine)\b/i],
  ["authority", /\b(need to ask|check with (my|our)|not my decision|have to discuss)\b/i],
];

const BUYING = /\b(that would be useful|send (the )?invite|can we do|how (much|soon)|let's|sounds good|yes,? (but|that))\b/i;
const PAIN = /\b(messy|lose track|delayed|problem|slipping|mismatch|not happy|busy with|takes (too )?long|half their week)\b/i;

export function heuristicAnalysis(t: Transcript, ctx: { outcome: string | null; user_name: string; contact_name: string; designation?: string | null }): CallAnalysis {
  const roles = t.roles ?? {};
  const repSpeaker = Object.keys(roles).find((k) => roles[k] === "rep") ?? t.utterances[1]?.speaker ?? "A";
  const rep = t.utterances.filter((u) => u.speaker === repSpeaker);
  const prospect = t.utterances.filter((u) => u.speaker !== repSpeaker);
  const repText = rep.map((u) => u.text).join(" ");
  const prospectText = prospect.map((u) => u.text).join(" ");

  const questions = rep.filter((u) => u.text.includes("?")).length;
  const openQs = rep.filter((u) => /\b(how|what|why|who|when|which|tell me)\b[^?]*\?/i.test(u.text)).length;
  const fillers = (repText.match(/\b(basically|actually|like|you know|umm?|uh|so so)\b/gi) ?? []).length;
  const asksPermission = /\b(good time|okay moment|a minute|two minutes)\b/i.test(rep[0]?.text ?? repText.slice(0, 200));
  const quantified = /\b(\d+|fifteen|ten|sixty|half)\b/i.test(prospectText) && openQs >= 2;
  const nextStep = /\b(thursday|monday|tomorrow|wednesday|friday|invite|session|call (you|me))\b/i.test(repText);
  const featureDump = rep.some((u) => u.text.split(",").length >= 6);

  const objections = OBJECTION_PATTERNS.flatMap(([category, re]) => {
    const hit = prospect.find((u) => re.test(u.text));
    if (!hit) return [];
    const idx = t.utterances.indexOf(hit);
    const reply = t.utterances.slice(idx + 1).find((u) => u.speaker === repSpeaker)?.text ?? "";
    const handling: "well" | "partially" | "poorly" | "not_addressed" = !reply
      ? "not_addressed"
      : reply.includes("?") && reply.length > 60 ? "well" : reply.length > 40 ? "partially" : "poorly";
    return [{
      category,
      quote: hit.text,
      handling,
      better_response:
        category === "price"
          ? "“Fair question — before we talk numbers, how much time does your team lose to this each week?”"
          : category === "competitor"
            ? "“Good to hear it's working. What's the one thing you'd change about it if you could?”"
            : category === "send_info"
              ? "“Happy to. So I send the right thing — what's the biggest headache it should solve?”"
              : category === "timing"
                ? "“Understood. What would need to happen for this to be a priority this quarter?”"
                : "“I hear you. Can I ask one quick question before I let you go?”",
    }];
  });

  let score = 45;
  score += Math.min(15, openQs * 4);
  score += asksPermission ? 6 : 0;
  score += quantified ? 10 : 0;
  score += nextStep ? 10 : 0;
  score -= featureDump ? 12 : 0;
  score -= Math.min(10, fillers * 2);
  score += objections.filter((o) => o.handling === "well").length * 5;
  score -= objections.filter((o) => o.handling === "poorly" || o.handling === "not_addressed").length * 5;
  if (ctx.outcome === "meeting_booked") score += 10;
  if (ctx.outcome === "wrong_number") score = 50;
  score = Math.max(15, Math.min(96, Math.round(score)));
  const s10 = (bonus = 0) => Math.max(1, Math.min(10, Math.round(score / 10 + bonus)));

  const interest = ctx.outcome === "meeting_booked" ? 8 : ctx.outcome === "interested" ? 7 : ctx.outcome === "follow_up_agreed" ? 5 : ctx.outcome === "callback_requested" ? 4 : 2;
  const pains = prospect.filter((u) => PAIN.test(u.text)).map((u) => u.text).slice(0, 3);
  const signals = prospect.filter((u) => BUYING.test(u.text)).map((u) => u.text).slice(0, 3);

  const skills = Object.fromEntries(SKILLS.map((k) => [k, s10()])) as CallAnalysis["skills"];
  skills.opening = s10(asksPermission ? 1.5 : -1.5);
  skills.discovery = s10(openQs >= 3 ? 2 : openQs === 0 ? -3 : 0);
  skills.value_proposition = s10(featureDump ? -3 : quantified ? 1.5 : 0);
  skills.closing = s10(nextStep ? 1.5 : -2.5);
  skills.clarity_pace = s10(fillers > 3 ? -2 : 0.5);

  return {
    speaker_roles: [
      { speaker: repSpeaker, role: "salesperson" },
      ...[...new Set(prospect.map((u) => u.speaker))].map((s) => ({ speaker: s, role: "prospect" as const })),
    ],
    language: /\b(haan|ji|achha|nahi)\b/i.test(prospectText + repText) ? "Hindi-English mix" : "English",
    summary: `${ctx.user_name.split(" ")[0]} called ${ctx.contact_name}. ${pains.length ? `The prospect described a problem: “${pains[0]}”. ` : ""}${objections.length ? `Main objection: ${objections[0].category.replace("_", " ")}. ` : ""}${nextStep ? "A concrete next step was agreed." : "No firm next step was agreed."}`,
    call_type: ctx.outcome === "wrong_number" ? "wrong_number" : ctx.outcome === "meeting_booked" ? "meeting_booking" : questions > 2 ? "discovery" : "cold_call",
    outcome: (ctx.outcome as CallAnalysis["outcome"]) ?? "follow_up_agreed",
    overall_score: score,
    skills,
    frameworks: FRAMEWORKS.map((framework) => {
      const base = framework === "SPIN" || framework === "GAP Selling" ? (openQs >= 3 ? 2 : -2) : framework === "BANT" || framework === "MEDDIC" || framework === "NEAT" ? (/\b(decides|budget|sign)\b/i.test(t.utterances.map((u) => u.text).join(" ")) ? 1 : -2) : 0;
      return {
        framework,
        score: s10(base) ,
        applied: openQs ? `Asked ${openQs} open question${openQs > 1 ? "s" : ""}${asksPermission ? " and opened by asking for permission" : ""}.` : "Little evidence of this framework on the call.",
        missed: framework === "SPIN" ? "Ask an implication question: what does this problem cost them if it continues?" : framework === "BANT" || framework === "NEAT" ? "Confirm who signs off and whether budget exists before pitching." : framework === "Challenger" ? "Teach the prospect one insight about their business they hadn't considered." : framework === "Sandler" ? "Set an up-front contract for the call: time, agenda and the outcome you both want." : "Tie the pitch to the prospect's own words and ask for a specific next step.",
      };
    }),
    talk: { questions_asked: questions, open_questions: openQs, interruptions: 0, filler_words: fillers, pace: "good" },
    prospect: {
      sentiment_start: "neutral",
      sentiment_end: interest >= 7 ? "positive" : interest <= 2 ? "negative" : "neutral",
      interest_level: interest,
      temperature: interest * 10 - (objections.length ? 5 : 0),
      decision_maker: /\b(decides|sign(s)? off)\b/i.test(prospectText) ? "no" : /founder|owner|director|managing|ceo|cto|head|general manager/i.test(ctx.designation ?? "") && t.utterances.length >= 6 ? "yes" : "unknown",
      engagement: prospect.length > rep.length * 0.8 ? "Engaged — answered questions in detail." : "Short answers; limited engagement.",
      response_summary: signals.length ? `Showed buying signals: “${signals[0]}”.` : objections.length ? `Pushed back (${objections.map((o) => o.category.replace("_", " ")).join(", ")}).` : "Polite but non-committal.",
      key_quotes: prospect.map((u) => u.text).filter((x) => x.length > 25).slice(0, 3),
    },
    bant: {
      budget: { status: /\b(budget|lakhs?)\b/i.test(prospectText) ? "indicated" : "unknown", evidence: prospect.find((u) => /\b(budget|lakhs?)\b/i.test(u.text))?.text ?? "" },
      authority: { status: /\b(decides|sign(s)? off)\b/i.test(prospectText) ? "indicated" : "unknown", evidence: prospect.find((u) => /\b(decides|sign)\b/i.test(u.text))?.text ?? "" },
      need: { status: pains.length ? "confirmed" : "unknown", evidence: pains[0] ?? "" },
      timeline: { status: /\b(march|quarter|month|week)\b/i.test(prospectText) ? "indicated" : "unknown", evidence: prospect.find((u) => /\b(march|quarter|month)\b/i.test(u.text))?.text ?? "" },
    },
    objections,
    pain_points: pains,
    product_requests: prospect
      .filter((u) => /\b(mainly|need|want|looking for|interested in|maybe the|cover|show)\b/i.test(u.text) && /\b(inventory|tracking|reminders?|app|crm|erp|kyc|onboarding|automation|dashboard)\b/i.test(u.text))
      .map((u) => u.text)
      .slice(0, 3),
    buying_signals: signals,
    competitors: /another vendor|other company/i.test(prospectText) ? ["Existing software vendor"] : [],
    risks: objections.length > 1 ? ["Multiple objections still open"] : [],
    strengths: [
      ...(asksPermission ? ["Opened by asking for permission — respectful and effective."] : []),
      ...(openQs >= 2 ? [`Asked ${openQs} open questions to understand the prospect.`] : []),
      ...(nextStep ? ["Closed for a specific next step with a time."] : []),
      ...(quantified ? ["Got the prospect to put a number on the problem."] : []),
    ].slice(0, 3).concat(asksPermission || openQs >= 2 || nextStep ? [] : ["Kept the call polite and brief."]),
    improvements: [
      ...(featureDump ? [{ moment: "The pitch", issue: "Listed many services before learning what the prospect needs.", suggestion: "Ask about their problem first, then mention only the one relevant service.", example_line: "“Before I tell you what we do — how are you handling X today?”" }] : []),
      ...(openQs < 2 ? [{ moment: "Discovery", issue: "Very few open questions.", suggestion: "Use SPIN: situation → problem → implication → need-payoff.", example_line: "“What happens if this isn't fixed before you scale?”" }] : []),
      ...(!nextStep ? [{ moment: "Closing", issue: "Ended without a specific next step.", suggestion: "Always propose a concrete time.", example_line: "“Does Thursday at 4 work for a 20-minute walkthrough with our Legion team?”" }] : []),
      ...(fillers > 3 ? [{ moment: "Throughout", issue: `Used filler words ${fillers} times.`, suggestion: "Pause instead of filling silence.", example_line: "Take a breath before answering." }] : []),
      ...(!quantified ? [{ moment: "Discovery", issue: "The problem was never put into numbers.", suggestion: "Ask what the problem costs them — time, money or customers — so the value is concrete.", example_line: "“Roughly how many hours a week does your team lose to this?”" }] : []),
      { moment: "Before closing", issue: "Budget and decision process weren't both confirmed.", suggestion: "Use BANT/MEDDIC: confirm who signs off and whether money is set aside before booking Legion.", example_line: "“Who else would weigh in, and is there a budget earmarked for this?”" },
    ].slice(0, 3),
    next_action: {
      action: ctx.outcome === "meeting_booked" ? "Send the Legion meeting invite and a one-page recap" : nextStep ? "Follow up at the agreed time with a tailored message" : "Re-engage with a specific question about their problem",
      due_in_days: ctx.outcome === "meeting_booked" ? 0 : 2,
      owner: ctx.outcome === "meeting_booked" ? "legion" : "salesperson",
    },
    qualification_evidence: {
      decision_maker: /\b(decides|sign(s)? off)\b/i.test(prospectText),
      need: pains.length > 0,
      interest: ctx.outcome === "meeting_booked" || ctx.outcome === "interested",
      budget: /\b(budget|lakhs?)\b/i.test(prospectText),
      timeline: /\b(march|quarter|month)\b/i.test(prospectText),
    },
    confidence: t.utterances.length >= 6 ? 0.7 : 0.45,
    needs_human_review: t.utterances.length < 6,
    review_reasons: t.utterances.length < 6 ? ["Very short call — limited evidence."] : [],
  };
}

export function heuristicDailyReport(input: {
  repName: string;
  date: string;
  metrics: Record<string, any>;
  calls: { call_code: string; outcome: string | null; analysis: CallAnalysis | null }[];
}): DailyReport {
  const analysed = input.calls.filter((c) => c.analysis) as { call_code: string; outcome: string | null; analysis: CallAnalysis }[];
  const avg = analysed.length ? Math.round(analysed.reduce((s, c) => s + c.analysis.overall_score, 0) / analysed.length) : 0;
  const best = [...analysed].sort((a, b) => b.analysis.overall_score - a.analysis.overall_score)[0];
  const worst = [...analysed].sort((a, b) => a.analysis.overall_score - b.analysis.overall_score)[0];
  const first = input.repName.split(" ")[0];
  const m = input.metrics;
  const grade = avg >= 85 ? "A+" : avg >= 78 ? "A" : avg >= 70 ? "B+" : avg >= 62 ? "B" : avg >= 50 ? "C" : "D";
  const fw = FRAMEWORKS.map((f) => {
    const scores = analysed.map((c) => c.analysis.frameworks.find((x) => x.framework === f)?.score ?? 0);
    const score = scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : 0;
    return { framework: f, score, comment: score >= 7 ? "Consistently applied." : score >= 5 ? "Partly applied — room to tighten." : "Rarely applied today." };
  });
  const objCounts = new Map<string, { count: number; well: number }>();
  for (const c of analysed) for (const o of c.analysis.objections) {
    const e = objCounts.get(o.category) ?? { count: 0, well: 0 };
    e.count++;
    if (o.handling === "well") e.well++;
    objCounts.set(o.category, e);
  }
  const improvements = analysed.flatMap((c) => c.analysis.improvements);
  return {
    headline: analysed.length
      ? `${first}: ${m.calls_total} calls, ${m.connected} connected, ${m.meetings_booked ?? 0} meeting${m.meetings_booked === 1 ? "" : "s"} booked — avg call score ${avg}`
      : `${first}: ${m.calls_total} calls logged, no recordings analysed`,
    grade: analysed.length ? grade : "C",
    overall_score: avg,
    executive_summary: analysed.length
      ? `${first} made ${m.calls_total} calls (${m.connect_rate}% connect rate) with ${Math.round((m.talk_time_sec ?? 0) / 60)} minutes of talk time. ${analysed.length} recorded calls were analysed with an average score of ${avg}/100. ${best ? `The strongest call was ${best.call_code}. ` : ""}Main area to work on: ${improvements[0]?.issue?.toLowerCase() ?? "maintaining consistency"}.`
      : `${first} logged ${m.calls_total} calls but no recordings were available to analyse. Make sure recordings are attached after each call.`,
    wins: [
      ...(m.meetings_booked ? [`Booked ${m.meetings_booked} Legion meeting${m.meetings_booked > 1 ? "s" : ""}.`] : []),
      ...(best ? [`${best.call_code}: ${best.analysis.strengths[0] ?? "strong call"}`] : []),
      ...(m.connect_rate >= 40 ? [`Healthy ${m.connect_rate}% connect rate.`] : []),
    ],
    concerns: [
      ...(worst && worst.analysis.overall_score < 55 ? [`${worst.call_code} scored ${worst.analysis.overall_score}: ${worst.analysis.improvements[0]?.issue ?? "weak call"}`] : []),
      ...(m.recordings_missing ? [`${m.recordings_missing} connected call${m.recordings_missing > 1 ? "s have" : " has"} no recording.`] : []),
      ...(m.calls_total < (m.target ?? 40) ? [`Below the daily call target (${m.calls_total}/${m.target ?? 40}).`] : []),
    ],
    communication: analysed.length ? `Average clarity/pace ${avgSkill(analysed, "clarity_pace")}/10 and tone/confidence ${avgSkill(analysed, "tone_confidence")}/10. Talked ${avgTalk(analysed)}% of the time on average.` : "No recordings to assess.",
    conversation_handling: analysed.length ? `Discovery ${avgSkill(analysed, "discovery")}/10, objection handling ${avgSkill(analysed, "objection_handling")}/10, closing ${avgSkill(analysed, "closing")}/10.` : "No recordings to assess.",
    prospect_response: analysed.length ? analysed.map((c) => c.analysis.prospect.response_summary).slice(0, 3).join(" ") : "No recordings to assess.",
    framework_breakdown: fw,
    objection_summary: [...objCounts.entries()].map(([category, e]) => ({ category, count: e.count, handling: `${e.well}/${e.count} handled well` })),
    best_call: { call_code: best?.call_code ?? "—", why: best?.analysis.strengths[0] ?? "—" },
    toughest_call: { call_code: worst?.call_code ?? "—", why: worst?.analysis.improvements[0]?.issue ?? "—" },
    coaching_plan: improvements.slice(0, 3).map((i) => ({ focus: i.issue, drill: i.suggestion, example_line: i.example_line })),
    product_feedback: [...new Set(analysed.flatMap((c) => c.analysis.product_requests))].slice(0, 5),
    manager_actions: worst && worst.analysis.overall_score < 55 ? [`Listen to ${worst.call_code} with ${first} and role-play the objection.`] : [`Recognise ${first}'s progress in stand-up.`],
    tomorrow_targets: [`${m.target ?? 40} calls`, "Ask at least 3 open questions on every connected call", "Close every connected call with a specific next step"],
  };
}

function avgSkill(calls: { analysis: CallAnalysis }[], k: keyof CallAnalysis["skills"]) {
  return +(calls.reduce((s, c) => s + c.analysis.skills[k], 0) / calls.length).toFixed(1);
}
function avgTalk(calls: { analysis: CallAnalysis }[]) {
  return Math.round(calls.reduce((s, c) => s + (c.analysis.computed?.rep_talk_pct ?? 50), 0) / calls.length);
}

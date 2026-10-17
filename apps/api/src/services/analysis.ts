import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { db, json } from "../db/index.js";
import { env } from "../env.js";
import { broadcast, publish } from "../lib/bus.js";
import { activity, notify } from "../lib/record.js";
import { heuristicAnalysis } from "./analysis-heuristic.js";
import { GeminiError, geminiJson } from "./gemini.js";
import type { Transcript } from "./transcription.js";

/**
 * AI call intelligence (proposal §8.6 and §9E, with the founders' brief):
 * how the salesperson spoke and handled the conversation, how good the call
 * was against every major sales framework, and how the prospect responded.
 *
 * Claude (or Gemini, see gemini.ts) returns a strictly-typed analysis, so the CRM
 * can chart it, aggregate it across the team and roll it into the daily
 * report. Uncertain findings are flagged for human review, never hidden.
 */

export const FRAMEWORKS = ["SPIN", "BANT", "MEDDIC", "Challenger", "Sandler", "GAP Selling", "NEAT", "SNAP", "Straight Line", "AIDA"] as const;
export const SKILLS = [
  "opening", "rapport", "discovery", "active_listening", "value_proposition", "objection_handling", "closing",
  "tone_confidence", "clarity_pace", "professionalism",
] as const;

const sentiment = z.enum(["very_negative", "negative", "neutral", "positive", "very_positive"]);
const qualItem = z.object({
  status: z.enum(["confirmed", "indicated", "unknown", "negative"]),
  evidence: z.string().describe("Short quote or paraphrase from the call; empty if unknown"),
});

export const CallAnalysisSchema = z.object({
  speaker_roles: z
    .array(z.object({ speaker: z.string(), role: z.enum(["salesperson", "prospect", "other"]) }))
    .describe("Which transcript speaker label is the Focus Realm salesperson and which is the prospect"),
  language: z.string().describe("Main language(s) of the call, e.g. 'English', 'Hindi-English mix'"),
  summary: z.string().describe("3–5 sentence neutral summary of what happened on the call"),
  call_type: z.enum(["cold_call", "follow_up", "discovery", "meeting_booking", "objection_handling", "closing", "wrong_number", "voicemail", "other"]),
  outcome: z.enum(["no_answer", "busy", "switched_off", "wrong_number", "not_interested", "callback_requested", "follow_up_agreed", "interested", "meeting_booked", "do_not_call"]),
  overall_score: z.number().describe("Overall call quality 0–100, per the rubric"),
  skills: z.object(Object.fromEntries(SKILLS.map((s) => [s, z.number().describe("0–10")])) as Record<(typeof SKILLS)[number], z.ZodNumber>),
  frameworks: z
    .array(
      z.object({
        framework: z.enum(FRAMEWORKS),
        score: z.number().describe("0–10: how well the salesperson applied this framework"),
        applied: z.string().describe("What they did that fits this framework, with a short quote"),
        missed: z.string().describe("The most valuable thing this framework says they should have done"),
      }),
    )
    .describe("One entry for every framework in the list, in the same order"),
  talk: z.object({
    questions_asked: z.number(),
    open_questions: z.number(),
    interruptions: z.number(),
    filler_words: z.number(),
    pace: z.enum(["too_slow", "good", "too_fast"]),
  }),
  prospect: z.object({
    sentiment_start: sentiment,
    sentiment_end: sentiment,
    interest_level: z.number().describe("0–10"),
    temperature: z.number().describe("Lead temperature 0–100: likelihood this becomes a Legion meeting"),
    decision_maker: z.enum(["yes", "no", "unknown"]),
    engagement: z.string().describe("How engaged the prospect was and how that changed during the call"),
    response_summary: z.string().describe("How the prospect responded to the pitch, questions and asks"),
    key_quotes: z.array(z.string()).describe("Up to 4 verbatim prospect quotes that matter most"),
  }),
  bant: z.object({ budget: qualItem, authority: qualItem, need: qualItem, timeline: qualItem }),
  objections: z.array(
    z.object({
      category: z.enum(["price", "timing", "no_need", "competitor", "trust", "authority", "send_info", "busy", "status_quo", "other"]),
      quote: z.string(),
      handling: z.enum(["well", "partially", "poorly", "not_addressed"]),
      better_response: z.string().describe("A specific better line the salesperson could have used"),
    }),
  ),
  pain_points: z.array(z.string()),
  product_requests: z.array(z.string()).describe("Features, products or services the prospect asked for or hinted at"),
  buying_signals: z.array(z.string()),
  competitors: z.array(z.string()),
  risks: z.array(z.string()),
  strengths: z.array(z.string()).describe("2–4 things the salesperson did well, specific to this call"),
  improvements: z
    .array(
      z.object({
        moment: z.string().describe("Where in the call (timestamp or quote)"),
        issue: z.string(),
        suggestion: z.string(),
        example_line: z.string().describe("Exactly what they could say next time"),
      }),
    )
    .describe("2–4 highest-leverage coaching points"),
  next_action: z.object({
    action: z.string(),
    due_in_days: z.number(),
    owner: z.enum(["salesperson", "legion", "sales_head"]),
  }),
  qualification_evidence: z.object({
    decision_maker: z.boolean(),
    need: z.boolean(),
    interest: z.boolean(),
    budget: z.boolean(),
    timeline: z.boolean(),
  }),
  confidence: z.number().describe("0–1: your confidence in this analysis given transcript quality"),
  needs_human_review: z.boolean(),
  review_reasons: z.array(z.string()),
});

export type CallAnalysis = z.infer<typeof CallAnalysisSchema> & {
  computed?: { rep_talk_pct: number; longest_monologue_sec: number; rep_words: number; prospect_words: number };
};

const SYSTEM = `You are the call-intelligence engine inside Focus Realm's sales CRM. Focus Realm is an Indian software company that builds custom software, CRMs/ERPs, apps and AI automation for growing businesses. Its salespeople (many of them early-career sales team members) make outbound calls to prospects; qualified prospects are handed to the "Legion" team for meetings (Legion Meet 1 and Legion Meet 2).

You receive one call transcript with speaker labels and timestamps, plus CRM context. Calls may be in English, Hindi or a Hindi–English mix; always write your analysis in clear English and keep quotes in the original language.

Analyse three things with equal care:
1. How the salesperson spoke — tone, confidence, pace, clarity, filler words, listening, talk-to-listen balance.
2. How they handled the conversation — opening, permission, discovery, value articulation tied to the prospect's words, objection handling, and whether they closed for a concrete next step (ideally a Legion meeting).
3. How the prospect responded — sentiment at the start vs the end, interest, engagement, decision-making authority, buying signals, objections, pain points and product requests.

Score against every framework in this order: SPIN (Situation, Problem, Implication, Need-payoff questions), BANT (Budget, Authority, Need, Timeline), MEDDIC (Metrics, Economic buyer, Decision criteria, Decision process, Identify pain, Champion), Challenger (teach, tailor, take control), Sandler (up-front contract, pain, budget, decision, fulfilment), GAP Selling (current state → future state gap), NEAT (Need, Economic impact, Access to authority, Timeline), SNAP (Simple, iNvaluable, Aligned, Priority), Straight Line (control, rapport, certainty), AIDA (Attention, Interest, Desire, Action). A short cold call can't apply every framework fully — score what was reasonable for the call's length and stage, and say what the single most useful missing move was.

Scoring rubric (overall_score 0–100): 90+ exceptional — tight discovery, quantified pain, clear next step booked; 75–89 strong; 60–74 adequate with clear gaps; 40–59 weak — pitched before discovering, objections mishandled, no next step; below 40 harmful or unprofessional. Skills and frameworks are 0–10. Be calibrated and honest: a feature-dump pitch with no questions is weak even if the prospect was polite. Don't inflate scores to be kind — the coaching is only useful if it is accurate.

Every claim must be grounded in the transcript. Quote short phrases as evidence. If the transcript is short, garbled, one-sided or you are unsure who is speaking, lower "confidence", set needs_human_review to true and say why in review_reasons. For qualification_evidence, mark a field true only when the call contains explicit evidence for it.

Coaching must be specific and kind: name the exact moment, the issue, and an example line the salesperson can say next time.`;

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ maxRetries: 3, timeout: 5 * 60_000 });
  return client;
}

/** Server-side refusal fallbacks, where the configured model supports them. */
function fallbackParams() {
  return /claude-(opus-5|fable-5|sonnet-5-5)/.test(env.aiModel)
    ? { betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[], fallbacks: "default" as const }
    : {};
}

function stamp(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatTranscript(t: Transcript) {
  return t.utterances.map((u) => `[${stamp(u.start)}] ${u.speaker}: ${u.text}`).join("\n");
}

/** Talk-time metrics computed from timestamps once we know who's who. */
export function computeTalk(t: Transcript, repSpeakers: Set<string>) {
  let rep = 0, prospect = 0, repWords = 0, prospectWords = 0, longest = 0, run = 0;
  let last: string | null = null;
  for (const u of t.utterances) {
    const dur = Math.max(0, u.end - u.start);
    const words = u.text.split(/\s+/).filter(Boolean).length;
    const isRep = repSpeakers.has(u.speaker);
    if (isRep) { rep += dur; repWords += words; } else { prospect += dur; prospectWords += words; }
    run = isRep && last === "rep" ? run + dur : isRep ? dur : 0;
    if (isRep) longest = Math.max(longest, run);
    last = isRep ? "rep" : "prospect";
  }
  const total = rep + prospect;
  return {
    rep_talk_pct: total ? Math.round((rep / total) * 100) : 0,
    longest_monologue_sec: Math.round(longest),
    rep_words: repWords,
    prospect_words: prospectWords,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

function normalise(a: CallAnalysis): CallAnalysis {
  a.overall_score = Math.round(clamp(a.overall_score, 0, 100));
  a.confidence = clamp(a.confidence, 0, 1);
  a.prospect.temperature = Math.round(clamp(a.prospect.temperature, 0, 100));
  a.prospect.interest_level = clamp(a.prospect.interest_level, 0, 10);
  for (const k of SKILLS) a.skills[k] = clamp(a.skills[k], 0, 10);
  for (const f of a.frameworks) f.score = clamp(f.score, 0, 10);
  a.next_action.due_in_days = Math.round(clamp(a.next_action.due_in_days, 0, 60));
  return a;
}

interface CallContext {
  call_code: string;
  user_name: string;
  contact_name: string;
  company_name: string | null;
  designation: string | null;
  outcome: string | null;
  notes: string | null;
  call_count: number;
  previous_outcome: string | null;
}

function analysisPrompt(t: Transcript, ctx: CallContext) {
  return `CRM context
- Call ID: ${ctx.call_code}
- Salesperson: ${ctx.user_name}
- Prospect: ${ctx.contact_name}${ctx.designation ? `, ${ctx.designation}` : ""}${ctx.company_name ? ` at ${ctx.company_name}` : ""}
- Calls to this prospect so far (including this one): ${ctx.call_count}
- Previous call outcome: ${ctx.previous_outcome ?? "none"}
- Outcome the salesperson logged: ${ctx.outcome ?? "not logged yet"}
- Salesperson's notes: ${ctx.notes ?? "none"}

Transcript (speaker labels are from automatic diarisation and may need mapping):
${formatTranscript(t)}`;
}

async function claudeAnalysis(t: Transcript, ctx: CallContext): Promise<CallAnalysis> {
  const content = analysisPrompt(t, ctx);
  const msg = await anthropic().beta.messages.parse({
    model: env.aiModel,
    max_tokens: 16000,
    ...fallbackParams(),
    output_config: { effort: env.aiEffort, format: betaZodOutputFormat(CallAnalysisSchema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  if (msg.stop_reason === "refusal") throw new NonRetryable("The AI declined to analyse this call");
  if (msg.stop_reason === "max_tokens" || !msg.parsed_output) throw new Error("The analysis was cut short — will retry");
  return msg.parsed_output as CallAnalysis;
}

export class NonRetryable extends Error {}

/** Which model does the AI work right now ("" = none: demo analysis). */
export function activeModel() {
  if (env.aiProvider === "anthropic" && env.anthropicConfigured) return env.aiModel;
  if (env.aiProvider === "gemini" && env.geminiApiKey) return env.geminiModel;
  return "";
}

export const aiConfigured = () => Boolean(activeModel());
const useGemini = () => env.aiProvider === "gemini";

/** Analyse one call and store the results. Safe to run twice. */
export async function analyzeCall(callId: string, opts: { notify?: boolean } = {}) {
  const call = await db.maybe(
    `select k.*, u.full_name as user_name, c.full_name as contact_name, c.designation, c.call_count, co.name as company_name,
       (select p.outcome from crm_calls p where p.contact_id = k.contact_id and p.started_at < k.started_at and p.outcome is not null
         order by p.started_at desc limit 1) as previous_outcome
     from crm_calls k join crm_users u on u.id = k.user_id join crm_contacts c on c.id = k.contact_id
     left join crm_companies co on co.id = c.company_id where k.id = $1`,
    [callId],
  );
  if (!call) return null;
  const transcript = call.transcript as Transcript | null;
  if (!transcript?.utterances?.length) {
    await db.query(`update crm_calls set analysis_status = 'none' where id = $1`, [callId]);
    return null;
  }
  await db.query(`update crm_calls set analysis_status = 'processing' where id = $1`, [callId]);

  let analysis: CallAnalysis;
  let model: string;
  try {
    if (aiConfigured()) {
      analysis = useGemini()
        ? ((await geminiJson(CallAnalysisSchema, SYSTEM, [{ text: analysisPrompt(transcript, call) }])) as CallAnalysis)
        : await claudeAnalysis(transcript, call);
      model = activeModel();
    } else {
      analysis = heuristicAnalysis(transcript, call);
      model = "demo-heuristic";
    }
  } catch (e) {
    const permanent =
      e instanceof NonRetryable ||
      (e instanceof GeminiError && e.permanent) ||
      e instanceof Anthropic.BadRequestError ||
      e instanceof Anthropic.AuthenticationError ||
      e instanceof Anthropic.PermissionDeniedError ||
      e instanceof Anthropic.NotFoundError;
    await db.query(`update crm_calls set analysis_status = $2 where id = $1`, [callId, permanent ? "failed" : "queued"]);
    if (permanent) {
      console.error(`[analysis] ${call.call_code} failed permanently:`, (e as Error).message);
      return null;
    }
    throw e;
  }
  const needsReview = await persistAnalysis({ id: callId, user_id: call.user_id, contact_id: call.contact_id }, transcript, analysis, model);
  analysis = (await db.one(`select analysis from crm_calls where id = $1`, [callId])).analysis;

  await activity(call.contact_id, call.user_id, "ai", `AI analysis ready — ${analysis.overall_score}/100`, analysis.summary, { callId });
  publish(call.user_id, { type: "analysis.ready", data: { callId, score: analysis.overall_score } });
  broadcast({ type: "call.updated", data: { id: callId, analysis_status: needsReview ? "needs_review" : "done" } });
  if (opts.notify !== false) {
    await notify(call.user_id, "coaching", `Coaching ready for your call with ${call.contact_name}`, `Score ${analysis.overall_score}/100 — ${analysis.strengths[0] ?? "see what went well"}`, `/sales/calls/${callId}`);
  }
  return analysis;
}

/**
 * Stores an analysis: normalises scores, maps speakers to roles, computes
 * talk-time from the timestamps, and extracts objections/pain points/product
 * requests into crm_call_insights for team-wide trends. Returns whether the
 * result needs a human review.
 */
export async function persistAnalysis(
  call: { id: string; user_id: string; contact_id: string },
  transcript: Transcript,
  raw: CallAnalysis,
  model: string,
  at: Date = new Date(),
): Promise<boolean> {
  const analysis = normalise(raw);
  const roles: Record<string, "rep" | "prospect"> = { ...(transcript.roles ?? {}) };
  for (const r of analysis.speaker_roles ?? []) {
    if (!roles[r.speaker]) roles[r.speaker] = r.role === "salesperson" ? "rep" : "prospect";
  }
  const repSpeakers = new Set(Object.entries(roles).filter(([, r]) => r === "rep").map(([s]) => s));
  analysis.computed = computeTalk(transcript, repSpeakers);
  const needsReview = analysis.needs_human_review || analysis.confidence < 0.55;

  await db.tx(async (q) => {
    await q.query(
      `update crm_calls set analysis = $2::jsonb, analysis_status = $3, analysis_model = $4, score = $5, analyzed_at = $7,
         transcript = jsonb_set(transcript, '{roles}', $6::jsonb), updated_at = now()
       where id = $1`,
      [call.id, json(analysis), needsReview ? "needs_review" : "done", model, analysis.overall_score, json(roles), at],
    );
    await q.query(`delete from crm_call_insights where call_id = $1`, [call.id]);
    const insights: [string, string | null, string, string | null, string | null][] = [
      ...analysis.objections.map((o): [string, string, string, string, string] => ["objection", o.category, o.quote, o.better_response, o.handling === "not_addressed" ? "poorly" : o.handling]),
      ...analysis.pain_points.map((p): [string, null, string, null, null] => ["pain_point", null, p, null, null]),
      ...analysis.product_requests.map((p): [string, null, string, null, null] => ["product_request", null, p, null, null]),
      ...analysis.buying_signals.map((p): [string, null, string, null, null] => ["buying_signal", null, p, null, null]),
      ...analysis.competitors.map((p): [string, null, string, null, null] => ["competitor", null, p, null, null]),
      ...analysis.risks.map((p): [string, null, string, null, null] => ["risk", null, p, null, null]),
    ];
    for (const [kind, category, text, evidence, handled] of insights) {
      await q.query(
        `insert into crm_call_insights (call_id, user_id, contact_id, kind, category, text, evidence, handled, confidence, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [call.id, call.user_id, call.contact_id, kind, category, text, evidence, handled, analysis.confidence, at],
      );
    }
    await q.query(`update crm_contacts set temperature = $2 where id = $1`, [call.contact_id, analysis.prospect.temperature]);
  });
  return needsReview;
}

// ------------------------------------------------------------- daily rollup

export const DailyReportSchema = z.object({
  headline: z.string().describe("One punchy line summarising the day for leadership"),
  grade: z.enum(["A+", "A", "B+", "B", "C", "D"]),
  overall_score: z.number().describe("0–100 for the day"),
  executive_summary: z.string().describe("3–4 sentences for the CEO/COO"),
  wins: z.array(z.string()),
  concerns: z.array(z.string()),
  communication: z.string().describe("How the salesperson spoke today: tone, confidence, pace, listening"),
  conversation_handling: z.string().describe("How they handled conversations: discovery, objections, closing"),
  prospect_response: z.string().describe("How prospects responded across today's calls — patterns, sentiment, interest"),
  framework_breakdown: z.array(z.object({ framework: z.string(), score: z.number(), comment: z.string() })),
  objection_summary: z.array(z.object({ category: z.string(), count: z.number(), handling: z.string() })),
  best_call: z.object({ call_code: z.string(), why: z.string() }),
  toughest_call: z.object({ call_code: z.string(), why: z.string() }),
  coaching_plan: z.array(z.object({ focus: z.string(), drill: z.string(), example_line: z.string() })).describe("2–3 things to practise tomorrow"),
  product_feedback: z.array(z.string()).describe("What prospects asked for or complained about that product/founders should know"),
  manager_actions: z.array(z.string()).describe("What the sales head should do about this rep tomorrow"),
  tomorrow_targets: z.array(z.string()),
});

export type DailyReport = z.infer<typeof DailyReportSchema>;

const REPORT_SYSTEM = `You write the end-of-day sales performance report for one Focus Realm salesperson. The founders, sales heads and the Legion team read it in the CRM, so it must be accurate, specific, and readable in two minutes. You receive the day's computed activity metrics and the AI analysis of each of the day's recorded calls.

Ground every statement in the data provided. Use call IDs when you reference calls. Combine "how they spoke", "how they handled the conversation" and "how prospects responded" into clear patterns rather than repeating each call. Average the framework scores across analysed calls, and comment on what the trend means. Be fair: credit real progress, name real problems, and keep coaching actionable for tomorrow. If few calls were analysed, say so and temper conclusions.`;

export async function synthesiseDailyReport(input: {
  repName: string;
  date: string;
  metrics: Record<string, unknown>;
  calls: { call_code: string; outcome: string | null; duration_sec: number | null; contact: string; company: string | null; analysis: CallAnalysis | null }[];
}): Promise<{ report: DailyReport; model: string }> {
  const analysed = input.calls.filter((c) => c.analysis);
  if (!aiConfigured() || !analysed.length) {
    const { heuristicDailyReport } = await import("./analysis-heuristic.js");
    return { report: heuristicDailyReport(input), model: analysed.length ? "demo-heuristic" : "metrics-only" };
  }
  const compact = input.calls.map((c) => ({
    call_code: c.call_code,
    prospect: `${c.contact}${c.company ? ` (${c.company})` : ""}`,
    outcome: c.outcome,
    duration_sec: c.duration_sec,
    analysis: c.analysis
      ? {
          summary: c.analysis.summary,
          score: c.analysis.overall_score,
          skills: c.analysis.skills,
          frameworks: c.analysis.frameworks.map((f) => ({ f: f.framework, s: f.score, missed: f.missed })),
          talk: { ...c.analysis.talk, ...c.analysis.computed },
          prospect: c.analysis.prospect,
          objections: c.analysis.objections,
          pain_points: c.analysis.pain_points,
          product_requests: c.analysis.product_requests,
          strengths: c.analysis.strengths,
          improvements: c.analysis.improvements,
        }
      : null,
  }));
  const content = `Salesperson: ${input.repName}\nDate: ${input.date}\n\nComputed metrics:\n${JSON.stringify(input.metrics, null, 2)}\n\nCalls:\n${JSON.stringify(compact, null, 2)}`;
  let r: DailyReport;
  if (useGemini()) {
    r = await geminiJson(DailyReportSchema, REPORT_SYSTEM, [{ text: content }]);
  } else {
    const msg = await anthropic().beta.messages.parse({
      model: env.aiModel,
      max_tokens: 16000,
      ...fallbackParams(),
      output_config: { effort: env.aiEffort, format: betaZodOutputFormat(DailyReportSchema) },
      system: REPORT_SYSTEM,
      messages: [{ role: "user", content }],
    });
    if (msg.stop_reason === "refusal") throw new NonRetryable("The AI declined to write this report");
    if (!msg.parsed_output) throw new Error("The report was cut short — will retry");
    r = msg.parsed_output as DailyReport;
  }
  r.overall_score = Math.round(clamp(r.overall_score, 0, 100));
  return { report: r, model: activeModel() };
}

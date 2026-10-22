export type Role = "founder" | "sales_head" | "sales_rep" | "legion";
export type Portal = "sales" | "legion" | "founder";

export interface User {
  id: string;
  employee_code: string;
  email: string | null;
  full_name: string;
  phone: string | null;
  role: Role;
  title: string | null;
  department: string | null;
  status: "active" | "inactive" | "offboarded";
  must_change_password: boolean;
  avatar_hue: number;
  source: string;
  daily_call_target: number;
  portal: Portal;
}

export interface Meta {
  demoLogins: { employee_code: string; full_name: string; role: Role; title: string | null; avatar_hue: number }[];
  demoPassword: string | null;
  telephonyMode: "phone_link" | "bridge" | "demo";
  bridgeReady: boolean;
  aiConfigured: boolean;
  aiProvider: "anthropic" | "gemini" | null;
  aiModel: string | null;
  transcriptionConfigured: boolean;
  deepgramConfigured?: boolean;
  emailConfigured: boolean;
  storage: string;
  database: string;
  /** No founder exists yet: the sign-in page shows first-run setup. */
  setupNeeded: boolean;
  /** SETUP_CODE is configured on the server. */
  setupEnabled: boolean;
}

export type Stage = "prospect" | "qualified" | "legion_meet_1" | "legion_meet_2" | "legion_meet_3";

export interface Contact {
  id: string;
  full_name: string;
  designation: string | null;
  phone: string | null;
  phone_key: string | null;
  phone_display?: string | null;
  email: string | null;
  city: string | null;
  source: string | null;
  campaign: string | null;
  segment: string | null;
  tags: string[];
  stage: Stage;
  status: string;
  owner_id: string | null;
  owner_name?: string | null;
  owner_hue?: number | null;
  legion_owner_id: string | null;
  legion_owner_name?: string | null;
  do_not_contact: boolean;
  is_invalid: boolean;
  qualification: Record<string, boolean | string>;
  temperature: number | null;
  last_call_outcome: string | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  next_task_at?: string | null;
  next_task_title?: string | null;
  call_count: number;
  company_name: string | null;
  company_industry?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  meeting_at?: string | null;
}

export interface Utterance {
  speaker: string;
  role?: "rep" | "prospect";
  start: number;
  end: number;
  text: string;
}

export interface CallAnalysis {
  summary: string;
  language: string;
  call_type: string;
  outcome: string;
  overall_score: number;
  skills: Record<string, number>;
  frameworks: { framework: string; score: number; applied: string; missed: string }[];
  talk: { questions_asked: number; open_questions: number; interruptions: number; filler_words: number; pace: string };
  computed?: { rep_talk_pct: number; longest_monologue_sec: number; rep_words: number; prospect_words: number };
  prospect: {
    sentiment_start: string;
    sentiment_end: string;
    interest_level: number;
    temperature: number;
    decision_maker: string;
    engagement: string;
    response_summary: string;
    key_quotes: string[];
  };
  bant: Record<"budget" | "authority" | "need" | "timeline", { status: string; evidence: string }>;
  objections: { category: string; quote: string; handling: string; better_response: string }[];
  pain_points: string[];
  product_requests: string[];
  buying_signals: string[];
  competitors: string[];
  risks: string[];
  strengths: string[];
  improvements: { moment: string; issue: string; suggestion: string; example_line: string }[];
  next_action: { action: string; due_in_days: number; owner: string };
  qualification_evidence: Record<string, boolean>;
  confidence: number;
  needs_human_review: boolean;
  review_reasons: string[];
}

export interface Call {
  id: string;
  call_code: string;
  contact_id: string;
  user_id: string;
  mode: string;
  status: string;
  outcome: string | null;
  notes: string | null;
  started_at: string;
  duration_sec: number | null;
  recording_status: string;
  transcript_status: string;
  analysis_status: string;
  score: number | null;
  summary?: string | null;
  contact_name: string;
  company_name: string | null;
  user_name: string;
  user_hue?: number;
  transcript?: { provider: string; language?: string; utterances: Utterance[]; roles?: Record<string, "rep" | "prospect"> } | null;
  analysis?: CallAnalysis | null;
  analysis_model?: string | null;
  contact_phone_display?: string | null;
  review?: { verdict: string; note?: string; by: string; at: string } | null;
}

export interface Task {
  id: string;
  contact_id: string | null;
  assigned_to: string;
  created_by: string | null;
  kind: string;
  title: string;
  reason: string | null;
  due_at: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  status: "open" | "done" | "missed" | "cancelled";
  contact_name?: string | null;
  contact_phone?: string | null;
  company_name?: string | null;
  assignee_name?: string;
  assignee_hue?: number;
  created_by_name?: string | null;
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export interface DailyReport {
  headline: string;
  grade: string;
  overall_score: number;
  executive_summary: string;
  wins: string[];
  concerns: string[];
  communication: string;
  conversation_handling: string;
  prospect_response: string;
  framework_breakdown: { framework: string; score: number; comment: string }[];
  objection_summary: { category: string; count: number; handling: string }[];
  best_call: { call_code: string; why: string };
  toughest_call: { call_code: string; why: string };
  coaching_plan: { focus: string; drill: string; example_line: string }[];
  product_feedback: string[];
  manager_actions: string[];
  tomorrow_targets: string[];
}

import { env } from "../../env.js";
import { e164 } from "../../lib/phone.js";

/**
 * Telephony providers for "bridge" calling: the provider rings the
 * salesperson's own phone first (so the call shows up on their phone), then
 * dials the prospect and joins them — recording both sides on the provider's
 * side. This is the dependable way to record normal phone calls: a web page
 * can't capture a cellular call, and Android blocks most apps from doing so.
 *
 * Each provider reports progress and the recording URL to
 * /api/webhooks/telephony/:provider?call=<id>&token=<TELEPHONY_WEBHOOK_TOKEN>.
 */

export interface BridgeRequest {
  callId: string;
  repPhoneKey: string;
  prospectPhoneKey: string;
  consentText?: string | null;
}

export interface BridgeResult {
  providerRef: string;
  status: "initiated" | "ringing";
}

export interface ProviderEvent {
  status?: "ringing" | "in_progress" | "completed" | "failed" | "no_answer" | "busy";
  durationSec?: number;
  recordingUrl?: string;
  providerRef?: string;
}

export interface TelephonyProvider {
  name: "exotel" | "twilio";
  configured(): boolean;
  bridge(req: BridgeRequest): Promise<BridgeResult>;
  /** Normalises the provider's webhook body into a ProviderEvent. */
  parseWebhook(body: Record<string, any>): ProviderEvent;
  /** Downloads a recording URL with the provider's credentials. */
  fetchRecording(url: string): Promise<{ data: Buffer; mime: string }>;
}

function callbackUrl(provider: string, callId: string) {
  const u = new URL(`${env.publicApiUrl}/api/webhooks/telephony/${provider}`);
  u.searchParams.set("call", callId);
  u.searchParams.set("token", env.telephonyWebhookToken);
  return u.toString();
}

const exotel: TelephonyProvider = {
  name: "exotel",
  configured: () => Boolean(env.exotel.sid && env.exotel.apiKey && env.exotel.apiToken && env.exotel.callerId),
  async bridge(req) {
    const { sid, apiKey, apiToken, subdomain, callerId } = env.exotel;
    const form = new URLSearchParams({
      From: e164(req.repPhoneKey),
      To: e164(req.prospectPhoneKey),
      CallerId: callerId,
      Record: "true",
      RecordingChannels: "dual",
      CallType: "trans",
      TimeLimit: "3600",
      TimeOut: "40",
      CustomField: req.callId,
      StatusCallback: callbackUrl("exotel", req.callId),
      "StatusCallbackEvents[0]": "terminal",
      "StatusCallbackEvents[1]": "answered",
      StatusCallbackContentType: "application/json",
    });
    const res = await fetch(`https://${subdomain}/v1/Accounts/${sid}/Calls/connect.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(`Exotel refused the call: ${body?.RestException?.Message ?? res.status}`);
    return { providerRef: body?.Call?.Sid ?? "", status: "ringing" };
  },
  parseWebhook(b) {
    const map: Record<string, ProviderEvent["status"]> = {
      completed: "completed", failed: "failed", busy: "busy", "no-answer": "no_answer", answered: "in_progress",
      "in-progress": "in_progress", ringing: "ringing", canceled: "failed",
    };
    const status = map[String(b.Status ?? b.EventType ?? "").toLowerCase()];
    return {
      status,
      durationSec: Number(b.ConversationDuration ?? b.Duration ?? 0) || undefined,
      recordingUrl: b.RecordingUrl || undefined,
      providerRef: b.CallSid,
    };
  },
  async fetchRecording(url) {
    const { apiKey, apiToken } = env.exotel;
    const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString("base64")}` } });
    if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "audio/mpeg" };
  },
};

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
}

const twilio: TelephonyProvider = {
  name: "twilio",
  configured: () => Boolean(env.twilio.accountSid && env.twilio.authToken && env.twilio.callerId),
  async bridge(req) {
    const { accountSid, authToken, callerId } = env.twilio;
    const cb = callbackUrl("twilio", req.callId);
    const say = req.consentText ? `<Say voice="alice">${escapeXml(req.consentText)}</Say>` : "";
    const twiml = `<Response>${say}<Dial callerId="${escapeXml(callerId)}" record="record-from-answer-dual" recordingStatusCallback="${escapeXml(cb)}" recordingStatusCallbackEvent="completed"><Number statusCallback="${escapeXml(cb)}" statusCallbackEvent="answered completed">${e164(req.prospectPhoneKey)}</Number></Dial></Response>`;
    const form = new URLSearchParams({
      To: e164(req.repPhoneKey),
      From: callerId,
      Twiml: twiml,
      StatusCallback: cb,
      StatusCallbackEvent: "completed",
    });
    form.append("StatusCallbackEvent", "answered");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const body = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw new Error(`Twilio refused the call: ${body?.message ?? res.status}`);
    return { providerRef: body.sid, status: "ringing" };
  },
  parseWebhook(b) {
    if (b.RecordingUrl) {
      return { recordingUrl: `${b.RecordingUrl}.mp3`, durationSec: Number(b.RecordingDuration) || undefined, providerRef: b.CallSid };
    }
    const map: Record<string, ProviderEvent["status"]> = {
      completed: "completed", failed: "failed", busy: "busy", "no-answer": "no_answer", "in-progress": "in_progress",
      answered: "in_progress", ringing: "ringing", canceled: "failed",
    };
    return {
      status: map[String(b.CallStatus ?? b.DialCallStatus ?? "").toLowerCase()],
      durationSec: Number(b.CallDuration ?? b.DialCallDuration) || undefined,
      providerRef: b.ParentCallSid ?? b.CallSid,
    };
  },
  async fetchRecording(url) {
    const { accountSid, authToken } = env.twilio;
    const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}` } });
    if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), mime: res.headers.get("content-type") ?? "audio/mpeg" };
  },
};

export const providers = { exotel, twilio };

export function activeProvider(): TelephonyProvider | null {
  const p = env.telephonyProvider ? providers[env.telephonyProvider] : null;
  return p && p.configured() ? p : null;
}

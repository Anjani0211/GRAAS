import { config } from "../config";
import { logger } from "../utils/logger";

export type DeliveryResult =
  | { delivered: true; provider: string; providerId?: string }
  | { delivered: false; provider: "none"; reason: string };

/** Send email via Resend (https://resend.com). */
export async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<DeliveryResult> {
  if (!config.resendApiKey) {
    return { delivered: false, provider: "none", reason: "RESEND_API_KEY not configured" };
  }
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: config.emailFrom,
        to: [params.to],
        subject: params.subject,
        text: params.text,
        html: params.html ?? `<pre style="font-family:sans-serif">${escapeHtml(params.text)}</pre>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body }, "[Email] Resend failed");
      return { delivered: false, provider: "none", reason: `Resend HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as { id?: string };
    return { delivered: true, provider: "resend", providerId: data.id };
  } catch (err) {
    logger.warn({ err }, "[Email] send failed");
    return {
      delivered: false,
      provider: "none",
      reason: err instanceof Error ? err.message : "email send failed",
    };
  }
}

/** Send SMS via MSG91 flow API (India). Falls back to not delivered. */
export async function sendSms(params: {
  to: string;
  message: string;
}): Promise<DeliveryResult> {
  if (!config.msg91AuthKey) {
    return { delivered: false, provider: "none", reason: "MSG91_AUTH_KEY not configured" };
  }
  try {
    const mobile = params.to.replace(/\D/g, "").replace(/^91/, "");
    const payload: Record<string, unknown> = {
      template_id: config.msg91TemplateId || undefined,
      short_url: "0",
      recipients: [
        {
          mobiles: `91${mobile}`,
          VAR1: params.message.slice(0, 200),
        },
      ],
    };
    // If no template, use legacy sendhttp API
    if (!config.msg91TemplateId) {
      const qs = new URLSearchParams({
        authkey: config.msg91AuthKey,
        mobiles: `91${mobile}`,
        message: params.message.slice(0, 560),
        sender: config.msg91SenderId,
        route: "4",
        country: "91",
      });
      const resp = await fetch(`https://api.msg91.com/api/sendhttp.php?${qs}`, {
        signal: AbortSignal.timeout(15_000),
      });
      const text = await resp.text();
      if (!resp.ok) {
        return { delivered: false, provider: "none", reason: `MSG91 HTTP ${resp.status}` };
      }
      return { delivered: true, provider: "msg91", providerId: text.slice(0, 64) };
    }

    const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey: config.msg91AuthKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      const body = await resp.text();
      logger.warn({ status: resp.status, body }, "[SMS] MSG91 failed");
      return { delivered: false, provider: "none", reason: `MSG91 HTTP ${resp.status}` };
    }
    const data = (await resp.json()) as { request_id?: string };
    return { delivered: true, provider: "msg91", providerId: data.request_id };
  } catch (err) {
    logger.warn({ err }, "[SMS] send failed");
    return {
      delivered: false,
      provider: "none",
      reason: err instanceof Error ? err.message : "sms send failed",
    };
  }
}

export async function deliverNotification(params: {
  channel: "sms" | "email" | "whatsapp";
  recipient: string;
  message: string;
  subject?: string;
}): Promise<DeliveryResult> {
  if (params.channel === "email") {
    return sendEmail({
      to: params.recipient,
      subject: params.subject ?? "GRAAS case update",
      text: params.message,
    });
  }
  if (params.channel === "sms") {
    return sendSms({ to: params.recipient, message: params.message });
  }
  // WhatsApp: no free generic provider — queue only
  return {
    delivered: false,
    provider: "none",
    reason: "WhatsApp provider not configured (use email/SMS or Meta Cloud API later)",
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

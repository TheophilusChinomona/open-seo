import { env } from "cloudflare:workers";

// Resend transactional email transport for the hosted auth flows.
//
// Replaces the previous Loops-based senders. Resend is required rather than
// optional in hosted mode: verification, password reset, and invitations all
// fail closed without it, and the hosted auth gate refuses every /api/auth/*
// request until the config is present.
const RESEND_EMAILS_URL = "https://api.resend.com/emails";

// Resend rejects any request that does not carry a User-Agent header.
const RESEND_USER_AGENT = "open-seo-selfhost/1.0";

type EmailConfig = {
  apiKey: string;
  from: string;
};

function getOptionalEnv(name: string) {
  const value: unknown = Reflect.get(env, name);
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed || null;
}

function getRequiredEnv(name: string) {
  const value = getOptionalEnv(name);

  if (!value) {
    throw new Error(`${name} is required in hosted mode`);
  }

  return value;
}

function getHostedAuthEmailConfig(): EmailConfig {
  return {
    apiKey: getRequiredEnv("RESEND_API_KEY"),
    from: getRequiredEnv("RESEND_FROM_EMAIL"),
  };
}

type HostedAuthEmailEnv = {
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
};

// Mirrors getHostedAuthEmailConfig: both values must be present for hosted auth
// email to work, so a half-configured deployment is never treated as
// configured. Takes an env record (like hasHostedTurnstileConfig) so the hosted
// auth gate and the boot preflight can share one definition.
export function hasHostedAuthEmailConfig(envRecord: HostedAuthEmailEnv) {
  return Boolean(
    envRecord.RESEND_API_KEY?.trim() && envRecord.RESEND_FROM_EMAIL?.trim(),
  );
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmail({
  heading,
  body,
  ctaLabel,
  ctaUrl,
  footer,
}: {
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  footer: string;
}) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">${escapeHtml(heading)}</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.5;">${body}</p>
      <p style="margin:0 0 24px;">
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#000000;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-size:16px;">${escapeHtml(ctaLabel)}</a>
      </p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#6b7280;">${footer}</p>
    </div>
  </body>
</html>`;
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
}: {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
}) {
  const response = await fetch(RESEND_EMAILS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": RESEND_USER_AGENT,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (response.ok) {
    return;
  }

  // Log the status only: the response body and the request URL can carry the
  // recipient address and one-time tokens.
  console.error("Resend transactional email error:", {
    status: response.status,
    subject,
  });

  throw new Error(`Failed to send Resend email (${response.status})`);
}

export async function sendHostedVerificationEmail({
  email,
  confirmationUrl,
}: {
  email: string;
  confirmationUrl: string;
}) {
  const config = getHostedAuthEmailConfig();
  await sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    to: email,
    subject: "Confirm your OpenSEO email",
    html: renderEmail({
      heading: "Confirm your email",
      body: "Confirm your email address to finish setting up OpenSEO.",
      ctaLabel: "Verify my email",
      ctaUrl: confirmationUrl,
      footer: "If you did not create this account, you can ignore this email.",
    }),
  });
}

export async function sendHostedPasswordResetEmail({
  email,
  resetUrl,
}: {
  email: string;
  resetUrl: string;
}) {
  const config = getHostedAuthEmailConfig();
  await sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    to: email,
    subject: "Reset your OpenSEO password",
    html: renderEmail({
      heading: "Reset your password",
      body: "We received a request to reset the password for your OpenSEO account.",
      ctaLabel: "Reset password",
      ctaUrl: resetUrl,
      footer:
        "If you did not request a password reset, you can ignore this email.",
    }),
  });
}

export async function sendHostedInvitationEmail({
  email,
  inviteUrl,
  organizationName,
  inviterName,
  inviterEmail,
}: {
  email: string;
  inviteUrl: string;
  organizationName: string;
  inviterName: string;
  inviterEmail: string;
}) {
  const config = getHostedAuthEmailConfig();
  const inviter = escapeHtml(`${inviterName} (${inviterEmail})`);
  const organization = escapeHtml(organizationName);

  await sendResendEmail({
    apiKey: config.apiKey,
    from: config.from,
    to: email,
    subject: `You have been invited to ${organizationName} on OpenSEO`,
    html: renderEmail({
      heading: `You have been invited to ${organizationName}`,
      body: `${inviter} invited you to join ${organization} on OpenSEO.`,
      ctaLabel: "Accept invitation",
      ctaUrl: inviteUrl,
      footer: "If you were not expecting this invitation, you can ignore it.",
    }),
  });
}

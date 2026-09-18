import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mockEnv = vi.hoisted(() => ({
  RESEND_API_KEY: undefined as string | undefined,
  RESEND_FROM_EMAIL: undefined as string | undefined,
}));

vi.mock("cloudflare:workers", () => ({ env: mockEnv }));

import {
  hasHostedAuthEmailConfig,
  sendHostedInvitationEmail,
  sendHostedPasswordResetEmail,
  sendHostedVerificationEmail,
} from "./resend";

const FROM = "OpenSEO <no-reply@mail.example.com>";

function okResponse() {
  return new Response(null, { status: 200 });
}

// Parsed with zod rather than read off a JSON.parse result so every field is
// typed — the type-aware lint rules reject member access on an `any` value.
const sentEmailSchema = z.object({
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  html: z.string(),
});

// Structurally typed rather than RequestInit: the Workers-flavoured
// RequestInit<CfProperties> from fetch's parameter tuple is not assignable to
// the global RequestInit, and this helper only ever reads `body`.
function sentEmail(init: { body?: BodyInit | null } | undefined) {
  const body = init?.body;
  // Narrow instead of stringifying: BodyInit can also be a stream/Blob, and
  // String() on those would silently produce "[object Object]".
  if (typeof body !== "string") {
    throw new Error("expected the Resend request body to be a string");
  }

  return sentEmailSchema.parse(JSON.parse(body));
}

describe("hosted auth email config", () => {
  it("is configured only when both Resend values are present", () => {
    expect(
      hasHostedAuthEmailConfig({
        RESEND_API_KEY: "re_x",
        RESEND_FROM_EMAIL: FROM,
      }),
    ).toBe(true);
    expect(hasHostedAuthEmailConfig({ RESEND_API_KEY: "re_x" })).toBe(false);
    expect(hasHostedAuthEmailConfig({ RESEND_FROM_EMAIL: FROM })).toBe(false);
    // Whitespace-only values are not configuration.
    expect(
      hasHostedAuthEmailConfig({
        RESEND_API_KEY: "re_x",
        RESEND_FROM_EMAIL: " ",
      }),
    ).toBe(false);
  });
});

describe("Resend transactional senders", () => {
  beforeEach(() => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.RESEND_FROM_EMAIL = FROM;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends the verification email with the confirmation link", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedVerificationEmail({
      email: "user@example.com",
      confirmationUrl: "https://seo.example.com/verify?token=abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    // Resend rejects requests that carry no User-Agent.
    expect(new Headers(init?.headers).get("User-Agent")).toBeTruthy();
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Bearer re_test_key",
    );

    const body = sentEmail(fetchMock.mock.calls[0][1]);
    expect(body.from).toBe(FROM);
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.html).toContain("https://seo.example.com/verify?token=abc");
  });

  it("sends the password reset email", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedPasswordResetEmail({
      email: "user@example.com",
      resetUrl: "https://seo.example.com/reset?token=xyz",
    });

    const body = sentEmail(fetchMock.mock.calls[0][1]);
    expect(body.html).toContain("https://seo.example.com/reset?token=xyz");
    expect(body.subject).toContain("Reset");
  });

  it("sends the invitation email", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedInvitationEmail({
      email: "invitee@example.com",
      inviteUrl: "https://seo.example.com/invite?token=inv",
      organizationName: "Acme",
      inviterName: "Theo",
      inviterEmail: "theo@example.com",
    });

    const body = sentEmail(fetchMock.mock.calls[0][1]);
    expect(body.html).toContain("https://seo.example.com/invite?token=inv");
    expect(body.html).toContain("Acme");
  });

  it("escapes HTML in invitation values", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedInvitationEmail({
      email: "invitee@example.com",
      inviteUrl: "https://seo.example.com/invite?token=inv",
      organizationName: "<script>alert(1)</script>",
      inviterName: "A & B",
      inviterEmail: "theo@example.com",
    });

    const body = sentEmail(fetchMock.mock.calls[0][1]);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("A &amp; B");
  });

  it("throws on a rejected send without logging the token or recipient", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 422 })),
    );

    await expect(
      sendHostedPasswordResetEmail({
        email: "user@example.com",
        resetUrl: "https://seo.example.com/reset?token=secret-token",
      }),
    ).rejects.toThrow("Failed to send Resend email (422)");

    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("user@example.com");
    expect(logged).not.toContain("re_test_key");
  });

  it("fails closed when the Resend config is absent", async () => {
    mockEnv.RESEND_API_KEY = undefined;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendHostedVerificationEmail({
        email: "user@example.com",
        confirmationUrl: "https://seo.example.com/verify?token=abc",
      }),
    ).rejects.toThrow("RESEND_API_KEY is required in hosted mode");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

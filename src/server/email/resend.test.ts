import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  return { ok: true, status: 200 } as Response;
}

describe("hosted auth email config", () => {
  beforeEach(() => {
    mockEnv.RESEND_API_KEY = "re_test_key";
    mockEnv.RESEND_FROM_EMAIL = FROM;
  });

  it("is configured only when both Resend values are present", () => {
    expect(
      hasHostedAuthEmailConfig({ RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: FROM }),
    ).toBe(true);
    expect(
      hasHostedAuthEmailConfig({ RESEND_API_KEY: "re_x" }),
    ).toBe(false);
    expect(
      hasHostedAuthEmailConfig({ RESEND_FROM_EMAIL: FROM }),
    ).toBe(false);
    // Whitespace-only values are not configuration.
    expect(
      hasHostedAuthEmailConfig({ RESEND_API_KEY: "re_x", RESEND_FROM_EMAIL: " " }),
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
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedVerificationEmail({
      email: "user@example.com",
      confirmationUrl: "https://seo.example.com/verify?token=abc",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    // Resend rejects requests without a User-Agent.
    expect(init.headers["User-Agent"]).toBeTruthy();
    expect(init.headers.Authorization).toBe("Bearer re_test_key");

    const body = JSON.parse(init.body);
    expect(body.from).toBe(FROM);
    expect(body.to).toEqual(["user@example.com"]);
    expect(body.html).toContain("https://seo.example.com/verify?token=abc");
  });

  it("sends the password reset email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedPasswordResetEmail({
      email: "user@example.com",
      resetUrl: "https://seo.example.com/reset?token=xyz",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toContain("https://seo.example.com/reset?token=xyz");
    expect(body.subject).toContain("Reset");
  });

  it("sends the invitation email", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedInvitationEmail({
      email: "invitee@example.com",
      inviteUrl: "https://seo.example.com/invite?token=inv",
      organizationName: "Acme",
      inviterName: "Theo",
      inviterEmail: "theo@example.com",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).toContain("https://seo.example.com/invite?token=inv");
    expect(body.html).toContain("Acme");
  });

  it("escapes HTML in invitation values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchMock);

    await sendHostedInvitationEmail({
      email: "invitee@example.com",
      inviteUrl: "https://seo.example.com/invite?token=inv",
      organizationName: "<script>alert(1)</script>",
      inviterName: "A & B",
      inviterEmail: "theo@example.com",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
    expect(body.html).toContain("A &amp; B");
  });

  it("throws on a rejected send without logging the token or recipient", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422 } as Response),
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
    const fetchMock = vi.fn().mockResolvedValue(okResponse());
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

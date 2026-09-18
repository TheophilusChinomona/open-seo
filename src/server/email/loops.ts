import { env } from "cloudflare:workers";
import {
  getContactNameParts,
  updateLoopsContact,
} from "@/server/email/loops-client";

// Loops is an OPTIONAL marketing integration: it mirrors signups (and billing
// status, see billing/loops-sync.ts) into a Loops audience. It is NOT used for
// authentication email — verification, password reset, and invitations are sent
// through Resend (see email/resend.ts). Without LOOPS_API_KEY every function
// here is a no-op, so auth keeps working on a deployment that never configures
// Loops.

function getOptionalEnv(name: string) {
  const value: unknown = Reflect.get(env, name);
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed || null;
}

export async function upsertHostedSignupContact({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name?: string | null;
}) {
  const apiKey = getOptionalEnv("LOOPS_API_KEY");

  if (!apiKey) {
    console.warn(
      "Skipping Loops signup contact sync: LOOPS_API_KEY is not set",
    );
    return;
  }

  await updateLoopsContact({
    apiKey,
    payload: {
      email,
      userId,
      source: "openseo-signup",
      userGroup: "app-user",
      ...getContactNameParts(name),
    },
    logContext: { action: "signup-contact-sync" },
  });
}

import { env } from "cloudflare:workers";

type DatabaseProvider = "d1" | "postgres";

export function getDatabaseProvider(): DatabaseProvider {
  const provider = Reflect.get(env, "DATABASE_PROVIDER");

  if (provider === "postgres") {
    return "postgres";
  }

  if (provider === "d1" || provider === undefined || provider === "") {
    return "d1";
  }

  throw new Error(
    `Unsupported DATABASE_PROVIDER "${String(provider)}". Expected "d1" or "postgres".`,
  );
}

// Cloudflare deployments use the HYPERDRIVE binding. Self-hosted Docker has no
// binding, so it uses the protected runtime connection string instead.
export function getPostgresConnectionString() {
  const hyperdrive = Reflect.get(env, "HYPERDRIVE") as
    | { connectionString?: string }
    | undefined;
  const hyperdriveUrl = hyperdrive?.connectionString?.trim();
  if (hyperdriveUrl) {
    return hyperdriveUrl;
  }

  const dockerUrl = Reflect.get(env, "POSTGRES_DATABASE_URL");
  if (typeof dockerUrl === "string" && dockerUrl.trim()) {
    return dockerUrl.trim();
  }

  throw new Error(
    "DATABASE_PROVIDER=postgres requires HYPERDRIVE or POSTGRES_DATABASE_URL. Set POSTGRES_DATABASE_URL for Docker deployments.",
  );
}

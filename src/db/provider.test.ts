import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  DATABASE_PROVIDER: "postgres" as string | undefined,
  HYPERDRIVE: undefined as { connectionString?: string } | undefined,
  POSTGRES_DATABASE_URL: undefined as string | undefined,
}));

vi.mock("cloudflare:workers", () => ({ env: mockEnv }));

import {
  getDatabaseProvider,
  getPostgresConnectionString,
} from "@/db/provider";

describe("database provider", () => {
  beforeEach(() => {
    mockEnv.DATABASE_PROVIDER = "postgres";
    mockEnv.HYPERDRIVE = undefined;
    mockEnv.POSTGRES_DATABASE_URL = undefined;
  });

  it("prefers the Hyperdrive connection when it is available", () => {
    mockEnv.HYPERDRIVE = { connectionString: " postgres://hyperdrive " };
    mockEnv.POSTGRES_DATABASE_URL = "postgres://docker";

    expect(getPostgresConnectionString()).toBe("postgres://hyperdrive");
  });

  it("uses the protected Docker connection string without Hyperdrive", () => {
    mockEnv.POSTGRES_DATABASE_URL = " postgres://open-seo-app ";

    expect(getPostgresConnectionString()).toBe("postgres://open-seo-app");
  });

  it("fails closed when Postgres has no connection configuration", () => {
    expect(() => getPostgresConnectionString()).toThrow(
      "DATABASE_PROVIDER=postgres requires HYPERDRIVE or POSTGRES_DATABASE_URL",
    );
  });

  it("defaults unset and empty providers to D1", () => {
    mockEnv.DATABASE_PROVIDER = undefined;
    expect(getDatabaseProvider()).toBe("d1");

    mockEnv.DATABASE_PROVIDER = "";
    expect(getDatabaseProvider()).toBe("d1");
  });
});

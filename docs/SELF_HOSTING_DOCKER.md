# Docker Self-Hosting

Run OpenSEO locally with Docker.

In Docker mode, OpenSEO uses `AUTH_MODE=local_noauth` (no auth checks, local admin user `admin@localhost`). Only expose it behind your own auth-protected reverse proxy, tunnel, or private network.

The default `compose.yaml` uses the published GHCR image:

- `ghcr.io/every-app/open-seo:latest`

## Prerequisites

- Docker Desktop (or Docker Engine + Docker Compose)
- A DataForSEO API key (see [`DATAFORSEO_API_KEY.md`](./DATAFORSEO_API_KEY.md))

## Quickstart

```bash
cp .env.example .env
```

Set `DATAFORSEO_API_KEY` in `.env` using the [DataForSEO setup guide](./DATAFORSEO_API_KEY.md), then start OpenSEO:

```bash
docker compose up -d
```

Open `http://localhost:<PORT>` (default `3001`). The first start builds the app and may take 1-2 minutes; follow progress with `docker compose logs -f`.

Optional env values:

- `PORT` (defaults to `3001`)
- `ALLOWED_HOST` (single reverse-proxy hostname to allow in Vite preview)
- `AUTH_MODE=local_noauth` (already set in compose)
- `OPEN_SEO_IMAGE` (defaults to `ghcr.io/every-app/open-seo:latest`)
- `OPENROUTER_API_KEY` (required for AI features such as SAM; see [OpenRouter](https://openrouter.ai/settings/keys))

If you are putting Docker behind a reverse proxy or a temporary tunnel, remember that Docker self-hosting runs with app auth disabled. Only expose it behind your own auth-protected reverse proxy, tunnel, or private network, and add the public hostname before restarting:

```bash
ALLOWED_HOST=yourdomain.com docker compose up -d
```

You can also persist it in `.env`.

## Telemetry

OpenSEO collects anonymized telemetry for core usage events: heartbeats with aggregate counts (installs, users, projects, feature usage) tied to a random install ID, sent every 5 minutes during the first two hours after install, then at most once daily. Telemetry also includes failed setup check names and statuses, never values or error messages. No URLs, keywords, prompts, emails, or IP-derived location are collected, and idle installs send nothing.

To disable it, set `OPENSEO_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) in `.env`, then run `docker compose up -d --force-recreate open-seo`.

## Pin to a specific image tag

Set `OPEN_SEO_IMAGE` in `.env` and restart:

```bash
OPEN_SEO_IMAGE=ghcr.io/every-app/open-seo:v1.2.3
docker compose up -d
```

## Build your own image locally

If you are testing local code changes, build and run a local tag:

```bash
docker build -f Dockerfile.selfhost -t open-seo:local .
OPEN_SEO_IMAGE=open-seo:local docker compose up -d
```

## Common commands

- Restart service after env changes:

```bash
docker compose up -d open-seo
```

- Pull latest published image and restart:

```bash
docker compose pull && docker compose up -d
```

- Stop:

```bash
docker compose down
```

## Health and troubleshooting

Startup checks appear in `docker compose logs` before the build. Once running, `/api/health` reports configuration and database status, and `docker compose ps` reports container health.

## Hosted Better Auth with private PostgreSQL

For a multi-organization deployment, keep the base Compose file as the local
no-auth rollback and apply the hosted overlay:

```bash
docker network create --internal open-seo-db
cp .env.example .env
# Set the hosted variables below in .env or in the deployment secret store.
docker compose -f compose.yaml -f compose.hosted.yaml up -d
```

The overlay requires `AUTH_MODE=hosted`, `DATABASE_PROVIDER=postgres`,
`BETTER_AUTH_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters,
the Google OAuth credentials, all three Loops transactional email variables,
and `POSTGRES_DATABASE_URL`. The URL must target the private PostgreSQL
network and the `open_seo` database using the least-privilege
`open_seo_app` role. URL-encode reserved characters in its password.

Before starting the app, attach the PostgreSQL container to the exact same
external network. Apply `drizzle-pg` migrations with the protected connection
string, never with a PostgreSQL administrator URL. Do not publish PostgreSQL's
port. Keep `compose.yaml` and its `open_seo_data` volume unchanged until the
hosted deployment has passed authenticated acceptance and the rollback window.

The overlay explicitly forwards the auth, database, model, email, DataForSEO,
and OpenRouter settings. It does not support `BYPASS_EMAIL_VERIFICATION`; do
not set that variable in production.

For Dokploy, use the standalone `compose.dokploy-hosted.yaml` definition from
the fork's `main` branch. It includes the image, persistent volume, and both
external networks (`dokploy-network` and the private PostgreSQL network), so it
does not depend on a local `.env` file. Keep auto-deploy disabled until the
manual staging and authenticated acceptance checks pass.

## Troubleshooting environment variables

To confirm Docker Compose is using the expected environment variables:

```bash
docker compose config
```

Check that `AUTH_MODE=local_noauth`, and that `DATAFORSEO_API_KEY` is the base64
encoded value of your DataForSEO email and API password in this format:
`email:password`.

If you changed `.env`, recreate the container so Compose reapplies it:

```bash
docker compose up -d --force-recreate open-seo
```

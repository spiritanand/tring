# Tring

A chat agent that books, cancels and reschedules appointments for a single-doctor clinic. The design is in [docs/spec.md](docs/spec.md).

## Run locally

```sh
pnpm install
cp .env.example .env.local   # then add OPENAI_API_KEY
pnpm db:push
pnpm dev
```

The patient chat is at `/` and the clinic side is at `/desk`.

## Checks

```sh
pnpm test        # slot maths, guarded booking writes and conversation rules (stub model)
pnpm typecheck
pnpm lint
pnpm exec tsx --env-file=.env.local scripts/probe-model.mts   # eight sentences through the live model
```

## Deploy

The app runs on Vercel with a Turso database. Set these environment variables on the Vercel project:

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | your OpenAI key |
| `TRING_MODEL` | `gpt-6-luna` |
| `TURSO_DATABASE_URL` | from `turso db show tring --url` |
| `TURSO_AUTH_TOKEN` | from `turso db tokens create tring` |

Apply the schema to a new database with `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... pnpm exec drizzle-kit migrate`.

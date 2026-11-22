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

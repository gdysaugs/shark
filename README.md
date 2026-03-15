# XM Chat

Simple chat site that uses:
- Supabase (Google OAuth + message storage)
- OpenAI API (via Cloudflare Pages Functions)

## Setup

1) Install deps
```
npm install
```

2) Env vars
Create `.env` from `.env.example`:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
VITE_SUPABASE_REDIRECT_URL=https://sharkai.uk
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

3) Supabase table
```
create table public.chat_messages (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  character_id text not null,
  role text not null,
  content text not null,
  created_at timestamp with time zone not null default now(),
  constraint chat_messages_pkey primary key (id)
);

create index if not exists chat_messages_user_idx on public.chat_messages using btree (user_id);
create index if not exists chat_messages_character_idx on public.chat_messages using btree (character_id);
```

4) Run locally
```
npm run dev
```

## Cloudflare Pages

Project:
```
shark
```

Production branch:
```
main
```

Build command:
```bash
npm run build
```

Output dir:
```bash
dist
```

Deploy to `shark` (with `functions/`):
```bash
npm run pages:deploy
```

Local Pages runtime (with `functions/`):
```bash
npm run pages:dev
```

Set function environment variables in:
`Cloudflare Pages -> shark -> Settings -> Environment variables`

Functions env keys used in this repo:
```bash
COMFY_ORG_API_KEY
R2_REGION
RUNPOD_API_KEY
RUNPOD_ENDPOINT_URL
RUNPOD_QWEN_ENDPOINT_URL
RUNPOD_WAN_ENDPOINT_URL
RUNPOD_WAN_RAPID_ENDPOINT_URL
RUNPOD_WAN_REMIX_ENDPOINT_URL
RUNPOD_WORKER_MODE
RUNPOD_ZIMAGE_ENDPOINT_URL
SOVITS_FRAGMENT_INTERVAL
SOVITS_SPEED_FACTOR
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_REDIRECT_URL
VITE_SUPABASE_URL
```

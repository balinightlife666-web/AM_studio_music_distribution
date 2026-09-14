create table if not exists public.am_sessions (
  token_hash text primary key,
  user_id text not null,
  display_name text not null,
  organization_id text not null,
  environment text not null default 'DEV_SANDBOX',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists public.am_releases (
  id text primary key,
  owner_id text not null,
  status text not null,
  payload jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.am_assets (
  id text primary key,
  owner_id text not null,
  kind text not null,
  file_name text not null,
  mime text not null,
  size_bytes bigint not null,
  checksum text not null,
  status text not null,
  storage_key text,
  verified_checksum text,
  duration_ms bigint not null default 0,
  width integer not null default 0,
  height integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.am_audit_events (
  id text primary key,
  actor_id text not null,
  action text not null,
  entity_id text not null,
  prior_state text,
  next_state text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.am_royalty_ledger (
  id text primary key,
  owner_id text not null,
  event_type text not null,
  bucket text not null,
  amount_minor bigint not null,
  currency text not null,
  source_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.am_provider_config (
  provider_key text primary key,
  display_name text not null,
  mode text not null default 'DISABLED',
  contract_status text not null default 'NOT_CONTRACTED',
  credentials_status text not null default 'NOT_CONFIGURED',
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.am_provider_deliveries (
  id text primary key,
  release_id text not null,
  provider_key text not null,
  status text not null,
  provider_release_id text,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists am_sessions_expires_idx on public.am_sessions(expires_at);
create index if not exists am_releases_owner_updated_idx on public.am_releases(owner_id, updated_at desc);
create index if not exists am_assets_owner_created_idx on public.am_assets(owner_id, created_at desc);
create index if not exists am_audit_entity_created_idx on public.am_audit_events(entity_id, created_at desc);
create index if not exists am_royalty_owner_created_idx on public.am_royalty_ledger(owner_id, created_at asc);
create index if not exists am_provider_delivery_release_idx on public.am_provider_deliveries(release_id, created_at desc);

alter table public.am_sessions enable row level security;
alter table public.am_releases enable row level security;
alter table public.am_assets enable row level security;
alter table public.am_audit_events enable row level security;
alter table public.am_royalty_ledger enable row level security;
alter table public.am_provider_config enable row level security;
alter table public.am_provider_deliveries enable row level security;

insert into storage.buckets (id, name, public)
values ('am-studio-assets', 'am-studio-assets', false)
on conflict (id) do update set public = excluded.public;

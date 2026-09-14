CREATE TABLE IF NOT EXISTS am_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'DEV_SANDBOX',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_releases (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL,
  storage_key TEXT,
  verified_checksum TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  prior_state TEXT,
  next_state TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_royalty_ledger (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  bucket TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  source_ref TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_provider_config (
  provider_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'DISABLED',
  contract_status TEXT NOT NULL DEFAULT 'NOT_CONTRACTED',
  credentials_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_provider_deliveries (
  id TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_release_id TEXT,
  last_error TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS am_admin_credentials (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS am_sessions_expires_idx ON am_sessions(expires_at);
CREATE INDEX IF NOT EXISTS am_releases_owner_updated_idx ON am_releases(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS am_assets_owner_created_idx ON am_assets(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS am_audit_entity_created_idx ON am_audit_events(entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS am_royalty_owner_created_idx ON am_royalty_ledger(owner_id, created_at ASC);
CREATE INDEX IF NOT EXISTS am_provider_delivery_release_idx ON am_provider_deliveries(release_id, created_at DESC);

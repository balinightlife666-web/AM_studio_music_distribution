const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};
const MAX_BYTES = 50 * 1024 * 1024;
const EDITABLE = new Set(['DRAFT', 'PREFLIGHT_REQUIRED', 'NEEDS_CHANGES']);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...cors(), ...headers },
  });
}

function cors() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type, x-am-client, x-am-admin-token, x-am-admin-bootstrap',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS',
  };
}

function apiError(status, code, message, issues) {
  const error = { code, message, requestId: requestId() };
  if (issues !== undefined) error.issues = issues;
  return json({ error }, status);
}

function requestId() {
  return `req_${crypto.randomUUID().replaceAll('-', '')}`;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function now() {
  return new Date().toISOString();
}


const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS am_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    environment TEXT NOT NULL DEFAULT 'DEV_SANDBOX',
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS am_releases (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    status TEXT NOT NULL,
    payload TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS am_assets (
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
  )`,
  `CREATE TABLE IF NOT EXISTS am_audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    prior_state TEXT,
    next_state TEXT,
    meta TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS am_royalty_ledger (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    bucket TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,
    source_ref TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS am_provider_config (
    provider_key TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'DISABLED',
    contract_status TEXT NOT NULL DEFAULT 'NOT_CONTRACTED',
    credentials_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    enabled INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS am_provider_deliveries (
    id TEXT PRIMARY KEY,
    release_id TEXT NOT NULL,
    provider_key TEXT NOT NULL,
    status TEXT NOT NULL,
    provider_release_id TEXT,
    last_error TEXT,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS am_admin_credentials (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS am_sessions_expires_idx ON am_sessions(expires_at)',
  'CREATE INDEX IF NOT EXISTS am_releases_owner_updated_idx ON am_releases(owner_id, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS am_assets_owner_created_idx ON am_assets(owner_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS am_audit_entity_created_idx ON am_audit_events(entity_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS am_royalty_owner_created_idx ON am_royalty_ledger(owner_id, created_at ASC)',
  'CREATE INDEX IF NOT EXISTS am_provider_delivery_release_idx ON am_provider_deliveries(release_id, created_at DESC)',
];

let schemaReady = null;

async function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch(SCHEMA_STATEMENTS.map(statement => env.DB.prepare(statement)))
      .catch(error => {
        schemaReady = null;
        throw error;
      });
  }
  await schemaReady;
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function safeJson(value, fallback = {}) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '')); } catch { return fallback; }
}

function canonicalPayload(input = {}) {
  const rawDestinations = Array.isArray(input.destinations) ? input.destinations : [];
  const destinations = [...new Set(rawDestinations.map(clean).filter(Boolean))];
  return {
    title: clean(input.title),
    artistName: clean(input.artistName),
    labelName: clean(input.labelName) || 'AM STUDIO',
    genre: clean(input.genre),
    releaseDate: clean(input.releaseDate),
    songwriter: clean(input.songwriter),
    composer: clean(input.composer),
    copyrightOwner: clean(input.copyrightOwner),
    explicitContent: Boolean(input.explicitContent),
    rightsConfirmed: Boolean(input.rightsConfirmed),
    audioAssetId: clean(input.audioAssetId),
    artworkAssetId: clean(input.artworkAssetId),
    destinations,
  };
}

function normalizeChecksum(value) {
  const raw = clean(value).toLowerCase();
  const digest = raw.startsWith('sha256:') ? raw.slice(7) : raw;
  return /^[a-f0-9]{64}$/.test(digest) ? `sha256:${digest}` : '';
}

function hex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function sha256Bytes(value) {
  return `sha256:${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))}`;
}

function opaqueToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function apiPath(url) {
  return url.pathname.replace(/^\/api/, '') || '/health';
}

async function audit(env, actorId, action, entityId, priorState = null, nextState = null, meta = {}) {
  await env.DB.prepare(
    'INSERT INTO am_audit_events (id, actor_id, action, entity_id, prior_state, next_state, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(newId('aud'), actorId, action, entityId, priorState, nextState, JSON.stringify(meta || {}), now()).run();
}

async function requireSession(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256Text(token);
  const row = await env.DB.prepare(
    'SELECT user_id, display_name, organization_id, environment, expires_at FROM am_sessions WHERE token_hash = ? AND expires_at > ? LIMIT 1'
  ).bind(tokenHash, now()).first();
  if (!row) return null;
  return {
    id: row.user_id,
    displayName: row.display_name,
    roles: ['SANDBOX_USER'],
    organizationId: row.organization_id,
    kycState: 'NOT_CONNECTED',
    payoutEligibility: false,
    environment: row.environment,
  };
}

async function adminConfigured(env) {
  if (clean(env.AM_STUDIO_ADMIN_TOKEN)) return true;
  const row = await env.DB.prepare("SELECT id FROM am_admin_credentials WHERE id = 'primary' LIMIT 1").first();
  return Boolean(row);
}

async function requireAdmin(request, env) {
  const auth = request.headers.get('authorization') || '';
  const supplied = clean(request.headers.get('x-am-admin-token')) || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
  if (!supplied) return false;
  const suppliedHash = await sha256Text(supplied);

  const envToken = clean(env.AM_STUDIO_ADMIN_TOKEN);
  if (envToken && suppliedHash === await sha256Text(envToken)) return true;

  const row = await env.DB.prepare("SELECT token_hash FROM am_admin_credentials WHERE id = 'primary' LIMIT 1").first();
  return Boolean(row && row.token_hash === suppliedHash);
}

async function releaseById(env, id, ownerId = '') {
  const query = ownerId
    ? env.DB.prepare('SELECT id, owner_id, status, payload, revision, created_at, updated_at FROM am_releases WHERE id = ? AND owner_id = ? LIMIT 1').bind(id, ownerId)
    : env.DB.prepare('SELECT id, owner_id, status, payload, revision, created_at, updated_at FROM am_releases WHERE id = ? LIMIT 1').bind(id);
  const row = await query.first();
  if (!row) return null;
  return {
    id: row.id,
    ownerId: row.owner_id,
    status: row.status,
    ...safeJson(row.payload),
    revision: Number(row.revision || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function handleHealth(env) {
  let database = false;
  let storage = false;
  try {
    await env.DB.prepare('SELECT 1 AS ok').first();
    database = true;
  } catch {}
  try {
    storage = Boolean(env.ASSETS_BUCKET);
  } catch {}
  return json({
    ok: database && storage,
    service: 'am-studio-distribution-backend',
    environment: 'DEV_SANDBOX',
    host: 'CLOUDFLARE',
    database: database ? 'D1' : 'UNAVAILABLE',
    objectStorage: storage ? 'R2' : 'UNAVAILABLE',
    distributionProvider: 'disabled',
    dspDeliveryEnabled: false,
    payoutEnabled: false,
    royaltyLedger: 'APPEND_ONLY_SANDBOX',
    adminConfigured: await adminConfigured(env),
    timestamp: now(),
  }, database && storage ? 200 : 503);
}

async function handleCreateSession(env) {
  const createdAt = now();
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const token = opaqueToken();
  const tokenHash = await sha256Text(token);
  const userId = 'usr_sandbox_owner';
  const displayName = 'AM STUDIO Sandbox Owner';
  const organizationId = 'org_am_studio';

  await env.DB.prepare('DELETE FROM am_sessions WHERE expires_at <= ?').bind(createdAt).run();
  await env.DB.prepare(
    'INSERT INTO am_sessions (token_hash, user_id, display_name, organization_id, environment, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(tokenHash, userId, displayName, organizationId, 'DEV_SANDBOX', createdAt, expiresAt).run();

  return json({
    token,
    tokenType: 'Bearer',
    expiresInSeconds: 43200,
    environment: 'DEV_SANDBOX',
    user: {
      id: userId,
      displayName,
      roles: ['SANDBOX_USER'],
      organizationId,
      kycState: 'NOT_CONNECTED',
      payoutEligibility: false,
      environment: 'DEV_SANDBOX',
    },
    requestId: requestId(),
  }, 201);
}

async function handleMe(request, env) {
  const user = await requireSession(request, env);
  return user ? json({ ...user, requestId: requestId() }) : apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
}

async function handleWallet(request, env) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const result = await env.DB.prepare(
    'SELECT currency, bucket, COALESCE(SUM(amount_minor), 0) AS amount_minor FROM am_royalty_ledger WHERE owner_id = ? GROUP BY currency, bucket ORDER BY currency, bucket'
  ).bind(user.id).all();
  const currencies = {};
  for (const row of result.results || []) {
    if (!currencies[row.currency]) currencies[row.currency] = { PENDING: 0, AVAILABLE: 0, HELD: 0, PAID: 0 };
    currencies[row.currency][row.bucket] = Number(row.amount_minor || 0);
  }
  return json({ wallet: { ownerId: user.id, currencies, authoritative: true, source: 'APPEND_ONLY_SANDBOX' }, requestId: requestId() });
}

async function handleLedger(request, env) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const result = await env.DB.prepare(
    'SELECT id, event_type, bucket, amount_minor, currency, source_ref, metadata, created_at FROM am_royalty_ledger WHERE owner_id = ? ORDER BY created_at ASC, id ASC'
  ).bind(user.id).all();
  return json({
    entries: (result.results || []).map(row => ({
      id: row.id,
      eventType: row.event_type,
      bucket: row.bucket,
      amountMinor: Number(row.amount_minor || 0),
      currency: row.currency,
      sourceRef: row.source_ref || '',
      metadata: safeJson(row.metadata),
      createdAt: row.created_at,
    })),
    requestId: requestId(),
  });
}

async function handleReleases(request, env) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');

  if (request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT id, status, payload, revision, created_at, updated_at FROM am_releases WHERE owner_id = ? ORDER BY updated_at DESC'
    ).bind(user.id).all();
    return json({
      releases: (result.results || []).map(row => ({
        id: row.id,
        status: row.status,
        ...safeJson(row.payload),
        revision: Number(row.revision || 1),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      requestId: requestId(),
    });
  }

  const payload = canonicalPayload(await readJson(request));
  const id = newId('rel');
  const timestamp = now();
  await env.DB.prepare(
    'INSERT INTO am_releases (id, owner_id, status, payload, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, 'DRAFT', JSON.stringify(payload), 1, timestamp, timestamp).run();
  await audit(env, user.id, 'RELEASE_CREATED', id, null, 'DRAFT');
  return json({ release: { id, status: 'DRAFT', ...payload, revision: 1 }, requestId: requestId() }, 201);
}

async function handleRelease(request, env, id) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const current = await releaseById(env, id, user.id);
  if (!current) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');

  if (request.method === 'GET') return json({ release: current, requestId: requestId() });
  if (!EDITABLE.has(current.status)) return apiError(409, 'RELEASE_STATE_NOT_EDITABLE', `Release cannot be edited while status=${current.status}`);

  const merged = canonicalPayload({ ...current, ...(await readJson(request)) });
  const revision = Number(current.revision || 1) + 1;
  await env.DB.prepare('UPDATE am_releases SET payload = ?, revision = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .bind(JSON.stringify(merged), revision, now(), id, user.id).run();
  await audit(env, user.id, 'RELEASE_UPDATED', id, current.status, current.status);
  return json({ release: { id, status: current.status, ...merged, revision }, requestId: requestId() });
}

async function handleCreateUpload(request, env) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const body = await readJson(request);
  const kind = body.kind === 'ARTWORK' ? 'ARTWORK' : body.kind === 'AUDIO_MASTER' ? 'AUDIO_MASTER' : '';
  const fileName = clean(body.fileName);
  const mime = clean(body.mime) || 'application/octet-stream';
  const sizeBytes = Math.trunc(Number(body.sizeBytes || 0));
  const checksum = normalizeChecksum(body.checksum);

  if (!kind) return apiError(400, 'UPLOAD_KIND_INVALID', 'kind must be AUDIO_MASTER or ARTWORK');
  if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || !checksum) return apiError(400, 'UPLOAD_METADATA_INVALID', 'fileName, sizeBytes and sha256 checksum are required');
  if (sizeBytes > MAX_BYTES) return apiError(413, 'UPLOAD_TOO_LARGE', 'Individual sandbox assets are capped at 50 MB');

  const id = newId('ast');
  const ext = (fileName.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin';
  const storageKey = `am-studio/sandbox/${user.id}/${id}.${ext}`;
  const timestamp = now();
  await env.DB.prepare(
    'INSERT INTO am_assets (id, owner_id, kind, file_name, mime, size_bytes, checksum, status, storage_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, user.id, kind, fileName, mime, sizeBytes, checksum, 'PENDING_UPLOAD', storageKey, timestamp, timestamp).run();
  await audit(env, user.id, 'UPLOAD_SESSION_CREATED', id, null, 'PENDING_UPLOAD');
  return json({
    assetId: id,
    status: 'PENDING_UPLOAD',
    upload: {
      method: 'PUT',
      mode: 'CLOUDFLARE_R2_VIA_API',
      target: `/v1/uploads/${id}/content`,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    },
    requestId: requestId(),
  }, 201);
}

async function handleUploadContent(request, env, id) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const asset = await env.DB.prepare('SELECT * FROM am_assets WHERE id = ? AND owner_id = ? LIMIT 1').bind(id, user.id).first();
  if (!asset) return apiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  if (asset.status !== 'PENDING_UPLOAD') return apiError(409, 'ASSET_STATE_INVALID', `Asset cannot accept bytes while status=${asset.status}`);

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > MAX_BYTES) return apiError(413, 'UPLOAD_TOO_LARGE', 'Individual sandbox assets are capped at 50 MB');
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength <= 0) return apiError(400, 'UPLOAD_EMPTY', 'Uploaded file is empty');
  if (bytes.byteLength > MAX_BYTES) return apiError(413, 'UPLOAD_TOO_LARGE', 'Individual sandbox assets are capped at 50 MB');

  const verifiedChecksum = await sha256Bytes(bytes);
  if (bytes.byteLength !== Number(asset.size_bytes) || verifiedChecksum !== asset.checksum) {
    await env.DB.prepare('UPDATE am_assets SET status = ?, verified_checksum = ?, updated_at = ? WHERE id = ?')
      .bind('CHECKSUM_FAILED', verifiedChecksum, now(), id).run();
    await audit(env, user.id, 'UPLOAD_CHECKSUM_FAILED', id, asset.status, 'CHECKSUM_FAILED', { actualBytes: bytes.byteLength, verifiedChecksum });
    return apiError(409, 'UPLOAD_INTEGRITY_MISMATCH', 'Uploaded bytes do not match declared size/checksum');
  }

  await env.ASSETS_BUCKET.put(asset.storage_key, bytes, {
    httpMetadata: { contentType: asset.mime || 'application/octet-stream' },
    customMetadata: { assetId: id, ownerId: user.id, kind: asset.kind },
  });
  await env.DB.prepare('UPDATE am_assets SET status = ?, verified_checksum = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .bind('UPLOADED', verifiedChecksum, now(), id, user.id).run();
  await audit(env, user.id, 'UPLOAD_BYTES_VERIFIED', id, 'PENDING_UPLOAD', 'UPLOADED');
  return json({ assetId: id, status: 'UPLOADED', verifiedChecksum, sizeBytes: bytes.byteLength, requestId: requestId() });
}

async function handleCompleteUpload(request, env, id) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const asset = await env.DB.prepare('SELECT * FROM am_assets WHERE id = ? AND owner_id = ? LIMIT 1').bind(id, user.id).first();
  if (!asset) return apiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  if (!['UPLOADED', 'VERIFIED'].includes(asset.status)) return apiError(409, 'UPLOAD_BYTES_REQUIRED', 'Upload and verify file bytes first');

  const body = await readJson(request);
  const durationMs = Math.max(0, Math.trunc(Number(body.durationMs || 0)));
  const width = Math.max(0, Math.trunc(Number(body.width || 0)));
  const height = Math.max(0, Math.trunc(Number(body.height || 0)));
  if (asset.kind === 'AUDIO_MASTER' && durationMs <= 0) return apiError(400, 'AUDIO_DURATION_REQUIRED', 'Audio duration is required');
  if (asset.kind === 'ARTWORK' && (width <= 0 || height <= 0)) return apiError(400, 'ARTWORK_DIMENSIONS_REQUIRED', 'Artwork dimensions are required');

  await env.DB.prepare('UPDATE am_assets SET status = ?, duration_ms = ?, width = ?, height = ?, updated_at = ? WHERE id = ? AND owner_id = ?')
    .bind('VERIFIED', durationMs, width, height, now(), id, user.id).run();
  await audit(env, user.id, 'UPLOAD_VERIFIED', id, asset.status, 'VERIFIED');
  return json({
    assetId: id,
    status: 'VERIFIED',
    verifiedChecksum: asset.verified_checksum || asset.checksum,
    sizeBytes: Number(asset.size_bytes),
    durationMs,
    width,
    height,
    requestId: requestId(),
  });
}

async function handlePreflight(request, env, id) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const release = await releaseById(env, id, user.id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');

  const issues = [];
  const issue = (field, code) => issues.push({ field, code });
  if (!release.title) issue('title', 'TITLE_REQUIRED');
  if (!release.artistName) issue('artistName', 'PRIMARY_ARTIST_REQUIRED');
  if (!release.genre) issue('genre', 'GENRE_REQUIRED');
  if (!release.releaseDate) issue('releaseDate', 'RELEASE_DATE_REQUIRED');
  if (!release.copyrightOwner) issue('copyrightOwner', 'COPYRIGHT_OWNER_REQUIRED');
  if (!release.rightsConfirmed) issue('rightsConfirmed', 'RIGHTS_DECLARATION_REQUIRED');
  if (!Array.isArray(release.destinations) || !release.destinations.length) issue('destinations', 'DESTINATION_REQUIRED');

  const audio = release.audioAssetId
    ? await env.DB.prepare('SELECT id, kind, file_name, mime, status, duration_ms FROM am_assets WHERE id = ? AND owner_id = ? LIMIT 1').bind(release.audioAssetId, user.id).first()
    : null;
  const art = release.artworkAssetId
    ? await env.DB.prepare('SELECT id, kind, file_name, mime, status, width, height FROM am_assets WHERE id = ? AND owner_id = ? LIMIT 1').bind(release.artworkAssetId, user.id).first()
    : null;

  if (!audio || audio.kind !== 'AUDIO_MASTER' || audio.status !== 'VERIFIED') issue('audioAssetId', 'VERIFIED_AUDIO_MASTER_REQUIRED');
  else {
    const mime = String(audio.mime || '').toLowerCase();
    const name = String(audio.file_name || '').toLowerCase();
    if (!(mime.includes('wav') || mime.includes('flac') || name.endsWith('.wav') || name.endsWith('.flac'))) issue('audioAssetId', 'AUDIO_FORMAT_WAV_OR_FLAC_REQUIRED');
  }

  if (!art || art.kind !== 'ARTWORK' || art.status !== 'VERIFIED') issue('artworkAssetId', 'VERIFIED_ARTWORK_REQUIRED');
  else if (Number(art.width) < 3000 || Number(art.height) < 3000 || Number(art.width) !== Number(art.height)) issue('artworkAssetId', 'ARTWORK_SQUARE_3000_REQUIRED');

  const status = issues.length ? 'PREFLIGHT_REQUIRED' : 'READY_FOR_REVIEW';
  await env.DB.prepare('UPDATE am_releases SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind(status, now(), id, user.id).run();
  await audit(env, user.id, 'RELEASE_PREFLIGHT', id, release.status, status, { issues });
  return json({ release: await releaseById(env, id, user.id), ok: issues.length === 0, status, issues, requestId: requestId() });
}

async function handleSubmitReview(request, env, id) {
  const user = await requireSession(request, env);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const release = await releaseById(env, id, user.id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (release.status !== 'READY_FOR_REVIEW') return apiError(409, 'RELEASE_NOT_READY_FOR_REVIEW', 'Run a passing preflight first');
  await env.DB.prepare('UPDATE am_releases SET status = ?, updated_at = ? WHERE id = ? AND owner_id = ?').bind('IN_REVIEW', now(), id, user.id).run();
  await audit(env, user.id, 'RELEASE_SUBMITTED_FOR_REVIEW', id, 'READY_FOR_REVIEW', 'IN_REVIEW');
  return json({ release: await releaseById(env, id, user.id), requestId: requestId() });
}

async function handleAdminBootstrap(request, env) {
  if (clean(env.AM_STUDIO_ADMIN_TOKEN)) return apiError(409, 'ADMIN_ENV_SECRET_ACTIVE', 'Admin is configured with a Cloudflare secret');
  const existing = await env.DB.prepare("SELECT id FROM am_admin_credentials WHERE id = 'primary' LIMIT 1").first();
  if (existing) return apiError(409, 'ADMIN_ALREADY_BOOTSTRAPPED', 'Admin token already exists');

  const origin = request.headers.get('origin') || '';
  const expectedOrigin = new URL(request.url).origin;
  if (origin && origin !== expectedOrigin) return apiError(403, 'ADMIN_BOOTSTRAP_ORIGIN_REJECTED', 'Bootstrap must originate from this AM STUDIO Worker');
  if (request.headers.get('x-am-admin-bootstrap') !== 'browser') return apiError(403, 'ADMIN_BOOTSTRAP_HEADER_REQUIRED', 'Bootstrap header missing');

  const token = opaqueToken();
  const tokenHash = await sha256Text(token);
  const timestamp = now();
  await env.DB.prepare('INSERT INTO am_admin_credentials (id, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .bind('primary', tokenHash, timestamp, timestamp).run();
  await audit(env, 'admin-bootstrap', 'ADMIN_BOOTSTRAPPED', 'admin', null, 'CONFIGURED');
  return json({ ok: true, token, tokenType: 'Admin', environment: 'DEV_SANDBOX', requestId: requestId() }, 201);
}

async function handleAdminOverview(request, env) {
  if (!(await requireAdmin(request, env))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const [releaseRows, royaltyRows, auditRows, providerRows, deliveryRows] = await Promise.all([
    env.DB.prepare('SELECT id, owner_id, status, payload, revision, created_at, updated_at FROM am_releases ORDER BY updated_at DESC LIMIT 100').all(),
    env.DB.prepare('SELECT bucket, currency, COALESCE(SUM(amount_minor), 0) AS amount_minor FROM am_royalty_ledger GROUP BY bucket, currency ORDER BY currency, bucket').all(),
    env.DB.prepare('SELECT id, actor_id, action, entity_id, prior_state, next_state, meta, created_at FROM am_audit_events ORDER BY created_at DESC LIMIT 100').all(),
    env.DB.prepare('SELECT provider_key, display_name, mode, contract_status, credentials_status, enabled, updated_at FROM am_provider_config ORDER BY updated_at DESC').all(),
    env.DB.prepare('SELECT id, release_id, provider_key, status, provider_release_id, last_error, payload, created_at, updated_at FROM am_provider_deliveries ORDER BY updated_at DESC LIMIT 100').all(),
  ]);

  const releases = (releaseRows.results || []).map(row => ({
    id: row.id,
    ownerId: row.owner_id,
    status: row.status,
    revision: Number(row.revision || 1),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...safeJson(row.payload),
  }));
  const royalties = {};
  for (const row of royaltyRows.results || []) {
    if (!royalties[row.currency]) royalties[row.currency] = {};
    royalties[row.currency][row.bucket] = Number(row.amount_minor || 0);
  }

  return json({
    environment: 'DEV_SANDBOX',
    host: 'CLOUDFLARE',
    distributionProvider: 'disabled',
    dspDeliveryEnabled: false,
    payoutEnabled: false,
    counts: {
      total: releases.length,
      inReview: releases.filter(r => r.status === 'IN_REVIEW').length,
      approved: releases.filter(r => r.status === 'APPROVED').length,
      needsChanges: releases.filter(r => r.status === 'NEEDS_CHANGES').length,
    },
    releases,
    royalties,
    audit: (auditRows.results || []).map(row => ({ ...row, meta: safeJson(row.meta) })),
    providers: (providerRows.results || []).map(row => ({ ...row, enabled: Boolean(row.enabled) })),
    deliveries: (deliveryRows.results || []).map(row => ({ ...row, payload: safeJson(row.payload) })),
  });
}

async function handleAdminRelease(request, env, id) {
  if (!(await requireAdmin(request, env))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const release = await releaseById(env, id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  const ids = [release.audioAssetId || '', release.artworkAssetId || ''].filter(Boolean);
  const assets = [];
  for (const assetId of ids) {
    const row = await env.DB.prepare('SELECT * FROM am_assets WHERE id = ? LIMIT 1').bind(assetId).first();
    if (row) assets.push({
      ...row,
      mediaPath: `/admin/assets/${row.id}/content`,
    });
  }
  const auditRows = await env.DB.prepare('SELECT * FROM am_audit_events WHERE entity_id = ? ORDER BY created_at DESC LIMIT 100').bind(id).all();
  return json({ release, assets, audit: (auditRows.results || []).map(row => ({ ...row, meta: safeJson(row.meta) })) });
}

async function handleAdminMedia(request, env, id) {
  if (!(await requireAdmin(request, env))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const asset = await env.DB.prepare('SELECT id, storage_key, mime, file_name, status FROM am_assets WHERE id = ? LIMIT 1').bind(id).first();
  if (!asset || !asset.storage_key) return apiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  const object = await env.ASSETS_BUCKET.get(asset.storage_key);
  if (!object) return apiError(404, 'ASSET_BYTES_NOT_FOUND', 'Asset bytes not found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', asset.mime || headers.get('content-type') || 'application/octet-stream');
  headers.set('content-disposition', `inline; filename="${String(asset.file_name || 'asset').replace(/["\r\n]/g, '')}"`);
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(object.body, { status: 200, headers });
}

async function handleAdminDecision(request, env, id) {
  if (!(await requireAdmin(request, env))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const body = await readJson(request);
  const action = clean(body.action).toUpperCase();
  const note = clean(body.note).slice(0, 1000);
  if (!['APPROVE', 'NEEDS_CHANGES', 'RIGHTS_HOLD'].includes(action)) return apiError(400, 'ADMIN_ACTION_INVALID', 'Unsupported admin decision');
  const release = await releaseById(env, id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (release.status !== 'IN_REVIEW') return apiError(409, 'RELEASE_NOT_IN_REVIEW', `Release is ${release.status}`);

  const nextStatus = action === 'APPROVE' ? 'APPROVED' : action;
  const revision = Number(release.revision || 1) + 1;
  await env.DB.prepare('UPDATE am_releases SET status = ?, revision = ?, updated_at = ? WHERE id = ?')
    .bind(nextStatus, revision, now(), id).run();
  await audit(env, 'admin', `ADMIN_${action}`, id, release.status, nextStatus, { note });
  return json({ ok: true, releaseId: id, priorStatus: release.status, status: nextStatus, note });
}

async function handleApi(request, env, url) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  const path = apiPath(url);

  if (path === '/' || path === '/health') return handleHealth(env);
  if (path === '/v1/auth/session' && request.method === 'POST') return handleCreateSession(env);
  if (path === '/v1/me' && request.method === 'GET') return handleMe(request, env);
  if (path === '/v1/wallet' && request.method === 'GET') return handleWallet(request, env);
  if (path === '/v1/royalties/ledger' && request.method === 'GET') return handleLedger(request, env);
  if (path === '/v1/releases' && ['GET', 'POST'].includes(request.method)) return handleReleases(request, env);
  if (path === '/v1/uploads' && request.method === 'POST') return handleCreateUpload(request, env);

  let match = path.match(/^\/v1\/releases\/([A-Za-z0-9_-]+)$/);
  if (match && ['GET', 'PATCH'].includes(request.method)) return handleRelease(request, env, match[1]);
  match = path.match(/^\/v1\/releases\/([A-Za-z0-9_-]+)\/preflight$/);
  if (match && request.method === 'POST') return handlePreflight(request, env, match[1]);
  match = path.match(/^\/v1\/releases\/([A-Za-z0-9_-]+)\/submit-review$/);
  if (match && request.method === 'POST') return handleSubmitReview(request, env, match[1]);
  match = path.match(/^\/v1\/uploads\/([A-Za-z0-9_-]+)\/content$/);
  if (match && request.method === 'PUT') return handleUploadContent(request, env, match[1]);
  match = path.match(/^\/v1\/uploads\/([A-Za-z0-9_-]+)\/complete$/);
  if (match && request.method === 'POST') return handleCompleteUpload(request, env, match[1]);

  if (path === '/admin/bootstrap' && request.method === 'POST') return handleAdminBootstrap(request, env);
  if (path === '/admin/overview' && request.method === 'GET') return handleAdminOverview(request, env);
  match = path.match(/^\/admin\/releases\/([A-Za-z0-9_-]+)$/);
  if (match && request.method === 'GET') return handleAdminRelease(request, env, match[1]);
  match = path.match(/^\/admin\/releases\/([A-Za-z0-9_-]+)\/decision$/);
  if (match && request.method === 'POST') return handleAdminDecision(request, env, match[1]);
  match = path.match(/^\/admin\/assets\/([A-Za-z0-9_-]+)\/content$/);
  if (match && request.method === 'GET') return handleAdminMedia(request, env, match[1]);

  return apiError(404, 'NOT_FOUND', 'Route not found');
}

async function serveAdmin(request, env) {
  if (!env.ASSETS) return apiError(503, 'ADMIN_ASSETS_MISSING', 'Admin static assets are not bound');
  const assetUrl = new URL(request.url);
  assetUrl.pathname = '/index.html';
  assetUrl.search = '';
  const response = await env.ASSETS.fetch(new Request(assetUrl, request));
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-cache');
  headers.set('x-frame-options', 'DENY');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health') {
        await ensureSchema(env);
        return handleHealth(env);
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await ensureSchema(env);
        return handleApi(request, env, url);
      }
      if (url.pathname === '/' || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return serveAdmin(request, env);
      if (env.ASSETS) {
        const asset = await env.ASSETS.fetch(request);
        if (asset.status !== 404) return asset;
      }
      return apiError(404, 'NOT_FOUND', 'Route not found');
    } catch (error) {
      console.error(error);
      return apiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : 'Unexpected server error');
    }
  },
};

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ADMIN_TOKEN = Deno.env.get('AM_STUDIO_ADMIN_TOKEN') || '';
const BUCKET = 'am-studio-assets';
const MAX_BYTES = 50 * 1024 * 1024;
const EDITABLE = new Set(['DRAFT', 'PREFLIGHT_REQUIRED', 'NEEDS_CHANGES']);

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-am-admin-token',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,OPTIONS',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, ...extra, 'content-type': 'application/json; charset=utf-8' },
  });
}

function apiError(status: number, code: string, message: string, issues?: unknown) {
  const error: Record<string, unknown> = { code, message, requestId: requestId() };
  if (issues !== undefined) error.issues = issues;
  return json({ error }, status);
}

function requestId() {
  return `req_${crypto.randomUUID().replaceAll('-', '')}`;
}

function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

function clean(v: unknown) {
  return typeof v === 'string' ? v.trim() : '';
}

function normalizeChecksum(v: unknown) {
  const raw = clean(v).toLowerCase();
  const digest = raw.startsWith('sha256:') ? raw.slice(7) : raw;
  return /^[a-f0-9]{64}$/.test(digest) ? `sha256:${digest}` : '';
}

function canonicalPayload(input: Record<string, unknown> = {}) {
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

function pathFromRequest(req: Request) {
  const p = new URL(req.url).pathname;
  const marker = '/am-studio';
  const i = p.indexOf(marker);
  if (i >= 0) return p.slice(i + marker.length) || '/';
  return p;
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

async function sha256Bytes(value: ArrayBuffer) {
  return `sha256:${hex(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))}`;
}

function newOpaqueToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

async function readJson(req: Request) {
  try { return await req.json(); } catch { return {}; }
}

async function audit(actor: string, action: string, entityId: string, priorState: string | null = null, nextState: string | null = null, meta: Record<string, unknown> = {}) {
  const { error } = await supabase.from('am_audit_events').insert({
    id: newId('aud'), actor_id: actor, action, entity_id: entityId,
    prior_state: priorState, next_state: nextState, meta,
  });
  if (error) throw error;
}

async function requireSession(req: Request) {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const tokenHash = await sha256Text(token);
  const { data, error } = await supabase
    .from('am_sessions')
    .select('user_id,display_name,organization_id,environment,expires_at')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.user_id,
    displayName: data.display_name,
    roles: ['SANDBOX_USER'],
    organizationId: data.organization_id,
    kycState: 'NOT_CONNECTED',
    payoutEligibility: false,
    environment: data.environment,
  };
}

async function requireAdmin(req: Request) {
  if (!ADMIN_TOKEN) return false;
  const auth = req.headers.get('authorization') || '';
  const supplied = req.headers.get('x-am-admin-token') || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
  if (!supplied) return false;
  const [a, b] = await Promise.all([sha256Text(supplied), sha256Text(ADMIN_TOKEN)]);
  return a === b;
}

async function releaseById(id: string, ownerId?: string) {
  let q = supabase.from('am_releases').select('id,owner_id,status,payload,revision,created_at,updated_at').eq('id', id);
  if (ownerId) q = q.eq('owner_id', ownerId);
  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id, ownerId: data.owner_id, status: data.status,
    ...(data.payload || {}), revision: data.revision,
    createdAt: data.created_at, updatedAt: data.updated_at,
  };
}

async function handleHealth() {
  return json({
    ok: true,
    service: 'am-studio-distribution-backend',
    environment: 'DEV_SANDBOX',
    distributionProvider: 'disabled',
    dspDeliveryEnabled: false,
    royaltyLedger: 'APPEND_ONLY_SANDBOX',
    host: 'SUPABASE',
    timestamp: new Date().toISOString(),
  });
}

async function handleCreateSession() {
  const token = newOpaqueToken();
  const tokenHash = await sha256Text(token);
  const userId = 'usr_sandbox_owner';
  const displayName = 'AM STUDIO Sandbox Owner';
  const organizationId = 'org_am_studio';
  const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from('am_sessions').insert({
    token_hash: tokenHash, user_id: userId, display_name: displayName,
    organization_id: organizationId, environment: 'DEV_SANDBOX', expires_at: expiresAt,
  });
  if (error) return apiError(500, 'SESSION_CREATE_FAILED', error.message);
  return json({
    token, tokenType: 'Bearer', expiresInSeconds: 43200,
    user: { id: userId, displayName, roles: ['SANDBOX_USER'], organizationId, kycState: 'NOT_CONNECTED', payoutEligibility: false, environment: 'DEV_SANDBOX' },
    requestId: requestId(),
  }, 201);
}

async function handleMe(req: Request) {
  const user = await requireSession(req);
  return user ? json({ ...user, requestId: requestId() }) : apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
}

async function handleWallet(req: Request) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const { data, error } = await supabase.from('am_royalty_ledger').select('currency,bucket,amount_minor').eq('owner_id', user.id);
  if (error) return apiError(500, 'LEDGER_READ_FAILED', error.message);
  const currencies: Record<string, Record<string, number>> = {};
  for (const row of data || []) {
    if (!currencies[row.currency]) currencies[row.currency] = { PENDING: 0, AVAILABLE: 0, HELD: 0, PAID: 0 };
    currencies[row.currency][row.bucket] = (currencies[row.currency][row.bucket] || 0) + Number(row.amount_minor || 0);
  }
  return json({ wallet: { ownerId: user.id, currencies, authoritative: true, source: 'APPEND_ONLY_SANDBOX' }, requestId: requestId() });
}

async function handleLedger(req: Request) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const { data, error } = await supabase
    .from('am_royalty_ledger')
    .select('id,event_type,bucket,amount_minor,currency,source_ref,metadata,created_at')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) return apiError(500, 'LEDGER_READ_FAILED', error.message);
  return json({ entries: (data || []).map(r => ({
    id: r.id, eventType: r.event_type, bucket: r.bucket, amountMinor: Number(r.amount_minor),
    currency: r.currency, sourceRef: r.source_ref || '', metadata: r.metadata || {}, createdAt: r.created_at,
  })), requestId: requestId() });
}

async function handleReleases(req: Request) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  if (req.method === 'GET') {
    const { data, error } = await supabase.from('am_releases')
      .select('id,status,payload,revision,created_at,updated_at')
      .eq('owner_id', user.id).order('updated_at', { ascending: false });
    if (error) return apiError(500, 'RELEASE_LIST_FAILED', error.message);
    return json({ releases: (data || []).map(r => ({ id: r.id, status: r.status, ...(r.payload || {}), revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at })), requestId: requestId() });
  }
  if (req.method !== 'POST') return apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  const body = await readJson(req) as Record<string, unknown>;
  const id = newId('rel');
  const payload = canonicalPayload(body);
  const { error } = await supabase.from('am_releases').insert({ id, owner_id: user.id, status: 'DRAFT', payload, revision: 1 });
  if (error) return apiError(500, 'RELEASE_CREATE_FAILED', error.message);
  await audit(user.id, 'RELEASE_CREATED', id, null, 'DRAFT');
  return json({ release: { id, status: 'DRAFT', ...payload, revision: 1 }, requestId: requestId() }, 201);
}

async function handleRelease(req: Request, id: string) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const current = await releaseById(id, user.id);
  if (!current) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (req.method === 'GET') return json({ release: current, requestId: requestId() });
  if (req.method !== 'PATCH') return apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed');
  if (!EDITABLE.has(current.status)) return apiError(409, 'RELEASE_STATE_NOT_EDITABLE', `Release cannot be edited while status=${current.status}`);
  const body = await readJson(req) as Record<string, unknown>;
  const merged = canonicalPayload({ ...current, ...body });
  const revision = Number(current.revision || 1) + 1;
  const { error } = await supabase.from('am_releases').update({ payload: merged, revision, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id);
  if (error) return apiError(500, 'RELEASE_UPDATE_FAILED', error.message);
  await audit(user.id, 'RELEASE_UPDATED', id, current.status, current.status);
  return json({ release: { id, status: current.status, ...merged, revision }, requestId: requestId() });
}

async function handleCreateUpload(req: Request) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const body = await readJson(req) as Record<string, unknown>;
  const kind = body.kind === 'ARTWORK' ? 'ARTWORK' : body.kind === 'AUDIO_MASTER' ? 'AUDIO_MASTER' : '';
  const fileName = clean(body.fileName), mime = clean(body.mime), declaredChecksum = normalizeChecksum(body.checksum);
  const sizeBytes = Number(body.sizeBytes || 0);
  if (!kind) return apiError(400, 'UPLOAD_KIND_INVALID', 'kind must be AUDIO_MASTER or ARTWORK');
  if (!fileName || !mime || !Number.isFinite(sizeBytes) || sizeBytes <= 0 || !declaredChecksum) return apiError(400, 'UPLOAD_METADATA_INVALID', 'fileName, mime, sizeBytes and sha256 checksum are required');
  if (sizeBytes > MAX_BYTES) return apiError(413, 'UPLOAD_TOO_LARGE', 'Individual assets are capped at 50 MB in this migration channel');
  const id = newId('ast');
  const ext = (fileName.split('.').pop() || 'bin').replace(/[^A-Za-z0-9]/g, '').toLowerCase() || 'bin';
  const storageKey = `am-studio/sandbox/${user.id}/${id}.${ext}`;
  const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUploadUrl(storageKey, { upsert: false });
  if (signError || !signed) return apiError(500, 'UPLOAD_SIGN_FAILED', signError?.message || 'Could not create signed upload URL');
  const { error } = await supabase.from('am_assets').insert({
    id, owner_id: user.id, kind, file_name: fileName, mime, size_bytes: Math.trunc(sizeBytes),
    checksum: declaredChecksum, status: 'PENDING_UPLOAD', storage_key: storageKey,
  });
  if (error) return apiError(500, 'UPLOAD_SESSION_CREATE_FAILED', error.message);
  await audit(user.id, 'UPLOAD_SESSION_CREATED', id, null, 'PENDING_UPLOAD');
  return json({
    assetId: id, status: 'PENDING_UPLOAD',
    upload: { method: 'PUT', mode: 'SUPABASE_SIGNED_UPLOAD', target: signed.signedUrl, path: signed.path, token: signed.token, expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() },
    requestId: requestId(),
  }, 201);
}

async function handleCompleteUpload(req: Request, id: string) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const { data: asset, error: assetError } = await supabase.from('am_assets').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle();
  if (assetError || !asset) return apiError(404, 'ASSET_NOT_FOUND', 'Asset not found');
  if (!asset.storage_key) return apiError(409, 'ASSET_STORAGE_KEY_MISSING', 'Asset storage key missing');
  const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(asset.storage_key);
  if (downloadError || !blob) return apiError(409, 'UPLOAD_NOT_FOUND', 'Uploaded object not found');
  const bytes = await blob.arrayBuffer();
  const verifiedChecksum = await sha256Bytes(bytes);
  if (bytes.byteLength !== Number(asset.size_bytes) || verifiedChecksum !== asset.checksum) {
    await supabase.from('am_assets').update({ status: 'CHECKSUM_FAILED', verified_checksum: verifiedChecksum, updated_at: new Date().toISOString() }).eq('id', id);
    await audit(user.id, 'UPLOAD_CHECKSUM_FAILED', id, asset.status, 'CHECKSUM_FAILED', { actualBytes: bytes.byteLength, verifiedChecksum });
    return apiError(409, 'UPLOAD_INTEGRITY_MISMATCH', 'Uploaded bytes do not match declared size/checksum');
  }
  const body = await readJson(req) as Record<string, unknown>;
  const durationMs = Math.max(0, Math.trunc(Number(body.durationMs || 0)));
  const width = Math.max(0, Math.trunc(Number(body.width || 0)));
  const height = Math.max(0, Math.trunc(Number(body.height || 0)));
  if (asset.kind === 'AUDIO_MASTER' && durationMs <= 0) return apiError(400, 'AUDIO_DURATION_REQUIRED', 'Audio duration is required');
  if (asset.kind === 'ARTWORK' && (width <= 0 || height <= 0)) return apiError(400, 'ARTWORK_DIMENSIONS_REQUIRED', 'Artwork dimensions are required');
  const { error } = await supabase.from('am_assets').update({
    status: 'VERIFIED', verified_checksum: verifiedChecksum, duration_ms: durationMs,
    width, height, updated_at: new Date().toISOString(),
  }).eq('id', id).eq('owner_id', user.id);
  if (error) return apiError(500, 'UPLOAD_COMPLETE_FAILED', error.message);
  await audit(user.id, 'UPLOAD_VERIFIED', id, asset.status, 'VERIFIED');
  return json({ assetId: id, status: 'VERIFIED', verifiedChecksum, sizeBytes: bytes.byteLength, durationMs, width, height, requestId: requestId() });
}

async function handlePreflight(req: Request, id: string) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const release = await releaseById(id, user.id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  const issues: Array<{ field: string; code: string }> = [];
  const issue = (field: string, code: string) => issues.push({ field, code });
  if (!release.title) issue('title', 'TITLE_REQUIRED');
  if (!release.artistName) issue('artistName', 'PRIMARY_ARTIST_REQUIRED');
  if (!release.genre) issue('genre', 'GENRE_REQUIRED');
  if (!release.releaseDate) issue('releaseDate', 'RELEASE_DATE_REQUIRED');
  if (!release.copyrightOwner) issue('copyrightOwner', 'COPYRIGHT_OWNER_REQUIRED');
  if (!release.rightsConfirmed) issue('rightsConfirmed', 'RIGHTS_DECLARATION_REQUIRED');
  if (!Array.isArray(release.destinations) || !release.destinations.length) issue('destinations', 'DESTINATION_REQUIRED');
  const ids = [release.audioAssetId || '', release.artworkAssetId || ''].filter(Boolean);
  let assets: any[] = [];
  if (ids.length) {
    const { data } = await supabase.from('am_assets').select('id,kind,file_name,mime,status,width,height,duration_ms').eq('owner_id', user.id).in('id', ids);
    assets = data || [];
  }
  const audio = assets.find(a => a.id === release.audioAssetId);
  const art = assets.find(a => a.id === release.artworkAssetId);
  if (!audio || audio.kind !== 'AUDIO_MASTER' || audio.status !== 'VERIFIED') issue('audioAssetId', 'VERIFIED_AUDIO_MASTER_REQUIRED');
  else {
    const mime = String(audio.mime || '').toLowerCase(), name = String(audio.file_name || '').toLowerCase();
    if (!(mime.includes('wav') || mime.includes('flac') || name.endsWith('.wav') || name.endsWith('.flac'))) issue('audioAssetId', 'AUDIO_FORMAT_WAV_OR_FLAC_REQUIRED');
  }
  if (!art || art.kind !== 'ARTWORK' || art.status !== 'VERIFIED') issue('artworkAssetId', 'VERIFIED_ARTWORK_REQUIRED');
  else if (Number(art.width) < 3000 || Number(art.height) < 3000 || Number(art.width) !== Number(art.height)) issue('artworkAssetId', 'ARTWORK_SQUARE_3000_REQUIRED');
  const status = issues.length ? 'PREFLIGHT_REQUIRED' : 'READY_FOR_REVIEW';
  await supabase.from('am_releases').update({ status, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id);
  await audit(user.id, 'RELEASE_PREFLIGHT', id, release.status, status, { issues });
  const updated = await releaseById(id, user.id);
  return json({ release: updated, ok: issues.length === 0, status, issues, requestId: requestId() });
}

async function handleSubmitReview(req: Request, id: string) {
  const user = await requireSession(req);
  if (!user) return apiError(401, 'UNAUTHORIZED', 'Valid bearer token required');
  const release = await releaseById(id, user.id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (release.status !== 'READY_FOR_REVIEW') return apiError(409, 'RELEASE_NOT_READY_FOR_REVIEW', 'Run a passing preflight first');
  await supabase.from('am_releases').update({ status: 'IN_REVIEW', updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', user.id);
  await audit(user.id, 'RELEASE_SUBMITTED_FOR_REVIEW', id, 'READY_FOR_REVIEW', 'IN_REVIEW');
  return json({ release: await releaseById(id, user.id), requestId: requestId() });
}

async function handleAdminOverview(req: Request) {
  if (!(await requireAdmin(req))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const [{ data: releases }, { data: royalties }, { data: auditRows }, { data: providers }, { data: deliveries }] = await Promise.all([
    supabase.from('am_releases').select('id,owner_id,status,payload,revision,created_at,updated_at').order('updated_at', { ascending: false }).limit(100),
    supabase.from('am_royalty_ledger').select('bucket,currency,amount_minor'),
    supabase.from('am_audit_events').select('id,actor_id,action,entity_id,prior_state,next_state,meta,created_at').order('created_at', { ascending: false }).limit(100),
    supabase.from('am_provider_config').select('*').order('updated_at', { ascending: false }),
    supabase.from('am_provider_deliveries').select('*').order('updated_at', { ascending: false }).limit(100),
  ]);
  const mapped = (releases || []).map(r => ({ id: r.id, ownerId: r.owner_id, status: r.status, revision: r.revision, createdAt: r.created_at, updatedAt: r.updated_at, ...(r.payload || {}) }));
  const royaltySummary: Record<string, Record<string, number>> = {};
  for (const r of royalties || []) {
    if (!royaltySummary[r.currency]) royaltySummary[r.currency] = {};
    royaltySummary[r.currency][r.bucket] = (royaltySummary[r.currency][r.bucket] || 0) + Number(r.amount_minor || 0);
  }
  return json({
    environment: 'DEV_SANDBOX', host: 'SUPABASE', distributionProvider: 'disabled', dspDeliveryEnabled: false, payoutEnabled: false,
    counts: { total: mapped.length, inReview: mapped.filter(r => r.status === 'IN_REVIEW').length, approved: mapped.filter(r => r.status === 'APPROVED').length, needsChanges: mapped.filter(r => r.status === 'NEEDS_CHANGES').length },
    releases: mapped, royalties: royaltySummary, audit: auditRows || [], providers: providers || [], deliveries: deliveries || [],
  });
}

async function handleAdminRelease(req: Request, id: string) {
  if (!(await requireAdmin(req))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const release = await releaseById(id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  const ids = [release.audioAssetId || '', release.artworkAssetId || ''].filter(Boolean);
  let assets: any[] = [];
  if (ids.length) {
    const { data } = await supabase.from('am_assets').select('*').in('id', ids);
    assets = data || [];
  }
  const withUrls = await Promise.all(assets.map(async a => {
    let signedUrl = '';
    if (a.storage_key) {
      const { data } = await supabase.storage.from(BUCKET).createSignedUrl(a.storage_key, 900);
      signedUrl = data?.signedUrl || '';
    }
    return { ...a, signedUrl };
  }));
  const { data: auditRows } = await supabase.from('am_audit_events').select('*').eq('entity_id', id).order('created_at', { ascending: false });
  return json({ release, assets: withUrls, audit: auditRows || [] });
}

async function handleAdminDecision(req: Request, id: string) {
  if (!(await requireAdmin(req))) return apiError(401, 'ADMIN_UNAUTHORIZED', 'Valid admin token required');
  const body = await readJson(req) as Record<string, unknown>;
  const action = clean(body.action).toUpperCase();
  const note = clean(body.note).slice(0, 1000);
  if (!['APPROVE', 'NEEDS_CHANGES', 'RIGHTS_HOLD'].includes(action)) return apiError(400, 'ADMIN_ACTION_INVALID', 'Unsupported admin decision');
  const release = await releaseById(id);
  if (!release) return apiError(404, 'RELEASE_NOT_FOUND', 'Release not found');
  if (release.status !== 'IN_REVIEW') return apiError(409, 'RELEASE_NOT_IN_REVIEW', `Release is ${release.status}`);
  const nextStatus = action === 'APPROVE' ? 'APPROVED' : action;
  const revision = Number(release.revision || 1) + 1;
  const { error } = await supabase.from('am_releases').update({ status: nextStatus, revision, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return apiError(500, 'ADMIN_DECISION_FAILED', error.message);
  await audit('admin', `ADMIN_${action}`, id, release.status, nextStatus, { note });
  return json({ ok: true, releaseId: id, priorStatus: release.status, status: nextStatus, note });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const path = pathFromRequest(req);
  try {
    if (path === '/' || path === '/health') return handleHealth();
    if (path === '/v1/auth/session' && req.method === 'POST') return handleCreateSession();
    if (path === '/v1/me' && req.method === 'GET') return handleMe(req);
    if (path === '/v1/wallet' && req.method === 'GET') return handleWallet(req);
    if (path === '/v1/royalties/ledger' && req.method === 'GET') return handleLedger(req);
    if (path === '/v1/releases' && (req.method === 'GET' || req.method === 'POST')) return handleReleases(req);
    if (path === '/v1/uploads' && req.method === 'POST') return handleCreateUpload(req);

    let m = path.match(/^\/v1\/releases\/([A-Za-z0-9_-]+)$/);
    if (m && (req.method === 'GET' || req.method === 'PATCH')) return handleRelease(req, m[1]);
    m = path.match(/^\/v1\/releases\/([A-Za-z0-9_-]+)\/preflight$/);
    if (m && req.method === 'POST') return handlePreflight(req, m[1]);
    m = path.match(/^\/v1\/releases\/([A-Za-z0-9_-]+)\/submit-review$/);
    if (m && req.method === 'POST') return handleSubmitReview(req, m[1]);
    m = path.match(/^\/v1\/uploads\/([A-Za-z0-9_-]+)\/complete$/);
    if (m && req.method === 'POST') return handleCompleteUpload(req, m[1]);
    m = path.match(/^\/v1\/uploads\/([A-Za-z0-9_-]+)\/content$/);
    if (m) return apiError(410, 'DIRECT_STORAGE_UPLOAD_REQUIRED', 'Use the signed upload URL returned by POST /v1/uploads');

    if (path === '/admin/overview' && req.method === 'GET') return handleAdminOverview(req);
    m = path.match(/^\/admin\/releases\/([A-Za-z0-9_-]+)$/);
    if (m && req.method === 'GET') return handleAdminRelease(req, m[1]);
    m = path.match(/^\/admin\/releases\/([A-Za-z0-9_-]+)\/decision$/);
    if (m && req.method === 'POST') return handleAdminDecision(req, m[1]);

    return apiError(404, 'NOT_FOUND', 'Route not found');
  } catch (e) {
    console.error(e);
    return apiError(500, 'INTERNAL_ERROR', e instanceof Error ? e.message : 'Unexpected server error');
  }
});

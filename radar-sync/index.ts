import { createClient } from 'npm:@supabase/supabase-js@2';
import { fetchPublicTikTokProfile } from '../tiktok-profile.ts';

// O identificador da conta e a chave do provedor nunca saem deste servidor.
const allowedOrigins = new Set([
  'https://jose-sites.github.io',
  'https://radar-da-tropa.joseantoniooliveir18.chatgpt.site',
  'https://radardatropa.pages.dev',
]);
const handlePattern = /^[A-Za-z0-9._]{2,40}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cors(origin: string | null) {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.has(origin) ? origin : 'https://jose-sites.github.io',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-radar-sync-token',
    'Vary': 'Origin',
  };
}
function response(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function envKey(name: string, legacy: string) {
  try {
    const keys = JSON.parse(Deno.env.get(name) || '{}');
    if (typeof keys.default === 'string') return keys.default;
  } catch { /* fallback for older projects */ }
  return Deno.env.get(legacy) || '';
}
const projectUrl = Deno.env.get('SUPABASE_URL') || '';
const adminKey = envKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
const publicKey = envKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
const syncToken = Deno.env.get('RADAR_SYNC_TOKEN') || '';
const admin = createClient(projectUrl, adminKey, { auth: { persistSession: false } });
const publicClient = createClient(projectUrl, publicKey, { auth: { persistSession: false } });

const fetchProfile = fetchPublicTikTokProfile;

async function cacheAvatar(source: unknown, profileId: string) {
  if (typeof source !== 'string') return null;
  let url: URL;
  try { url = new URL(source); } catch { return null; }
  // Impede que um URL inesperado vindo do provedor acesse recursos internos.
  if (url.protocol !== 'https:' || !/(^|\.)tiktokcdn(?:-[a-z0-9]+)?\.com$/i.test(url.hostname)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const image = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!image.ok) return null;
    const mime = (image.headers.get('content-type') || '').split(';')[0].toLowerCase();
    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string,string>)[mime];
    if (!ext) return null;
    const reader = image.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2_000_000) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const path = `${profileId}.${ext}`;
    const { error } = await admin.storage.from('radar-avatars').upload(path, bytes, {
      contentType: mime, cacheControl: '3600', upsert: true,
    });
    return error ? null : path;
  } catch { return null; }
  finally { clearTimeout(timeout); }
}

async function rememberAlias(profileId: string, handle: string) {
  if (!handlePattern.test(handle)) return;
  const { error } = await admin.from('radar_profile_aliases').upsert(
    { profile_id: profileId, handle }, { onConflict: 'profile_id,handle', ignoreDuplicates: true },
  );
  if (error) throw new Error('alias_save_failed');
}

async function saveProfile(profile: any, originalHandle: string | null = null, expectedId: string | null = null) {
  const userId = String(profile.id);
  if (expectedId && userId !== expectedId) throw new Error('identity_mismatch');
  const currentHandle = String(profile.uniqueId);
  const { data: existing, error: readError } = await admin.from('radar_profiles')
    .select('id,current_handle,avatar_path').eq('tiktok_user_id', userId).maybeSingle();
  if (readError) throw new Error('profile_read_failed');
  const at = new Date().toISOString();
  let profileId: string;
  if (existing) {
    profileId = existing.id;
    await rememberAlias(profileId, existing.current_handle);
    await rememberAlias(profileId, currentHandle);
    if (originalHandle) await rememberAlias(profileId, originalHandle);
    const avatarPath = await cacheAvatar(profile.avatarUrl, profileId);
    const { error } = await admin.from('radar_profiles').update({
      current_handle: currentHandle,
      tiktok_sec_uid: typeof profile.secUid === 'string' ? profile.secUid : null,
      avatar_path: avatarPath || existing.avatar_path,
      last_checked_at: at, last_attempt_at: at, sync_error: null,
    }).eq('id', profileId);
    if (error) throw new Error('profile_update_failed');
  } else {
    const { data: created, error } = await admin.from('radar_profiles').insert({
      tiktok_user_id: userId, tiktok_sec_uid: typeof profile.secUid === 'string' ? profile.secUid : null,
      current_handle: currentHandle, last_checked_at: at, last_attempt_at: at,
    }).select('id').single();
    if (error || !created) throw new Error('profile_create_failed');
    profileId = created.id;
    await rememberAlias(profileId, currentHandle);
    if (originalHandle) await rememberAlias(profileId, originalHandle);
    const avatarPath = await cacheAvatar(profile.avatarUrl, profileId);
    if (avatarPath) await admin.from('radar_profiles').update({ avatar_path: avatarPath }).eq('id', profileId);
  }
  return profileId;
}

// Retry only temporary lookup failures; never repeat persistence or a rate-limited lookup.
async function lookupReportProfile(handle: string, attempts: number) {
  for (let attempt = 0; ; attempt++) {
    try { return await fetchProfile('username', handle); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (attempt + 1 >= attempts || !['public_profile_unavailable', 'public_profile_timeout'].includes(code)) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1000 : 3000));
    }
  }
}

async function resolveReport(report: { id: string; handle: string; profile_id?: string | null }, attempts = 1) {
  if (report.profile_id) return true;
  const at = new Date().toISOString();
  await admin.from('radar_reports').update({ profile_resolution_attempt_at: at, profile_resolution_error: null }).eq('id', report.id);
  try {
    if (!handlePattern.test(report.handle)) throw new Error('invalid_handle');
    const profile = await lookupReportProfile(report.handle, attempts);
    const profileId = await saveProfile(profile, report.handle);
    const { error } = await admin.from('radar_reports').update({ profile_id: profileId, profile_resolution_error: null }).eq('id', report.id).is('profile_id', null);
    if (error) throw new Error('report_link_failed');
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'profile_lookup_failed';
    console.error('report resolution failed:', report.id, code);
    await admin.from('radar_reports').update({ profile_resolution_error: code }).eq('id', report.id);
    return false;
  }
}

// Return the recorded outcome instead of hiding lookup failures behind a pending state.
async function reportResolutionResult(reportId: string) {
  const { data, error } = await admin.from('radar_reports')
    .select('profile_id,profile_resolution_error,profile_resolution_attempt_at')
    .eq('id', reportId).maybeSingle();
  if (error || !data) return { profileVerified: false, error: 'resolution_status_unavailable' };
  return {
    profileVerified: Boolean(data.profile_id),
    error: data.profile_id ? null : data.profile_resolution_error || 'verification_pending',
    attemptedAt: data.profile_resolution_attempt_at,
  };
}

async function syncProfile(profile: { id: string; tiktok_user_id: string; current_handle: string }) {
  const at = new Date().toISOString();
  await admin.from('radar_profiles').update({ last_attempt_at: at }).eq('id', profile.id);
  try {
    let fresh;
    try { fresh = await fetchProfile('userId', profile.tiktok_user_id); }
    catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (!['public_profile_unavailable','public_profile_timeout'].includes(code) || !handlePattern.test(profile.current_handle)) throw error;
      fresh = await fetchProfile('username', profile.current_handle);
    }
    // An old handle may have been reassigned: never update without the same stable ID.
    await saveProfile(fresh, null, profile.tiktok_user_id);
    return true;
  } catch (error) {
    const code = error instanceof Error ? error.message : 'profile_lookup_failed';
    await admin.from('radar_profiles').update({ sync_error: code }).eq('id', profile.id);
    return false;
  }
}

async function scheduledSync(retryPending = false, refreshProfiles = false) {
  let resolved = 0, updated = 0, failed = 0;
  const deadline = Date.now() + 80000;
  const due = new Date(Date.now() - (retryPending ? 5 * 60 * 1000 : 3 * 60 * 60 * 1000)).toISOString();
  const refreshDue = new Date(Date.now() - (refreshProfiles ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000)).toISOString();
  const { data: reports, error: reportError } = await admin.from('radar_reports')
    .select('id,handle,profile_id').is('profile_id', null).neq('status', 'rejected')
    .or(`profile_resolution_attempt_at.is.null,profile_resolution_attempt_at.lt.${due}`)
    .order('profile_resolution_attempt_at', { ascending: true, nullsFirst: true }).limit(5);
  if (reportError) {
    console.error('report query:', reportError);
    throw new Error(`reports_unavailable_${reportError.code || 'unknown'}`);
  }
  for (const report of reports || []) {
    if (Date.now() >= deadline) break;
    (await resolveReport(report)) ? resolved++ : failed++;
  }
  const { data: profiles, error: profileError } = await admin.from('radar_profiles')
    .select('id,tiktok_user_id,current_handle').or(`last_attempt_at.is.null,last_attempt_at.lt.${refreshDue}`)
    .order('last_attempt_at', { ascending: true, nullsFirst: true }).limit(5);
  if (profileError) {
    console.error('profile query:', profileError);
    throw new Error(`profiles_unavailable_${profileError.code || 'unknown'}`);
  }
  for (const profile of profiles || []) {
    if (Date.now() >= deadline) break;
    (await syncProfile(profile)) ? updated++ : failed++;
  }
  return { resolved, updated, failed };
}

Deno.serve(async (request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405, origin);
  if (!projectUrl || !adminKey || !publicKey) return response({ error: 'server_unavailable' }, 503, origin);
  if (request.headers.get('x-radar-sync-token') === syncToken && syncToken.length >= 48) {
    try {
      const options = await request.json().catch(() => ({}));
      return response(await scheduledSync(options?.retryPending === true, options?.refreshProfiles === true), 200, origin);
    }
    catch (error) {
      const code = error instanceof Error ? error.message : 'sync_failed';
      console.error('scheduled sync failed:', code);
      return response({ error: code }, 500, origin);
    }
  }
  if (!origin || !allowedOrigins.has(origin)) return response({ error: 'origin_not_allowed' }, 403, origin);
  let body: any;
  try { body = await request.json(); } catch { return response({ error: 'invalid_request' }, 400, origin); }
  const reportId = String(body?.reportId || '');
  if (!uuidPattern.test(reportId)) return response({ error: 'invalid_request' }, 400, origin);
  // Existing reports can be retried by a verified administrator, without sharing a PIN.
  if (body?.action === 'retry') {
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/i.test(authorization)) return response({ error: 'access_denied' }, 403, origin);
    const caller = createClient(projectUrl, publicKey, {
      global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
    });
    const { data: user, error: userError } = await caller.auth.getUser();
    if (userError || !user.user) return response({ error: 'access_denied' }, 403, origin);
    const { data: isAdmin, error: adminError } = await caller.rpc('radar_is_admin');
    if (adminError || isAdmin !== true) return response({ error: 'access_denied' }, 403, origin);
    const { data: report, error } = await admin.from('radar_reports')
      .select('id,handle,profile_id,profile_resolution_attempt_at').eq('id', reportId).maybeSingle();
    if (error || !report) return response({ error: 'report_not_found' }, 404, origin);
    if (!report.profile_id) {
      if (report.profile_resolution_attempt_at && Date.now() - new Date(report.profile_resolution_attempt_at).getTime() < 5 * 60 * 1000)
        return response({ error: 'retry_later' }, 429, origin);
      await resolveReport(report, 3);
    }
    return response(await reportResolutionResult(reportId), 200, origin);
  }
  const pin = String(body?.pin || '');
  if (!/^(?:[0-9]{10}|[0-9a-fA-F\s-]{12,29})$/.test(pin)) return response({ error: 'invalid_request' }, 400, origin);
  const { data: streamer, error: pinError } = await publicClient.rpc('radar_verify_pin', { p_pin: pin });
  if (pinError || !streamer?.id) return response({ error: 'access_denied' }, 403, origin);
  const { data: report, error: reportError } = await admin.from('radar_reports')
    .select('id,handle,streamer_id,profile_id,created_at,profile_resolution_attempt_at')
    .eq('id', reportId).eq('streamer_id', streamer.id).maybeSingle();
  if (reportError || !report) return response({ error: 'report_not_found' }, 404, origin);
  if (Date.now() - new Date(report.created_at).getTime() > 30 * 60 * 1000) return response({ error: 'registration_expired' }, 400, origin);
  if (report.profile_resolution_attempt_at && Date.now() - new Date(report.profile_resolution_attempt_at).getTime() < 5 * 60 * 1000)
    return response(await reportResolutionResult(reportId), 200, origin);
  await resolveReport(report, 3);
  return response(await reportResolutionResult(reportId), 200, origin);
});


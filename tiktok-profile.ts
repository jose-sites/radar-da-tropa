// Public TikTok pages only: no paid API, cookies, login or challenge bypass.
const handlePattern = /^[A-Za-z0-9._]{2,40}$/;
const idPattern = /^\d{5,30}$/;
const MAX_BYTES = 2_000_000;

export function parseTikTokProfile(html: string, field: 'username' | 'userId', expected: string) {
  const script = /<script\b[^>]*\bid=["']__UNIVERSAL_DATA_FOR_REHYDRATION__["'][^>]*>([\s\S]*?)<\/script\s*>/i.exec(html);
  if (!script) throw new Error('public_profile_unavailable');
  let detail: any;
  try {
    detail = JSON.parse(script[1])?.__DEFAULT_SCOPE__?.['webapp.user-detail'];
  } catch { throw new Error('public_profile_unavailable'); }
  const user = detail?.userInfo?.user;
  // Private profiles may still publish their account identity in the page.
  // 10222 means private content; accept only the explicitly private user record.
  if (!detail || !(detail.statusCode === 0 || (detail.statusCode === 10222 && user?.privateAccount === true)))
    throw new Error('public_profile_unavailable');
  // IDs must remain strings: JavaScript numbers lose precision for TikTok IDs.
  if (typeof user?.id !== 'string' || !idPattern.test(user.id) ||
      typeof user.uniqueId !== 'string' || !handlePattern.test(user.uniqueId))
    throw new Error('public_profile_unavailable');
  if (field === 'userId' ? user.id !== expected : user.uniqueId.toLowerCase() !== expected.toLowerCase())
    throw new Error('identity_mismatch');
  return {
    id: user.id, uniqueId: user.uniqueId,
    secUid: typeof user.secUid === 'string' ? user.secUid : null,
    avatarUrl: typeof user.avatarLarger === 'string' ? user.avatarLarger : null,
    signature: typeof user.signature === 'string' ? user.signature : '',
  };
}

export async function fetchPublicTikTokProfile(
  field: 'username' | 'userId', value: string, fetcher: typeof fetch = fetch,
) {
  if (!(field === 'username' ? handlePattern : idPattern).test(value)) throw new Error('invalid_handle');
  let url = new URL(field === 'username'
    ? `https://www.tiktok.com/@${encodeURIComponent(value)}`
    : `https://www.tiktok.com/share/user/${value}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      if (url.origin !== 'https://www.tiktok.com' || url.username || url.password)
        throw new Error('public_profile_unavailable');
      const result = await fetcher(url.href, {
        redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
      });
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        const location = result.headers.get('location');
        await result.body?.cancel();
        if (!location) throw new Error('public_profile_unavailable');
        url = new URL(location, url);
        continue;
      }
      if (!result.ok || !(result.headers.get('content-type') || '').toLowerCase().includes('text/html')) {
        await result.body?.cancel();
        throw new Error(result.status === 429 ? 'public_rate_limited' : 'public_profile_unavailable');
      }
      const reader = result.body?.getReader();
      if (!reader) throw new Error('public_profile_unavailable');
      const decoder = new TextDecoder();
      let html = '', bytes = 0;
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        bytes += chunk.byteLength;
        if (bytes > MAX_BYTES) { await reader.cancel(); throw new Error('public_profile_unavailable'); }
        html += decoder.decode(chunk, { stream: true });
      }
      html += decoder.decode();
      return parseTikTokProfile(html, field, value);
    }
    throw new Error('public_profile_unavailable');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('public_profile_timeout');
    throw error;
  } finally { clearTimeout(timer); }
}

// Official creator oEmbed metadata is partial: a name never substitutes a user ID.
export async function fetchPublicTikTokSummary(handle: string, fetcher: typeof fetch = fetch) {
  if (!handlePattern.test(handle)) throw new Error('invalid_handle');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = new URL('https://www.tiktok.com/oembed');
    url.searchParams.set('url', `https://www.tiktok.com/@${handle}`);
    const result = await fetcher(url.href, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!result.ok || !(result.headers.get('content-type') || '').includes('application/json')) {
      await result.body?.cancel();
      throw new Error(result.status === 429 ? 'public_rate_limited' : 'public_profile_unavailable');
    }
    const reader = result.body?.getReader();
    if (!reader) throw new Error('public_profile_unavailable');
    let text = '', bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32000) { await reader.cancel(); throw new Error('public_profile_unavailable'); }
      text += decoder.decode(value, { stream: true });
    }
    const data = JSON.parse(text + decoder.decode());
    const author = new URL(data.author_url);
    if (data.type !== 'rich' || data.provider_name !== 'TikTok' ||
        !['https://www.tiktok.com', 'https://www.tiktok.com/'].includes(data.provider_url) ||
        author.origin !== 'https://www.tiktok.com' || author.username || author.password ||
        author.pathname.toLowerCase() !== `/@${handle.toLowerCase()}` ||
        typeof data.author_name !== 'string' || !data.author_name.trim() || data.author_name.length > 100)
      throw new Error('public_profile_unavailable');
    const displayName = data.author_name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!displayName) throw new Error('public_profile_unavailable');
    return { displayName };
  } finally { clearTimeout(timer); }
}

// Public API-live account metadata, also used by open-source TikTok LIVE clients.
// This reads only account identity; it never opens a stream or uses a login cookie.
export async function fetchPublicTikTokLiveProfile(handle: string, fetcher: typeof fetch = fetch) {
  if (!handlePattern.test(handle)) throw new Error('invalid_handle');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const url = new URL('https://www.tiktok.com/api-live/user/room/');
    url.searchParams.set('uniqueId', handle);
    url.searchParams.set('sourceType', '54');
    url.searchParams.set('aid', '1988');
    const result = await fetcher(url.href, { redirect: 'error', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!result.ok || !(result.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      await result.body?.cancel();
      throw new Error(result.status === 429 ? 'public_rate_limited' : 'public_profile_unavailable');
    }
    const reader = result.body?.getReader();
    if (!reader) throw new Error('public_profile_unavailable');
    const decoder = new TextDecoder();
    let text = '', bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 250000) { await reader.cancel(); throw new Error('public_profile_unavailable'); }
      text += decoder.decode(value, { stream: true });
    }
    let data: any;
    try { data = JSON.parse(text + decoder.decode()); } catch { throw new Error('public_profile_unavailable'); }
    const user = data?.data?.user;
    if (data?.statusCode !== 0 || typeof user?.id !== 'string' || !idPattern.test(user.id) ||
        typeof user.uniqueId !== 'string' || !handlePattern.test(user.uniqueId)) throw new Error('public_profile_unavailable');
    if (user.uniqueId.toLowerCase() !== handle.toLowerCase()) throw new Error('identity_mismatch');
    return { id: user.id, uniqueId: user.uniqueId,
      secUid: typeof user.secUid === 'string' ? user.secUid : null,
      avatarUrl: typeof user.avatarLarger === 'string' ? user.avatarLarger : typeof user.avatarMedium === 'string' ? user.avatarMedium : null,
      signature: typeof user.signature === 'string' ? user.signature : '' };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('public_profile_timeout');
    if (error instanceof Error && ['public_rate_limited', 'public_profile_unavailable', 'identity_mismatch'].includes(error.message)) throw error;
    throw new Error('public_profile_unavailable');
  } finally { clearTimeout(timer); }
}

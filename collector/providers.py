"""Two optional browser providers. No login, CAPTCHA solver or proxy rotation."""
import asyncio
import os
import json
import re
from urllib.parse import urlparse

HANDLE = re.compile(r'[A-Za-z0-9._]{2,40}\Z')
IDENTIFIER = re.compile(r'[0-9]{5,30}\Z')

class LookupFailure(Exception):
    pass


def normalize(raw, expected):
    identifier, handle = raw.get('id'), raw.get('uniqueId')
    if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
        raise LookupFailure('invalid_identity')
    if not isinstance(handle, str) or not HANDLE.fullmatch(handle):
        raise LookupFailure('invalid_identity')
    if handle.lower() != expected.lower():
        raise LookupFailure('identity_mismatch')
    avatar = raw.get('avatarUrl')
    if avatar:
        parsed = urlparse(avatar)
        if parsed.scheme != 'https' or not re.fullmatch(r'(?:[a-z0-9-]+\.)*tiktokcdn(?:-[a-z0-9]+)?\.com', parsed.hostname or '') or parsed.username or parsed.password:
            avatar = None
    return {'id': identifier, 'uniqueId': handle, 'secUid': raw.get('secUid') or None,
            'avatarUrl': avatar or None, 'signature': str(raw.get('signature') or '')[:2000]}


def tiktokpy_document(document):
    """Translate current public-page data to TikTokPy's original user schema."""
    if 'UserModule' in document:
        return document
    detail = document.get('__DEFAULT_SCOPE__', {}).get('webapp.user-detail', {})
    user = detail.get('userInfo', {}).get('user', {})
    status = detail.get('statusCode')
    if status != 0 and not (status == 10222 and user.get('privateAccount') is True):
        raise LookupFailure('profile_unavailable')
    handle = user.get('uniqueId')
    if not isinstance(handle, str) or not HANDLE.fullmatch(handle):
        raise LookupFailure('invalid_identity')
    return {'UserPage': {'statusCode': 0}, 'UserModule': {
        'users': {handle: user}, 'stats': {handle: detail.get('userInfo', {}).get('stats', {})}}}


def launch_options():
    options = {}
    if os.getenv('RADAR_BROWSER_EXECUTABLE'):
        options['executable_path'] = os.environ['RADAR_BROWSER_EXECUTABLE']
    # Preserve the managed environment's outbound route. Never log this value.
    proxy = os.getenv('HTTPS_PROXY') or os.getenv('HTTP_PROXY')
    if proxy:
        options['proxy'] = {'server': proxy}
    return options


async def tiktok_api(handle):
    from TikTokApi import TikTokApi
    options = launch_options()
    class SingleRequestApi(TikTokApi):
        async def make_request(self, *args, **kwargs):
            kwargs['retries'] = 1
            return await super().make_request(*args, **kwargs)
    async with SingleRequestApi() as api:
        await api.create_sessions(num_sessions=1, headless=True, sleep_after=2,
                                  browser='chromium', timeout=15000,
                                  enable_session_recovery=False,
                                  executable_path=options.get('executable_path'),
                                  proxies=[options['proxy']] if 'proxy' in options else None)
        result = await api.user(username=handle).info()
        user = result.get('userInfo', {}).get('user', {})
        if result.get('statusCode', 0) not in (0, 10222):
            raise LookupFailure('profile_unavailable')
        return normalize({**user, 'avatarUrl': user.get('avatarLarger')}, handle)


async def tiktok_py(handle):
    from tiktokapipy.async_api import AsyncTikTokAPI
    class CaptureProfileApi(AsyncTikTokAPI):
        async def _scrape_data(self, link, data_model):
            page = await self.context.new_page()
            try:
                response = await page.goto(link, wait_until='domcontentloaded', timeout=15000)
                if response and response.status == 429:
                    raise LookupFailure('rate_limited')
                if response and response.status == 403:
                    raise LookupFailure('blocked')
                if 'captcha' in page.url.lower():
                    raise LookupFailure('blocked')
                script = page.locator('script#__UNIVERSAL_DATA_FOR_REHYDRATION__, script#SIGI_STATE').first
                await script.wait_for(state='attached', timeout=12000)
                text = await script.text_content()
                if not text or len(text.encode()) > 2000000:
                    raise LookupFailure('profile_unavailable')
                document = tiktokpy_document(json.loads(text))
                return self._extract_and_dump_data(json.dumps(document), data_model)
            finally:
                await page.close()

        def _extract_and_dump_data(self, data, model):
            self.profile_document = json.loads(data)
            return super()._extract_and_dump_data(data, model)
    async with CaptureProfileApi(headless=True, navigation_timeout=15, navigation_retries=0,
                                 **launch_options()) as api:
        user = await api.user(handle, video_limit=0)
        # TikTokPy closes its page before returning and omits avatar from its
        # model. Capture its original SIGI_STATE document, preserving string IDs.
        users = api.profile_document.get('UserModule', {}).get('users', {})
        raw = next((item for item in users.values() if str(item.get('id')) == str(user.id)), None)
        if not raw:
            raise LookupFailure('profile_unavailable')
        return normalize({**raw, 'avatarUrl': raw.get('avatarLarger') or raw.get('avatarMedium')}, handle)


async def lookup(handle, providers=None, pause=asyncio.sleep, timeout=35):
    if not isinstance(handle, str) or not HANDLE.fullmatch(handle):
        raise LookupFailure('invalid_handle')
    providers = providers or [('tiktok-api', tiktok_api), ('tiktokpy', tiktok_py)]
    failures = []
    for index, (name, provider) in enumerate(providers):
        if index:
            await pause(3)
        try:
            profile = normalize(await asyncio.wait_for(provider(handle), timeout=timeout), handle)
            return {'profile': profile, 'provider': name}
        except LookupFailure as error:
            if str(error) in ('identity_mismatch', 'blocked', 'rate_limited'):
                raise
            failures.append(f'{name}:unavailable')
        except Exception as error:
            message = str(error).lower()
            if 'captcha' in message:
                raise LookupFailure('blocked') from None
            if re.search(r'\b(?:http|status(?:_code)?)\D{0,8}429\b', message):
                raise LookupFailure('rate_limited') from None
            # Provider exceptions may contain cookies, page bodies or URLs. Do not log.
            failures.append(f'{name}:unavailable')
    raise LookupFailure(';'.join(failures))

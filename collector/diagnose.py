"""Read-only control checks. Logs codes/types only, never cookies or page bodies."""
import asyncio
import contextlib
import io
import json
import logging
import re
import warnings
from providers import tiktok_api, tiktok_py, LookupFailure

async def main():
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings('ignore')
    for label, handle in [('control', 'lao012.77'), ('pending', 'ntdamidia0')]:
        for name, provider in [('tiktokpy', tiktok_py), ('tiktok-api', tiktok_api)]:
            result = {'check': label, 'provider': name}
            try:
                with contextlib.redirect_stderr(io.StringIO()):
                    profile = await asyncio.wait_for(provider(handle), timeout=25)
                result.update(found=True, photo=bool(profile.get('avatarUrl')))
            except Exception as error:
                result.update(found=False, error_type=type(error).__name__)
                code = str(error)
                if isinstance(error, LookupFailure) and re.fullmatch(r'[a-z0-9_]{1,60}', code):
                    result['code'] = code
                if isinstance(error, KeyError) and error.args and re.fullmatch(r'[A-Za-z0-9_.-]{1,60}', str(error.args[0])):
                    result['missing_field'] = str(error.args[0])
                network = re.search(r'net::(ERR_[A-Z_]+)', code)
                if network:
                    result['network'] = network.group(1)
            print(json.dumps(result), flush=True)

if __name__ == '__main__':
    asyncio.run(main())

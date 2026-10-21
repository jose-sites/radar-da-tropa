"""GitHub-hosted browser collector. Authenticates with short-lived OIDC only."""
import argparse
import contextlib
import io
import warnings
import asyncio
import json
import logging
import os
from pathlib import Path
import urllib.parse
import urllib.request
import urllib.error

from providers import lookup, LookupFailure

ENDPOINT = 'https://wcbixbwekbtqgreitodh.supabase.co/functions/v1/radar-sync'
AUDIENCE = 'radar-da-tropa:browser-collector:v1'


def call_api(body):
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    separator = '&' if '?' in url else '?'
    request = urllib.request.Request(url + separator + urllib.parse.urlencode({'audience': AUDIENCE}),
                                    headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            token = json.load(response)['value']
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'oidc_http_{error.code}') from None
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'x-radar-collector': 'v1'})
    try:
        with urllib.request.urlopen(request, timeout=50) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 409 and body.get('action') == 'complete':
            return {'profileVerified': False, 'error': 'lease_expired'}
        raise RuntimeError(f'bridge_http_{error.code}') from None


async def collect(jobs, api=call_api, finder=lookup, pause=asyncio.sleep):
    summary = {'checked': 0, 'identified': 0, 'unavailable': 0}
    for index, job in enumerate(jobs[:3]):
        if index:
            await pause(5)
        result = {'action': 'complete', 'reportId': job['reportId'], 'lease': job['lease']}
        try:
            with contextlib.redirect_stderr(io.StringIO()):
                result.update(await finder(job['handle']))
        except LookupFailure as error:
            result['error'] = str(error) if str(error) in ('blocked', 'rate_limited', 'identity_mismatch') else 'unavailable'
        response = await asyncio.to_thread(api, result)
        summary['checked'] += 1
        summary['identified' if response.get('profileVerified') is True else 'unavailable'] += 1
    return summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--claim', action='store_true')
    parser.add_argument('--jobs', required=True)
    options = parser.parse_args()
    logging.disable(logging.CRITICAL)
    warnings.filterwarnings('ignore')
    if options.claim:
        jobs = call_api({'action': 'claim'})['jobs']
        descriptor = os.open(options.jobs, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            json.dump(jobs, file)
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'has_jobs={str(bool(jobs)).lower()}\n')
        print(json.dumps({'queued': len(jobs)}))
    else:
        print(json.dumps(asyncio.run(collect(json.loads(Path(options.jobs).read_text())))))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Error class and HTTP status are safe; exception text/headers are not.
        status = error.code if isinstance(error, urllib.error.HTTPError) else None
        code = str(error) if isinstance(error, RuntimeError) and __import__('re').fullmatch(r'(oidc|bridge)_http_[0-9]{3}', str(error)) else None
        print(json.dumps({'collector_error': type(error).__name__, 'http_status': status, 'code': code}))
        raise SystemExit(1)

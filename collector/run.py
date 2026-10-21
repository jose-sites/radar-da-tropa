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

from providers import lookup, LookupFailure

ENDPOINT = 'https://wcbixbwekbtqgreitodh.supabase.co/functions/v1/radar-sync'
AUDIENCE = 'radar-da-tropa:browser-collector:v1'


def call_api(body):
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL']
    separator = '&' if '?' in url else '?'
    request = urllib.request.Request(url + separator + urllib.parse.urlencode({'audience': AUDIENCE}),
                                    headers={'Authorization': 'Bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    with urllib.request.urlopen(request, timeout=20) as response:
        token = json.load(response)['value']
    request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'x-radar-collector': 'v1'})
    with urllib.request.urlopen(request, timeout=50) as response:
        return json.load(response)


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
    except Exception:
        # Never dump provider responses, authorization headers or session cookies.
        print('Collector failed; see the private queue status. No identity was confirmed by this error.')
        raise SystemExit(1)

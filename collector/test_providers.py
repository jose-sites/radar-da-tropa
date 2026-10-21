import unittest
from unittest.mock import AsyncMock
from providers import lookup, normalize, tiktokpy_document, LookupFailure
from run import collect

PROFILE = {'id': '7506280430036747320', 'uniqueId': 'Example', 'avatarUrl': 'https://p16.tiktokcdn.com/photo.jpg'}

class ProvidersTests(unittest.IsolatedAsyncioTestCase):
    async def test_first_provider_success_does_not_repeat(self):
        first, second, pause = AsyncMock(return_value=PROFILE), AsyncMock(), AsyncMock()
        result = await lookup('example', [('first', first), ('second', second)], pause=pause)
        self.assertEqual(result['profile']['id'], PROFILE['id'])
        second.assert_not_called()
        pause.assert_not_called()

    async def test_second_provider_recovers_first_failure(self):
        first, second, pause = AsyncMock(side_effect=RuntimeError()), AsyncMock(return_value=PROFILE), AsyncMock()
        result = await lookup('example', [('first', first), ('second', second)], pause=pause)
        self.assertEqual(result['provider'], 'second')
        self.assertEqual(result['profile']['uniqueId'], 'Example')
        pause.assert_awaited_once_with(3)

    async def test_both_fail_never_confirms(self):
        failure = AsyncMock(side_effect=RuntimeError('secret must not be exposed'))
        with self.assertRaisesRegex(LookupFailure, '^first:unavailable;second:unavailable$'):
            await lookup('example', [('first', failure), ('second', failure)], pause=AsyncMock())

    async def test_identity_mismatch_stops(self):
        second = AsyncMock()
        with self.assertRaisesRegex(LookupFailure, 'identity_mismatch'):
            await lookup('wrong_user', [('first', AsyncMock(return_value=PROFILE)), ('second', second)])
        second.assert_not_called()

    async def test_invalid_handles_never_launch_browser(self):
        provider = AsyncMock()
        for handle in ['https://attacker.example', '../example', '', 'x', None]:
            with self.assertRaises(LookupFailure):
                await lookup(handle, [('first', provider)])
        provider.assert_not_called()

    async def test_timeout_tries_only_one_alternative(self):
        result = await lookup('example', [('first', AsyncMock(side_effect=TimeoutError())), ('second', AsyncMock(return_value=PROFILE))], pause=AsyncMock())
        self.assertEqual(result['provider'], 'second')

    async def test_bad_ids_and_avatars(self):
        for identifier in [7506280430036747320, 'bad', '1', None]:
            with self.assertRaises(LookupFailure):
                normalize({**PROFILE, 'id': identifier}, 'example')
        for url in ['http://p16.tiktokcdn.com/a', 'https://tiktokcdn.com.attacker.example/a', 'https://localhost/a', 'https://u:p@p16.tiktokcdn.com/a']:
            self.assertIsNone(normalize({**PROFILE, 'avatarUrl':url}, 'example')['avatarUrl'])

    async def test_worker_submits_success_and_failure_without_faking_success(self):
        submitted=[]
        def api(body):
            submitted.append(body)
            return {'profileVerified':'profile' in body}
        finder=AsyncMock(side_effect=[{'profile':PROFILE,'provider':'tiktok-api'},LookupFailure('unavailable')])
        jobs=[{'reportId':str(i),'lease':'lease','handle':'example'} for i in range(2)]
        summary=await collect(jobs,api=api,finder=finder,pause=AsyncMock())
        self.assertEqual(summary,{'checked':2,'identified':1,'unavailable':1})
        self.assertNotIn('profile',submitted[1])
        self.assertEqual(submitted[0]['lease'],'lease')

    async def test_backend_failure_does_not_claim_saved_identity(self):
        def api(body): raise RuntimeError('backend offline')
        with self.assertRaises(RuntimeError):
            await collect([{'reportId':'id','lease':'lease','handle':'example'}],api=api,finder=AsyncMock(return_value={'profile':PROFILE,'provider':'tiktok-api'}))

if __name__=='__main__':unittest.main()

class BlockTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_rate_limit_and_captcha_stop_alternatives(self):
        for error in [LookupFailure('rate_limited'),LookupFailure('blocked'),RuntimeError('HTTP 429'),RuntimeError('CAPTCHA required')]:
            second=AsyncMock()
            with self.assertRaises(LookupFailure):
                await lookup('example',[('first',AsyncMock(side_effect=error)),('second',second)],pause=AsyncMock())
            second.assert_not_called()

class DocumentTests(unittest.TestCase):
    def test_modern_tiktok_page_converts_without_changing_id(self):
        raw={'id':PROFILE['id'],'uniqueId':'Example','avatarLarger':PROFILE['avatarUrl']}
        document=tiktokpy_document({'__DEFAULT_SCOPE__':{'webapp.user-detail':{'statusCode':0,'userInfo':{'user':raw,'stats':{}}}}})
        self.assertEqual(document['UserModule']['users']['Example']['id'],PROFILE['id'])
        self.assertEqual(document['UserModule']['users']['Example']['avatarLarger'],PROFILE['avatarUrl'])

    def test_missing_data_and_unconfirmed_private_status_rejected(self):
        for document in [{},{'__DEFAULT_SCOPE__':{'webapp.user-detail':{'statusCode':10222,'userInfo':{'user':{'uniqueId':'example'}}}}}]:
            with self.assertRaises(LookupFailure):tiktokpy_document(document)

    def test_legacy_document_is_preserved(self):
        document={'UserModule':{'users':{'example':PROFILE}}}
        self.assertIs(tiktokpy_document(document),document)

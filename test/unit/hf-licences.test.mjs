// "Check licences": which gated Hugging Face repos the person's token has accepted, probed with a HEAD and the token
// (never logged or returned), on a fake fetch.
//   node --test test/unit/hf-licences.test.mjs
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { licenceStatus } from '../../src/service/models.js'
import { assertCopiesMain } from './main-source.mjs'

const TOKEN = 'hf_SECRET_TOKEN_VALUE_123'
const manifest = {
  models: [
    { id: 'a', url: 'https://huggingface.co/Org/Open/resolve/abc/a.safetensors', gated: 'https://huggingface.co/Org/Open' },
    { id: 'b', url: 'https://huggingface.co/Org/Locked/resolve/abc/b.safetensors', gated: 'https://huggingface.co/Org/Locked' },
    { id: 'c', url: 'https://huggingface.co/Org/Locked/resolve/abc/c.safetensors', gated: 'https://huggingface.co/Org/Locked' },
    { id: 'd', url: 'https://huggingface.co/Org/Down/resolve/abc/d.safetensors', gated: 'https://huggingface.co/Org/Down' },
    { id: 'e', url: 'https://huggingface.co/Org/Plain/resolve/abc/e.safetensors' }
  ]
}

describe('licenceStatus', () => {
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, init })
    if (url.includes('/Open/')) return { status: 302 }
    if (url.includes('/Locked/')) return { status: 403 }
    if (url.includes('/Down/')) throw new Error(`connect ECONNREFUSED while using ${init.headers.Authorization}`)
    return { status: 500 }
  }

  test('marks accepted, needs-licence and unknown, one HEAD per repo, token only in the header', async () => {
    calls.length = 0
    const pages = ['https://huggingface.co/Org/Open', 'https://huggingface.co/Org/Locked', 'https://huggingface.co/Org/Locked', 'https://huggingface.co/Org/Down']
    const r = await licenceStatus(manifest, pages, { token: TOKEN, fetchImpl: fakeFetch })
    assert.deepEqual(r, { 'https://huggingface.co/Org/Open': 'accepted', 'https://huggingface.co/Org/Locked': 'needs-licence', 'https://huggingface.co/Org/Down': 'unknown' })
    assert.equal(calls.length, 3)
    assert.ok(calls.every((c) => c.init.method === 'HEAD' && c.init.headers.Authorization === `Bearer ${TOKEN}`))
    assert.ok(!JSON.stringify(r).includes(TOKEN), 'the result never carries the token, even from an error that mentions it')
  })

  test('without a token it makes no request and says unknown', async () => {
    calls.length = 0
    const r = await licenceStatus(manifest, ['https://huggingface.co/Org/Open'], { token: null, fetchImpl: fakeFetch })
    assert.deepEqual(r, { 'https://huggingface.co/Org/Open': 'unknown' })
    assert.equal(calls.length, 0)
  })

  test('ignores a page that is not a gated model of IV Studio, so it cannot be used to probe other URLs', async () => {
    calls.length = 0
    const r = await licenceStatus(manifest, ['https://example.com/x', 'https://huggingface.co/Org/Plain'], { token: TOKEN, fetchImpl: fakeFetch })
    assert.deepEqual(r, {})
    assert.equal(calls.length, 0)
  })
})

describe('window channel: licences', () => {
  test('[ipc:models:licences] asks licenceStatus about the pages the window names, against IV Studio\'s own model list', () => {
    assertCopiesMain(assert, 'models:licences', '(pages) => licenceStatus(studio.manifest, pages)')
  })
})

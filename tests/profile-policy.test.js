const test = require('node:test')
const assert = require('node:assert/strict')
const { planProfiles, nextProfileTask } = require('../tools/lib/profile-policy')
const now = 100 * 86400000
test('先补未成功资料，定期复查不因空字段每天重抓，并尊重持久化退避', () => {
  const rows = [
    { mnid: '1' },
    { mnid: '2', profileSchemaVersion: 2, profileFetchedAt: now - 31 * 86400000 },
    { mnid: '3', profileSchemaVersion: 2, profileFetchedAt: now - 86400000 }
  ]
  assert.deepEqual(
    planProfiles(rows, {}, now, 10).map(r => r.mnid),
    ['1', '2']
  )
  assert.deepEqual(
    planProfiles(rows, { 1: { nextRetryAt: now + 1 } }, now, 10).map(r => r.mnid),
    ['2']
  )
  assert.equal(nextProfileTask({ failures: 8 }, now, false).nextRetryAt, now + 7 * 86400000)
  assert.equal(nextProfileTask({ failures: 8 }, now, true).failures, 0)
})
test('成功资料复查每轮限20人，失败人员轮转让新任务有机会', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({
    mnid: String(i),
    profileSchemaVersion: 2,
    profileFetchedAt: 1
  }))
  assert.equal(planProfiles(rows, {}, now, 750).length, 20)
  assert.deepEqual(
    planProfiles([{ mnid: '1' }, { mnid: '2' }], { 1: { lastAttemptAt: 1 } }, now, 1).map(
      r => r.mnid
    ),
    ['2']
  )
})

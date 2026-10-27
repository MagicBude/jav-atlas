const test = require('node:test')
const assert = require('node:assert/strict')
const { updateProfile } = require('../tools/lib/profile-update')
test('来源变化更新规范字段并保留历史，不因空解析抹掉已知资料', () => {
  const row = { mnid: '1', name: '人物' }
  updateProfile(row, { agency: '甲', hobby: '阅读' }, 1)
  updateProfile(row, { agency: '乙', hobby: '' }, 2)
  assert.equal(row.agency, '乙')
  assert.equal(row.hobby, '阅读')
  assert.deepEqual(row.profileHistory[1].changes.agency, { before: '甲', after: '乙' })
  updateProfile(row, { agency: '乙' }, 3)
  assert.equal(row.profileHistory.length, 2)
})
test('旧名册人工值和基线之后的人工值均保留，最新来源仍可查', () => {
  const row = { height: '180' }
  updateProfile(row, { height: '160', agency: '甲' }, 1)
  assert.equal(row.height, '180')
  row.agency = '人工修改'
  updateProfile(row, { height: '161', agency: '乙' }, 2)
  assert.equal(row.agency, '人工修改')
  assert.equal(row.profileSource.values.agency, '乙')
  assert.equal(row.profileSource.conflicts.height.retained, '180')
})

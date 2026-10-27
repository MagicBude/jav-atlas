const test = require('node:test')
const assert = require('node:assert/strict')
const { compareRankings, validSnapshot, snapshotDay } = require('../tools/lib/ranking-history')
const make = time => ({
  fetchedAt: time,
  ...Object.fromEntries(
    ['day', 'week', 'month'].map(p => [
      p,
      Array.from({ length: 250 }, (_, i) => ({ id: String(i + 1), rank: i + 1, name: '人物' + i }))
    ])
  )
})
test('完整三榜才可作基准，不接受重复人物和缺页', () => {
  const value = make(Date.UTC(2026, 9, 27))
  assert.equal(validSnapshot(value), true)
  value.day[1].id = value.day[0].id
  assert.equal(validSnapshot(value), false)
  value.day.pop()
  assert.equal(validSnapshot(value), false)
})
test('仅比较前一个北京时间日期的有效榜单，各周期独立且准确标示进入前250', () => {
  const previous = make(Date.UTC(2026, 9, 26)),
    current = make(Date.UTC(2026, 9, 27))
  current.day[0].id = '2'
  current.day[1].id = '1'
  current.day[249].id = '999'
  const result = compareRankings(current, [current, previous])
  assert.deepEqual(result.day.changes['2'], { kind: 'up', delta: 1 })
  assert.deepEqual(result.day.changes['1'], { kind: 'down', delta: -1 })
  assert.deepEqual(result.day.changes['999'], { kind: 'entered', delta: null })
  assert.equal(result.week.changes['1'].kind, 'same')
  assert.equal(compareRankings(current, [current]).day.previousFetchedAt, null)
  assert.equal(snapshotDay(Date.UTC(2026, 9, 26, 17)), '2026-10-27')
})

/** JavDB补充转换不联网：验证唯一番号、双重身份校验、评论去重与字段边界。 */
const test = require('node:test'),
  assert = require('node:assert/strict')
const { project } = require('../tools/lib/work-enrichment')
const local = { id: '1', code: 'TEST-001', releaseDate: '2026-01-01' }
const search = { data: { movies: [{ id: 'A', number: 'test-001' }] } }
const detail = {
  data: {
    movie: {
      id: 'A',
      number: 'TEST-001',
      release_date: '2026-01-02',
      score: '4.1',
      magnets: ['不可进入补充记录'],
      actors: []
    }
  }
}
test('精确匹配保留来源日期冲突与未知分数，评论去重不泄露用户内部ID', () => {
  const page = {
    data: {
      reviews: [
        { id: 1, user_id: 99, username: 'user', content: '<script>text</script>', score: null }
      ]
    }
  }
  const { record, mapping } = project(local, search, detail, [page, page], '2026-10-22')
  assert.equal(mapping.dateDifference, true)
  assert.equal(record.reviews.length, 1)
  assert.equal(record.reviews[0].score, null)
  assert.equal(record.reviews[0].content, '<script>text</script>')
  assert(!Object.hasOwn(record.reviews[0], 'user_id'))
  assert(!Object.hasOwn(record.metadata, 'magnets'))
  assert.equal(local.releaseDate, '2026-01-01')
})
test('模糊单结果、多精确结果或详情身份不一致均拒绝', () => {
  assert.throws(() =>
    project(local, { data: { movies: [{ id: 'A', number: 'TEST-002' }] } }, detail, [], 0)
  )
  assert.throws(() =>
    project(
      local,
      { data: { movies: [...search.data.movies, ...search.data.movies] } },
      detail,
      [],
      0
    )
  )
  assert.throws(() =>
    project(local, search, { data: { movie: { ...detail.data.movie, id: 'B' } } }, [], 0)
  )
})

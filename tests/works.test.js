/** 作品解析回归仅用合成HTML，不联网、不依赖源站作品标题。 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseList, parseDetail } = require('../tools/lib/minnano-works')
const row = id =>
  `<tr><td><img src="blank.gif" data-src="/cover/${id}.jpg"></td><td><h3 class="ttl"><a href="av${id}.html">Sample</a></h3><p class="cast"><a href="actress190754.html">Actor</a></p><p class="cast">Maker</p></td><td>2026/09/15</td></tr>`
const list = (rows, pagination = '') =>
  `<a href="actress190754.html">Actor</a><div class="act-video-list"><table>${rows}</table></div><!-- /.act-video-list --><div class="pagination">${pagination}</div><h3 class="ttl"><a href="av999.html">Recommendation</a></h3>`
test('作品区排除推荐，保留占位、懒加载封面和来源ID', () => {
  const r = parseList(list(row('123') + row('uk190754')), '190754', 1)
  assert.deepEqual(
    r.entries.map(e => e.id),
    ['123', 'uk190754']
  )
  assert.equal(r.entries[1].kind, 'unknown')
  assert.equal(r.entries[0].coverUrl, 'https://www.minnano-av.com/cover/123.jpg')
  assert.equal(r.entries[0].releaseDate, '2026-09-15')
  assert.equal(r.nextPage, null)
})
test('分页验证当前页与人物，跟随同源下一页', () => {
  const html = list(
    row('123'),
    '<u>1</u><a href="/actress.php?actress_id=190754&amp;page=2">Next</a>'
  )
  assert.equal(parseList(html, '190754', 1).nextPage, 2)
  assert.throws(() => parseList(html, '190754', 2), /页码/)
  assert.throws(() => parseList(html, '125605', 1), /身份/)
  assert.throws(() => parseList('Just a moment', '190754', 1), /验证/)
  assert.throws(() => parseList(list(''), '190754', 1), /空列表/)
})
test('作品详情独立校验身份，原标签和重复标签不丢失', () => {
  const html =
    '<meta property="og:url" content="https://www.minnano-av.com/av123.html"><div class="av-data mt0"><table class="prof-table"><tr><td>作品名</td><td>Sample</td></tr><tr><td>品番</td><td><span data-code="TEST-123">TEST-123</span></td></tr><tr><td>独自</td><td>A</td></tr><tr><td>独自</td><td>B</td></tr></table></div>'
  const r = parseDetail(html, '123')
  assert.equal(r.code, 'TEST-123')
  assert.equal(r.releaseDate, null)
  assert.equal(r.profileFields.filter(f => f.label === '独自').length, 2)
  assert.throws(() => parseDetail(html, '456'), /身份/)
  assert.throws(() => parseDetail(html, 'uk123'), /占位/)
})

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
test('两人试采共享作品去重，详情预算待办可跨轮补齐，既有字段保留', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-works-'))
  try {
    fs.mkdirSync(path.join(dir, 'minnano'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'minnano/ranked-pool.json'),
      JSON.stringify({ members: { 190754: {}, 125605: {} } })
    )
    const record = path.join(dir, 'minnano/works/records/123.json')
    fs.mkdirSync(path.dirname(record), { recursive: true })
    fs.writeFileSync(record, JSON.stringify({ id: '123', custom: '保留', fetchedAt: 1 }))
    const run = () =>
      spawnSync(
        process.execPath,
        [
          '--require',
          path.join(__dirname, 'fixtures/works-network.js'),
          path.join(__dirname, '../tools/works-relay.js')
        ],
        {
          env: { ...process.env, RELAY_DIR: dir, WORK_DETAILS: '1' },
          encoding: 'utf8',
          timeout: 15000
        }
      )
    const a = run()
    assert.equal(a.status, 0, a.stdout + a.stderr)
    const read = f => JSON.parse(fs.readFileSync(path.join(dir, 'minnano/works', f), 'utf8'))
    assert.equal(read('records/123.json').custom, '保留')
    assert.equal(read('report.json').pendingDetails, 1)
    assert.equal(read('people/190754.json').entries.length, 2)
    assert.equal(read('people/125605.json').entries.length, 2)
    const b = run()
    assert.equal(b.status, 0, b.stdout + b.stderr)
    assert.equal(read('report.json').pendingDetails, 0)
    assert.equal(read('records/456.json').id, '456')
    assert(read('people/125605.json').completedAt)
  } finally {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

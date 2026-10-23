const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
function sandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-enrich-'))
  const write = (file, data) => {
    const dest = path.join(dir, file)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, JSON.stringify(data))
  }
  const read = file =>
    JSON.parse(fs.readFileSync(path.join(dir, 'javdb/work-enrichment', file), 'utf8'))
  for (let i = 1; i <= 2; i++)
    write(`minnano/works/records/${i}.json`, {
      id: String(i),
      code: `TEST-00${i}`,
      releaseDate: '2026-01-01'
    })
  const run = extra =>
    spawnSync(
      process.execPath,
      [
        '--require',
        path.join(__dirname, 'fixtures/enrichment-network.js'),
        path.join(__dirname, '../tools/enrich-works.js')
      ],
      {
        env: { ...process.env, RELAY_DIR: dir, ENRICH_LIMIT: '2', ENRICH_DELAY_MS: '0', ...extra },
        encoding: 'utf8',
        timeout: 10000
      }
    )
  try {
    fn({ dir, write, read, run })
  } finally {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
test('补充队列预算续跑、跨源独立和成功复用，保留旧评论与来源记录', () =>
  sandbox(({ dir, write, read, run }) => {
    const raw = fs.readFileSync(path.join(dir, 'minnano/works/records/1.json'), 'utf8')
    write('javdb/work-enrichment/records/A.json', {
      fetchedAt: 1,
      reviews: [{ id: 'r1', content: '保留' }],
      reviewScope: { saved: 1 }
    })
    const a = run({ ENRICH_REQUESTS: '2' })
    assert.equal(a.status, 0, a.stderr)
    assert.equal(read('report.json').success, 1)
    assert.equal(read('records/A.json').reviews[0].content, '保留')
    assert.equal(read('records/A.json').reviewsFetchedAt, 1)
    assert.equal(fs.readFileSync(path.join(dir, 'minnano/works/records/1.json'), 'utf8'), raw)
    assert.equal(run({}).status, 0)
    assert.equal(read('report.json').success, 1)
    assert.equal(run({}).status, 0)
    assert.equal(read('report.json').requests, 0)
  }))
test('限流停止本轮而不切线路，遵守Retry-After退避', () =>
  sandbox(({ read, run }) => {
    const before = Date.now()
    assert.equal(run({ ENRICH_FIXTURE_RATE_LIMIT: '1' }).status, 2)
    assert.equal(read('report.json').requests, 1)
    assert(read('progress.json').tasks['1'].nextRetryAt >= before + 600000)
    assert.equal(run({}).status, 0)
    assert.equal(read('report.json').requests, 0)
  }))

test('多候选不写映射，保留待确认与退避；文件错误退出1', () =>
  sandbox(({ dir, read, run }) => {
    const a = run({ ENRICH_FIXTURE_AMBIGUOUS: 'TEST-002' })
    assert.equal(a.status, 2, a.stderr)
    assert.equal(read('progress.json').tasks['2'].status, 'ambiguous')
    assert.equal(read('mappings.json').schemaVersion, 1)
    assert.equal(read('mappings.json').mappings['2'], undefined)
    assert.equal(run({}).status, 0)
    assert.equal(read('report.json').requests, 0)
    fs.rmSync(path.join(dir, 'javdb/work-enrichment/report.json'))
    fs.mkdirSync(path.join(dir, 'javdb/work-enrichment/report.json'))
    assert.equal(run({}).status, 1)
  }))

test('独立类型回填仅补字段并复用已核实记录，不刷新旧元数据时间或评论', () =>
  sandbox(({ dir, write, read }) => {
    write('javdb/work-enrichment/records/A.json', {
      id: 'A',
      fetchedAt: 123,
      metadata: { number: 'TEST-001', director_name: '保留导演' },
      reviews: [{ id: 'r', content: '保留评论' }]
    })
    const run = () =>
      spawnSync(
        process.execPath,
        [
          '--require',
          path.join(__dirname, 'fixtures/enrichment-network.js'),
          path.join(__dirname, '../tools/backfill-work-types.js')
        ],
        { env: { ...process.env, RELAY_DIR: dir }, encoding: 'utf8', timeout: 10000 }
      )
    const first = run()
    assert.equal(first.status, 0, first.stderr)
    const saved = read('records/A.json')
    assert.equal(saved.metadata.type, 0)
    assert.equal(saved.fetchedAt, 123)
    assert.equal(saved.metadata.director_name, '保留导演')
    assert.equal(saved.reviews[0].content, '保留评论')
    assert(saved.typeFetchedAt > 123)
    const second = run()
    assert.equal(second.status, 0, second.stderr)
    assert(second.stdout.includes('"requests":0'))
    assert.deepEqual(read('records/A.json'), saved)
  }))

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { listCoverage } = require('../tools/lib/work-coverage')
test('仅稳定完成本轮扫描才标完成，不借用历史完成时间', () => {
  assert.equal(listCoverage(null), 'not-started')
  assert.equal(listCoverage({ completedAt: 100, nextPage: 2 }), 'partial')
  assert.equal(listCoverage({ finished: true, stable: false, completedAt: 100 }), 'unstable')
  assert.equal(listCoverage({ finished: true, stable: true }), 'partial')
  assert.equal(listCoverage({ finished: true, stable: true, completedAt: 100 }), 'complete')
})
test('覆盖报告按池内唯一作品计数，缺详情不冒充已补齐', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-coverage-'))
  const write = (file, value) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(value))
  }
  try {
    write('minnano/ranked-pool.json', { members: { 1: {}, 2: {}, 3: {} } })
    write('minnano/works/progress.json', {
      people: { 1: { finished: true, stable: true, completedAt: 100 }, 2: { nextPage: 2 } },
      pendingDetails: { 9: {} }
    })
    write('minnano/works/people/1.json', {
      actorId: '1',
      entries: [
        { id: '8', kind: 'work' },
        { id: '9', kind: 'work' },
        { id: 'uk1', kind: 'unknown' }
      ]
    })
    write('minnano/works/people/2.json', { actorId: '2', entries: [{ id: '8', kind: 'work' }] })
    write('minnano/works/records/8.json', { id: '8', fetchedAt: 100, code: 'TEST-8' })
    const r = JSON.parse(
      execFileSync(process.execPath, ['tools/report-work-coverage.js'], {
        encoding: 'utf8',
        env: { ...process.env, RELAY_DIR: root }
      })
    )
    assert.deepEqual(r.people.lists, { 'not-started': 1, partial: 1, unstable: 0, complete: 1 })
    assert.deepEqual(r.works, {
      listed: 2,
      details: 1,
      missingDetails: 1,
      withCode: 1,
      missingCode: 0
    })
    assert.equal(r.metadata.notMatched, 1)
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert(path.basename(root).startsWith('atlas-coverage-'))
    fs.rmSync(root, { recursive: true, force: true })
  }
})

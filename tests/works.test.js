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
const { planActors, RequestBudget, shouldRestartScan } = require('../tools/lib/works-policy')

test('人物队列优先当前榜单，已服务者让位，完成冷却与失败退避独立生效', () => {
  const now = 2000000000
  const args = {
    ids: ['1', '2', '3', '4', '5'],
    rankings: { day: [{ id: '2', rank: 1 }] },
    people: {
      3: { lastScheduledAt: 100, finished: true },
      4: { finished: true, stable: true, completedAt: now - 1 },
      5: { nextRetryAt: now + 1 }
    },
    now,
    limit: 5
  }
  assert.deepEqual(planActors(args), ['2', '1', '3'])
  args.people['2'] = { lastScheduledAt: now, finished: true }
  assert.deepEqual(planActors(args), ['1', '3', '2'])
  args.now += 8 * 86400000
  assert(planActors(args).includes('4'))
  assert(planActors(args).includes('5'))
})

test('5人预算保留2个续跑和3个新人物名额，两队内部轮转且空位可互补', () => {
  const args = {
    ids: ['1', '2', '3', '4', '5', '6', '7', '8'],
    rankings: {},
    now: 1000,
    limit: 5,
    people: { 6: { lastScheduledAt: 10 }, 7: { lastScheduledAt: 20 }, 8: { lastScheduledAt: 30 } }
  }
  assert.deepEqual(planActors(args), ['6', '7', '1', '2', '3'])
  args.people['6'].lastScheduledAt = 1000
  args.people['7'].lastScheduledAt = 1000
  assert.deepEqual(planActors(args).slice(0, 2), ['8', '6'])
  assert.equal(planActors({ ...args, ids: ['6', '7', '8'] }).length, 3)
  assert.deepEqual(planActors({ ...args, ids: ['1', '2', '3'] }), ['1', '2', '3'])
})

test('跨天持续推进保留扫描，连续七天无进展才重启，旧断点兼容', () => {
  const day = 86400000,
    now = 20 * day
  assert.equal(shouldRestartScan({ startedAt: day, lastProgressAt: now - 2 * day }, now), false)
  assert.equal(shouldRestartScan({ startedAt: day, lastProgressAt: now - 8 * day }, now), true)
  assert.equal(shouldRestartScan({ startedAt: now - 2 * day }, now), false)
  assert.equal(shouldRestartScan({ startedAt: now, finished: true }, now), true)
})

test('总请求预算涵盖全部尝试，耗尽信号与来源失败区分', () => {
  const budget = new RequestBudget(2)
  budget.take()
  budget.take()
  assert.throws(
    () => budget.take(),
    error => error.budgetExhausted === true
  )
  assert.equal(budget.used, 2)
})

/** 每个用例在临时数据根模拟多轮runner；全部断点只来自文件，不依赖进程内变量。 */
function queueSandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-work-queue-'))
  const read = file => JSON.parse(fs.readFileSync(path.join(dir, 'minnano/works', file), 'utf8'))
  const write = (file, value) => {
    const target = path.join(dir, 'minnano', file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(value))
  }
  const run = (env = {}) =>
    spawnSync(
      process.execPath,
      [
        '--require',
        path.join(__dirname, 'fixtures/works-network.js'),
        path.join(__dirname, '../tools/works-relay.js')
      ],
      {
        env: { ...process.env, RELAY_DIR: dir, WORK_SCOPE: 'ranked', WORK_DETAILS: '0', ...env },
        encoding: 'utf8',
        timeout: 15000
      }
    )
  try {
    write('ranked-pool.json', { members: { 190754: {}, 125605: {}, 999999: {} } })
    fn({ dir, read, write, run })
  } finally {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

test('每人分页暂停后跨轮续跑，首页复核也受总请求上限约束', () =>
  queueSandbox(({ dir, read, run }) => {
    const log = path.join(dir, 'requests.log')
    const env = {
      WORK_FIXTURE_PAGES: '2',
      WORK_PEOPLE: '1',
      WORK_PERSON_PAGES: '1',
      WORK_REQUESTS: '1',
      WORK_FIXTURE_LOG: log
    }
    // 单人预算优先完成已有扫描，第二轮即沿同一scan接第二页。
    assert.equal(run(env).status, 0)
    const first = read('progress.json').people['125605']
    assert.equal(first.nextPage, 2)
    assert.equal(run(env).status, 0)
    const resumed = read('progress.json').people['125605']
    assert.equal(resumed.scanId, first.scanId)
    assert.equal(resumed.nextPage, null)
    assert.equal(resumed.finished, undefined) // 首页复核尚无请求预算，不能标完成。
    assert.equal(read('report.json').requests, 1)
    assert.equal(run(env).status, 0)
    assert.equal(read('progress.json').people['125605'].finished, true)
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, 3)
  }))

test('来源失败保留其他人物进度及退避，磁盘错误不能伪装成可恢复失败', () =>
  queueSandbox(({ dir, read, run }) => {
    const partial = run({ WORK_FIXTURE_BAD_ACTOR: '125605' })
    assert.equal(partial.status, 2, partial.stdout + partial.stderr)
    assert(read('people/190754.json').completedAt)
    assert(read('progress.json').people['125605'].nextRetryAt > Date.now())
    assert.equal(read('report.json').failures.length, 1)
    const next = run({ WORK_FIXTURE_BAD_ACTOR: '125605' })
    assert.equal(next.status, 0, next.stdout + next.stderr)
    assert.equal(read('report.json').requests, 0)
    // 把报告路径变成目录，触发真实文件写入错误；必须退出1，Actions不允许提交。
    fs.rmSync(path.join(dir, 'minnano/works/report.json'))
    fs.mkdirSync(path.join(dir, 'minnano/works/report.json'))
    assert.equal(run().status, 1)
  }))

test('已有成功详情跨越七天仍复用，旧待办优先于新列表消耗请求预算', () =>
  queueSandbox(({ read, write, run }) => {
    write('works/records/123.json', { id: '123', fetchedAt: 1, custom: '保留' })
    write('works/progress.json', {
      schemaVersion: 1,
      people: {},
      pendingDetails: {
        123: { attempts: 0, nextRetryAt: 0 },
        456: { attempts: 0, nextRetryAt: 0 }
      }
    })
    const result = run({ WORK_DETAILS: '1', WORK_REQUESTS: '1' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(read('records/123.json').custom, '保留')
    assert.equal(read('records/456.json').id, '456')
    assert.equal(read('report.json').requests, 1)
    assert.equal(read('report.json').pages, 0)
  }))
test('trial范围不消费其他人物待办，非法断点ID在联网前被拒绝', () =>
  queueSandbox(({ dir, read, write, run }) => {
    write('works/progress.json', {
      schemaVersion: 1,
      people: {},
      pendingDetails: { 999123: { attempts: 0, nextRetryAt: 0 } }
    })
    const trial = run({ WORK_SCOPE: 'trial', WORK_DETAILS: '2' })
    assert.equal(trial.status, 0, trial.stdout + trial.stderr)
    assert(read('progress.json').pendingDetails['999123'])
    assert.equal(read('report.json').details, 2)
    const log = path.join(dir, 'invalid-requests.log')
    write('works/progress.json', {
      schemaVersion: 1,
      people: {},
      pendingDetails: { '../bad': { attempts: 0, nextRetryAt: 0 } }
    })
    assert.equal(run({ WORK_FIXTURE_LOG: log }).status, 1)
    assert.equal(fs.existsSync(log), false)
  }))

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
    fs.writeFileSync(record, JSON.stringify({ id: '123', custom: '保留' }))
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

const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  candidates,
  checkedRecord,
  sameCode,
  searchCandidates,
  resolveFanza
} = require('../tools/lib/fanza')

test('搜索只接受相同前缀及集数，厂商数字前缀仅用于候选，仍需详情校验', async () => {
  assert.deepEqual(
    searchCandidates('COM-081', [{ id: 'h_123com00081' }, { id: 'com00082' }, { id: 'xcom00081' }]),
    ['h_123com00081']
  )
  const calls = []
  const result = await resolveFanza({ id: '1', code: 'COM-081' }, async (kind, variables) => {
    calls.push(kind)
    if (kind === 'search')
      return { data: { legacySearchPPV: { result: { contents: [{ id: 'h_123com00081' }] } } } }
    return {
      data: {
        ppvContent: variables.id.startsWith('h_')
          ? { id: variables.id, makerContentId: 'COM-081', duration: 120 }
          : null
      }
    }
  })
  assert.equal(result.record.metadata.id, 'h_123com00081')
  assert.deepEqual(calls, ['detail', 'detail', 'search', 'detail'])
})

test('搜索同番号多版本不自动选择，超出预算不请求详情，异常保留已查证据', async () => {
  for (const count of [2, 3]) {
    let requests = 0
    const result = await resolveFanza({ id: '1', code: 'COM-081' }, async (kind, variables) => {
      requests++
      if (kind === 'search')
        return {
          data: {
            legacySearchPPV: {
              result: {
                contents: Array.from({ length: count }, (_, i) => ({ id: `h_${i + 1}com00081` }))
              }
            }
          }
        }
      return {
        data: {
          ppvContent: variables.id.startsWith('h_')
            ? { id: variables.id, makerContentId: 'COM-081' }
            : null
        }
      }
    })
    assert.equal(result.record, null)
    assert.equal(requests, count === 2 ? 5 : 3)
  }
  await assert.rejects(
    resolveFanza({ id: '1', code: 'COM-081' }, async kind => {
      if (kind === 'search') throw Error('HTTP 429')
      return { data: { ppvContent: null } }
    }),
    error => error.observations.length === 2
  )
})

test('补零可等价，前缀、集数和分片后缀必须严格区分', () => {
  assert(sameCode('ofje00528', 'OFJE-528'))
  assert(sameCode('AJVR00111', 'ajvr-111'))
  assert(!sameCode('OFJE-528', 'OFJE-530'))
  assert(!sameCode('FCDC-130', 'OFJE-130'))
  assert(!sameCode('MCSR-042', 'MCSR-042-01'))
  assert(!sameCode('1STARS-931', 'STARS-931'))
  assert(!sameCode('', ''))
})
test('候选不猜数字前缀，返回番号和商品ID双重校验，秒数保持原单位', () => {
  assert.deepEqual(candidates('SNOS-461'), ['snos00461', 'snos461'])
  assert.deepEqual(candidates('../bad'), [])
  const movie = { id: 'snos00461', makerContentId: 'SNOS-461', duration: 7042 }
  assert.equal(
    checkedRecord({ id: '1', code: 'SNOS-461' }, movie, movie.id, 1).metadata.durationSeconds,
    7042
  )
  assert.throws(() => checkedRecord({ id: '1', code: 'SNOS-462' }, movie, movie.id, 1), /不一致/)
  assert.throws(() => checkedRecord({ id: '1', code: 'SNOS-461' }, movie, 'snos461', 1), /不一致/)
})

test('采集独立落盘且跨轮复用成功和失败退避，限流跨轮停止', () => {
  const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-fanza-'))
  const write = (file, value) => {
    const p = path.join(dir, file)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, JSON.stringify(value))
  }
  const read = file => JSON.parse(fs.readFileSync(path.join(dir, file)))
  try {
    write('minnano/works/records/1.json', { id: '1', code: 'TEST-1', custom: '保持' })
    write('minnano/works/records/2.json', { id: '2', code: 'TEST-2' })
    const fixture = path.join(dir, 'network.cjs')
    fs.writeFileSync(
      fixture,
      `global.fetch=async(_, options)=>{const id=JSON.parse(options.body).variables.id; if(process.env.FANZA_TEST_LIMIT)return new Response('',{status:429}); return Response.json({data:{ppvContent:{id,makerContentId:id.endsWith('00001')?'TEST-1':'WRONG-2',duration:121}}})}`
    )
    const run = extra =>
      spawnSync(
        process.execPath,
        ['--require', fixture, path.resolve(__dirname, '../tools/enrich-fanza.js')],
        { env: { ...process.env, RELAY_DIR: dir, ...extra }, encoding: 'utf8', timeout: 15000 }
      )
    const first = run()
    assert.equal(first.status, 2, first.stdout + first.stderr)
    assert.equal(read('fanza/work-enrichment/records/1.json').metadata.durationSeconds, 121)
    assert.equal(fs.existsSync(path.join(dir, 'fanza/work-enrichment/records/2.json')), false)
    assert.equal(read('minnano/works/records/1.json').custom, '保持')
    assert.equal(run().status, 0)
    assert.equal(read('fanza/work-enrichment/report.json').requests, 0)
    write('minnano/works/records/3.json', { id: '3', code: 'TEST-3' })
    assert.equal(run({ FANZA_TEST_LIMIT: '1' }).status, 2)
    assert(read('fanza/work-enrichment/progress.json').blockedUntil > Date.now())
    assert.equal(run().status, 0)
    assert.equal(read('fanza/work-enrichment/report.json').requests, 0)
  } finally {
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

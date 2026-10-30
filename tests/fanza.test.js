const { test } = require('node:test')
const assert = require('node:assert/strict')
const { candidates, checkedRecord } = require('../tools/lib/fanza')
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

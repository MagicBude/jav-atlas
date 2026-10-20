const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { readJson, writeJson, envInt } = require('../tools/lib/runtime')
const root = path.join(__dirname, '..')

/** 每例都使用系统临时目录，合成资料不会写入项目 relay 或混入真实采集。 */
function sandbox(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-pipeline-'))
  try {
    fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
function run(dir, file, args = [], extra = {}) {
  const preload = path.join(__dirname, 'fixtures', 'network.js')
  return spawnSync(
    process.execPath,
    ['--require', preload, path.join(root, 'tools', file), ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_OPTIONS: '--require=' + JSON.stringify(preload),
        RELAY_DIR: dir,
        CACHE_DIR: path.join(dir, 'cache'),
        MOVIE_PAGES: '1',
        UC_PAGES: '1',
        AVA_LIMIT: '0',
        WEB_GENDER: '0',
        SKIP_IMAGES: '1',
        ...extra
      },
      encoding: 'utf8',
      timeout: 15000
    }
  )
}
const json = (dir, f) => readJson(path.join(dir, f))
function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''))
}

test('空目录以合成响应跑通完整 smoke，保持来源 ID 与未知性别', () =>
  sandbox(dir => {
    const result = run(dir, 'collect.js', ['smoke', 'all'])
    success(result)
    assert(fs.existsSync(path.join(dir, 'avatars', '123.jpg')), '相对图片 URL 应正确下载')
    assert.equal(json(dir, 'roster.json')[0].mnid, '123')
    assert.equal(json(dir, 'roster.json')[0].birthday, '2000-01-02')
    assert.equal(json(dir, 'actors_full.json').list.find(a => a.id === 'actor1').gender, 'f')
    assert.equal(json(dir, 'actors_full.json').list.find(a => a.id === 'actor2').gender, '?')
    const uc = json(dir, 'uncensored_actresses.json')
    assert.equal(uc.count, 2)
    assert.equal(uc.unknown, 1)
    assert.equal(uc.list[0].uc_count, 1)
    assert(!result.stdout.includes('男优 -'))
  }))

test('榜单空解析时失败，已有榜单不被覆盖', () =>
  sandbox(dir => {
    const file = path.join(dir, 'rankings.json')
    writeJson(file, { sentinel: true })
    const result = run(dir, 'rank-relay.js', [], { FIXTURE_FAIL: 'rank-empty' })
    assert.notEqual(result.status, 0)
    assert.deepEqual(readJson(file), { sentinel: true })
  }))

test('API 全部失败时演员与无码采集均非零退出并保留旧文件', () =>
  sandbox(dir => {
    for (const [script, output] of [
      ['actors-full-crawl.js', 'actors_full.json'],
      ['uncensored-actresses-crawl.js', 'uncensored_actresses.json']
    ]) {
      writeJson(path.join(dir, output), { sentinel: true })
      const result = run(dir, script, [], { FIXTURE_FAIL: 'javdb' })
      assert.notEqual(result.status, 0)
      assert.deepEqual(json(dir, output), { sentinel: true })
    }
  }))

test('新增演员详情全失败时不覆盖已有集合', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'actors_full.json'), { list: [] })
    const result = run(dir, 'actors-full-crawl.js', [], { FIXTURE_FAIL: 'actor-detail' })
    assert.notEqual(result.status, 0)
    assert.deepEqual(json(dir, 'actors_full.json'), { list: [] })
  }))

test('不识别资料页时不写假成功，失败缓存允许下一轮立即重试', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'roster.json'), [{ mnid: '123', name: 'Test Actor' }])
    const failed = run(dir, 'profiles-relay.js', [], { FIXTURE_FAIL: 'profile-empty' })
    assert.notEqual(failed.status, 0)
    assert.deepEqual(json(dir, 'roster.json'), [{ mnid: '123', name: 'Test Actor' }])
    success(run(dir, 'profiles-relay.js'))
    assert.equal(json(dir, 'roster.json')[0].birthday, '2000-01-02')
  }))

test('再次建立名册不重复添加，也不覆盖人工字段', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js'))
    writeJson(path.join(dir, 'roster.json'), [{ mnid: '123', name: 'Manual Name', height: '170' }])
    success(run(dir, 'bootstrap-roster.js'))
    assert.deepEqual(json(dir, 'roster.json'), [
      { mnid: '123', name: 'Manual Name', height: '170' }
    ])
  }))

test('损坏的演员 JSON 不被当成冷启动清空', () =>
  sandbox(dir => {
    const file = path.join(dir, 'actors_full.json')
    fs.writeFileSync(file, '{broken')
    assert.notEqual(run(dir, 'actors-full-crawl.js').status, 0)
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  }))

test('修复缓存按 map 读取，已有记录不会嵌套包装', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'roster.json'), [{ mnid: '123', name: 'Test Actor' }])
    writeJson(path.join(dir, 'actress_fix.json'), {
      count: 1,
      map: { 'Test Actor': { name: 'Test Actor', marker: true } }
    })
    success(run(dir, 'actors-full-crawl.js'))
    const fix = json(dir, 'actress_fix.json')
    assert.equal(fix.map['Test Actor'].marker, true)
    assert.equal(fix.map.map, undefined)
    assert.equal(fix.count, 1)
  }))

test('没有女性输入时不生成空名字文件，已有名字继续保留', () =>
  sandbox(dir => {
    success(run(dir, 'gen-female-names.js'))
    assert(!fs.existsSync(path.join(dir, 'female_names.json')))
    writeJson(path.join(dir, 'female_names.json'), { names: ['Existing'] })
    success(run(dir, 'gen-female-names.js'))
    assert.deepEqual(json(dir, 'female_names.json').names, ['Existing'])
  }))

test('整数参数拒绝非法值，0 仅在允许时生效', () => {
  const key = 'ATLAS_TEST_INTEGER'
  const previous = process.env[key]
  try {
    for (const v of ['NaN', '-1', '1.5', 'Infinity', '1e3']) {
      process.env[key] = v
      assert.throws(() => envInt(key, 4))
    }
    process.env[key] = '0'
    assert.throws(() => envInt(key, 4))
    assert.equal(envInt(key, 4, 0), 0)
  } finally {
    if (previous === undefined) delete process.env[key]
    else process.env[key] = previous
  }
})

test('统一入口首步失败立即停止，不能输出整批成功', () =>
  sandbox(dir => {
    const result = run(dir, 'collect.js', ['smoke', 'all'], { FIXTURE_FAIL: 'minnano' })
    assert.notEqual(result.status, 0)
    assert(!result.stdout.includes('>>> actors-full-crawl.js'))
    assert(!fs.existsSync(path.join(dir, 'roster.json')))
  }))

test('h2 旧版榜单标题仍能解析', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js', [], { FIXTURE_RANK_TAG: 'h2' }))
    assert.equal(json(dir, 'rankings.json').day[0].id, '123')
  }))

test('某个影片维度失败不把部分成功发布为完整新集合', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'actors_full.json'), { list: [], sentinel: true })
    const result = run(dir, 'actors-full-crawl.js', [], { FIXTURE_FAIL: 'second-dimension' })
    assert.notEqual(result.status, 0)
    assert.equal(json(dir, 'actors_full.json').sentinel, true)
  }))

test('损坏的无码名单不被忽略并覆盖', () =>
  sandbox(dir => {
    fs.writeFileSync(path.join(dir, 'uncensored_actresses.json'), '{broken')
    assert.notEqual(run(dir, 'uncensored-actresses-crawl.js').status, 0)
    assert.equal(fs.readFileSync(path.join(dir, 'uncensored_actresses.json'), 'utf8'), '{broken')
  }))

test('无码人物详情全失败时保留旧名单', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'uncensored_actresses.json'), { list: [], sentinel: true })
    assert.notEqual(
      run(dir, 'uncensored-actresses-crawl.js', [], { FIXTURE_FAIL: 'actor-detail' }).status,
      0
    )
    assert.equal(json(dir, 'uncensored_actresses.json').sentinel, true)
  }))

test('名册头像采集同样遵守 RELAY_DIR，而非硬编码项目目录', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js'))
    success(run(dir, 'bootstrap-roster.js'))
    success(run(dir, 'roster-avatars.js', ['1']))
    assert(fs.existsSync(path.join(dir, 'avatars', '123.jpg')))
  }))

test('已有未知人物可在后续获得名册依据后被确认，而不是永久跳过', () =>
  sandbox(dir => {
    success(run(dir, 'actors-full-crawl.js'))
    assert.equal(json(dir, 'actors_full.json').unknown, 2)
    writeJson(path.join(dir, 'female_names.json'), { names: ['Test Actor'] })
    success(run(dir, 'actors-full-crawl.js'))
    const actors = json(dir, 'actors_full.json')
    assert.equal(actors.list.find(a => a.id === 'actor1').gender, 'f')
    assert.equal(actors.list.find(a => a.id === 'actor1').genderSource, 'roster')
    assert.equal(actors.unknown, 1)
  }))

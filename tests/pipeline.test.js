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
    assert(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep))
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
    assert(
      fs.existsSync(path.join(dir, 'minnano', 'avatars', '123.jpg')),
      '相对图片 URL 应正确下载'
    )
    assert.equal(json(dir, 'minnano/actresses.json')[0].mnid, '123')
    assert.equal(json(dir, 'minnano/actresses.json')[0].birthday, '2000-01-02')
    assert.equal(json(dir, 'javdb/actors.json').list.find(a => a.id === 'actor1').gender, 'f')
    assert.equal(json(dir, 'javdb/actors.json').list.find(a => a.id === 'actor2').gender, '?')
    const uc = json(dir, 'javdb/uncensored-actors.json')
    assert.equal(uc.count, 2)
    assert.equal(uc.unknown, 1)
    assert.equal(uc.list[0].uc_count, 1)
    assert(!result.stdout.includes('男优 -'))
  }))

test('榜单空解析时失败，已有榜单不被覆盖', () =>
  sandbox(dir => {
    const file = path.join(dir, 'minnano/rankings.json')
    writeJson(file, { sentinel: true })
    const result = run(dir, 'rank-relay.js', [], { FIXTURE_FAIL: 'rank-empty' })
    assert.notEqual(result.status, 0)
    assert.deepEqual(readJson(file), { sentinel: true })
  }))

test('API 全部失败时演员与无码采集均非零退出并保留旧文件', () =>
  sandbox(dir => {
    for (const [script, output] of [
      ['actors-full-crawl.js', 'javdb/actors.json'],
      ['uncensored-actresses-crawl.js', 'javdb/uncensored-actors.json']
    ]) {
      writeJson(path.join(dir, output), { sentinel: true })
      const result = run(dir, script, [], { FIXTURE_FAIL: 'javdb' })
      assert.notEqual(result.status, 0)
      assert.deepEqual(json(dir, output), { sentinel: true })
    }
  }))

test('新增演员详情全失败时不覆盖已有集合', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'javdb/actors.json'), { list: [] })
    const result = run(dir, 'actors-full-crawl.js', [], { FIXTURE_FAIL: 'actor-detail' })
    assert.notEqual(result.status, 0)
    assert.deepEqual(json(dir, 'javdb/actors.json'), { list: [] })
  }))

test('不识别资料页时不写假成功，失败缓存允许下一轮立即重试', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [{ mnid: '123', name: 'Test Actor' }])
    const failed = run(dir, 'profiles-relay.js', [], { FIXTURE_FAIL: 'profile-empty' })
    assert.notEqual(failed.status, 0)
    assert.deepEqual(json(dir, 'minnano/actresses.json'), [{ mnid: '123', name: 'Test Actor' }])
    success(run(dir, 'profiles-relay.js'))
    assert.equal(json(dir, 'minnano/actresses.json')[0].birthday, '2000-01-02')
  }))

test('再次建立名册不重复添加，也不覆盖人工字段', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js'))
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '123', name: 'Manual Name', height: '170' }
    ])
    success(run(dir, 'bootstrap-roster.js'))
    assert.deepEqual(json(dir, 'minnano/actresses.json'), [
      { mnid: '123', name: 'Manual Name', height: '170' }
    ])
  }))

test('损坏的演员 JSON 不被当成冷启动清空', () =>
  sandbox(dir => {
    const file = path.join(dir, 'javdb/actors.json')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{broken')
    assert.notEqual(run(dir, 'actors-full-crawl.js').status, 0)
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken')
  }))

test('修复缓存按 map 读取，已有记录不会嵌套包装', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [{ mnid: '123', name: 'Test Actor' }])
    writeJson(path.join(dir, 'derived/avatar-supplements.json'), {
      count: 1,
      map: { 'Test Actor': { name: 'Test Actor', marker: true } }
    })
    success(run(dir, 'actors-full-crawl.js'))
    const fix = json(dir, 'derived/avatar-supplements.json')
    assert.equal(fix.map['Test Actor'].marker, true)
    assert.equal(fix.map.map, undefined)
    assert.equal(fix.count, 1)
  }))

test('没有女性输入时不生成空名字文件，已有名字继续保留', () =>
  sandbox(dir => {
    success(run(dir, 'gen-female-names.js'))
    assert(!fs.existsSync(path.join(dir, 'derived/female-name-index.json')))
    writeJson(path.join(dir, 'derived/female-name-index.json'), { names: ['Existing'] })
    success(run(dir, 'gen-female-names.js'))
    assert.deepEqual(json(dir, 'derived/female-name-index.json').names, ['Existing'])
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
    assert(!fs.existsSync(path.join(dir, 'minnano/actresses.json')))
  }))

test('h2 旧版榜单标题仍能解析', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js', [], { FIXTURE_RANK_TAG: 'h2' }))
    assert.equal(json(dir, 'minnano/rankings.json').day[0].id, '123')
  }))

test('某个影片维度失败不把部分成功发布为完整新集合', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'javdb/actors.json'), { list: [], sentinel: true })
    const result = run(dir, 'actors-full-crawl.js', [], { FIXTURE_FAIL: 'second-dimension' })
    assert.notEqual(result.status, 0)
    assert.equal(json(dir, 'javdb/actors.json').sentinel, true)
  }))

test('损坏的无码名单不被忽略并覆盖', () =>
  sandbox(dir => {
    fs.mkdirSync(path.join(dir, 'javdb'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'javdb/uncensored-actors.json'), '{broken')
    assert.notEqual(run(dir, 'uncensored-actresses-crawl.js').status, 0)
    assert.equal(fs.readFileSync(path.join(dir, 'javdb/uncensored-actors.json'), 'utf8'), '{broken')
  }))

test('无码人物详情全失败时保留旧名单', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'javdb/uncensored-actors.json'), { list: [], sentinel: true })
    assert.notEqual(
      run(dir, 'uncensored-actresses-crawl.js', [], { FIXTURE_FAIL: 'actor-detail' }).status,
      0
    )
    assert.equal(json(dir, 'javdb/uncensored-actors.json').sentinel, true)
  }))

test('名册头像采集同样遵守 RELAY_DIR，而非硬编码项目目录', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js'))
    success(run(dir, 'bootstrap-roster.js'))
    success(run(dir, 'roster-avatars.js', ['1']))
    assert(fs.existsSync(path.join(dir, 'minnano', 'avatars', '123.jpg')))
  }))

test('已有未知人物可在后续获得名册依据后被确认，而不是永久跳过', () =>
  sandbox(dir => {
    success(run(dir, 'actors-full-crawl.js'))
    assert.equal(json(dir, 'javdb/actors.json').unknown, 2)
    writeJson(path.join(dir, 'derived/female-name-index.json'), { names: ['Test Actor'] })
    success(run(dir, 'actors-full-crawl.js'))
    const actors = json(dir, 'javdb/actors.json')
    assert.equal(actors.list.find(a => a.id === 'actor1').gender, 'f')
    assert.equal(actors.list.find(a => a.id === 'actor1').genderSource, 'roster')
    assert.equal(actors.unknown, 1)
  }))

test('JSON 保存使用多行缩进和末尾换行，不改变字段值及 replacer 规则', () =>
  sandbox(dir => {
    const value = { people: [{ id: '123', name: '测试人物', zero: 0, active: false }], empty: '' }
    const file = path.join(dir, 'readable.json')
    writeJson(file, value)
    const text = fs.readFileSync(file, 'utf8')
    assert(text.endsWith('\n'))
    assert(text.split('\n').length > 8)
    assert(text.includes('\n  "people": ['))
    assert.deepEqual(readJson(file), value)
    writeJson(file, value, (key, current) => (current === '' ? undefined : current))
    assert.equal(readJson(file).empty, undefined)
    assert.equal(readJson(file).people[0].zero, 0)
    assert.equal(readJson(file).people[0].active, false)
  }))

test('同作品数和同出演数的记录，不因请求完成顺序而重排', () =>
  sandbox(dir => {
    success(run(dir, 'actors-full-crawl.js'))
    success(run(dir, 'uncensored-actresses-crawl.js'))
    const actors = json(dir, 'javdb/actors.json').list
    const credits = json(dir, 'javdb/uncensored-actors.json').list
    // 删除本例自己的产物，第二轮必须重新请求详情，才真正覆盖并发完成顺序变化。
    fs.unlinkSync(path.join(dir, 'javdb/actors.json'))
    fs.unlinkSync(path.join(dir, 'javdb/uncensored-actors.json'))
    success(run(dir, 'actors-full-crawl.js', [], { FIXTURE_REVERSE: '1' }))
    success(run(dir, 'uncensored-actresses-crawl.js', [], { FIXTURE_REVERSE: '1' }))
    assert.deepEqual(json(dir, 'javdb/actors.json').list, actors)
    assert.deepEqual(json(dir, 'javdb/uncensored-actors.json').list, credits)
  }))

test('数据路径按来源分组，覆盖根目录不改变内部布局', () =>
  sandbox(dir => {
    const { dataPaths } = require('../tools/lib/data-paths')
    const paths = dataPaths(dir)
    assert.equal(paths.minnanoActresses, path.join(dir, 'minnano', 'actresses.json'))
    assert.equal(paths.javdbMaleSeeds, path.join(dir, 'javdb', 'male-seed-actors.json'))
    assert.equal(paths.femaleNameIndex, path.join(dir, 'derived', 'female-name-index.json'))
    assert.equal(paths.avatarSupplements, path.join(dir, 'derived', 'avatar-supplements.json'))
    assert.equal(paths.supplementAvatars, path.join(dir, 'derived', 'avatars'))
    for (const file of Object.values(paths)) {
      assert(path.isAbsolute(file))
      assert(file.startsWith(dir + path.sep))
      assert(['minnano', 'javdb', 'derived'].includes(path.relative(dir, file).split(path.sep)[0]))
    }
  }))

test('男演员种子和普通 JavDB 采集共用同一来源头像缓存', () =>
  sandbox(dir => {
    const options = { FIXTURE_MALE: '1', FIXTURE_AVATAR: '1', SEED_LIMIT: '1', SKIP_IMAGES: '0' }
    success(run(dir, 'male-roster-relay.js', [], options))
    assert.equal(json(dir, 'javdb/male-seed-actors.json').count, 1)
    assert(fs.existsSync(path.join(dir, 'javdb', 'avatars', 'actor1.jpg')))
    success(run(dir, 'actors-full-crawl.js', [], options))
    assert.deepEqual(fs.readdirSync(path.join(dir, 'javdb', 'avatars')), ['actor1.jpg'])
    assert(!fs.existsSync(path.join(dir, 'avatars_male')))
  }))

test('跨来源补图写入 derived，不混入 JavDB 源站头像目录', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano', 'actresses.json'), [{ mnid: '123', name: 'Test Actor' }])
    writeJson(path.join(dir, 'derived', 'avatar-supplements.json'), {
      count: 1,
      map: {
        'Test Actor': {
          name: 'Test Actor',
          mnid: '123',
          mimg: 'https://www.minnano-av.com/images/test.jpg'
        }
      }
    })
    success(run(dir, 'actors-full-crawl.js', [], { SKIP_IMAGES: '0' }))
    assert(fs.existsSync(path.join(dir, 'derived', 'avatars', 'mn_123.jpg')))
    assert(!fs.existsSync(path.join(dir, 'javdb', 'avatars', 'mn_123.jpg')))
  }))

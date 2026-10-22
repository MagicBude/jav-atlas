const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { readJson, writeJson, envInt } = require('../tools/lib/runtime')
const { avatarFilename } = require('../tools/lib/avatars')
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

test('榜单池详情已齐也独立重试缺图，并在最终报告更新图片状态', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '123', name: 'Test Actor', profileFetchedAt: 1, profileSchemaVersion: 2 }
    ])
    success(run(dir, 'collect.js', ['daily', 'ranked'], { SKIP_IMAGES: '0', BACKFILL_LIMIT: '3' }))
    const report = json(dir, 'minnano/backfill-report.json')
    assert.equal(report.selected, 0)
    assert.equal(report.total.missingAvatars, 0)
    assert.equal(report.scope, 'ranked-pool')
    assert.equal(json(dir, 'minnano/actresses.json')[0].profileFetchedAt, 1)
  }))

test('Top250缺页或分页重复都拒绝覆盖已有榜单', () =>
  sandbox(dir => {
    const file = path.join(dir, 'minnano/rankings.json')
    writeJson(file, { sentinel: '旧完整快照' })
    for (const extra of [{ FIXTURE_RANK_STOP: '3' }, { FIXTURE_RANK_REPEAT: '1' }]) {
      const result = run(dir, 'rank-relay.js', [], { FIXTURE_TOP250: '1', ...extra })
      assert.notEqual(result.status, 0)
      assert.deepEqual(json(dir, 'minnano/rankings.json'), { sentinel: '旧完整快照' })
    }
  }))

test('三种榜单完整采集五页各250位，保持源站名次', () =>
  sandbox(dir => {
    success(run(dir, 'rank-relay.js', [], { FIXTURE_TOP250: '1' }))
    for (const mode of ['day', 'week', 'month']) {
      const rows = json(dir, 'minnano/rankings.json')[mode]
      assert.equal(rows.length, 250)
      assert.deepEqual(
        rows.map(row => row.rank),
        Array.from({ length: 250 }, (_, i) => i + 1)
      )
    }
  }))

test('榜单池按原生ID累积，落榜不删除，既有名册字段保持', () =>
  sandbox(dir => {
    const file = path.join(dir, 'minnano/rankings.json')
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '999', name: '存档', agency: '保留' }
    ])
    const row = id => ({ id, name: '姓名' + id, rank: 1 })
    writeJson(file, { fetchedAt: 10, day: [row('123')], week: [row('123')], month: [row('456')] })
    success(run(dir, 'bootstrap-roster.js'))
    writeJson(file, { fetchedAt: 20, day: [row('789')], week: [row('123')], month: [row('789')] })
    success(run(dir, 'bootstrap-roster.js'))
    const pool = json(dir, 'minnano/ranked-pool.json')
    assert.deepEqual(Object.keys(pool.members).sort(), ['123', '456', '789'])
    assert.equal(pool.members['123'].firstSeenAt, 10)
    assert.equal(pool.members['123'].lastSeenAt, 20)
    assert.equal(pool.members['456'].lastSeenAt, 10)
    assert.equal(json(dir, 'minnano/actresses.json')[0].agency, '保留')
  }))

test('ranked 日常入口不调用目录或JavDB，仅回填榜单池人物', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '999', name: '不应请求的存档人物', unknown: null, aliases: [], note: '' }
    ])
    const result = run(dir, 'collect.js', ['daily', 'ranked'], { BACKFILL_LIMIT: '3' })
    success(result)
    assert(!result.stdout.includes('actors-full-crawl'))
    assert(!result.stdout.includes('discover-minnano'))
    assert.deepEqual(
      json(dir, 'minnano/actresses.json').find(row => row.mnid === '999'),
      { mnid: '999', name: '不应请求的存档人物', unknown: null, aliases: [], note: '' }
    )
    assert(json(dir, 'minnano/actresses.json').find(row => row.mnid === '123').profileFetchedAt)
    assert.equal(json(dir, 'minnano/backfill-report.json').total.people, 1)
  }))

test('同批头像筛选在路径分配前完成，不给无关人物写索引', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '123', name: 'Test Actor' },
      { mnid: '456', name: 'Unselected' }
    ])
    success(run(dir, 'roster-avatars.js', ['1'], { ONLY: '123' }))
    assert.deepEqual(Object.keys(json(dir, 'minnano/avatars/index.json').files), ['123'])
  }))

test('限量详情入口跨缓存继续下一批，保留已有字段，失败不记完成', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '123', name: 'Manual Name', height: '180' },
      { mnid: '456', name: 'Not Declared' }
    ])
    success(run(dir, 'backfill-minnano.js', [], { BACKFILL_LIMIT: '1' }))
    const rows = json(dir, 'minnano/actresses.json')
    assert(rows[0].profileFetchedAt)
    assert.equal(rows[0].height, '180')
    assert.deepEqual(rows[0].relatedProfiles, [
      { id: '456', name: 'Related Actor', title: 'Related Actor,tag' }
    ])
    assert.deepEqual(
      rows[0].profileFields.find(field => field.label === '独自項目'),
      {
        label: '独自項目',
        text: '原始値',
        links: [{ text: '原始値', url: 'https://www.minnano-av.com/custom.html?a=1&b=2' }]
      }
    )
    assert.equal(rows[1].profileFetchedAt, undefined)
    assert.equal(json(dir, 'minnano/backfill-report.json').batch.profileSuccess, 1)
    assert.equal(json(dir, 'minnano/backfill-report.json').total.people, 2)
    fs.rmSync(path.join(dir, 'cache'), { recursive: true, force: true })
    const failed = run(dir, 'backfill-minnano.js', [], { BACKFILL_LIMIT: '1' })
    assert.notEqual(failed.status, 0)
    assert(failed.stdout.includes('ONLY 指定'))
    assert.deepEqual(json(dir, 'minnano/actresses.json'), rows)
    assert.equal(json(dir, 'minnano/backfill-report.json').batch.profileFailed, 1)
    assert.equal(json(dir, 'minnano/backfill-report.json').results[0].mnid, '456')
  }))

test('限量详情入口拒绝非法数量且无候选时不请求网络', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano/actresses.json'), [
      { mnid: '123', name: 'Done', profileFetchedAt: 1, profileSchemaVersion: 2 }
    ])
    assert.notEqual(run(dir, 'backfill-minnano.js', [], { BACKFILL_LIMIT: '0' }).status, 0)
    success(run(dir, 'backfill-minnano.js', [], { FIXTURE_FAIL: 'all' }))
  }))
function success(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr + (result.error || ''))
}

test('空目录以合成响应跑通完整 smoke，保持来源 ID 与未知性别', () =>
  sandbox(dir => {
    const result = run(dir, 'collect.js', ['smoke', 'all'])
    success(result)
    assert(
      fs.existsSync(
        path.join(dir, 'minnano', 'avatars', 'female', avatarFilename('123', 'Test Actor'))
      ),
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
    assert(
      fs.existsSync(
        path.join(dir, 'minnano', 'avatars', 'female', avatarFilename('123', 'Test Actor'))
      )
    )
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
    assert(
      fs.existsSync(
        path.join(dir, 'javdb', 'avatars', 'male', avatarFilename('actor1', 'Test Actor'))
      )
    )
    success(run(dir, 'actors-full-crawl.js', [], options))
    assert.deepEqual(fs.readdirSync(path.join(dir, 'javdb', 'avatars', 'male')), [
      avatarFilename('actor1', 'Test Actor')
    ])
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
    assert(
      fs.existsSync(
        path.join(dir, 'derived', 'avatars', 'female', avatarFilename('mn_123', 'Test Actor'))
      )
    )
    assert(
      !fs.existsSync(path.join(dir, 'javdb', 'avatars', avatarFilename('mn_123', 'Test Actor')))
    )
  }))

test('仅实际文件名冲突时加后缀，大小写不同但姓名不同无需后缀', () =>
  sandbox(dir => {
    const { avatarPath } = require('../tools/lib/avatars')
    const a = avatarPath(dir, '0R5Na', '同名演员')
    fs.writeFileSync(a, 'first image')
    const b = avatarPath(dir, '0R5na', '同名演员')
    fs.writeFileSync(b, 'second image')
    assert.equal(path.basename(a), '0R5Na_同名演员.jpg')
    assert.notEqual(a.toLowerCase(), b.toLowerCase())
    assert.match(path.basename(b), /--[0-9a-f]+\.jpg$/)
    const c = avatarPath(dir, '0R5NA', '另一人')
    assert.equal(path.basename(c), '0R5NA_另一人.jpg')
    assert.equal(fs.readFileSync(a, 'utf8'), 'first image')
    assert.equal(avatarPath(dir, '0R5na', '同名演员'), b)
    assert.equal(avatarFilename('123', '姓名:/?*'), '123_姓名____.jpg')
  }))

test('姓名变化复用头像，同一 ID 不留下重复缓存', () =>
  sandbox(dir => {
    const { avatarPath } = require('../tools/lib/avatars')
    const old = avatarPath(dir, 'actor1', '旧名')
    fs.writeFileSync(old, 'same image')
    const current = avatarPath(dir, 'actor1', '新名')
    assert.equal(fs.readFileSync(current, 'utf8'), 'same image')
    assert.equal(fs.readdirSync(path.join(dir, 'unknown')).length, 1)
  }))

test('网页复核失败保留未知，日志不把未知计成男性', () =>
  sandbox(dir => {
    const result = run(dir, 'actors-full-crawl.js', [], {
      WEB_GENDER: '1',
      FIXTURE_GENDER_HTML: '<html>blocked</html>'
    })
    success(result)
    assert.match(result.stdout, /男优 0 · 未知 2/)
    const data = json(dir, 'javdb/actors.json')
    assert.equal(data.male, 0)
    assert.equal(data.unknown, 2)
  }))

test('人工性别修复遇到非空拦截页也不误判为女性', () =>
  sandbox(dir => {
    const input = path.join(dir, 'input.json')
    const output = path.join(dir, 'output.json')
    writeJson(input, {
      list: [{ id: 'actor1', name: 'Test Actor', gender: 'm', genderSource: 'old' }]
    })
    success(
      run(dir, 'fix-gender-by-web.js', [input, output], {
        FIXTURE_GENDER_HTML: '<html>Access denied</html>'
      })
    )
    assert.equal(readJson(output).list[0].gender, 'm')
    assert.equal(readJson(output).list[0].genderSource, 'old')
    assert.notEqual(readJson(output).genderSource, 'javdb-web-section-meta')
  }))

test('旧头像迁移保留内容且可重复执行，不误认 ASCII 姓名为旧 ID', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano', 'actresses.json'), [{ mnid: '123', name: 'Alice' }])
    const folder = path.join(dir, 'minnano', 'avatars')
    fs.mkdirSync(folder, { recursive: true })
    const image = Buffer.from('original image bytes')
    fs.writeFileSync(path.join(folder, '123.jpg'), image)
    success(run(dir, 'migrate-avatar-names.js'))
    assert.deepEqual(
      fs.readFileSync(path.join(folder, 'female', avatarFilename('123', 'Alice'))),
      image
    )
    assert(!fs.existsSync(path.join(folder, '123.jpg')))
    success(run(dir, 'migrate-avatar-names.js'))
    assert.equal(fs.readdirSync(path.join(folder, 'female')).length, 1)
  }))

test('未知性别确认后移动已有头像，不重抓、不丢失内容', () =>
  sandbox(dir => {
    const { avatarPath } = require('../tools/lib/avatars')
    const previous = avatarPath(dir, 'actor1', '演员', '?')
    fs.writeFileSync(previous, 'image bytes')
    const current = avatarPath(dir, 'actor1', '演员', 'f')
    assert.equal(path.basename(path.dirname(current)), 'female')
    assert(!fs.existsSync(previous))
    assert.equal(fs.readFileSync(current, 'utf8'), 'image bytes')
    assert.equal(readJson(path.join(dir, 'index.json')).files.actor1.file, 'female/actor1_演员.jpg')
  }))

test('正常采集结束后采用无码资料确认的性别重分头像目录', () =>
  sandbox(dir => {
    const { avatarPath } = require('../tools/lib/avatars')
    writeJson(path.join(dir, 'javdb', 'actors.json'), {
      list: [{ id: 'actor1', name: '演员', gender: '?' }]
    })
    writeJson(path.join(dir, 'javdb', 'uncensored-actors.json'), {
      list: [{ id: 'actor1', name: '演员', gender: 'm' }]
    })
    const previous = avatarPath(path.join(dir, 'javdb', 'avatars'), 'actor1', '演员', '?')
    fs.writeFileSync(previous, 'saved image')
    success(run(dir, 'migrate-avatar-names.js'))
    assert(!fs.existsSync(previous))
    assert.equal(
      fs.readFileSync(path.join(dir, 'javdb', 'avatars', 'male', 'actor1_演员.jpg'), 'utf8'),
      'saved image'
    )
  }))

test('历史下载失败的索引预留不制造实际文件名冲突', () =>
  sandbox(dir => {
    const { avatarPath } = require('../tools/lib/avatars')
    writeJson(path.join(dir, 'index.json'), {
      files: {
        abc: { name: '同名', gender: '?', file: 'unknown/abc_同名.jpg' }
      }
    })
    const target = avatarPath(dir, 'ABC', '同名', '?')
    assert.equal(path.basename(target), 'ABC_同名.jpg')
  }))

test('性别解析需要有效标签，别名或拦截正文不能被当成女性', () => {
  const { parseGenderEvidence } = require('../tools/lib/gender-evidence')
  assert.equal(parseGenderEvidence('<html>Just a moment...</html>'), null)
  assert.equal(parseGenderEvidence('<span class="section-meta">別名</span>'), null)
  assert.deepEqual(
    parseGenderEvidence('<span class="extra section-meta"><b>1,234</b> 部影片</span>'),
    {
      gender: 'f',
      sectionMeta: ['1,234 部影片']
    }
  )
  assert.equal(
    parseGenderEvidence(
      '<span class="section-meta">別名</span><span class="section-meta">男優, 42 部影片</span>'
    ).gender,
    'm'
  )
})

test('批量网页复核跨集合按 ID 复用依据，更新三类汇总并可断点重跑', () =>
  sandbox(dir => {
    const actors = {
      list: [
        { id: 'actor1', name: 'A', gender: '?' },
        { id: 'actor2', name: 'B', gender: '?' }
      ]
    }
    writeJson(path.join(dir, 'javdb', 'actors.json'), actors)
    writeJson(path.join(dir, 'javdb', 'uncensored-actors.json'), {
      list: [{ id: 'actor2', name: 'B', gender: '?' }]
    })
    const result = run(dir, 'verify-genders.js', [], { FIXTURE_WEB_PROBE: 'normal' })
    success(result)
    assert.match(result.stdout, /按 ID 去重待复核：2/)
    const data = json(dir, 'javdb/actors.json')
    assert.equal(data.female, 1)
    assert.equal(data.male, 1)
    assert.equal(data.unknown, 0)
    const proof = json(dir, 'javdb/web-genders.json').records
    assert.equal(Object.keys(proof).length, 2)
    assert.deepEqual(proof.actor2.sectionMeta, ['男優, 42 部影片'])
    assert.equal(proof.actor2.sourceUrl, 'https://javdb.com/actors/actor2')
    assert(!Number.isNaN(Date.parse(proof.actor2.checkedAt)))
    const repeat = run(dir, 'verify-genders.js', [], { FIXTURE_WEB_PROBE: 'blocked' })
    success(repeat)
    assert.match(repeat.stdout, /按 ID 去重待复核：0/)
    assert.deepEqual(json(dir, 'javdb/web-genders.json').records, proof)
  }))

test('批量复核失败保留人物原值，不写虚假网页证据', () =>
  sandbox(dir => {
    const original = {
      list: [{ id: 'actor1', name: 'A', gender: '?', genderSource: 'unverified' }]
    }
    writeJson(path.join(dir, 'javdb', 'actors.json'), original)
    const report = path.join(dir, 'failure-report.json')
    success(run(dir, 'verify-genders.js', ['--report', report], { FIXTURE_WEB_PROBE: 'blocked' }))
    assert.equal(readJson(report).failures.actor1.reason, 'page-unavailable')
    assert.deepEqual(json(dir, 'javdb/actors.json'), original)
    assert(!fs.existsSync(path.join(dir, 'javdb', 'web-genders.json')))
  }))

test('云端禁用网页时仍复用已保存依据，不覆盖人工确认', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'javdb', 'web-genders.json'), {
      records: {
        actor1: { gender: 'm', sectionMeta: ['男優, 42 部影片'] },
        actor2: { gender: 'f', sectionMeta: ['42 部影片'] }
      }
    })
    writeJson(path.join(dir, 'javdb', 'actors.json'), {
      list: [{ id: 'actor2', name: 'Unknown Actor', gender: 'm', genderSource: 'manual' }]
    })
    success(run(dir, 'actors-full-crawl.js'))
    const list = json(dir, 'javdb/actors.json').list
    assert.equal(list.find(row => row.id === 'actor1').gender, 'm')
    assert.equal(list.find(row => row.id === 'actor1').genderSource, 'javdb-web-section-meta')
    assert.equal(list.find(row => row.id === 'actor2').gender, 'm')
    assert.equal(list.find(row => row.id === 'actor2').genderSource, 'manual')
  }))

test('普通采集成功解析网页后保存标签原文，无码采集复用相同依据', () =>
  sandbox(dir => {
    success(
      run(dir, 'actors-full-crawl.js', [], {
        WEB_GENDER: '1',
        FIXTURE_GENDER_HTML:
          '<span class="section-meta">別名</span><span class="section-meta">男優, 42 部影片</span>'
      })
    )
    const proof = json(dir, 'javdb/web-genders.json').records
    assert.deepEqual(proof.actor1.sectionMeta, ['別名', '男優, 42 部影片'])
    assert.equal(proof.actor1.gender, 'm')
    success(run(dir, 'uncensored-actresses-crawl.js'))
    const list = json(dir, 'javdb/uncensored-actors.json').list
    assert(list.every(row => row.gender === 'm' && row.genderSource === 'javdb-web-section-meta'))
  }))

test('偶发 TLS 握手失败仅重试一次并正常保存性别依据', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'javdb', 'actors.json'), {
      list: [{ id: 'actor1', name: 'A', gender: '?' }]
    })
    const result = run(dir, 'verify-genders.js', [], {
      FIXTURE_WEB_PROBE: 'normal',
      FIXTURE_WEB_TLS_RETRY: '1'
    })
    success(result)
    assert.match(result.stdout, /成功 1 · 失败 0/)
    assert.equal(json(dir, 'javdb/actors.json').list[0].gender, 'f')
  }))

test('批量复核拒绝缺失参数值，避免误启动全部人物的网络任务', () =>
  sandbox(dir => {
    for (const args of [['--ids'], ['--limit'], ['--ids', '../bad']]) {
      const result = run(dir, 'verify-genders.js', args)
      assert.notEqual(result.status, 0)
    }
    assert(!fs.existsSync(path.join(dir, 'javdb')))
  }))

test('单文件复核同样保存网页依据并同步未知统计', () =>
  sandbox(dir => {
    for (const tool of ['verify-gender-local.js', 'verify-uc-gender.js']) {
      const input = path.join(dir, 'input.json'),
        output = path.join(dir, 'output.json')
      writeJson(input, {
        unknown: 1,
        list: [{ id: 'actor1', name: 'A', gender: '?', genderSource: 'unverified' }]
      })
      success(
        run(dir, tool, [input, output], {
          FIXTURE_GENDER_HTML: '<span class="section-meta">男優, 42 部影片</span>'
        })
      )
      assert.equal(readJson(output).unknown, 0)
      assert.equal(readJson(output).male, 1)
      assert.deepEqual(json(dir, 'javdb/web-genders.json').records.actor1.sectionMeta, [
        '男優, 42 部影片'
      ])
    }
  }))

test('JSON 原子写入遇到 Windows 短暂文件锁会有限重试', () =>
  sandbox(dir => {
    const file = path.join(dir, 'data.json')
    writeJson(file, { version: 1 })
    const rename = fs.renameSync
    let attempts = 0
    try {
      fs.renameSync = (from, to) => {
        if (to === file && attempts++ < 2)
          throw Object.assign(new Error('locked'), { code: 'EPERM' })
        return rename(from, to)
      }
      writeJson(file, { version: 2 })
    } finally {
      fs.renameSync = rename
    }
    assert.equal(attempts, 3)
    assert.deepEqual(readJson(file), { version: 2 })
  }))

test('头像索引持续写入失败时回滚图片位置，解除锁后可继续迁移', () =>
  sandbox(dir => {
    const { avatarPath } = require('../tools/lib/avatars')
    const previous = avatarPath(dir, 'actor1', '演员', '?')
    fs.writeFileSync(previous, 'original image')
    const indexFile = path.join(dir, 'index.json')
    const original = readJson(indexFile)
    const rename = fs.renameSync
    try {
      fs.renameSync = (from, to) => {
        if (to === indexFile) throw Object.assign(new Error('locked'), { code: 'EPERM' })
        return rename(from, to)
      }
      assert.throws(() => avatarPath(dir, 'actor1', '演员', 'f'), /locked/)
    } finally {
      fs.renameSync = rename
    }
    assert(fs.existsSync(previous))
    assert.equal(fs.readFileSync(previous, 'utf8'), 'original image')
    assert.deepEqual(readJson(indexFile), original)
    const current = avatarPath(dir, 'actor1', '演员', 'f')
    assert(!fs.existsSync(previous))
    assert.equal(fs.readFileSync(current, 'utf8'), 'original image')
    assert.equal(readJson(indexFile).files.actor1.file, 'female/actor1_演员.jpg')
  }))

test('目录按页发现、去重续跑且不覆盖已有详细或人工字段', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano', 'actresses.json'), [
      { mnid: '123', name: '人工姓名', birthday: '2000-01-01', custom: true }
    ])
    success(run(dir, 'discover-minnano.js', ['--pages', '1']))
    assert.equal(json(dir, 'minnano/directory-progress.json').nextPage, 2)
    success(run(dir, 'discover-minnano.js', ['--pages', '1']))
    const rows = json(dir, 'minnano/actresses.json')
    assert.equal(rows.length, 2)
    assert.equal(rows[0].name, '人工姓名')
    assert.equal(rows[0].birthday, '2000-01-01')
    assert.equal(rows[0].custom, true)
    assert.equal(rows[1].mimg, 'https://www.minnano-av.com/p_actress_125_125/123/456.jpg')
    assert.equal(rows[1].videoCount, 42)
    assert.equal(json(dir, 'minnano/directory-progress.json').completed, true)
    success(run(dir, 'discover-minnano.js'))
    success(run(dir, 'discover-minnano.js', ['--start-page', '1', '--pages', '1']))
    assert.equal(json(dir, 'minnano/directory-progress.json').nextPage, 3)
    assert.equal(json(dir, 'minnano/actresses.json').length, 2)
  }))

test('目录中途失败只保留成功页面，重跑从失败页面开始', () =>
  sandbox(dir => {
    const failed = run(dir, 'discover-minnano.js', ['--pages', '2'], {
      FIXTURE_DIRECTORY_FAIL: '2'
    })
    assert.notEqual(failed.status, 0)
    assert.equal(json(dir, 'minnano/actresses.json').length, 1)
    assert.equal(json(dir, 'minnano/directory-progress.json').nextPage, 2)
    success(run(dir, 'discover-minnano.js', ['--pages', '1']))
    assert.equal(json(dir, 'minnano/actresses.json').length, 2)
  }))

test('目录解析拒绝空拦截页、错误页码，不采集推荐栏链接', () => {
  const { parseDirectory } = require('../tools/lib/minnano-directory')
  assert.throws(() => parseDirectory('<html>blocked</html>', 1), /页码/)
  assert.throws(
    () => parseDirectory("<span class='page_info'>2 / 2 ページ (30件)</span>", 1),
    /页码/
  )
  assert.throws(
    () =>
      parseDirectory(
        "<span class='page_info'>1 / 2 ページ (30件)</span><a href='actress123.html'>推荐</a>",
        1
      ),
    /解析为空/
  )
})

test('目录发现独立入口不会启动详细资料和头像下载', () =>
  sandbox(dir => {
    const result = run(dir, 'collect.js', ['smoke', 'directory'])
    success(result)
    assert.equal(json(dir, 'minnano/actresses.json').length, 1)
    assert(!result.stdout.includes('>>> profiles-relay.js'))
    assert(!fs.existsSync(path.join(dir, 'minnano', 'avatars')))
  }))

test('源站深页总页数退化时不把当前页误判为全目录结束', () =>
  sandbox(dir => {
    success(run(dir, 'discover-minnano.js', ['--pages', '2'], { FIXTURE_DIRECTORY_SHRINK: '1' }))
    const progress = json(dir, 'minnano/directory-progress.json')
    assert.equal(progress.totalPages, 3)
    assert.equal(progress.nextPage, 3)
    assert.equal(progress.completed, false)
  }))

test('目录批次页数拒绝非法值和超大批次，不开始采集', () =>
  sandbox(dir => {
    const badEnv = run(dir, 'collect.js', ['daily', 'directory'], { DIRECTORY_PAGES: 'bad' })
    assert.notEqual(badEnv.status, 0)
    assert(!badEnv.stdout.includes('>>>'))
    const tooLarge = run(dir, 'discover-minnano.js', ['--pages', '2001'])
    assert.notEqual(tooLarge.status, 0)
    assert(!fs.existsSync(path.join(dir, 'minnano')))
  }))

test('五十音分组共享页数预算、保留旧进度且支持跨次续跑', () =>
  sandbox(dir => {
    writeJson(path.join(dir, 'minnano', 'directory-progress.json'), {
      nextPage: 32,
      lastPage: 31,
      totalPages: 831,
      completed: false
    })
    success(run(dir, 'discover-minnano-groups.js', [], { DIRECTORY_PAGES: '1' }))
    let state = json(dir, 'minnano/directory-progress.json')
    assert.equal(state.nextPage, 32)
    assert.equal(state.partitionPlan.length, 1)
    assert.equal(state.groups.a.nextPage, 2)
    assert.equal(state.partitionCompleted, false)
    success(run(dir, 'discover-minnano-groups.js', [], { DIRECTORY_PAGES: '1' }))
    state = json(dir, 'minnano/directory-progress.json')
    assert.equal(state.partitionCompleted, true)
    assert.equal(json(dir, 'minnano/actresses.json').length, 2)
    success(run(dir, 'discover-minnano-groups.js', [], { DIRECTORY_PAGES: '1' }))
    assert.equal(json(dir, 'minnano/actresses.json').length, 2)
  }))

test('单页小分组没有分页栏时，以规范URL和有效人物行确认，拦截页仍拒绝', () => {
  const { parseDirectory } = require('../tools/lib/minnano-directory')
  const html =
    '<link rel="canonical" href="https://www.minnano-av.com/actress_list.php?gojuon=nu&amp;sort=date"><table><tr><td><h2 class="ttl"><a href="actress123.html">人物</a></h2></td></tr></table>'
  assert.equal(parseDirectory(html, 1, 'nu').totalPages, 1)
  assert.equal(parseDirectory(html, 1, 'nu').rows.length, 1)
  assert.throws(() => parseDirectory(html, 1, 'ne'), /单页/)
  assert.throws(() => parseDirectory(html, 2, 'nu'), /页码/)
  assert.throws(() => parseDirectory('<html>blocked</html>', 1, 'nu'), /单页/)
})

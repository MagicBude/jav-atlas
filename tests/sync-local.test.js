const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

/** 真正的本地Git远端，不联网；生成器用标记文件模拟，验证失败时不会误执行。 */
function sandbox(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-sync-'))
  const remote = path.join(temp, 'remote.git'),
    seed = path.join(temp, 'seed'),
    local = path.join(temp, '本地 仓库')
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const config = cwd => {
    git(cwd, 'config', 'user.name', 'Sync Test')
    git(cwd, 'config', 'user.email', 'sync@example.invalid')
  }
  const update = () => {
    fs.writeFileSync(path.join(seed, 'value.txt'), 'remote-v2')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'remote update')
    git(seed, 'push')
  }
  const run = () =>
    spawnSync(process.execPath, [path.join(local, 'tools/sync-local.js')], {
      cwd: os.tmpdir(),
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000
    })
  try {
    git(temp, 'init', '--bare', '--initial-branch=main', remote)
    fs.mkdirSync(seed)
    git(seed, 'init', '--initial-branch=main')
    config(seed)
    fs.mkdirSync(path.join(seed, 'tools'))
    fs.mkdirSync(path.join(seed, 'web/scripts'), { recursive: true })
    fs.copyFileSync(
      path.join(__dirname, '../tools/sync-local.js'),
      path.join(seed, 'tools/sync-local.js')
    )
    fs.copyFileSync(path.join(__dirname, '../同步更新.bat'), path.join(seed, '同步更新.bat'))
    fs.writeFileSync(
      path.join(seed, 'web/scripts/build-data.mjs'),
      `import fs from 'node:fs'; fs.writeFileSync('.sync-result',fs.readFileSync('value.txt','utf8'))`
    )
    fs.writeFileSync(path.join(seed, '.gitignore'), '.sync-result\n')
    fs.writeFileSync(path.join(seed, 'value.txt'), 'v1')
    git(seed, 'add', '.')
    git(seed, 'commit', '-m', 'initial')
    git(seed, 'remote', 'add', 'origin', remote)
    git(seed, 'push', '-u', 'origin', 'main')
    git(temp, 'clone', remote, local)
    config(local)
    fn({ local, seed, git, update, run })
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(os.tmpdir()))
    assert(path.basename(temp).startsWith('atlas-sync-'))
    fs.rmSync(temp, { recursive: true, force: true })
  }
}
test('一键同步快进到新提交后才生成数据，支持空格中文路径和其他启动目录', () =>
  sandbox(({ local, update, run }) => {
    update()
    const result = run()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(fs.readFileSync(path.join(local, '.sync-result'), 'utf8'), 'remote-v2')
  }))
test('本地有未提交修改时停止，文件不覆盖且不生成数据', () =>
  sandbox(({ local, git, update, run }) => {
    update()
    const before = git(local, 'rev-parse', 'HEAD')
    fs.writeFileSync(path.join(local, 'value.txt'), 'my edits')
    const result = run()
    assert.notEqual(result.status, 0)
    assert.equal(git(local, 'rev-parse', 'HEAD'), before)
    assert.equal(fs.readFileSync(path.join(local, 'value.txt'), 'utf8'), 'my edits')
    assert.equal(fs.existsSync(path.join(local, '.sync-result')), false)
  }))
test('分支分叉时拒绝自动合并，保留本地提交且不生成数据', () =>
  sandbox(({ local, git, update, run }) => {
    update()
    fs.writeFileSync(path.join(local, 'local.txt'), 'local commit')
    git(local, 'add', '.')
    git(local, 'commit', '-m', 'local update')
    const before = git(local, 'rev-parse', 'HEAD')
    const result = run()
    assert.notEqual(result.status, 0)
    assert.equal(git(local, 'rev-parse', 'HEAD'), before)
    assert.equal(fs.existsSync(path.join(local, '.sync-result')), false)
  }))

test('拉取成功但生成器失败时返回失败，不回滚已拉取提交', () =>
  sandbox(({ local, seed, git, update, run }) => {
    fs.writeFileSync(path.join(seed, 'web/scripts/build-data.mjs'), 'process.exitCode = 7')
    update()
    const result = run()
    assert.notEqual(result.status, 0)
    assert.equal(git(local, 'rev-parse', 'HEAD'), git(seed, 'rev-parse', 'HEAD'))
    assert.equal(fs.existsSync(path.join(local, '.sync-result')), false)
    assert(result.stderr.includes('网页数据生成失败'))
  }))

test('Windows bat入口可执行完整同步并正确返回退出码', { skip: process.platform !== 'win32' }, () =>
  sandbox(({ local, update }) => {
    update()
    const result = spawnSync('cmd.exe', ['/d', '/c', '同步更新.bat', '--no-pause'], {
      cwd: local,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(fs.readFileSync(path.join(local, '.sync-result'), 'utf8'), 'remote-v2')
  })
)

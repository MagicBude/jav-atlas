/**
 * 本地一键同步：仅允许干净工作区上的快进拉取，然后重新生成网页浏览资源。
 * 不自动提交、暂存、stash、rebase或覆盖本地文件；网络和生成失败均返回非零退出码。
 * 路径从脚本所在仓库解析，因此从其他目录或双击bat启动也不会更新错仓库。
 */
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function git(args, capture = false) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    windowsHide: true
  })
  if (result.error) throw Error('无法运行Git，请确认已安装并加入PATH。', { cause: result.error })
  if (result.status !== 0) {
    if (capture && result.stderr) console.error(result.stderr.trim())
    throw Error('Git操作失败，已停止。请检查网络、分支或Git提示，处理后重新运行。')
  }
  return result.stdout?.trim() || ''
}
/** Git不会自动采用Windows系统代理；只为本轮pull补参数，不修改全局Git配置。 */
function windowsProxyArgs() {
  if (
    process.platform !== 'win32' ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY
  )
    return []
  const configured = spawnSync(
    'git',
    ['config', '--get-urlmatch', 'http.proxy', 'https://github.com'],
    { cwd: root, encoding: 'utf8', windowsHide: true }
  )
  if (configured.status === 0) return []
  const query = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      String.raw`$p = Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings"; if ($p.ProxyEnable -eq 1) { $p.ProxyServer }`
    ],
    { encoding: 'utf8', windowsHide: true }
  )
  if (query.status !== 0) return []
  const raw = query.stdout.trim()
  const address = raw.includes('=')
    ? raw.match(/(?:^|;)https=([^;]+)/i)?.[1] || raw.match(/(?:^|;)http=([^;]+)/i)?.[1]
    : raw
  if (!address) return []
  try {
    const url = new URL(address.includes('://') ? address : 'http://' + address)
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)) return []
    console.log('本次拉取使用Windows系统代理，不修改Git配置。')
    return ['-c', 'http.proxy=' + url.href]
  } catch {
    return []
  }
}
function main() {
  console.log('正在检查本地仓库：' + root)
  if (path.relative(root, path.resolve(git(['rev-parse', '--show-toplevel'], true))) !== '')
    throw Error('脚本目录不是仓库根目录，已停止。')
  if (git(['status', '--porcelain', '--untracked-files=normal'], true)) {
    throw Error(
      '存在未提交的修改或未跟踪文件。请先检查并提交或自行整理，再同步；脚本不会替你丢弃或暂存修改。'
    )
  }
  console.log('\n[1/2] 拉取远端更新（仅快进，不自动合并）…')
  git([...windowsProxyArgs(), 'pull', '--ff-only'])
  console.log('\n[2/2] 重新生成本地网页数据…')
  const result = spawnSync(process.execPath, [path.join(root, 'web/scripts/build-data.mjs')], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error || result.status !== 0) {
    throw Error(
      '更新已拉取，但网页数据生成失败。请检查上方错误，修复后重新运行；不会回滚已拉取的提交。'
    )
  }
  console.log('\n同步完成！已打开的网页请刷新；尚未启动网页时运行 npm run dev --prefix web。')
}
try {
  main()
} catch (error) {
  console.error('\n同步未完成：' + error.message)
  process.exitCode = 1
}

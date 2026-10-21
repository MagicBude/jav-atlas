/**
 * @file 从源站五十音目录逐组发现人物，避免无筛选目录约5000人的深页边界。
 * 每轮总页数由 DIRECTORY_PAGES 控制；分组与分组页码均保存，可跨 Actions 续跑。
 * 分组列表来自源站公开链接，不按猜测枚举隐藏参数；零人组跳过。
 * 分组遍历完成只表示这些公开分类已遍历，不承诺覆盖没有读音分类的人物。
 */
const { promisify } = require('util')
const { execFile, spawnSync } = require('child_process')
const path = require('path')
const { dataPaths } = require('./lib/data-paths')
const { readJson, writeJson, envInt } = require('./lib/runtime')
const paths = dataPaths()
const execute = promisify(execFile)
;(async () => {
  let root = readJson(paths.minnanoDirectoryState, { nextPage: 1, completed: false })
  if (!root.partitionPlan) {
    const options = ['-fsSL', '--max-time', '25']
    if (process.env.WEB_PROXY) options.push('--proxy', process.env.WEB_PROXY)
    options.push('https://www.minnano-av.com/actress_list.html')
    const { stdout } = await execute(process.platform === 'win32' ? 'curl.exe' : 'curl', options, {
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024
    })
    const groups = [
      ...stdout.matchAll(/actress_list\.php\?gojuon=([a-z]+)[^>]*>([^<]+)<\/a>\s*\(([\d,]+)\)/g)
    ]
      .filter(row => Number(row[3].replaceAll(',', '')) > 0)
      .map(row => ({
        key: row[1],
        label: row[2],
        reportedPeople: Number(row[3].replaceAll(',', ''))
      }))
    if (!groups.length) throw new Error('源站没有有效五十音分类，拒绝标记完成')
    root.partitionPlan = [...new Map(groups.map(row => [row.key, row])).values()]
    root.partitionCompleted = false
    writeJson(paths.minnanoDirectoryState, root)
  }
  let remaining = envInt('DIRECTORY_PAGES', 20, 1, 2000)
  for (const group of root.partitionPlan) {
    root = readJson(paths.minnanoDirectoryState)
    const progress = root.groups?.[group.key]
    if (progress?.completed) continue
    if (!remaining) break
    const start = progress?.nextPage || 1
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, 'discover-minnano.js'),
        '--gojuon',
        group.key,
        '--pages',
        String(remaining)
      ],
      { env: process.env, stdio: 'inherit' }
    )
    if (result.error) throw result.error
    if (result.status !== 0) {
      process.exitCode = result.status || 1
      return
    }
    const current = readJson(paths.minnanoDirectoryState).groups[group.key]
    remaining -= current.nextPage - start
  }
  root = readJson(paths.minnanoDirectoryState)
  root.partitionCompleted = root.partitionPlan.every(group => root.groups?.[group.key]?.completed)
  writeJson(paths.minnanoDirectoryState, root)
  console.log(
    '五十音分组完成 ' +
      root.partitionPlan.filter(group => root.groups?.[group.key]?.completed).length +
      '/' +
      root.partitionPlan.length +
      '；已遍历全部分组：' +
      root.partitionCompleted
  )
})().catch(error => {
  console.error(error.stderr?.trim() || error.message)
  process.exitCode = 1
})

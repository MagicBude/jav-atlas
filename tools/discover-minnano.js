/**
 * @file 按追加日期顺序分批发现 minnano 人物；只写基础名册，不下载资料页或头像。
 * 默认从持久进度续跑，每次最多 20 页。--start-page 显式指定页码（例如 1 刷新新增人物）。
 * 名册先保存、进度后保存：中断最多重读当前页，不会因进度领先漏掉该页人物。
 * 每页按 mnid 合并，保留已有姓名、详细资料和人工字段；不按源站缺席删除历史人物。
 * 目录在翻页期间可能变化，完成一次遍历不等于精确全站快照，应定期重扫以补齐移动边界。
 */
const fs = require('fs')
const { promisify } = require('util')
const { execFile } = require('child_process')
const { dataPaths } = require('./lib/data-paths')
const { readJson, writeJson, envInt, compareIds } = require('./lib/runtime')
const { parseDirectory } = require('./lib/minnano-directory')
const execute = promisify(execFile)
const paths = dataPaths()
const args = process.argv.slice(2)
for (let i = 0; i < args.length; i += 2) {
  if (!['--pages', '--start-page'].includes(args[i]) || !/^[1-9]\d*$/.test(args[i + 1] || ''))
    throw new Error('用法：discover-minnano.js [--pages 正整数] [--start-page 正整数]')
}
const option = name => (args.includes(name) ? Number(args[args.indexOf(name) + 1]) : null)
const budget = option('--pages') || envInt('DIRECTORY_PAGES', 20, 1, 2000)
if (
  !Number.isSafeInteger(budget) ||
  budget > 2000 ||
  (option('--start-page') && !Number.isSafeInteger(option('--start-page')))
)
  throw new Error('目录页数必须为有效整数，本轮最多2000页')
const state = readJson(paths.minnanoDirectoryState, { nextPage: 1, completed: false })
if (!Number.isSafeInteger(state.nextPage) || state.nextPage < 1) throw new Error('目录进度无效')
const explicitStart = option('--start-page')
const roster = readJson(paths.minnanoActresses, [])
if (
  !Array.isArray(roster) ||
  roster.some(row => !row || !/^\d+$/.test(String(row.mnid)) || !row.name)
)
  throw new Error('人物名册结构无效，拒绝覆盖')
const known = new Map(roster.map(row => [String(row.mnid), row]))
if (known.size !== roster.length) throw new Error('已有名册含重复 ID，拒绝覆盖')

/** 本地代理可选；使用系统 curl 保持本地与 Actions 的请求行为一致。 */
async function getPage(page) {
  const url = `https://www.minnano-av.com/actress_list.php?sort=date&page=${page}`
  const options = ['-fsSL', '--connect-timeout', '8', '--max-time', '25']
  if (process.env.WEB_PROXY) options.push('--proxy', process.env.WEB_PROXY)
  options.push(url)
  const { stdout } = await execute(process.platform === 'win32' ? 'curl.exe' : 'curl', options, {
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024
  })
  return stdout
}

;(async () => {
  if (state.completed && state.lastPage >= state.totalPages && !explicitStart) {
    console.log('目录上一轮已遍历完成；重新扫描请指定 --start-page 1')
    return
  }
  const start = explicitStart || state.nextPage
  let totalPages = state.totalPages || 0
  let reportedPeople = state.reportedPeople || 0
  let added = 0,
    scanned = 0
  for (let page = start; page < start + budget; page++) {
    const result = parseDirectory(await getPage(page), page)
    for (const row of result.rows) {
      const old = known.get(row.mnid)
      if (!old) {
        known.set(row.mnid, row)
        added++
      } else
        for (const [key, value] of Object.entries(row))
          if (old[key] === undefined || old[key] === '') old[key] = value
    }
    writeJson(
      paths.minnanoActresses,
      [...known.values()].sort((a, b) => compareIds({ id: a.mnid }, { id: b.mnid }))
    )
    // 深页的 page_info 可能错误地退化为当前页/当前页；保留遍历中已见的最大范围。
    totalPages = Math.max(totalPages, result.totalPages)
    reportedPeople = Math.max(reportedPeople, result.totalPeople)
    const completed = page >= totalPages
    const progress = {
      source: 'minnano-actress-directory',
      sort: 'date',
      lastPage: page,
      nextPage: page + 1,
      totalPages,
      reportedPeople,
      completed,
      updatedAt: new Date().toISOString()
    }
    // 显式从头刷新少量页时，不倒退原有全量扫描进度。
    if (!explicitStart || page >= (state.lastPage || 0))
      writeJson(paths.minnanoDirectoryState, progress)
    scanned++
    console.log(
      `目录 ${page}/${totalPages} · 当前页 ${result.rows.length} 人 · 累计名册 ${known.size} 人`
    )
    if (completed) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  console.log(
    `发现完成：扫描 ${scanned} 页 · 新增 ${added} 人 · 名册 ${known.size} 人（不代表已取得详细资料）`
  )
})().catch(error => {
  console.error(
    '目录发现失败；已成功页面保留，可从检查点续跑：' + (error.stderr?.trim() || error.message)
  )
  process.exitCode = 1
})

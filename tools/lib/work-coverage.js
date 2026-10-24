/**
 * 作品列表进度只依据当前扫描，不拿历史完成时间冒充本轮完成。
 * 翻完分页且首页复核稳定才算遍历完成；这不等于人物所有出演都被源站收录。
 */
function listCoverage(scan) {
  if (!scan) return 'not-started'
  if (scan.finished && scan.stable && scan.completedAt) return 'complete'
  if (scan.finished && !scan.stable) return 'unstable'
  return 'partial'
}
module.exports = { listCoverage }

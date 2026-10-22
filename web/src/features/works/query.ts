/** 列表排序独立成纯函数：未知评分排最后，同分按日期及原生ID稳定排序。 */
import type { WorkEntry } from '../../entities/work'
export function compareWorks(a: WorkEntry, b: WorkEntry, sort: string) {
  if (sort === 'score') {
    const left = a.rating?.score,
      right = b.rating?.score
    if (left == null && right != null) return 1
    if (left != null && right == null) return -1
    if (left != null && right != null && left !== right) return right - left
  }
  return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.id.localeCompare(b.id)
}

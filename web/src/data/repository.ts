/**
 * @file 浏览资源只读仓库。缓存 Promise 而非只缓存成功值，合并同一文件的并发请求。
 * 失败时删除缓存，以便用户重试。源数据不进入 localStorage，也不向源站发请求。
 */
import type { Detail, Manifest, Person, Source } from '../entities/person'
const cache = new Map<string, Promise<unknown>>()
const details: string[] = []
const indexes = new Map<string, Promise<Person[]>>()
type IndexRow = Partial<Person> &
  Pick<Person, 'source' | 'id' | 'name' | 'status' | 'sourceUrl' | 'genderEvidence' | 'detailRef'>
export const asset = (file: string) =>
  `${import.meta.env.BASE_URL}generated/${file.split('/').map(encodeURIComponent).join('/')}`
export async function resource<T>(file: string): Promise<T> {
  if (!cache.has(file))
    cache.set(
      file,
      (async () => {
        const response = await fetch(asset(file))
        if (!response.ok) {
          if (response.status === 404 && file !== 'manifest.json') {
            const latest = await fetch(asset('manifest.json'), { cache: 'no-store' })
              .then(r => r.json())
              .catch(() => null)
            const current = (await cache.get('manifest.json')) as Manifest | undefined
            if (latest && latest.version !== current?.version)
              throw Error('站点数据已更新，请刷新；收藏和已保存的修改会保留。')
          }
          throw Error(`资源加载失败（HTTP ${response.status}），请重试。`)
        }
        return response.json()
      })().catch(error => {
        cache.delete(file)
        throw error
      })
    )
  return cache.get(file)! as Promise<T>
}
export const loadManifest = () => resource<Manifest>('manifest.json')
export function loadIndex(manifest: Manifest, source: Source): Promise<Person[]> {
  const file = manifest.sources[source].index
  if (!indexes.has(file))
    indexes.set(
      file,
      resource<IndexRow[]>(file)
        .then(rows =>
          rows.map(row => ({
            // 固定默认值只属于展示契约，unknown 仍然是 null/空串，不能拿 0 猜测。
            aliases: [],
            gender: '?',
            birthday: '',
            height: null,
            breast: null,
            waist: null,
            hip: null,
            cup: '',
            blood: '',
            place: '',
            agency: '',
            hobby: '',
            shoe: '',
            official: '',
            tags: [],
            avatar: null,
            fetchedAt: null,
            ...row
          }))
        )
        .catch(error => {
          indexes.delete(file)
          throw error
        })
    )
  return indexes.get(file)!
}
export async function loadDetail(person: Person) {
  const rows = await resource<Detail[]>(person.detailRef)
  // 详情块限制为最近 10 个；名册索引继续留在内存，翻页无需重新下载。
  const previous = details.indexOf(person.detailRef)
  if (previous >= 0) details.splice(previous, 1)
  details.push(person.detailRef)
  while (details.length > 10) cache.delete(details.shift()!)
  const detail = rows.find(row => row.id === person.id)
  if (!detail) throw Error('详情块缺少该人物记录，请重新生成浏览资源。')
  return detail
}

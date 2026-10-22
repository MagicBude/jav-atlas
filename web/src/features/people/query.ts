/** @file 查询是纯函数：同维度取并集，不同维度取交集；缺失值永远不冒充数值 0。 */
import { identity, normalize, type Person } from '../../entities/person'
import { localValue, type UserData } from '../../data/personal'
export interface PrivateFilters {
  favorite: string
  personalTags: string[]
  edited: string
  batch?: string[]
}
export const emptyPrivate = (): PrivateFilters => ({ favorite: '', personalTags: [], edited: '' })
/** 会话记录也可能损坏；只恢复受支持的个人条件，不能因一份坏草稿使浏览页面崩溃。 */
export function privateFilters(value: unknown): PrivateFilters {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    favorite: ['yes', 'no'].includes(String(raw.favorite)) ? String(raw.favorite) : '',
    edited: ['yes', 'no'].includes(String(raw.edited)) ? String(raw.edited) : '',
    personalTags: Array.isArray(raw.personalTags)
      ? raw.personalTags.filter((x): x is string => typeof x === 'string').slice(0, 100)
      : [],
    ...(Array.isArray(raw.batch)
      ? {
          batch: raw.batch
            .filter(
              (x): x is string =>
                typeof x === 'string' && /^(minnano|javdb)\/[a-zA-Z0-9_-]+$/.test(x)
            )
            .slice(0, 2000)
        }
      : {})
  }
}
export const ranges = [
  { key: 'height', label: '身高 / cm' },
  { key: 'year', label: '出生年份' },
  { key: 'breast', label: '胸围 / cm' },
  { key: 'waist', label: '腰围 / cm' },
  { key: 'hip', label: '臀围 / cm' }
] as const
/** 地址栏可能被手工编辑。先移除非法范围/页码，不能让 NaN 悄悄改变筛选含义。 */
export function sanitizeQuery(search: string): URLSearchParams {
  const params = new URLSearchParams(search)
  const allowed = new Set([
    'source',
    'q',
    'sort',
    'page',
    'size',
    'view',
    'values',
    'cup',
    'blood',
    'place',
    'agency',
    'tag',
    'tagMode',
    ...ranges.flatMap(range => [`${range.key}Min`, `${range.key}Max`, `${range.key}Unknown`])
  ])
  // 已下线的性别/采集阶段/头像条件同时从旧URL移除，避免隐藏条件继续过滤。
  for (const key of [...params.keys()]) if (!allowed.has(key)) params.delete(key)
  for (const range of ranges) {
    const minKey = `${range.key}Min`,
      maxKey = `${range.key}Max`
    for (const key of [minKey, maxKey])
      if (
        params.has(key) &&
        (!/^\d+(\.\d+)?$/.test(params.get(key)!) || !Number.isFinite(Number(params.get(key))))
      )
        params.delete(key)
    if (
      params.has(minKey) &&
      params.has(maxKey) &&
      Number(params.get(minKey)) > Number(params.get(maxKey))
    ) {
      params.delete(minKey)
      params.delete(maxKey)
    }
  }
  if (
    params.has('page') &&
    (!/^\d+$/.test(params.get('page')!) ||
      Number(params.get('page')) < 1 ||
      !Number.isSafeInteger(Number(params.get('page'))))
  )
    params.delete('page')
  if (params.has('size') && !['24', '48', '96'].includes(params.get('size')!)) params.delete('size')
  if (params.has('source') && !['minnano', 'javdb', 'all'].includes(params.get('source')!))
    params.delete('source')
  return params
}
export function queryLabel(key: string): string {
  const names: Record<string, string> = {
    q: '搜索',
    gender: '性别',
    cup: '罩杯',
    blood: '血型',
    place: '出生地',
    agency: '事务所',
    status: '资料阶段',
    avatar: '头像',
    tag: '来源标签',
    tagMode: '标签匹配'
  }
  if (names[key]) return names[key]
  const range = ranges.find(range => key.startsWith(range.key))
  return range
    ? `${range.label}${key.endsWith('Min') ? '下限' : key.endsWith('Max') ? '上限' : '含未知'}`
    : key
}
export function selectPeople(
  items: Person[],
  params: URLSearchParams,
  personal: PrivateFilters,
  data: UserData,
  favoritesOnly = false,
  sortResults = true
): Person[] {
  // 逐个人物检查全部条件，任一维度不满足就返回 false。同一维度多选取并集，不同维度取交集。
  // 函数不读取 DOM、网络或 localStorage，因此页面和测试能复用完全相同的筛选规则。
  const q = normalize(params.get('q') || '')
  const result = items.filter(person => {
    const record = data.records[identity(person)],
      favorite = !!record?.favorite?.active
    if (personal.batch && !personal.batch.includes(identity(person))) return false
    if ((favoritesOnly || personal.favorite === 'yes') && !favorite) return false
    if (personal.favorite === 'no' && favorite) return false
    const edited = Object.values(record?.fields || {}).some(op => op.kind === 'set')
    if (personal.edited && edited !== (personal.edited === 'yes')) return false
    const privateTags = localValue(record, 'personalTags')
    if (
      personal.personalTags.length &&
      (!Array.isArray(privateTags) || !personal.personalTags.some(tag => privateTags.includes(tag)))
    )
      return false
    if (
      q &&
      ![person.id, person.name || '', ...(person.aliases || [])].some(value =>
        normalize(value).includes(q)
      )
    )
      return false
    for (const field of ['gender', 'cup', 'blood', 'place', 'agency', 'status'] as const) {
      const options = params.getAll(field)
      if (options.length && !options.includes(String(person[field] || 'unknown'))) return false
    }
    if (
      (params.get('avatar') === 'yes' && !person.avatar) ||
      (params.get('avatar') === 'no' && person.avatar)
    )
      return false
    for (const range of ranges) {
      const min = params.get(`${range.key}Min`),
        max = params.get(`${range.key}Max`)
      if (!min && !max) continue
      const value =
        range.key === 'year'
          ? /^\d{4}-\d{2}-\d{2}$/.test(person.birthday || '')
            ? Number(person.birthday.slice(0, 4))
            : null
          : person[range.key]
      if (value == null) {
        if (params.get(`${range.key}Unknown`) !== 'yes') return false
      } else if ((min && Number(value) < Number(min)) || (max && Number(value) > Number(max)))
        return false
    }
    const tags = params.getAll('tag')
    if (
      tags.length &&
      !(params.get('tagMode') === 'all'
        ? tags.every(tag => person.tags.some(x => x.value === tag))
        : tags.some(tag => person.tags.some(x => x.value === tag)))
    )
      return false
    return true
  })
  // 筛选项数量统计只需要集合，不需要顺序；跳过排序可减少每次输入触发的重复计算。
  if (!sortResults) return result
  const sort = params.get('sort') || (q ? 'relevance' : favoritesOnly ? 'added' : 'name')
  const rank = (person: Person) =>
    person.id === params.get('q')
      ? 0
      : normalize(person.name || '') === q
        ? 1
        : person.aliases?.some(x => normalize(x) === q)
          ? 2
          : normalize(person.name || '').startsWith(q)
            ? 3
            : 4
  return result.sort((a, b) => {
    if (sort === 'relevance' && q)
      return rank(a) - rank(b) || identity(a).localeCompare(identity(b))
    if (sort === 'added')
      return (
        (data.records[identity(b)]?.favorite?.addedAt || 0) -
          (data.records[identity(a)]?.favorite?.addedAt || 0) ||
        identity(a).localeCompare(identity(b))
      )
    const key = sort.replace('-desc', '') as keyof Person
    const left = a[key] ?? '',
      right = b[key] ?? ''
    if (!left && left !== 0)
      return !right && right !== 0 ? identity(a).localeCompare(identity(b)) : 1
    if (!right && right !== 0) return -1
    const diff =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), 'zh-CN')
    return (
      diff * (sort.endsWith('-desc') || sort === 'fetchedAt' ? -1 : 1) ||
      identity(a).localeCompare(identity(b))
    )
  })
}

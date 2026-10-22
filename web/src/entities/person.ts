/**
 * @file 页面共同使用的数据契约与字段字典。
 * source + id 始终对应源站身份；类型中的 null 表示未知，不能拿 0 代替。
 * 来源模型只读；个人编辑通过覆盖层生成新对象，不修改这里的原记录。
 */
export type Source = 'minnano' | 'javdb'
export type Value = string | number | null | string[]
export interface Person {
  source: Source
  id: string
  name: string
  aliases: string[]
  gender: string
  birthday: string
  height: number | null
  breast: number | null
  waist: number | null
  hip: number | null
  cup: string
  blood: string
  place: string
  agency: string
  hobby: string
  shoe: string
  official: string
  tags: { value: string; label: string }[]
  avatar: string | null
  status: string
  fetchedAt: number | null
  genderEvidence: string
  sourceUrl: string
  detailRef: string
}
export interface Detail {
  id: string
  records: Record<string, Record<string, unknown>>
  related: { id: string; name: string; title?: string }[]
}
export interface Manifest {
  version: string
  generatedAt: string
  sources: Record<Source, { count: number; avatars: number; index: string }>
  rawFiles: Record<string, string>
  rankings: string
  report: string
  works?: { people: Record<string, string>; records: Record<string, string> }
}
export const identity = (person: Pick<Person, 'source' | 'id'>) => `${person.source}/${person.id}`
export const personUrl = (person: Pick<Person, 'source' | 'id'>) =>
  `/people/${person.source}/${encodeURIComponent(person.id)}`
export const statusLabels: Record<string, string> = {
  directory: '目录记录',
  profile: '详情已采集',
  raw: '原字段已采集',
  api: 'API 资料'
}
/** 字段字典让详情、表单和校验使用同一口径，新增字段不必在三个页面各写一次标签。 */
export const fields = [
  { key: 'name', label: '显示名', kind: 'text' },
  { key: 'aliases', label: '别名（逗号分隔）', kind: 'aliases' },
  { key: 'gender', label: '性别', kind: 'gender' },
  { key: 'birthday', label: '生日', kind: 'date' },
  { key: 'height', label: '身高 / cm', kind: 'number' },
  { key: 'breast', label: '胸围 / cm', kind: 'number' },
  { key: 'waist', label: '腰围 / cm', kind: 'number' },
  { key: 'hip', label: '臀围 / cm', kind: 'number' },
  { key: 'cup', label: '罩杯', kind: 'text' },
  { key: 'shoe', label: '鞋码', kind: 'text' },
  { key: 'blood', label: '血型', kind: 'text' },
  { key: 'place', label: '出生地', kind: 'text' },
  { key: 'agency', label: '事务所', kind: 'text' },
  { key: 'hobby', label: '爱好', kind: 'text' },
  { key: 'official', label: '官网链接', kind: 'url' }
] as const
export function safeUrl(value: unknown): string | undefined {
  try {
    const url = new URL(String(value))
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined
  } catch {
    return undefined
  }
}
export const display = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && !value.length)
    ? '未知'
    : Array.isArray(value)
      ? value.join('、')
      : String(value)
export const normalize = (value: string) =>
  value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()

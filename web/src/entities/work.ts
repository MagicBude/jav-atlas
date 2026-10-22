/** @file 作品展示模型独立于人物。列表摘要与详情分别加载，不把全库作品塞进人物索引。 */
export interface WorkEntry {
  id: string
  kind: 'work' | 'unknown'
  title: string
  code?: string | null
  sourceUrl: string
  releaseDate?: string | null
  makerText?: string
}
export interface WorkDetail extends WorkEntry {
  code?: string | null
  cast?: { id: string; name: string }[]
  profileFields?: { label: string; text: string; links: { text: string; url: string }[] }[]
}
export interface PersonWorks {
  actorId: string
  entries: WorkEntry[]
  completedAt?: number | null
}

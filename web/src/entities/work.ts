/** @file 作品展示模型独立于人物。列表摘要与详情分别加载，不把全库作品塞进人物索引。 */
export interface WorkEntry {
  id: string
  kind: 'work' | 'unknown'
  title: string
  code?: string | null
  sourceUrl: string
  releaseDate?: string | null
  makerText?: string
  actorIds?: string[]
  facets?: Record<string, { id: string; name: string }[]>
  rating?: { score: number; count: number | null; source: 'javdb' } | null
}
/** 全库仅加载轻量摘要；作品详情、评论与来源原文仍按需读取。 */
export interface WorkIndex {
  entries: WorkEntry[]
  actors: { id: string; name: string }[]
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

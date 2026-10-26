/** 网站用途和采集接入状态是两个维度。分类可多选归属，但服务总数按站点去重。 */
export const websiteCategories = [
  { id: 'all', label: '全部' },
  { id: 'people', label: '人物资料' },
  { id: 'works', label: '作品资料' },
  { id: 'api', label: '接口服务' }
] as const
export function readWebsiteCategory(value: string | null) {
  return websiteCategories.some(item => item.id === value) ? value! : 'all'
}
export function matchesWebsiteCategory(categories: readonly string[], category: string) {
  return category === 'all' || categories.includes(category)
}
export function websiteCategoryLabel(id: string) {
  return websiteCategories.find(item => item.id === id)?.label || id
}

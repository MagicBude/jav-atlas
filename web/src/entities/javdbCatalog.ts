/** 内容类型是 JavDB 目录的作用域；五类必须分开，不能按数字标签 ID 混在一起。 */
export const javdbContentTypes = [
  { id: 0, name: '有码' },
  { id: 1, name: '无码' },
  { id: 2, name: '欧美' },
  { id: 3, name: 'FC2' },
  { id: 4, name: '动漫' }
] as const

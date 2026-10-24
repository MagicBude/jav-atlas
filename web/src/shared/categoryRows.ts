/**
 * 横向类别行的可见项规则。展开只改变排版，不修改筛选或来源顺序。
 * 收起时保留前12项及全部已选项，避免筛选条件被藏进“更多”后难以取消。
 */
export interface CategoryOption {
  key: string
  label: string
  title?: string
  count?: number
  selected?: boolean
  to?: string
}
export function visibleCategoryOptions(
  options: CategoryOption[],
  expanded: boolean,
  previewCount = 12
) {
  return expanded
    ? options
    : options.filter((option, index) => index < previewCount || option.selected)
}

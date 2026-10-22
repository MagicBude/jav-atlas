/** @file 视图选择只修改URL参数，页面刷新、分享和返回详情后仍保留排列方式。 */
export type PersonView = 'grid' | 'portrait' | 'list'
export function personView(value: string | null): PersonView {
  return value === 'portrait' || value === 'list' ? value : 'grid'
}
export function ViewSwitcher({
  value,
  onChange
}: {
  value: PersonView
  onChange: (view: PersonView) => void
}) {
  return (
    <div className="view-switcher" role="group" aria-label="排列方式">
      {(
        [
          ['grid', '▦', '卡片'],
          ['portrait', '▥', '大图'],
          ['list', '☰', '列表']
        ] as const
      ).map(([key, icon, label]) => (
        <button key={key} aria-pressed={value === key} onClick={() => onChange(key)}>
          <span aria-hidden="true">{icon}</span>
          {label}
        </button>
      ))}
    </div>
  )
}

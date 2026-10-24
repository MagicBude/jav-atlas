/**
 * 类别目录与作品筛选共用一套横向布局，组件只负责展示和展开状态。
 * 有to时渲染站内链接；否则渲染可切换的筛选按钮，具体筛选规则由调用方维护。
 * 搜索期间展示所有命中项，收起只隐藏未选的后续项；键盘不会进入隐藏按钮。
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { visibleCategoryOptions, type CategoryOption } from './categoryRows'
import './category-row.css'
export function CategoryRow({
  label,
  options,
  onToggle,
  onClear,
  clearLabel,
  forceExpanded = false
}: {
  label: string
  options: CategoryOption[]
  onToggle?: (key: string) => void
  onClear?: () => void
  clearLabel?: string
  forceExpanded?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const contentId = useId()
  const open = forceExpanded || expanded
  const visible = visibleCategoryOptions(options, open)
  const hiddenCount = options.length - visible.length
  const collapsible = visibleCategoryOptions(options, false).length < options.length
  return (
    <section className="category-row" aria-label={label}>
      <h2 className="category-row-label">
        {label}
        <small>{options.length}</small>
      </h2>
      <div className="category-row-options" id={contentId}>
        {onClear && (
          <button
            type="button"
            className="category-chip category-all"
            aria-pressed={!options.some(option => option.selected)}
            aria-label={clearLabel || `清除${label}类别条件`}
            onClick={onClear}
          >
            全部
          </button>
        )}
        {visible.map(option => {
          const content = (
            <>
              <span>{option.label}</span>
              {option.count !== undefined && <small>{option.count}</small>}
            </>
          )
          return option.to ? (
            <Link className="category-chip" key={option.key} to={option.to} title={option.title}>
              {content}
            </Link>
          ) : (
            <button
              type="button"
              className="category-chip"
              key={option.key}
              title={option.title}
              aria-pressed={!!option.selected}
              onClick={() => onToggle?.(option.key)}
            >
              {content}
            </button>
          )
        })}
      </div>
      {collapsible && !forceExpanded && (
        <button
          type="button"
          className="category-row-toggle"
          aria-expanded={open}
          aria-controls={contentId}
          aria-label={`${open ? '收起' : '展开'}${label}`}
          onClick={() => setExpanded(value => !value)}
        >
          {open ? '收起' : `更多 +${hiddenCount}`}
          <span aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
      )}
    </section>
  )
}

/**
 * 可搜索的单选控件。details/summary提供原生展开与键盘行为，选项使用普通按钮，
 * 不伪装成缺少方向键支持的combobox。选择后关闭；Escape返回触发器焦点。
 * 只显示前80个搜索结果，避免成千选项撑满页面；完整选项数据仍由调用方保留。
 */
import { useEffect, useRef, useState } from 'react'
import { normalize } from '../entities/person'
import './search-select.css'
export interface SearchOption {
  id: string
  name: string
  source?: string
}
export function SearchSelect({
  label,
  value,
  options,
  onChange,
  showLabel = true
}: {
  label: string
  value: string
  options: SearchOption[]
  showLabel?: boolean
  onChange: (value: string) => void
}) {
  const [query, setQuery] = useState('')
  const details = useRef<HTMLDetailsElement>(null)
  const input = useRef<HTMLInputElement>(null)
  // details提供原生展开语义，但没有弹出选择器的外部点击关闭行为，在此补齐。
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      const element = details.current
      if (element?.open && event.target instanceof Node && !element.contains(event.target))
        element.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  const selected = options.find(option => option.id === value)
  const matches = options.filter(option =>
    normalize(`${option.name} ${option.id} ${option.source || ''}`).includes(normalize(query))
  )
  const choose = (id: string) => {
    onChange(id)
    if (details.current) details.current.open = false
    setQuery('')
  }
  return (
    <div className="search-select-field">
      {showLabel && <span>{label}</span>}
      <details
        className="search-select"
        name="work-filter-selectors"
        ref={details}
        onToggle={event => {
          if (event.currentTarget.open) input.current?.focus()
          else setQuery('')
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            if (details.current) {
              details.current.open = false
              details.current.querySelector('summary')?.focus()
            }
          }
        }}
      >
        <summary
          aria-label={`作品${label}`}
          title={
            selected
              ? `${selected.name}${selected.source ? ' · ' + selected.source : ''}`
              : value || `全部${label}`
          }
        >
          <span>{selected?.name || (value ? `${value}（当前范围无资料）` : `全部${label}`)}</span>
          {selected?.source && <small>{selected.source}</small>}
          <span aria-hidden="true">⌄</span>
        </summary>
        <div className="search-select-popup">
          <input
            ref={input}
            type="search"
            aria-label={`搜索${label}`}
            placeholder={`输入名称或ID查找${label}`}
            value={query}
            onChange={event => setQuery(event.target.value)}
          />
          <div className="search-select-options" aria-label={`${label}选项`}>
            <button type="button" aria-pressed={!value} onClick={() => choose('')}>
              全部{label}
            </button>
            {matches.slice(0, 80).map(option => (
              <button
                key={option.id}
                type="button"
                aria-pressed={option.id === value}
                onClick={() => choose(option.id)}
              >
                <span>{option.name}</span>
                {option.source && <small>{option.source}</small>}
              </button>
            ))}
          </div>
          {!matches.length && (
            <p className="small muted">没有匹配选项。已选条件可在页面中单独清除。</p>
          )}
          {matches.length > 80 && (
            <p className="small muted">
              匹配 {matches.length} 项，先显示 80 项；请输入更完整的名称。
            </p>
          )}
        </div>
      </details>
    </div>
  )
}

/**
 * @file 完整原始值查看器：对象和数组可逐层展开，新增来源字段不会因为页面没有专门设计而消失。
 * React 会转义文本；只将合法 http/https 字符串变为链接，不使用 dangerouslySetInnerHTML。
 */
import { display, safeUrl } from '../entities/person'
export function RawTree({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object')
    return safeUrl(value) ? (
      <a href={safeUrl(value)} target="_blank" rel="noreferrer">
        {String(value)} ↗
      </a>
    ) : (
      <span>{display(value)}</span>
    )
  return (
    <dl className="raw-tree">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {item !== null && typeof item === 'object' ? (
              <details>
                <summary>
                  {Array.isArray(item) ? `${item.length} 项` : `${Object.keys(item).length} 个字段`}
                </summary>
                <RawTree value={item} />
              </details>
            ) : (
              <RawTree value={item} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** 人物和作品共用详情来源入口；无可靠ID时保留文字，不制造可点击的错误链接。 */
import type { ReactNode } from 'react'
import { dataSources, sourceRecordUrl, type SourceEntity } from '../entities/dataSources'
export function SourceRecordLink({
  source,
  entity,
  id,
  children,
  className
}: {
  source: string
  entity: SourceEntity
  id: string
  children?: ReactNode
  className?: string
}) {
  const label = children || `${dataSources.find(item => item.id === source)?.name || source} ↗`
  const href = sourceRecordUrl(source, entity, id)
  return href ? (
    <a className={className} href={href} target="_blank" rel="noreferrer noopener">
      {label}
    </a>
  ) : (
    <span>{label}</span>
  )
}

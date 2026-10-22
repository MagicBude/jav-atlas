/** @file 卡片与紧凑行共用：人物链接和收藏按钮并列，避免点击收藏意外打开详情。 */
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../../app/context'
import { identity, personUrl, statusLabels, type Person } from '../../entities/person'
import { PersonAvatar } from '../../shared/PersonAvatar'
import { rememberList } from './returnPosition'
import styles from './PersonCard.module.css'
export function PersonCard({
  person,
  sequence = [],
  compact = false
}: {
  person: Person
  sequence?: string[]
  compact?: boolean
}) {
  const { data, favorite } = useApp(),
    location = useLocation()
  const selected = !!data.records[identity(person)]?.favorite?.active
  return (
    <article
      className={`${styles.card} ${compact ? styles.compact : ''}`}
      data-person={identity(person)}
    >
      <Link
        className={styles.portrait}
        to={personUrl(person)}
        state={{ background: location, returnKey: location.key, sequence }}
        onClick={event => {
          if (!event.ctrlKey && !event.metaKey && event.button === 0) rememberList(location)
        }}
      >
        <PersonAvatar file={person.avatar} name={person.name} />
      </Link>
      <div className={styles.summary}>
        <Link
          className={styles.name}
          to={personUrl(person)}
          state={{ background: location, returnKey: location.key, sequence }}
          onClick={() => rememberList(location)}
        >
          {person.name || '未命名'}
        </Link>
        <div className="muted small">
          {person.source} · <code>{person.id}</code>
        </div>
        <div className="small">
          {person.height != null ? `${person.height} cm` : '身高未知'} · {person.cup || '罩杯未知'}
        </div>
        <span className="badge">{statusLabels[person.status]}</span>
        {Object.values(data.records[identity(person)]?.fields || {}).some(
          op => op.kind === 'set'
        ) && <span className="local-mark">本地修改</span>}
      </div>
      <button
        className={`${styles.star} ${selected ? styles.selected : ''}`}
        aria-label={selected ? `取消收藏${person.name}` : `收藏${person.name}`}
        aria-pressed={selected}
        onClick={() => favorite(person)}
      >
        {selected ? '★' : '☆'}
      </button>
    </article>
  )
}

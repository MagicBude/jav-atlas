/** @file 卡片与紧凑行共用：人物链接和收藏按钮并列，避免点击收藏意外打开详情。 */
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../../app/context'
import { identity, personUrl, type Person } from '../../entities/person'
import { HeartIcon } from '../../shared/HeartIcon'
import { PersonAvatar } from '../../shared/PersonAvatar'
import { rememberList } from './returnPosition'
import styles from './PersonCard.module.css'
export function PersonCard({
  person,
  sequence = [],
  compact = false,
  portrait = false,
  rank
}: {
  person: Person
  sequence?: string[]
  compact?: boolean
  portrait?: boolean
  rank?: number
}) {
  const { data, favorite } = useApp(),
    location = useLocation()
  const selected = !!data.records[identity(person)]?.favorite?.active
  return (
    <article
      className={`${styles.card} ${compact ? styles.compact : ''} ${portrait ? styles.vertical : ''}`}
      data-person={identity(person)}
    >
      {/* 排名属于这张卡片；与内容同排或叠在照片角上，不创建额外的排名行。 */}
      {rank != null && (
        <span
          className={`${styles.rank} ${rank <= 3 ? styles.podium : ''}`}
          aria-label={`第 ${rank} 名`}
        >
          {String(rank).padStart(2, '0')}
        </span>
      )}
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
        <div className={styles.facts}>
          <span>{person.height != null ? `${person.height} cm` : '身高未知'}</span>
          <span>{person.cup ? `${person.cup} 杯` : '罩杯未知'}</span>
        </div>
        <div className={styles.meta}>
          <span>{person.source}</span>
          <code>#{person.id}</code>
        </div>
        {Object.values(data.records[identity(person)]?.fields || {}).some(
          op => op.kind === 'set'
        ) && <span className="local-mark">本地修改</span>}
      </div>
      <button
        className={`${styles.favorite} ${selected ? styles.selected : ''}`}
        aria-label={selected ? `取消收藏${person.name}` : `收藏${person.name}`}
        aria-pressed={selected}
        onClick={() => favorite(person)}
      >
        <HeartIcon active={selected} />
      </button>
    </article>
  )
}

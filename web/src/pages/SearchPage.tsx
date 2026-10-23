/** 全局搜索将人物与作品分组；只读本地索引，作品结果仍交给同一个WorkBrowser。 */
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../app/context'
import { loadIndex, resource } from '../data/repository'
import { normalize, identity } from '../entities/person'
import type { WorkIndex } from '../entities/work'
import { resolvePerson } from '../data/personal'
import { useResource } from '../shared/useResource'
import { PersonCard } from '../features/people/PersonCard'
import { WorkBrowser } from '../features/works/WorkBrowser'
export default function SearchPage() {
  const { manifest, data } = useApp(),
    location = useLocation()
  const q = new URLSearchParams(location.search).get('q')?.trim() || ''
  const people = useResource(q && manifest ? `${manifest.version}:search-people` : '', () =>
    loadIndex(manifest!, 'minnano')
  )
  const file = manifest?.works?.index
  const works = useResource(q && file ? file : '', () => resource<WorkIndex>(file!))
  const matches = (people.value || [])
    .map(person => resolvePerson(person, data.records[identity(person)]))
    .filter(
      person =>
        person.gender !== 'm' &&
        normalize([person.name, ...(person.aliases || []), person.id].join(' ')).includes(
          normalize(q)
        )
    )
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>搜索结果</h1>
          <p className="muted">
            {q ? `“${q}” · 本地人物与作品` : '在顶部输入姓名、别名、标题或番号。'}
          </p>
        </div>
      </header>
      {q && (
        <>
          <section className="search-group">
            <h2>
              人物 <span className="muted small">{matches.length}</span>
            </h2>
            {people.error ? (
              <p role="alert">
                {people.error} <button onClick={people.retry}>重试</button>
              </p>
            ) : !people.value ? (
              <p>正在查找人物…</p>
            ) : !matches.length ? (
              <p className="muted">本地人物中未找到匹配项。</p>
            ) : (
              <>
                <div className="people-grid list-view">
                  {matches.slice(0, 6).map(person => (
                    <PersonCard
                      key={identity(person)}
                      person={person}
                      compact
                      sequence={matches.map(identity)}
                    />
                  ))}
                </div>
                {matches.length > 6 && (
                  <Link to={`/people?q=${encodeURIComponent(q)}`}>查看全部人物结果 ↗</Link>
                )}
              </>
            )}
          </section>
          <section className="search-group">
            <h2>作品</h2>
            {works.error ? (
              <p role="alert">
                {works.error} <button onClick={works.retry}>重试</button>
              </p>
            ) : !file ? (
              <p className="muted">当前版本未提供作品索引。</p>
            ) : !works.value ? (
              <p>正在查找作品…</p>
            ) : (
              <WorkBrowser
                entries={works.value.entries}
                actors={works.value.actors}
                queryKey="q"
                hideSearch
              />
            )}
          </section>
        </>
      )}
    </>
  )
}

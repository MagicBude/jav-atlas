/**
 * 三语对照独立于筛选按钮布局，避免为日常浏览增加重复文字。
 * 身份始终是内容类型+ID；英文按用户提供的官方页面保留，不自行回译。
 */
import { Link } from 'react-router-dom'
import dictionary from '../data/javdb-tag-labels.json'
import { javdbGroupLabel } from '../entities/tagLabels'

type Group = { id: string; name: string; tags: string[] }
type Term = { label: string; labelTraditional: string; labelEnglish: string | null }
const terms: Record<string, Term> = dictionary.terms
export function TagTranslationTable({ groups, type }: { groups: Group[]; type: number }) {
  const traditional: Record<string, string> = dictionary.traditionalGroupLabels
  const english: Record<string, string | null> = dictionary.englishGroupLabels
  return (
    <div className="catalog-translations">
      {groups.map(group => (
        <section key={group.id}>
          <h2>
            {javdbGroupLabel(group.id, group.name)}{' '}
            <small>
              {traditional[group.id]} / {english[group.id] || '—'}
            </small>
          </h2>
          <div className="catalog-table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">简体中文</th>
                  <th scope="col">繁體中文</th>
                  <th scope="col">English</th>
                </tr>
              </thead>
              <tbody>
                {group.tags.map(id => {
                  const term = terms[`${type}:${id}`]
                  return (
                    <tr key={id}>
                      <td>{id}</td>
                      <td>
                        <Link to={'/works?' + new URLSearchParams({ wf_tag: `${type}:${id}` })}>
                          {term.label}
                        </Link>
                      </td>
                      <td lang="zh-Hant">{term.labelTraditional}</td>
                      <td lang="en">{term.labelEnglish || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}

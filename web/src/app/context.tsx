/**
 * @file 提供应用级只读版本、个人资料和未保存草稿。
 * 持久写入统一交给 PersonalRepository；状态更新只在存储真正成功后发布给页面。
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { loadManifest } from '../data/repository'
import {
  emptyData,
  PersonalRepository,
  same,
  type Operation,
  type PersonalRecord,
  type UserData
} from '../data/personal'
import { identity, type Manifest, type Person } from '../entities/person'
export interface Draft {
  values: Record<string, string>
  modes: Record<string, string>
  base: PersonalRecord | undefined
  dirty: boolean
}
interface Context {
  manifest: Manifest | null
  data: UserData
  error: string
  repository: PersonalRepository
  notify: (message: string, action?: () => void) => void
  commit: (operation: () => UserData) => boolean
  favorite: (person: Person) => void
  drafts: Record<string, Draft>
  setDraft: (key: string, draft?: Draft) => void
  saveDraft: { current: (() => boolean) | null }
}
const AppContext = createContext<Context | null>(null)
export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw Error('组件必须位于 AppProvider 内')
  return context
}
export function AppProvider({ children }: { children: ReactNode }) {
  const repository = useMemo(
    () =>
      new PersonalRepository({
        getItem: key => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value)
      }),
    []
  )
  const [data, setData] = useState(emptyData)
  const [manifest, setManifest] = useState<Manifest | null>(null)
  const [error, setError] = useState('')
  const [manifestError, setManifestError] = useState('')
  const [toast, setToast] = useState<{ message: string; action?: () => void } | null>(null)
  const [drafts, updateDrafts] = useState<Record<string, Draft>>({})
  const saveDraft = useRef<(() => boolean) | null>(null)
  const notify = (message: string, action?: () => void) => setToast({ message, action })
  const commit = (operation: () => UserData) => {
    try {
      setData(operation())
      setError('')
      return true
    } catch (failure) {
      notify(`未保存：${failure instanceof Error ? failure.message : String(failure)}`)
      return false
    }
  }
  useEffect(() => {
    loadManifest()
      .then(setManifest)
      .catch(failure => setManifestError(`数据无法载入：${failure.message}`))
    const read = () => {
      try {
        setData(repository.read())
      } catch (failure) {
        setError(`本地数据未覆盖：${failure instanceof Error ? failure.message : String(failure)}`)
      }
    }
    read()
    window.addEventListener('storage', read)
    return () => window.removeEventListener('storage', read)
  }, [repository])
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 10000)
    return () => window.clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (Object.values(drafts).some(draft => draft.dirty)) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [drafts])
  const favorite = (person: Person) => {
    const active = !data.records[identity(person)]?.favorite?.active
    let saved: UserData | undefined
    if (
      commit(() => {
        saved = repository.favorite(person, active)
        return saved
      })
    )
      notify(active ? '已收藏到本浏览器。' : '已取消收藏；备注和本地修改仍保留。', () => {
        try {
          if (
            !same(
              repository.read().records[identity(person)]?.favorite,
              saved?.records[identity(person)]?.favorite
            )
          ) {
            notify('收藏状态已在另一处变化，未执行过期撤销。')
            return
          }
          commit(() => repository.favorite(person, !active))
        } catch (failure) {
          notify(String(failure))
        }
      })
  }
  return (
    <AppContext.Provider
      value={{
        manifest,
        data,
        error: [manifestError, error].filter(Boolean).join('；'),
        repository,
        notify,
        commit,
        favorite,
        drafts,
        saveDraft,
        setDraft: (key, draft) =>
          updateDrafts(previous => {
            const next = { ...previous }
            if (draft) next[key] = draft
            else delete next[key]
            return next
          })
      }}
    >
      {children}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              onClick={() => {
                const action = toast.action
                setToast(null)
                action?.()
              }}
            >
              撤销
            </button>
          )}
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </AppContext.Provider>
  )
}
/** 操作构造器把“恢复来源”与“主动设为未知”分开，便于表单与导入测试复用。 */
export const operation = (
  kind: Operation['kind'],
  value: Operation['value'],
  base: Operation['base']
): Operation => ({ kind, value, base, updatedAt: Date.now() })

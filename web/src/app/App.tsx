import SourcesPage from '../pages/SourcesPage'
import TagCatalogPage from '../pages/TagCatalogPage'
import WorkPage from '../pages/WorkPage'
import WorksPage from '../pages/WorksPage'
import SearchPage from '../pages/SearchPage'
/**
 * @file 路由与容器的组合层。桌面详情叠在保存的背景列表上，完整页使用同一份内容。
 * 草稿保护统一在此拦截导航；不会在每个链接里各写一套不一致的“是否离开”。
 */
import { useEffect, useRef, useState } from 'react'
import {
  Link,
  NavLink,
  Route,
  Routes,
  useBlocker,
  useLocation,
  useNavigate
} from 'react-router-dom'
import { useApp } from './context'
import PeoplePage from '../pages/PeoplePage'
import PersonPage from '../pages/PersonPage'
import RankingsPage from '../pages/RankingsPage'
import DataPage from '../pages/DataPage'
import { Modal } from '../shared/Modal'
import { restoreList } from '../features/people/returnPosition'
export default function App() {
  const location = useLocation(),
    navigate = useNavigate(),
    { data, error, drafts, setDraft, saveDraft } = useApp()
  const [wide, setWide] = useState(window.innerWidth >= 1024)
  // 刷新后不要凭浏览器恢复的旧 state 强行打开没有背景的抽屉。
  const [firstKey] = useState(location.key)
  const [firstReload] = useState(
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
      ?.type === 'reload'
  )
  const background = location.state?.background
  const isPerson = /^\/people\/(minnano|javdb)\/[^/]+$/.test(location.pathname)
  const drawer = wide && isPerson && background && !(firstReload && location.key === firstKey)
  const previousDrawer = useRef<string | undefined>(undefined)
  useEffect(() => {
    // 背景列表保留实例，关闭后不会触发其“重新挂载”逻辑，因此在容器层补一次锚点恢复。
    if (previousDrawer.current && !drawer && !isPerson) restoreList(previousDrawer.current)
    previousDrawer.current = drawer ? location.state?.returnKey : undefined
  }, [drawer, isPerson, location.key])
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      Object.values(drafts).some(draft => draft.dirty) &&
      currentLocation.pathname !== nextLocation.pathname
  )
  useEffect(() => {
    const active = location.pathname.startsWith('/people/')
      ? location.pathname.slice('/people/'.length)
      : ''
    for (const [key, draft] of Object.entries(drafts))
      if (key !== active && !draft.dirty) setDraft(key)
  }, [location.pathname])
  useEffect(() => {
    const resize = () => setWide(window.innerWidth >= 1024)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    document.title = `${isPerson ? '人物详情' : location.pathname === '/sources' ? '资料来源' : location.pathname === '/tags' ? '类别目录' : location.pathname === '/search' ? '搜索结果' : location.pathname === '/works' ? '作品库' : location.pathname.startsWith('/works/') ? '作品详情' : location.pathname === '/favorites' ? '我的收藏' : location.pathname === '/rankings' ? '榜单' : '人物资料库'} · JAV Atlas`
  }, [location.pathname])
  const close = () => navigate(-1)
  return (
    <>
      <a
        className="skip-link"
        href="#/people"
        onClick={event => {
          event.preventDefault()
          document.getElementById('main-content')?.focus()
        }}
      >
        跳到主要内容
      </a>
      <header className="site-header">
        <div>
          <Link className="brand" to="/people">
            <span className="brand-icon">A</span>JAV <strong>Atlas</strong>
          </Link>
          <nav aria-label="主导航">
            <NavLink to="/people" className={({ isActive }) => (isActive ? 'active' : '')}>
              人物
            </NavLink>
            <NavLink to="/works">作品</NavLink>
            <NavLink to="/rankings">榜单</NavLink>
            <NavLink to="/tags">类别目录</NavLink>
            <NavLink to="/sources">资料来源</NavLink>
            <NavLink to="/favorites">
              收藏{' '}
              <span className="nav-count">
                {Object.values(data.records).filter(r => r.favorite?.active).length}
              </span>
            </NavLink>
          </nav>
          <form
            className="global-search"
            role="search"
            onSubmit={event => {
              event.preventDefault()
              const q = String(new FormData(event.currentTarget).get('q') || '').trim()
              if (q) navigate(`/search?q=${encodeURIComponent(q)}`)
            }}
          >
            <input
              key={
                location.pathname +
                (location.pathname === '/search'
                  ? new URLSearchParams(location.search).get('q')
                  : '')
              }
              name="q"
              aria-label="全局搜索"
              placeholder="姓名 / 标题 / 番号"
              defaultValue={
                location.pathname === '/search'
                  ? new URLSearchParams(location.search).get('q') || ''
                  : ''
              }
            />
            <button type="submit">查找</button>
          </form>
        </div>
      </header>
      <div id="main-content" tabIndex={-1} className="site-content">
        {error && (
          <div className="notice error" role="alert">
            {error}
            <Link to="/data">查看本地数据</Link>
            <button onClick={() => window.location.reload()}>重试</button>
          </div>
        )}
        <Routes location={drawer ? background : location}>
          <Route path="/" element={<PeoplePage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/favorites" element={<PeoplePage favoritesOnly />} />
          <Route path="/works" element={<WorksPage />} />
          <Route path="/tags" element={<TagCatalogPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/works/minnano/:id" element={<WorkPage />} />
          <Route path="/rankings" element={<RankingsPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/people/:source/:id" element={<PersonPage />} />
          <Route
            path="*"
            element={
              <main className="empty-state">
                <h1>页面不存在</h1>
                <Link to="/people">返回人物资料库</Link>
              </main>
            }
          />
        </Routes>
      </div>
      {drawer && (
        <Modal title="人物详情" drawer close={close}>
          <Routes>
            <Route
              path="/people/:source/:id"
              element={
                <PersonPage
                  drawer
                  close={close}
                  full={() =>
                    navigate(location.pathname, {
                      replace: true,
                      state: { ...location.state, background: undefined }
                    })
                  }
                />
              }
            />
          </Routes>
        </Modal>
      )}
      {blocker.state === 'blocked' && (
        <Modal title="有未保存的修改" close={() => blocker.reset()}>
          <h2>有未保存的修改</h2>
          <p>离开会放弃当前草稿。已经保存的收藏与个人资料不受影响。</p>
          <div className="detail-actions">
            <button onClick={() => blocker.reset()}>继续编辑</button>
            <button
              onClick={() => {
                Object.keys(drafts).forEach(key => setDraft(key))
                blocker.proceed()
              }}
            >
              放弃修改并离开
            </button>
            <button
              className="primary"
              onClick={() => {
                if (saveDraft.current?.()) blocker.proceed()
              }}
            >
              保存后离开
            </button>
          </div>
        </Modal>
      )}
      <footer className="site-footer">
        JAV Atlas · 保留来源 ID，资料与个人修改分别保存。<Link to="/data">数据范围与备份</Link>
      </footer>
    </>
  )
}

/** 作品流水线合成网络：两个演员共享作品，第二位另有一份作品；未知请求一律失败。 */
global.fetch = async value => {
  const u = new URL(value)
  if (process.env.WORK_FIXTURE_LOG)
    require('node:fs').appendFileSync(process.env.WORK_FIXTURE_LOG, String(value) + '\n')
  const actor =
    u.pathname.match(/^\/actress(190754|125605|999999)\.html$/)?.[1] ||
    (u.pathname === '/actress.php' ? u.searchParams.get('actress_id') : null)
  if (actor) {
    if (process.env.WORK_FIXTURE_BAD_ACTOR === actor) return new Response('Just a moment')
    const page = Number(u.searchParams.get('page') || 1)
    const total = Number(process.env.WORK_FIXTURE_PAGES || 1)
    const row = id =>
      `<tr><td><img data-src="/cover.jpg"></td><td><h3 class="ttl"><a href="av${id}.html">Sample</a></h3><p class="cast"><a href="actress${actor}.html">Actor</a></p></td><td>2026/09/15</td></tr>`
    const rows =
      total > 1
        ? row(String(1000 + page))
        : row('123') + (actor === '125605' ? row('456') : row('uk190754'))
    const pagination =
      total > 1
        ? `<u>${page}</u>` +
          (page < total
            ? `<a href="/actress.php?actress_id=${actor}&amp;page=${page + 1}">Next</a>`
            : '')
        : ''
    return new Response(
      `<a href="actress${actor}.html">Actor</a><div class="act-video-list"><table>${rows}</table></div><!-- /.act-video-list --><div class="pagination">${pagination}</div>`
    )
  }
  const work = u.pathname.match(/^\/av(123|456)\.html$/)?.[1]
  if (work) {
    if (process.env.WORK_FIXTURE_FAIL === work) throw Error('模拟详情失败')
    return new Response(
      `<meta property="og:url" content="https://www.minnano-av.com/av${work}.html"><div class="av-data"><table class="prof-table"><tr><td>作品名</td><td>Sample ${work}</td></tr></table></div>`
    )
  }
  throw Error('未声明的作品测试请求 ' + value)
}

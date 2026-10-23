import { expect, it } from 'vitest'
import { facetUrl, matchesWorkFacets, clearWorkFilters } from '../src/features/works/query'
it('关联筛选用来源ID，前缀精确匹配且保留浏览条件', () => {
 const row = {id:'1',kind:'work' as const,title:'',sourceUrl:'',code:'SONE-001',facets:{director:[{id:'A',name:'同名'}]}}
 expect(matchesWorkFacets(row,new URLSearchParams('wf_prefix=SONE&wf_director=A'))).toBe(true)
 expect(matchesWorkFacets(row,new URLSearchParams('wf_prefix=SON'))).toBe(false)
 expect(matchesWorkFacets(row,new URLSearchParams('wf_director=B'))).toBe(false)
 const url = facetUrl('director','A','/works','?wa=123&wd=compact&wp=3&work=1')
 const params = new URL(url,'https://local.test').searchParams
 expect(params.get('wa')).toBe('123')
 expect(params.get('wd')).toBe('compact')
 expect(params.has('wp')).toBe(false)
 expect(params.has('work')).toBe(false)
 expect(new URLSearchParams(clearWorkFilters(params.toString())).has('wf_director')).toBe(false)
})

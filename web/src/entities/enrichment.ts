/** JavDB来源补充模型，保持与minnano身份和原字段分离。 */
export interface Enrichment {
  id: string
  sourceUrl: string
  fetchedAt: string
  metadata: {
    number: string
    score?: string
    reviews_count?: number
    comments_count?: number
    duration?: number
    release_date?: string
    maker_name?: string
    publisher_name?: string
    director_name?: string
    series_name?: string
    tags?: { id: string; name: string }[]
    actors?: { id: string; name: string }[]
  }
  reviews: {
    id: string
    author: string
    score: number | null
    content: string
    likes: number
    createdAt: string
  }[]
  mapping: { dateDifference: boolean; minnanoDate: string | null; javdbDate: string | null }
}

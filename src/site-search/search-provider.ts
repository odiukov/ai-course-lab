export interface SearchHit {
  title: string;
  lesson: string;
  url: string;
  /** Безопасный HTML: текст экранирован, а совпадения выделены тегами <mark>. */
  excerpt: string;
}

export interface SearchProvider {
  search(query: string): Promise<SearchHit[]>;
}

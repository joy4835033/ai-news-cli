export type SourceName = 'TechCrunch' | 'TheVerge' | 'HackerNews';

export interface Article {
  title: string;
  link: string;
  publishedAt: Date;
  source: SourceName;
  summary: string;
  rawDescription: string;
}

export interface RSSSource {
  name: SourceName;
  url: string;
}

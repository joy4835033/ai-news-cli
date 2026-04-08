export type SourceName =
  | 'TechCrunch'
  | 'TheVerge'
  | 'HackerNews'
  | 'OpenAI Blog'
  | 'Anthropic'
  | 'Google AI Blog'
  | 'DeepMind'
  | 'Meta AI'
  | 'MIT Tech Review'
  | 'VentureBeat AI'
  | 'Wired AI'
  | 'AI News'
  | '机器之心';

export interface Article {
  title:          string;
  link:           string;
  publishedAt:    Date;
  source:         SourceName;
  summary:        string;
  rawDescription: string;
  tier:           1 | 2 | 3;   // 新增：信源梯队
}

export interface RSSSource {
  name: SourceName;
  url:  string;
  tier: 1 | 2 | 3;             // 新增：信源梯队
}

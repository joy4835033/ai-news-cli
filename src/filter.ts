import { Article } from './types.js';

const HOURS_24 = 24 * 60 * 60 * 1000;

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'source', 'via', 'mc_cid', 'mc_eid',
  'fbclid', 'gclid', 'msclkid', 'twclid',
  '_hsenc', '_hsmi', 'hsCtaTracking',
]);

export function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.protocol = 'https:';
    url.hostname = url.hostname.replace(/^www\./, '');
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    url.hash = '';
    return url.toString().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

interface DedupeResult {
  articles: Article[];
  duplicatesRemoved: number;
  duplicateDetails: Array<{ kept: string; dropped: string; source: string }>;
}

export function dedupe(articles: Article[]): DedupeResult {
  const seen = new Map<string, Article>();
  const duplicateDetails: DedupeResult['duplicateDetails'] = [];

  for (const article of articles) {
    const key = normalizeUrl(article.link);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, article);
    } else {
      if (article.publishedAt < existing.publishedAt) {
        seen.set(key, article);
        duplicateDetails.push({
          kept:    article.source,
          dropped: existing.source,
          source:  article.title.slice(0, 50),
        });
      } else {
        duplicateDetails.push({
          kept:    existing.source,
          dropped: article.source,
          source:  article.title.slice(0, 50),
        });
      }
    }
  }

  return {
    articles: [...seen.values()],
    duplicatesRemoved: duplicateDetails.length,
    duplicateDetails,
  };
}

export function filterAndSort(
  articles: Article[],
  options: { verbose?: boolean } = {}
): Article[] {
  const cutoff = Date.now() - HOURS_24;
  const recent = articles.filter(a => a.publishedAt.getTime() > cutoff);
  const { articles: unique, duplicatesRemoved, duplicateDetails } = dedupe(recent);

  if (duplicatesRemoved > 0) {
    console.log(`🔄 去重：移除 ${duplicatesRemoved} 篇重复文章`);
    if (options.verbose) {
      duplicateDetails.forEach(d => {
        console.log(`   ↳ 保留 [${d.kept}] 丢弃 [${d.dropped}]：${d.source}…`);
      });
    }
    console.log();
  }

  return unique.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}

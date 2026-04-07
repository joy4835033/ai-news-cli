import { XMLParser } from 'fast-xml-parser';
import { Article, RSSSource } from './types.js';

const parser = new XMLParser({ ignoreAttributes: false });

export function cleanText(raw: string | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItem(item: any, source: RSSSource['name']): Article | null {
  try {
    const title = item.title?.['#text'] ?? item.title ?? '';
    const link =
      item.link?.['@_href'] ??
      item.link ??
      item.guid?.['#text'] ??
      item.guid ??
      '';
    const pubRaw =
      item.pubDate ??
      item.published ??
      item.updated ??
      '';
    const publishedAt = new Date(pubRaw);
    if (isNaN(publishedAt.getTime())) return null;

    const rawDescription =
      item.description ??
      item['content:encoded'] ??
      item.summary ??
      item.content?.['#text'] ??
      '';

    return {
      title:          String(title).trim(),
      link:           String(link).trim(),
      publishedAt,
      source,
      summary:        cleanText(String(rawDescription)),
      rawDescription: String(rawDescription),
    };
  } catch {
    return null;
  }
}

async function fetchSource(source: RSSSource): Promise<Article[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(source.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'ai-news-cli/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const parsed = parser.parse(xml);
    const channel = parsed?.rss?.channel ?? parsed?.feed;
    const rawItems: any[] = channel?.item ?? channel?.entry ?? [];
    const items = Array.isArray(rawItems) ? rawItems : [rawItems];

    return items
      .map(item => parseItem(item, source.name))
      .filter((a): a is Article => a !== null);
  } catch (err: any) {
    const reason = err?.name === 'AbortError' ? '请求超时' : err?.message;
    console.warn(`⚠️  [${source.name}] 抓取失败：${reason}`);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchAllSources(sources: RSSSource[]): Promise<Article[]> {
  const results = await Promise.allSettled(sources.map(fetchSource));
  return results.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
}

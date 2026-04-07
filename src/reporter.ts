import { promises as fs } from 'fs';
import path from 'path';
import { Article, SourceName } from './types.js';

function formatTime(date: Date): string {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function buildStats(articles: Article[]): string {
  const sourceCount = new Set(articles.map(a => a.source)).size;
  const bySource = articles.reduce<Record<string, number>>((acc, a) => {
    acc[a.source] = (acc[a.source] ?? 0) + 1;
    return acc;
  }, {});

  const breakdown = Object.entries(bySource)
    .map(([src, count]) => `${src} ${count} 篇`)
    .join(' · ');

  return [
    '## 📊 今日统计',
    '',
    `- 📰 **共收录 ${articles.length} 篇**文章，来自 **${sourceCount} 个**信息源`,
    `- 📌 来源分布：${breakdown}`,
    `- 🕐 统计周期：过去 24 小时`,
    '',
  ].join('\n');
}

function buildArticleEntry(article: Article, index: number): string {
  return [
    `### ${index}. [${article.title}](${article.link})`,
    '',
    `> ${article.summary}`,
    '',
    `- 🕐 **发布时间：** ${formatTime(article.publishedAt)}`,
    `- 🏷️ **来源：** ${article.source}`,
    '',
    '---',
    '',
  ].join('\n');
}

const SOURCE_EMOJI: Record<SourceName, string> = {
  TechCrunch: '🟠',
  TheVerge:   '🔵',
  HackerNews: '🟡',
};

export async function generateReport(articles: Article[]): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\//g, '-');

  const header = [
    `# 🤖 AI 新闻日报 · ${dateStr}`,
    '',
    `> 生成时间：${formatTime(now)}`,
    `> 数据来源：TechCrunch AI · The Verge AI · Hacker News`,
    '',
    '---',
    '',
  ].join('\n');

  const stats = buildStats(articles);

  const groups = articles.reduce<Record<string, Article[]>>((acc, a) => {
    (acc[a.source] ??= []).push(a);
    return acc;
  }, {});

  let globalIndex = 1;
  const sections = Object.entries(groups).map(([source, items]) => {
    const emoji = SOURCE_EMOJI[source as SourceName] ?? '📰';
    const heading = `## ${emoji} ${source} (${items.length} 篇)\n\n`;
    const entries = items.map(a => buildArticleEntry(a, globalIndex++)).join('');
    return heading + entries;
  }).join('\n');

  const content = header + stats + '---\n\n' + sections;

  const outputDir = path.resolve('output');
  await fs.mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `ai-daily-${dateStr}.md`);
  await fs.writeFile(filePath, content, 'utf-8');

  return filePath;
}

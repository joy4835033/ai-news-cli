import Anthropic from '@anthropic-ai/sdk';

function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      '❌ 未找到 ANTHROPIC_API_KEY 环境变量\n' +
      '   请先执行：export ANTHROPIC_API_KEY=your_key_here'
    );
  }
  return new Anthropic({ apiKey });
}

const client = createClient();

export async function summarizeArticle(
  title: string,
  description: string
): Promise<string> {
  const truncated = description
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);

  try {
    const message = await client.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 120,
      messages: [
        {
          role: 'user',
          content:
            `请用一句话（不超过60个中文字）总结以下科技新闻的核心内容。` +
            `只输出摘要本身，不要加任何前缀或解释。\n\n` +
            `标题：${title}\n\n` +
            `内容：${truncated}`,
        },
      ],
    });

    const text = message.content[0];
    if (text.type !== 'text') return fallbackSummary(truncated);
    return text.text.trim();
  } catch (err: any) {
    console.warn(`  ⚠️  AI摘要失败（${title.slice(0, 30)}...）：${err?.message}`);
    return fallbackSummary(truncated);
  }
}

export async function summarizeAll(
  articles: Array<{ title: string; rawDescription: string }>
): Promise<string[]> {
  const CONCURRENCY = 5;
  const results: string[] = new Array(articles.length);

  for (let i = 0; i < articles.length; i += CONCURRENCY) {
    const batch = articles.slice(i, i + CONCURRENCY);

    process.stdout.write(
      `  🤖 AI摘要进度：${Math.min(i + CONCURRENCY, articles.length)}/${articles.length}\r`
    );

    const batchResults = await Promise.all(
      batch.map(a => summarizeArticle(a.title, a.rawDescription))
    );

    batchResults.forEach((r, j) => { results[i + j] = r; });

    if (i + CONCURRENCY < articles.length) {
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  process.stdout.write('\n');
  return results;
}

function fallbackSummary(text: string): string {
  if (!text) return '暂无摘要';
  return text.length > 80 ? text.slice(0, 80) + '…' : text;
}

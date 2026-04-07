import { fetchAllSources } from './fetcher.js';
import { filterAndSort }   from './filter.js';
import { generateReport }  from './reporter.js';
import { summarizeAll }    from './summarizer.js';
import { startScheduler }  from './scheduler.js';
import type { RSSSource }  from './types.js';

const RSS_SOURCES: RSSSource[] = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'TheVerge',   url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'HackerNews', url: 'https://hnrss.org/newest?q=AI&count=30' },
];

export async function runDaily(options: { verbose?: boolean } = {}): Promise<void> {
  console.log('🔍 正在并发抓取 RSS 源...\n');
  const raw = await fetchAllSources(RSS_SOURCES);
  console.log(`📥 原始抓取：${raw.length} 篇\n`);

  const articles = filterAndSort(raw, { verbose: options.verbose });
  const sourceCount = new Set(articles.map(a => a.source)).size;
  console.log(`✅ 过滤后：${articles.length} 篇（来自 ${sourceCount} 个源）\n`);

  if (articles.length === 0) {
    console.log('⚠️  过去24小时内无新文章，仍将生成空日报。\n');
  }

  console.log('🤖 正在生成 AI 摘要...');
  const summaries = await summarizeAll(
    articles.map(a => ({ title: a.title, rawDescription: a.rawDescription }))
  );
  const articlesWithSummary = articles.map((a, i) => ({
    ...a,
    summary: summaries[i],
  }));
  console.log('✅ AI 摘要生成完毕\n');

  const filePath = await generateReport(articlesWithSummary);
  console.log(`📄 日报已生成：${filePath}`);
}

interface CliArgs {
  cron:    boolean;
  now:     boolean;
  verbose: boolean;
  expr:    string;
  tz:      string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const get = (prefix: string): string | undefined =>
    argv.find(a => a.startsWith(prefix))?.split('=')[1];

  return {
    cron:    argv.includes('--cron'),
    now:     argv.includes('--now'),
    verbose: argv.includes('--verbose'),
    expr:    get('--expr') ?? '0 8 * * *',
    tz:      get('--tz')   ?? 'Asia/Shanghai',
  };
}

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.cron) {
    startScheduler(() => runDaily({ verbose: args.verbose }), {
      expression:     args.expr,
      timezone:       args.tz,
      runImmediately: args.now,
    });
  } else {
    await runDaily({ verbose: args.verbose });
  }
}

main().catch(err => {
  console.error('❌ 运行出错：', err);
  process.exit(1);
});

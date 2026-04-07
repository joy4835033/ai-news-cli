import { createServer, IncomingMessage, ServerResponse } from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { marked } from 'marked';

async function getLatestReport(): Promise<{ html: string; date: string } | null> {
  const outputDir = path.resolve('output');
  try {
    const files = await fs.readdir(outputDir);
    const mdFiles = files.filter(f => f.startsWith('ai-daily-') && f.endsWith('.md')).sort();
    if (mdFiles.length === 0) return null;
    const latest = mdFiles.at(-1)!;
    const date = latest.replace('ai-daily-', '').replace('.md', '');
    const md = await fs.readFile(path.join(outputDir, latest), 'utf-8');
    const html = await marked(md);
    return { html, date };
  } catch {
    return null;
  }
}

async function getArchiveList(): Promise<string[]> {
  const outputDir = path.resolve('output');
  try {
    const files = await fs.readdir(outputDir);
    return files
      .filter(f => f.startsWith('ai-daily-') && f.endsWith('.md'))
      .sort()
      .reverse()
      .map(f => f.replace('ai-daily-', '').replace('.md', ''));
  } catch {
    return [];
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const dateParam = url.searchParams.get('date');
  const archiveDates = await getArchiveList();

  let reportData: { html: string; date: string } | null = null;

  if (dateParam) {
    const outputDir = path.resolve('output');
    const filePath = path.join(outputDir, `ai-daily-${dateParam}.md`);
    try {
      const md = await fs.readFile(filePath, 'utf-8');
      const html = await marked(md);
      reportData = { html, date: dateParam };
    } catch {
      reportData = null;
    }
  } else {
    reportData = await getLatestReport();
  }

  const activeDate = reportData?.date ?? '';
  const archiveLinksHtml = archiveDates
    .map(d => {
      const cls = d === activeDate ? 'archive-link active' : 'archive-link';
      return `<a href="/?date=${d}" class="${cls}">${d}</a>`;
    })
    .join('\n');

  const body = reportData
    ? reportData.html
    : `<div class="empty">
         <div class="icon">📭</div>
         <p>暂无日报内容</p>
         <p style="font-size:.85rem;margin-top:.5rem;color:#aaa">
           请先触发 GitHub Actions 生成第一份日报
         </p>
       </div>`;

  const title = reportData ? `AI 新闻日报 · ${reportData.date}` : 'AI 新闻日报';

  const finalHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f5f5f5; color: #1a1a1a; line-height: 1.75; }
    header { background: #fff; border-bottom: 1px solid #e5e5e5; padding: .9rem 2rem;
             display: flex; align-items: center; gap: 1rem;
             position: sticky; top: 0; z-index: 10; }
    header h1 { font-size: 1.1rem; font-weight: 700; color: #0070f3; }
    header span { font-size: .85rem; color: #888; }
    .layout { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem;
              display: grid; grid-template-columns: 1fr 220px;
              gap: 2rem; align-items: start; }
    .content { background: #fff; border-radius: 12px; padding: 2.5rem;
               box-shadow: 0 1px 4px rgba(0,0,0,.06); }
    .content h1 { font-size: 1.6rem; border-bottom: 3px solid #0070f3;
                  padding-bottom: .6rem; margin-bottom: 1.5rem; }
    .content h2 { font-size: 1.2rem; color: #0070f3; margin: 2.5rem 0 1rem;
                  padding-bottom: .3rem; border-bottom: 1px solid #e8f0fe; }
    .content h3 { font-size: 1rem; margin: 1.5rem 0 .4rem; }
    .content h3 a { color: #1a1a1a; text-decoration: none; }
    .content h3 a:hover { color: #0070f3; text-decoration: underline; }
    .content blockquote { border-left: 4px solid #0070f3; padding: .6rem 1rem;
                          background: #f0f7ff; border-radius: 0 8px 8px 0;
                          color: #444; margin: .6rem 0 1rem; font-size: .95rem; }
    .content ul { padding-left: 1.4rem; margin: .4rem 0; }
    .content li { font-size: .9rem; color: #555; }
    .content hr { border: none; border-top: 1px solid #eee; margin: 1.2rem 0; }
    .content p { margin: .5rem 0; }
    .content a { color: #0070f3; }
    .sidebar { background: #fff; border-radius: 12px; padding: 1.5rem;
               box-shadow: 0 1px 4px rgba(0,0,0,.06);
               position: sticky; top: 70px; }
    .sidebar h2 { font-size: .95rem; font-weight: 700; color: #888;
                  text-transform: uppercase; letter-spacing: .05em; margin-bottom: 1rem; }
    .archive-link { display: block; padding: .4rem .6rem; border-radius: 6px;
                    font-size: .88rem; color: #444; text-decoration: none;
                    transition: background .15s; }
    .archive-link:hover { background: #f0f7ff; color: #0070f3; }
    .archive-link.active { background: #0070f3; color: #fff; font-weight: 600; }
    .empty { text-align: center; padding: 4rem 2rem; color: #888; }
    .empty .icon { font-size: 3rem; margin-bottom: 1rem; }
    @media (max-width: 768px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; }
      .content { padding: 1.5rem; }
    }
  </style>
</head>
<body>
  <header>
    <h1>🤖 AI 新闻日报</h1>
    <span>每天早上 8 点自动更新</span>
  </header>
  <div class="layout">
    <main class="content">${body}</main>
    <aside class="sidebar">
      <h2>📅 历史归档</h2>
      ${archiveLinksHtml || '<p style="color:#aaa;font-size:.85rem">暂无历史记录</p>'}
    </aside>
  </div>
</body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(finalHtml);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch(err => {
    console.error('请求处理失败：', err);
    res.writeHead(500);
    res.end('服务器错误');
  });
});

const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`🌐 服务已启动：http://localhost:${PORT}`);
});

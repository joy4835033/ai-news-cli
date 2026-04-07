import { promises as fs } from 'fs';
import path from 'path';
import { marked } from 'marked';

async function build(): Promise<void> {
  const outputDir = path.resolve('output');
  const publicDir = path.resolve('public');

  await fs.mkdir(publicDir, { recursive: true });

  // 读取所有日报
  const files = await fs.readdir(outputDir);
  const mdFiles = files
    .filter(f => f.startsWith('ai-daily-') && f.endsWith('.md'))
    .sort()
    .reverse();

  if (mdFiles.length === 0) {
    console.log('⚠️  没有找到任何日报文件');
    return;
  }

  // 生成归档链接
  const archiveDates = mdFiles.map(f =>
    f.replace('ai-daily-', '').replace('.md', '')
  );

  // 为每个日报生成一个 HTML 文件
  for (const file of mdFiles) {
    const date = file.replace('ai-daily-', '').replace('.md', '');
    const md = await fs.readFile(path.join(outputDir, file), 'utf-8');
    const body = await marked(md);
    const html = buildHtml(body, date, archiveDates);

    const outName = date === archiveDates[0] ? 'index.html' : `${date}.html`;
    await fs.writeFile(path.join(publicDir, outName), html, 'utf-8');
    console.log(`✅ 生成：public/${outName}`);
  }

  // 最新一篇也单独保存一份带日期名的文件（方便归档跳转）
  const latestDate = archiveDates[0];
  const latestMd = await fs.readFile(
    path.join(outputDir, `ai-daily-${latestDate}.md`), 'utf-8'
  );
  const latestBody = await marked(latestMd);
  const latestHtml = buildHtml(latestBody, latestDate, archiveDates);
  await fs.writeFile(
    path.join(publicDir, `${latestDate}.html`), latestHtml, 'utf-8'
  );

  console.log(`\n🎉 构建完成，共生成 ${mdFiles.length} 个页面`);
}

function buildHtml(body: string, activeDate: string, archiveDates: string[]): string {
  const archiveLinks = archiveDates
    .map(d => {
      const cls = d === activeDate ? 'archive-link active' : 'archive-link';
      const href = d === archiveDates[0] ? '/' : `/${d}.html`;
      return `<a href="${href}" class="${cls}">${d}</a>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🤖 AI 新闻日报 · ${activeDate}</title>
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
      ${archiveLinks}
    </aside>
  </div>
</body>
</html>`;
}

build().catch(err => {
  console.error('❌ 构建失败：', err);
  process.exit(1);
});

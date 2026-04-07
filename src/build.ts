import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: 'https://api.moonshot.cn/v1',
});

function getDateStr(): string {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = beijing.getUTCFullYear();
  const m = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getWeekDay(): string {
  const days = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return days[beijing.getUTCDay()];
}

async function generateNews(): Promise<string> {
  const today = getDateStr();
  const prompt = `你是一个AI科技日报编辑，请生成${today}的AI科技日报。

要求：
1. 包含5条今日最重要的AI/科技新闻
2. 每条新闻包含：标题、1-2句摘要、重要程度（用🔴🟡🟢表示高中低）
3. 最后加一句"今日洞察"，50字以内的行业观点
4. 语言简洁专业，面向科技从业者
5. 用JSON格式返回，结构如下：

{
  "news": [
    {
      "title": "新闻标题",
      "summary": "新闻摘要",
      "level": "🔴"
    }
  ],
  "insight": "今日洞察内容"
}`;

  const response = await client.chat.completions.create({
    model: 'moonshot-v1-8k',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  return response.choices[0].message.content || '{}';
}

function buildHTML(jsonStr: string, dateStr: string, weekDay: string): string {
  const data = JSON.parse(jsonStr);
  const news = data.news || [];
  const insight = data.insight || '';

  const newsHTML = news.map((item: any, index: number) => `
    <div class="news-card" style="animation-delay: ${index * 0.1}s">
      <div class="news-header">
        <span class="news-level">${item.level}</span>
        <span class="news-index">NO.${String(index + 1).padStart(2, '0')}</span>
      </div>
      <h3 class="news-title">${item.title}</h3>
      <p class="news-summary">${item.summary}</p>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 科技日报 · ${dateStr}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: #0c0e17;
      color: #e8eaf0;
      font-family: 'Noto Serif SC', 'PingFang SC', serif;
      min-height: 100vh;
      padding: 20px;
    }

    .container {
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 20px;
    }

    /* 顶部 header */
    .header {
      text-align: center;
      margin-bottom: 48px;
    }

    .header-label {
      font-size: 11px;
      letter-spacing: 4px;
      color: #7c6af7;
      text-transform: uppercase;
      margin-bottom: 16px;
    }

    .header-title {
      font-size: clamp(28px, 6vw, 48px);
      font-weight: 700;
      background: linear-gradient(135deg, #a78bfa, #60a5fa, #34d399);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      line-height: 1.2;
      margin-bottom: 12px;
    }

    .header-date {
      font-size: 14px;
      color: #6b7280;
      letter-spacing: 2px;
    }

    .divider {
      width: 60px;
      height: 2px;
      background: linear-gradient(90deg, #7c6af7, #60a5fa);
      margin: 24px auto;
      border-radius: 2px;
    }

    /* 新闻卡片 */
    .news-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 40px;
    }

    .news-card {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 16px;
      padding: 24px;
      transition: all 0.3s ease;
      animation: fadeUp 0.5s ease both;
    }

    .news-card:hover {
      background: rgba(124,106,247,0.08);
      border-color: rgba(124,106,247,0.3);
      transform: translateY(-2px);
    }

    .news-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .news-level {
      font-size: 18px;
    }

    .news-index {
      font-size: 11px;
      letter-spacing: 2px;
      color: #4b5563;
      font-family: 'JetBrains Mono', monospace;
    }

    .news-title {
      font-size: 17px;
      font-weight: 600;
      color: #f1f5f9;
      line-height: 1.5;
      margin-bottom: 10px;
    }

    .news-summary {
      font-size: 14px;
      color: #9ca3af;
      line-height: 1.8;
    }

    /* 今日洞察 */
    .insight-box {
      background: linear-gradient(135deg, rgba(124,106,247,0.12), rgba(96,165,250,0.08));
      border: 1px solid rgba(124,106,247,0.25);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 40px;
    }

    .insight-label {
      font-size: 11px;
      letter-spacing: 3px;
      color: #7c6af7;
      margin-bottom: 12px;
    }

    .insight-text {
      font-size: 16px;
      color: #c4b5fd;
      line-height: 1.8;
      font-style: italic;
    }

    /* 底部 */
    .footer {
      text-align: center;
      font-size: 12px;
      color: #374151;
      letter-spacing: 1px;
    }

    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    @media (max-width: 480px) {
      .container { padding: 24px 16px; }
      .news-card { padding: 18px; }
      .news-title { font-size: 15px; }
    }
  </style>
</head>
<body>
  <div class="container">

    <div class="header">
      <div class="header-label">INTELLIGENCE DAILY</div>
      <h1 class="header-title">AI 科技日报</h1>
      <div class="header-date">${dateStr} · ${weekDay}</div>
      <div class="divider"></div>
    </div>

    <div class="news-list">
      ${newsHTML}
    </div>

    <div class="insight-box">
      <div class="insight-label">✦ 今日洞察</div>
      <p class="insight-text">${insight}</p>
    </div>

    <div class="footer">
      YANG'S LAB · AI EDUCATION · ${dateStr}
    </div>

  </div>
</body>
</html>`;
}

async function main() {
  const dateStr = getDateStr();
  const weekDay = getWeekDay();

  console.log(`📰 正在生成 ${dateStr} 日报...`);

  const jsonStr = await generateNews();
  console.log('✅ 内容生成完成');

  const html = buildHTML(jsonStr, dateStr, weekDay);

  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist');
  }

  fs.writeFileSync(path.join('dist', 'index.html'), html, 'utf-8');
  console.log('✅ 文件写入 dist/index.html');
}

main().catch(console.error);

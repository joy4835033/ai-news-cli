import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { fetchAllSources } from './fetcher.js';
import { Article, RSSSource } from './types.js';

const client = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: 'https://api.moonshot.cn/v1',
});

const SOURCES: RSSSource[] = [
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
  { name: 'TheVerge',   url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'HackerNews', url: 'https://hnrss.org/frontpage' },
];

// ── 时间工具 ──────────────────────────────────────────
function getBeijingDate(): { dateStr: string; weekDay: string } {
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = beijing.getUTCFullYear();
  const m = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  const days = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
  return {
    dateStr: `${y}-${m}-${d}`,
    weekDay: days[beijing.getUTCDay()],
  };
}

// ── 文章过滤：只保留24小时内 ──────────────────────────
function filterRecent(articles: Article[]): Article[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return articles.filter(a => a.publishedAt.getTime() > cutoff);
}

// ── 序列化给 AI（只传必要字段，节省 token）─────────────
function articlesToPromptJson(articles: Article[]): string {
  const simplified = articles.map((a, i) => ({
    id: i + 1,
    title: a.title,
    summary: a.summary.slice(0, 200),   // 摘要最多200字
    source: a.source,
    time: a.publishedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  }));
  return JSON.stringify(simplified, null, 2);
}

// ── 调用 AI 分类整理 ──────────────────────────────────
async function generateSections(rawJson: string, dateStr: string): Promise<string> {
  const prompt = `你是一位专业的AI科技日报主编，今天是${dateStr}。

以下是今日抓取的原始新闻列表（JSON格式）：
${rawJson}

请根据这些新闻，生成一份结构化日报，严格按以下JSON格式返回，不要有任何多余内容：

{
  "cat1": {
    "highlights": [
      { "title": "新闻标题", "summary": "1-2句中文摘要" }
    ],
    "crossSector": "跨板块关联分析，100字以内",
    "startupAdvice": "创业方向建议，100字以内",
    "riskWarning": "风险预警，100字以内"
  },
  "cat2": [
    { "title": "行业动态标题", "summary": "中文摘要", "company": "相关企业名" }
  ],
  "cat3": [
    { "title": "投融资新闻标题", "summary": "中文摘要", "amount": "融资金额（如有）" }
  ],
  "cat4": [
    { "title": "技术突破标题", "summary": "中文摘要" }
  ],
  "cat5": [
    { "title": "产品上线标题", "summary": "中文摘要", "product": "产品名" }
  ],
  "cat6": [
    { "title": "AI教育资讯标题", "summary": "中文摘要" }
  ]
}

分类规则：
- cat1.highlights：选3-5条今日最重要新闻做摘录，标题翻译成中文
- cat2：行业头部企业动态，如 OpenAI / Google / Meta / Microsoft / Anthropic 等，选3-5条
- cat3：含融资、投资、估值、收购等关键词的新闻，选3-5条
- cat4：模型发布、算法突破、硬件革新等技术类新闻，选3-5条
- cat5：新产品/功能上线、App发布、平台更新，选3-5条
- cat6：AI教育、学习工具、在线课程、技能培训相关，选3-5条
- 某类没有相关内容则返回空数组 []
- 所有 title 和 summary 必须是中文
- 不要编造原始新闻中没有的内容`;

  const response = await client.chat.completions.create({
    model: 'moonshot-v1-8k',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  return response.choices[0].message.content || '{}';
}

// ── 生成手风琴列表 HTML ───────────────────────────────
function newsAccordion(items: any[], extraField?: string): string {
  if (!items.length) return '<p class="empty">暂无相关内容</p>';
  return items.map((item, i) => `
    <div class="acc-item">
      <button class="acc-title" onclick="toggle(this)">
        <span class="acc-index">${String(i + 1).padStart(2, '0')}</span>
        <span class="acc-text">${item.title}</span>
        <span class="acc-arrow">▸</span>
      </button>
      <div class="acc-body">
        <p>${item.summary || ''}</p>
        ${extraField && item[extraField] ? `<p class="acc-tag">📌 ${item[extraField]}</p>` : ''}
      </div>
    </div>
  `).join('');
}

// ── 拼装完整 HTML ─────────────────────────────────────
function buildHTML(jsonStr: string, dateStr: string, weekDay: string, total: number): string {
  const data = JSON.parse(jsonStr);

  const cat1 = data.cat1 || {};
  const highlights  = cat1.highlights || [];
  const cat2 = data.cat2 || [];
  const cat3 = data.cat3 || [];
  const cat4 = data.cat4 || [];
  const cat5 = data.cat5 || [];
  const cat6 = data.cat6 || [];

  const cat1HTML = `
    <div class="section" id="sec-1">
      <div class="sec-header">
        <span class="sec-icon">📋</span>
        <h2>综合要闻</h2>
        <span class="sec-count">今日收录 ${total} 篇</span>
      </div>

      <div class="sub-block">
        <div class="sub-title">📰 今日新闻摘录</div>
        ${newsAccordion(highlights)}
      </div>

      <div class="sub-block">
        <div class="sub-title">🔗 跨板块关联</div>
        <div class="text-card">${cat1.crossSector || '暂无分析'}</div>
      </div>

      <div class="sub-block">
        <div class="sub-title">🚀 创业方向建议</div>
        <div class="text-card highlight-card">${cat1.startupAdvice || '暂无建议'}</div>
      </div>

      <div class="sub-block">
        <div class="sub-title">⚠️ 风险预警</div>
        <div class="text-card warning-card">${cat1.riskWarning || '暂无预警'}</div>
      </div>
    </div>
  `;

  const sections = [
    { id: 2, icon: '🏭', title: '行业动态', items: cat2, extra: 'company' },
    { id: 3, icon: '💰', title: '投资融资', items: cat3, extra: 'amount'  },
    { id: 4, icon: '⚡', title: '技术突破', items: cat4                   },
    { id: 5, icon: '📦', title: '产品上线', items: cat5, extra: 'product' },
    { id: 6, icon: '🎓', title: 'AI 教育资讯', items: cat6               },
  ];

  const otherHTML = sections.map(s => `
    <div class="section" id="sec-${s.id}">
      <div class="sec-header">
        <span class="sec-icon">${s.icon}</span>
        <h2>${s.title}</h2>
        <span class="sec-count">${s.items.length} 条</span>
      </div>
      ${newsAccordion(s.items, s.extra)}
    </div>
  `).join('');

  const navItems = [
    { id: 1, icon: '📋', label: '综合要闻'  },
    { id: 2, icon: '🏭', label: '行业动态'  },
    { id: 3, icon: '💰', label: '投资融资'  },
    { id: 4, icon: '⚡', label: '技术突破'  },
    { id: 5, icon: '📦', label: '产品上线'  },
    { id: 6, icon: '🎓', label: 'AI 教育'   },
  ];

  const navHTML = navItems.map(n =>
    `<a href="#sec-${n.id}" class="nav-link">${n.icon} ${n.label}</a>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Joy 每日新闻播报 · ${dateStr}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f0f2f5; color: #1a1a2e; line-height: 1.75;
    }

    /* Header */
    header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      padding: 1.2rem 2rem;
      position: sticky; top: 0; z-index: 100;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    }
    .header-inner {
      max-width: 1200px; margin: 0 auto;
      display: flex; align-items: center; justify-content: space-between;
    }
    .header-brand { display: flex; align-items: center; gap: 12px; }
    .brand-logo {
      width: 38px; height: 38px; border-radius: 9px;
      background: linear-gradient(135deg, #e94560, #0f3460);
      display: flex; align-items: center; justify-content: center; font-size: 20px;
    }
    .brand-name  { font-size: 1.15rem; font-weight: 700; color: #fff; letter-spacing: 1px; }
    .brand-sub   { font-size: 0.72rem; color: #a0aec0; letter-spacing: 2px; margin-top: 2px; }
    .header-date { text-align: right; }
    .date-main   { font-size: 1rem; font-weight: 600; color: #e2e8f0; }
    .date-week   { font-size: 0.78rem; color: #a0aec0; margin-top: 2px; }

    /* Layout */
    .layout {
      max-width: 1200px; margin: 2rem auto; padding: 0 1.5rem;
      display: grid; grid-template-columns: 175px 1fr;
      gap: 1.5rem; align-items: start;
    }

    /* Sidenav */
    .sidenav {
      background: #fff; border-radius: 14px; padding: 1.2rem;
      box-shadow: 0 1px 6px rgba(0,0,0,0.06);
      position: sticky; top: 80px;
    }
    .sidenav-title {
      font-size: 0.7rem; font-weight: 700; color: #a0aec0;
      letter-spacing: 2px; text-transform: uppercase;
      margin-bottom: 0.8rem; padding-bottom: 0.6rem;
      border-bottom: 1px solid #f0f0f0;
    }
    .nav-link {
      display: block; padding: 0.5rem 0.7rem; border-radius: 8px;
      font-size: 0.87rem; color: #4a5568; text-decoration: none;
      transition: all 0.2s; margin-bottom: 2px;
    }
    .nav-link:hover { background: #ebf4ff; color: #2b6cb0; }

    /* Section */
    .main-content { display: flex; flex-direction: column; gap: 1.5rem; }
    .section {
      background: #fff; border-radius: 14px; padding: 1.8rem 2rem;
      box-shadow: 0 1px 6px rgba(0,0,0,0.06);
    }
    .sec-header {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 1.4rem; padding-bottom: 0.8rem;
      border-bottom: 2px solid #ebf4ff;
    }
    .sec-icon  { font-size: 1.3rem; }
    .sec-header h2 { font-size: 1.05rem; font-weight: 700; color: #1a1a2e; flex: 1; }
    .sec-count { font-size: 0.75rem; color: #a0aec0; background: #f7fafc;
                 padding: 2px 10px; border-radius: 20px; }

    /* Sub block */
    .sub-block { margin-bottom: 1.4rem; }
    .sub-block:last-child { margin-bottom: 0; }
    .sub-title {
      font-size: 0.84rem; font-weight: 700; color: #2d3748;
      margin-bottom: 0.7rem; padding: 0.3rem 0.8rem;
      background: #f7fafc; border-left: 3px solid #4299e1;
      border-radius: 0 6px 6px 0;
    }

    /* Text cards */
    .text-card {
      background: #f7fafc; border-radius: 10px;
      padding: 1rem 1.2rem; font-size: 0.92rem;
      color: #4a5568; line-height: 1.8;
    }
    .highlight-card {
      background: linear-gradient(135deg, #ebf8ff, #e6fffa);
      border: 1px solid #bee3f8; color: #2c5282;
    }
    .warning-card {
      background: linear-gradient(135deg, #fffaf0, #fff5f5);
      border: 1px solid #fbd38d; color: #744210;
    }

    /* Accordion */
    .acc-item {
      border: 1px solid #e8ecf0; border-radius: 10px;
      margin-bottom: 8px; overflow: hidden; transition: box-shadow 0.2s;
    }
    .acc-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .acc-title {
      width: 100%; display: flex; align-items: center; gap: 10px;
      padding: 0.85rem 1rem; background: #fafbfc;
      border: none; cursor: pointer; text-align: left; transition: background 0.2s;
    }
    .acc-title:hover, .acc-title.open { background: #ebf4ff; }
    .acc-index { font-size: 0.7rem; font-weight: 700; color: #a0aec0; letter-spacing: 1px; flex-shrink: 0; }
    .acc-text  { flex: 1; font-size: 0.93rem; font-weight: 600; color: #2d3748; line-height: 1.5; }
    .acc-arrow { font-size: 0.8rem; color: #a0aec0; transition: transform 0.25s; flex-shrink: 0; }
    .acc-title.open .acc-arrow { transform: rotate(90deg); }
    .acc-body {
      display: none; padding: 0.9rem 1rem 1rem 2.8rem;
      background: #fff; border-top: 1px solid #e8ecf0;
      font-size: 0.88rem; color: #718096; line-height: 1.8;
    }
    .acc-body.open { display: block; }
    .acc-tag { margin-top: 0.5rem; font-size: 0.82rem; color: #4299e1; font-weight: 600; }

    .empty { font-size: 0.88rem; color: #a0aec0; padding: 0.5rem 0; }

    footer {
      text-align: center; padding: 2rem;
      font-size: 0.78rem; color: #a0aec0; letter-spacing: 1px;
    }

    /* Mobile */
    @media (max-width: 768px) {
      .layout { grid-template-columns: 1fr; }
      .sidenav { position: static; display: flex; flex-wrap: wrap; gap: 6px; padding: 1rem; }
      .sidenav-title { width: 100%; }
      .nav-link { padding: 0.4rem 0.8rem; background: #f0f2f5; border-radius: 20px; font-size: 0.82rem; }
      .section { padding: 1.2rem; }
      .header-inner { flex-direction: column; gap: 8px; text-align: center; }
      .header-date { text-align: center; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="header-brand">
      <div class="brand-logo">📡</div>
      <div>
        <div class="brand-name">Joy 每日新闻播报</div>
        <div class="brand-sub">AI · TECH · INSIGHT</div>
      </div>
    </div>
    <div class="header-date">
      <div class="date-main">${dateStr}</div>
      <div class="date-week">${weekDay}</div>
    </div>
  </div>
</header>

<div class="layout">
  <nav class="sidenav">
    <div class="sidenav-title">栏目导航</div>
    ${navHTML}
  </nav>
  <main class="main-content">
    ${cat1HTML}
    ${otherHTML}
  </main>
</div>

<footer>Joy 每日新闻播报 · ${dateStr} · Powered by Moonshot AI</footer>

<script>
  function toggle(btn) {
    btn.classList.toggle('open');
    btn.nextElementSibling.classList.toggle('open');
  }
</script>

</body>
</html>`;
}

// ── 主流程 ────────────────────────────────────────────
async function main() {
  const { dateStr, weekDay } = getBeijingDate();
  console.log(`📰 正在生成 ${dateStr} 日报...`);

  // 1. 抓取原始新闻
  console.log('🌐 正在抓取新闻源...');
  const allArticles = await fetchAllSources(SOURCES);
  const recent = filterRecent(allArticles);
  console.log(`✅ 抓取完成，24小时内有效文章：${recent.length} 篇`);

  if (recent.length === 0) {
    console.warn('⚠️  没有抓取到任何文章，请检查网络或 RSS 源');
    process.exit(1);
  }

  // 2. AI 分类整理
  console.log('🤖 正在调用 AI 分类整理...');
  const promptJson = articlesToPromptJson(recent);
  const jsonStr = await generateSections(promptJson, dateStr);
  console.log('✅ AI 整理完成');

  // 3. 生成 HTML
  const html = buildHTML(jsonStr, dateStr, weekDay, recent.length);
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync(path.join('dist', 'index.html'), html, 'utf-8');
  console.log('✅ 文件写入 dist/index.html 成功');
}

main().catch(err => {
  console.error('❌ 构建失败：', err);
  process.exit(1);
});

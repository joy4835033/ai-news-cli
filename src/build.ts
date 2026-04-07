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

// ── 序列化给 AI ───────────────────────────────────────
function articlesToPromptJson(articles: Article[]): string {
  const simplified = articles.map((a, i) => ({
    id: i + 1,
    title: a.title,
    summary: a.summary.slice(0, 200),
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
      { "title": "新闻标题", "summary": "50-100字的中文摘要，需包含事件背景、核心内容和影响，语言简洁专业" }
    ],
    "crossSector": "跨板块关联分析，100字以内",
    "startupAdvice": "创业方向建议，100字以内",
    "riskWarning": "风险预警，100字以内"
  },
  "cat2": [
    { "title": "行业动态标题", "summary": "50-100字的中文摘要，需包含事件背景、核心内容和影响，语言简洁专业", "company": "相关企业名" }
  ],
  "cat3": [
    { "title": "投融资新闻标题", "summary": "50-100字的中文摘要，需包含融资方、投资方、金额用途及行业意义", "amount": "融资金额（如有）" }
  ],
  "cat4": [
    { "title": "技术突破标题", "summary": "50-100字的中文摘要，需包含技术原理、突破点和应用前景" }
  ],
  "cat5": [
    { "title": "产品上线标题", "summary": "50-100字的中文摘要，需包含产品功能、目标用户和市场定位", "product": "产品名" }
  ],
  "cat6": [
    { "title": "AI教育资讯标题", "summary": "50-100字的中文摘要，需包含内容特点、受众群体和教育价值" }
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
- summary 字数严格控制在50-100字之间，不得少于50字
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
        <span class="acc-arrow">›</span>
      </button>
      <div class="acc-body">
        <p>${item.summary || ''}</p>
        ${extraField && item[extraField] ? `<span class="acc-tag">${item[extraField]}</span>` : ''}
      </div>
    </div>
  `).join('');
}

// ── 拼装完整 HTML ─────────────────────────────────────
function buildHTML(jsonStr: string, dateStr: string, weekDay: string, total: number): string {
  const data = JSON.parse(jsonStr);

  const cat1 = data.cat1 || {};
  const highlights = cat1.highlights || [];
  const cat2 = data.cat2 || [];
  const cat3 = data.cat3 || [];
  const cat4 = data.cat4 || [];
  const cat5 = data.cat5 || [];
  const cat6 = data.cat6 || [];

  const cat1HTML = `
    <div class="section" id="sec-1">
      <div class="sec-header">
        <h2><span class="sec-icon">📋</span>综合要闻</h2>
        <span class="sec-badge">${total} 篇</span>
      </div>
      <div class="sub-block">
        <div class="sub-label">今日新闻摘录</div>
        ${newsAccordion(highlights)}
      </div>
      <div class="insight-grid">
        <div class="insight-card">
          <div class="insight-label">🔗 跨板块关联</div>
          <div class="insight-text">${cat1.crossSector || '暂无分析'}</div>
        </div>
        <div class="insight-card accent-blue">
          <div class="insight-label">🚀 创业方向建议</div>
          <div class="insight-text">${cat1.startupAdvice || '暂无建议'}</div>
        </div>
        <div class="insight-card accent-amber">
          <div class="insight-label">⚠️ 风险预警</div>
          <div class="insight-text">${cat1.riskWarning || '暂无预警'}</div>
        </div>
      </div>
    </div>
  `;

  const sections = [
    { id: 2, icon: '🏭', title: '行业动态',   items: cat2, extra: 'company' },
    { id: 3, icon: '💰', title: '投资融资',   items: cat3, extra: 'amount'  },
    { id: 4, icon: '⚡', title: '技术突破',   items: cat4                   },
    { id: 5, icon: '📦', title: '产品上线',   items: cat5, extra: 'product' },
    { id: 6, icon: '🎓', title: 'AI 教育资讯', items: cat6                  },
  ];

  const otherHTML = sections.map(s => `
    <div class="section" id="sec-${s.id}">
      <div class="sec-header">
        <h2><span class="sec-icon">${s.icon}</span>${s.title}</h2>
        <span class="sec-badge">${s.items.length} 条</span>
      </div>
      ${newsAccordion(s.items, s.extra)}
    </div>
  `).join('');

  const navItems = [
    { id: 1, icon: '📋', label: '综合要闻'   },
    { id: 2, icon: '🏭', label: '行业动态'   },
    { id: 3, icon: '💰', label: '投资融资'   },
    { id: 4, icon: '⚡', label: '技术突破'   },
    { id: 5, icon: '📦', label: '产品上线'   },
    { id: 6, icon: '🎓', label: 'AI 教育'    },
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

    :root {
      --primary:   #1a3a5c;
      --accent:    #2563eb;
      --border:    #e2e8f0;
      --bg:        #f4f6f9;
      --surface:   #ffffff;
      --text-main: #1e293b;
      --text-sub:  #64748b;
      --text-mute: #94a3b8;
      --radius:    10px;
    }

    body {
      font-family: 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.75;
      font-size: 14px;
    }

    /* ── Header ── */
    header {
      background: var(--primary);
      padding: 0 2rem;
      height: 60px;
      display: flex;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 100;
      border-bottom: 3px solid var(--accent);
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .brand-mark {
      width: 32px; height: 32px;
      background: var(--accent);
      border-radius: 6px;
      display: flex; align-items: center; justify-content: center;
      font-size: 16px;
    }
    .brand-name {
      font-size: 1rem;
      font-weight: 700;
      color: #fff;
      letter-spacing: 0.5px;
    }
    .brand-sub {
      font-size: 0.68rem;
      color: #93c5fd;
      letter-spacing: 2px;
      margin-top: 1px;
    }
    .header-date {
      text-align: right;
    }
    .date-main { font-size: 0.9rem; font-weight: 600; color: #e2e8f0; }
    .date-week { font-size: 0.72rem; color: #93c5fd; margin-top: 1px; }

    /* ── Layout ── */
    .layout {
      max-width: 1200px;
      margin: 1.5rem auto;
      padding: 0 1.5rem;
      display: grid;
      grid-template-columns: 160px 1fr;
      gap: 1.5rem;
      align-items: start;
    }

    /* ── Sidenav ── */
    .sidenav {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 0.75rem;
      position: sticky;
      top: 72px;
    }
    .sidenav-title {
      font-size: 0.65rem;
      font-weight: 700;
      color: var(--text-mute);
      letter-spacing: 2px;
      text-transform: uppercase;
      padding: 0 0.4rem 0.6rem;
      border-bottom: 1px solid var(--border);
      margin-bottom: 0.5rem;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0.45rem 0.6rem;
      border-radius: 6px;
      font-size: 0.83rem;
      color: var(--text-sub);
      text-decoration: none;
      transition: all 0.15s;
      margin-bottom: 2px;
    }
    .nav-link:hover {
      background: #eff6ff;
      color: var(--accent);
    }

    /* ── Section ── */
    .main-content { display: flex; flex-direction: column; gap: 1.25rem; }
    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.5rem 1.75rem;
    }
    .sec-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--border);
    }
    .sec-header h2 {
      font-size: 0.97rem;
      font-weight: 700;
      color: var(--primary);
      display: flex;
      align-items: center;
      gap: 7px;
    }
    .sec-icon { font-size: 1rem; }
    .sec-badge {
      font-size: 0.7rem;
      color: var(--text-mute);
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 2px 10px;
      border-radius: 20px;
    }

    /* ── Sub label ── */
    .sub-block { margin-bottom: 1.25rem; }
    .sub-block:last-child { margin-bottom: 0; }
    .sub-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-sub);
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 0.75rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px dashed var(--border);
    }

    /* ── Insight grid ── */
    .insight-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-top: 1rem;
    }
    .insight-card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.1rem;
      background: var(--bg);
    }
    .insight-card.accent-blue {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .insight-card.accent-amber {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .insight-label {
      font-size: 0.75rem;
      font-weight: 700;
      color: var(--text-sub);
      margin-bottom: 0.5rem;
    }
    .insight-text {
      font-size: 0.85rem;
      color: var(--text-main);
      line-height: 1.75;
    }

    /* ── Accordion ── */
    .acc-item {
      border: 1px solid var(--border);
      border-radius: 8px;
      margin-bottom: 6px;
      overflow: hidden;
    }
    .acc-title {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0.75rem 1rem;
      background: var(--surface);
      border: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.15s;
    }
    .acc-title:hover,
    .acc-title.open {
      background: #f8faff;
    }
    .acc-index {
      font-size: 0.65rem;
      font-weight: 700;
      color: var(--accent);
      background: #eff6ff;
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      letter-spacing: 0.5px;
    }
    .acc-text {
      flex: 1;
      font-size: 0.88rem;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.5;
    }
    .acc-arrow {
      font-size: 1.1rem;
      color: var(--text-mute);
      transition: transform 0.2s;
      flex-shrink: 0;
      line-height: 1;
    }
    .acc-title.open .acc-arrow { transform: rotate(90deg); }
    .acc-body {
      display: none;
      padding: 0.85rem 1rem 0.9rem 2.6rem;
      background: #fafbfd;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
      color: var(--text-sub);
      line-height: 1.85;
    }
    .acc-body.open { display: block; }
    .acc-tag {
      display: inline-block;
      margin-top: 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--accent);
      background: #eff6ff;
      padding: 2px 8px;
      border-radius: 4px;
    }

    .empty {
      font-size: 0.85rem;
      color: var(--text-mute);
      padding: 0.5rem 0;
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      padding: 2rem;
      font-size: 0.72rem;
      color: var(--text-mute);
      letter-spacing: 1px;
      border-top: 1px solid var(--border);
      margin-top: 1rem;
    }

    /* ── Mobile ── */
    @media (max-width: 768px) {
      .layout { grid-template-columns: 1fr; }
      .sidenav {
        position: static;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        padding: 0.75rem;
      }
      .sidenav-title { width: 100%; }
      .nav-link {
        padding: 0.35rem 0.75rem;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 20px;
        font-size: 0.78rem;
      }
      .section { padding: 1.1rem 1.2rem; }
      .insight-grid { grid-template-columns: 1fr; }
      header { padding: 0 1rem; }
      .header-inner { gap: 8px; }
    }
  </style>
</head>
<body>

<header>
  <div class="header-inner">
    <div class="brand">
      <div class="brand-mark">📡</div>
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

  console.log('🌐 正在抓取新闻源...');
  const allArticles = await fetchAllSources(SOURCES);
  const recent = filterRecent(allArticles);
  console.log(`✅ 抓取完成，24小时内有效文章：${recent.length} 篇`);

  if (recent.length === 0) {
    console.warn('⚠️  没有抓取到任何文章，请检查网络或 RSS 源');
    process.exit(1);
  }

  console.log('🤖 正在调用 AI 分类整理...');
  const promptJson = articlesToPromptJson(recent);
  const jsonStr = await generateSections(promptJson, dateStr);
  console.log('✅ AI 整理完成');

  const html = buildHTML(jsonStr, dateStr, weekDay, recent.length);
  fs.mkdirSync('dist', { recursive: true });
  fs.writeFileSync(path.join('dist', 'index.html'), html, 'utf-8');
  console.log('✅ 文件写入 dist/index.html 成功');
}

main().catch(err => {
  console.error('❌ 构建失败：', err);
  process.exit(1);
});

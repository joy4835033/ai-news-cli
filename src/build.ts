import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import { fetchAllSources } from './fetcher.js';
import { Article, RSSSource } from './types.js';

const client = new OpenAI({
  apiKey: process.env.MOONSHOT_API_KEY,
  baseURL: 'https://api.moonshot.cn/v1',
});

// ── 信源（分三梯队）────────────────────────────────────
const SOURCES: RSSSource[] = [
  // 第一梯队：官方/一手信源
  { name: 'OpenAI Blog',    url: 'https://openai.com/blog/rss.xml',                                          tier: 1 },
  { name: 'Anthropic',      url: 'https://www.anthropic.com/rss.xml',                                        tier: 1 },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/',                                   tier: 1 },
  { name: 'DeepMind',       url: 'https://deepmind.google/blog/rss.xml',                                     tier: 1 },
  { name: 'Meta AI',        url: 'https://ai.meta.com/blog/rss/',                                            tier: 1 },

  // 第二梯队：高质量媒体
  { name: 'TechCrunch',     url: 'https://techcrunch.com/category/artificial-intelligence/feed/',            tier: 2 },
  { name: 'TheVerge',       url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml',        tier: 2 },
  { name: 'MIT Tech Review',url: 'https://www.technologyreview.com/feed/',                                   tier: 2 },
  { name: 'VentureBeat AI', url: 'https://venturebeat.com/category/ai/feed/',                                tier: 2 },
  { name: 'Wired AI',       url: 'https://www.wired.com/feed/tag/ai/latest/rss',                             tier: 2 },
  { name: '机器之心',        url: 'https://www.jiqizhixin.com/rss',                                           tier: 2 },

  // 第三梯队：补充信源
  { name: 'HackerNews',     url: 'https://hnrss.org/frontpage',                                              tier: 3 },
  { name: 'AI News',        url: 'https://artificialintelligence-news.com/feed/',                            tier: 3 },
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
    dateStr: y + '-' + m + '-' + d,
    weekDay: days[beijing.getUTCDay()],
  };
}

// ── 过滤24小时内 ──────────────────────────────────────
function filterRecent(articles: Article[]): Article[] {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return articles.filter(a => a.publishedAt.getTime() > cutoff);
}

// ── 评分筛选（真实性 × 新鲜度）────────────────────────
function scoreAndFilter(articles: Article[]): Article[] {
  const now = Date.now();
  const scored = articles.map(a => {
    // 真实性：梯队越高分越高
    const truthScore = a.tier === 1 ? 1.0 : a.tier === 2 ? 0.7 : 0.4;
    // 新鲜度：24h内线性衰减
    const ageHours = (now - a.publishedAt.getTime()) / (1000 * 60 * 60);
    const freshnessScore = Math.max(0, 1 - ageHours / 24);
    const score = truthScore * 0.5 + freshnessScore * 0.5;
    return { ...a, score };
  });
  // 按分数排序，取前60条（控制 token 用量）
  return scored
    .sort((a, b) => (b as any).score - (a as any).score)
    .slice(0, 60);
}

// ── 序列化给 AI ───────────────────────────────────────
function articlesToPromptJson(articles: Article[]): string {
  const simplified = articles.map((a, i) => ({
    id:      i + 1,
    title:   a.title,
    summary: a.summary.slice(0, 300),
    source:  a.source,
    tier:    a.tier,
    url:     a.link,
    time:    a.publishedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  }));
  return JSON.stringify(simplified, null, 2);
}

// ── 调用 AI 分类整理 ──────────────────────────────────
async function generateSections(rawJson: string, dateStr: string): Promise<string> {
  const prompt =
    '你是一位专业的AI科技日报主编，今天是' + dateStr + '。\n\n'
  + '以下是今日抓取的原始新闻列表（JSON格式），每条包含 tier 字段（1=官方一手，2=优质媒体，3=补充信源）：\n'
  + rawJson + '\n\n'
  + '请根据这些新闻生成结构化日报，严格按以下JSON格式返回，不要有任何多余内容。\n\n'
  + '【重要】每条新闻的 summary 字段必须严格满足：\n'
  + '1. 字数：80到120个中文字符，绝对不能少于80字\n'
  + '2. 内容：第一句说明事件是什么，第二句说明背景或原因，第三句说明影响或意义\n'
  + '3. 语言：简洁专业，不使用"该公司""此次"等模糊表达，直接说主语\n'
  + '4. 禁止：不得只写一句话，不得少于三句话\n'
  + '5. url 字段：直接复制原始新闻中对应的 url 值，不得修改或编造\n\n'
  + '返回格式：\n'
  + '{\n'
  + '  "cat1": {\n'
  + '    "highlights": [\n'
  + '      { "title": "中文标题", "summary": "80-120字三句话摘要", "url": "原文链接" }\n'
  + '    ],\n'
  + '    "crossSector":    "跨板块关联分析100字以内",\n'
  + '    "startupAdvice":  "创业方向建议100字以内",\n'
  + '    "riskWarning":    "风险预警100字以内"\n'
  + '  },\n'
  + '  "cat2": [\n'
  + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "company": "企业名", "url": "原文链接" }\n'
  + '  ],\n'
  + '  "cat3": [\n'
  + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "amount": "融资金额", "url": "原文链接" }\n'
  + '  ],\n'
  + '  "cat4": [\n'
  + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "url": "原文链接" }\n'
  + '  ],\n'
  + '  "cat5": [\n'
  + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "product": "产品名", "url": "原文链接" }\n'
  + '  ],\n'
  + '  "cat6": [\n'
  + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "url": "原文链接" }\n'
  + '  ],\n'
  + '  "cat7": [\n'
  + '    { "title": "机会标题", "summary": "80-120字机会拆解，说明适合人群、切入点、变现方式", "direction": "方向标签", "url": "原文链接" }\n'
  + '  ]\n'
  + '}\n\n'
  + '分类规则：\n'
  + '- cat1.highlights：今日最重要3-5条，优先选 tier=1 的内容，标题译成中文\n'
  + '- cat2：OpenAI/Google/Meta/Microsoft/Anthropic等头部企业动态，3-5条\n'
  + '- cat3：融资/投资/估值/收购新闻，3-5条\n'
  + '- cat4：模型发布/算法突破/硬件革新，3-5条\n'
  + '- cat5：新产品/功能上线/App发布/平台更新，3-5条\n'
  + '- cat6：AI教育/学习工具/在线课程/技能培训，3-5条\n'
  + '- cat7：从今日新闻中提炼3-5条适合普通人的AI副业或创业机会，给出具体方向标签\n'
  + '- 无相关内容返回空数组[]\n'
  + '- 所有 title 和 summary 必须是中文\n'
  + '- 不得编造原始新闻中没有的内容';

  const response = await client.chat.completions.create({
    model: 'moonshot-v1-32k',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  return response.choices[0].message.content || '{}';
}

// ── 手风琴列表 HTML ───────────────────────────────────
// 原文链接放在 acc-body 底部，折叠内不展示在外面
function newsAccordion(items: any[], extraField?: string): string {
  if (!items.length) return '<div class="empty">· 暂无相关内容 ·</div>';
  return items.map((item, i) => {
    const idx = String(i + 1).padStart(2, '0');

    // 额外标签（company / amount / product / direction）
    const extra = extraField && item[extraField]
      ? '<span class="acc-tag">' + item[extraField] + '</span>'
      : '';

    // 原文链接：放在摘要下方，只在展开后可见
    const sourceLink = item.url
      ? '<a href="' + item.url + '" target="_blank" rel="noopener" class="acc-source-link">'
          + '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="vertical-align:-1px;margin-right:4px">'
          + '<path d="M7 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V9M10 2h4m0 0v4m0-4L7 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
          + '</svg>'
          + '查看原文'
        + '</a>'
      : '';

    return (
      '<details class="acc-item">' +
        '<summary class="acc-title">' +
          '<span class="acc-index">' + idx + '</span>' +
          '<span class="acc-text">' + item.title + '</span>' +
          '<span class="acc-arrow">' +
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
              '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
          '</span>' +
        '</summary>' +
        '<div class="acc-body">' +
          '<p class="acc-summary">' + (item.summary || '') + '</p>' +
          '<div class="acc-footer">' +
            extra +
            sourceLink +
          '</div>' +
        '</div>' +
      '</details>'
    );
  }).join('');
}

// ── 拼装完整 HTML ─────────────────────────────────────
function buildHTML(jsonStr: string, dateStr: string, weekDay: string, total: number): string {
  const data = JSON.parse(jsonStr);

  const cat1       = data.cat1 || {};
  const highlights = cat1.highlights || [];
  const cat2 = data.cat2 || [];
  const cat3 = data.cat3 || [];
  const cat4 = data.cat4 || [];
  const cat5 = data.cat5 || [];
  const cat6 = data.cat6 || [];
  const cat7 = data.cat7 || [];

  // ── 要点整理 section ──
  const cat1HTML =
    '<section class="section" id="sec-1">' +
      '<div class="sec-header">' +
        '<div class="sec-header-left">' +
          '<span class="sec-icon">🔮</span>' +
          '<h2>要点整理</h2>' +
        '</div>' +
        '<span class="sec-badge">今日收录 ' + total + ' 篇</span>' +
      '</div>' +
      '<div class="sub-block">' +
        '<div class="sub-label">今日新闻摘录</div>' +
        newsAccordion(highlights) +
      '</div>' +
      '<div class="insight-grid">' +
        '<div class="insight-card">' +
          '<div class="insight-label"><span class="insight-dot dot-purple"></span>跨板块关联</div>' +
          '<div class="insight-text">' + (cat1.crossSector   || '暂无分析') + '</div>' +
        '</div>' +
        '<div class="insight-card accent-cyan">' +
          '<div class="insight-label"><span class="insight-dot dot-cyan"></span>创业方向建议</div>' +
          '<div class="insight-text">' + (cat1.startupAdvice || '暂无建议') + '</div>' +
        '</div>' +
        '<div class="insight-card accent-pink">' +
          '<div class="insight-label"><span class="insight-dot dot-pink"></span>风险预警</div>' +
          '<div class="insight-text">' + (cat1.riskWarning   || '暂无预警') + '</div>' +
        '</div>' +
      '</div>' +
    '</section>';

  // ── 其他 sections ──
  const sections = [
    { id: 2, icon: '🏭', title: '行业动态',    items: cat2, extra: 'company'   },
    { id: 3, icon: '💰', title: '投资融资',    items: cat3, extra: 'amount'    },
    { id: 4, icon: '⚡', title: '技术突破',    items: cat4, extra: ''          },
    { id: 5, icon: '📦', title: '产品上线',    items: cat5, extra: 'product'   },
    { id: 6, icon: '🎓', title: 'AI 教育资讯', items: cat6, extra: ''          },
    { id: 7, icon: '🚀', title: '创业机会',    items: cat7, extra: 'direction' },
  ];

  const otherHTML = sections.map(s =>
    '<section class="section" id="sec-' + s.id + '">' +
      '<div class="sec-header">' +
        '<div class="sec-header-left">' +
          '<span class="sec-icon">' + s.icon + '</span>' +
          '<h2>' + s.title + '</h2>' +
        '</div>' +
        '<span class="sec-badge">' + s.items.length + ' 条</span>' +
      '</div>' +
      newsAccordion(s.items, s.extra || undefined) +
    '</section>'
  ).join('');

  // ── 导航 ──
  const navItems = [
    { id: 1, icon: '🔮', label: '要点整理' },
    { id: 2, icon: '🏭', label: '行业动态' },
    { id: 3, icon: '💰', label: '投资融资' },
    { id: 4, icon: '⚡', label: '技术突破' },
    { id: 5, icon: '📦', label: '产品上线' },
    { id: 6, icon: '🎓', label: 'AI 教育'  },
    { id: 7, icon: '🚀', label: '创业机会' },
  ];

  const navHTML = navItems.map(n =>
    '<a href="#sec-' + n.id + '" class="nav-link">' +
      '<span class="nav-icon">' + n.icon + '</span>' +
      '<span>' + n.label + '</span>' +
    '</a>'
  ).join('');

  // ── CSS ──
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;700&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #0a0a0f;
      --bg2:       #0f0f1a;
      --card:      #13131f;
      --border:    #1e1e35;
      --border2:   #252540;
      --accent:    #7c6aff;
      --cyan:      #00e5ff;
      --pink:      #ff6b9d;
      --text:      #e8e8f0;
      --muted:     #6b6b8a;
      --muted2:    #4a4a6a;
      --radius-lg: 12px;
      --radius-md: 8px;
      --radius-sm: 5px;
    }

    body {
      font-family: 'Noto Sans SC', 'Space Grotesk', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ══ HEADER ══ */
    header {
      background: rgba(10,10,15,0.95);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
      height: 64px;
      display: flex; align-items: center; padding: 0 2rem;
      position: sticky; top: 0; z-index: 200;
    }
    header::after {
      content: '';
      position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
      background: linear-gradient(90deg, transparent, var(--accent), var(--cyan), var(--accent), transparent);
    }
    .header-inner {
      max-width: 1240px; margin: 0 auto; width: 100%;
      display: flex; align-items: center; justify-content: space-between;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, var(--accent) 0%, #5b4fd4 100%);
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
      font-size: 17px;
      box-shadow: 0 0 16px rgba(124,106,255,0.4);
      flex-shrink: 0;
    }
    .brand-name { font-size: 1rem; font-weight: 700; color: var(--text); letter-spacing: 0.3px; }
    .brand-sub  { font-size: 0.62rem; color: var(--muted); letter-spacing: 3px; margin-top: 2px; }
    .header-right { display: flex; align-items: center; gap: 1.5rem; }
    .header-date-block { text-align: right; }
    .date-main { font-size: 0.88rem; font-weight: 600; color: var(--text); font-family: 'Space Grotesk', monospace; }
    .date-week { font-size: 0.65rem; color: var(--muted); margin-top: 2px; letter-spacing: 2px; }
    .header-divider { width: 1px; height: 28px; background: var(--border2); }
    .header-tag {
      font-size: 0.65rem; font-weight: 600; color: var(--cyan);
      border: 1px solid rgba(0,229,255,0.3); background: rgba(0,229,255,0.06);
      padding: 3px 10px; border-radius: 20px; letter-spacing: 2px;
    }

    /* ══ LAYOUT ══ */
    .layout {
      max-width: 1240px; margin: 1.75rem auto;
      padding: 0 1.5rem;
      display: grid; grid-template-columns: 172px 1fr;
      gap: 1.5rem; align-items: start;
    }

    /* ══ SIDENAV ══ */
    .sidenav {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius-lg); padding: 1rem 0.75rem;
      position: sticky; top: 76px;
    }
    .sidenav-title {
      font-size: 0.6rem; font-weight: 700; color: var(--muted2);
      letter-spacing: 3px; text-transform: uppercase;
      padding: 0 0.5rem 0.65rem;
      border-bottom: 1px solid var(--border); margin-bottom: 0.6rem;
    }
    .nav-link {
      display: flex; align-items: center; gap: 8px;
      padding: 0.5rem 0.65rem; border-radius: var(--radius-sm);
      font-size: 0.82rem; font-weight: 500;
      color: var(--muted); text-decoration: none;
      transition: all 0.15s ease; margin-bottom: 2px;
    }
    .nav-link:hover { background: rgba(124,106,255,0.1); color: var(--accent); }
    .nav-icon { font-size: 0.9rem; flex-shrink: 0; }

    /* ══ SECTIONS ══ */
    .main-content { display: flex; flex-direction: column; gap: 1.25rem; }
    .section {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius-lg); padding: 1.6rem 1.8rem;
      transition: border-color 0.2s;
    }
    .section:hover { border-color: var(--border2); }
    .sec-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 1.3rem; padding-bottom: 0.9rem;
      border-bottom: 1px solid var(--border);
    }
    .sec-header-left { display: flex; align-items: center; gap: 9px; }
    .sec-icon { font-size: 1.05rem; }
    .sec-header h2 { font-size: 0.95rem; font-weight: 700; color: var(--text); letter-spacing: 0.5px; }
    .sec-badge {
      font-size: 0.65rem; font-weight: 600; color: var(--muted);
      background: var(--bg2); border: 1px solid var(--border);
      padding: 3px 11px; border-radius: 20px; letter-spacing: 1px;
    }

    /* ══ SUB LABEL ══ */
    .sub-block { margin-bottom: 1.3rem; }
    .sub-block:last-child { margin-bottom: 0; }
    .sub-label {
      font-size: 0.62rem; font-weight: 700; color: var(--muted2);
      text-transform: uppercase; letter-spacing: 3px;
      margin-bottom: 0.8rem;
      display: flex; align-items: center; gap: 8px;
    }
    .sub-label::after { content: ''; flex: 1; height: 1px; background: var(--border); }

    /* ══ INSIGHT GRID ══ */
    .insight-grid {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 1rem; margin-top: 1.1rem;
    }
    .insight-card {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: 1.1rem 1.2rem; background: var(--bg2);
    }
    .insight-card.accent-cyan  { background: rgba(0,229,255,0.04);  border-color: rgba(0,229,255,0.2); }
    .insight-card.accent-pink  { background: rgba(255,107,157,0.04); border-color: rgba(255,107,157,0.2); }
    .insight-label {
      font-size: 0.68rem; font-weight: 700; color: var(--muted);
      margin-bottom: 0.6rem; display: flex; align-items: center; gap: 6px; letter-spacing: 1px;
    }
    .insight-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .dot-purple { background: var(--accent); box-shadow: 0 0 6px rgba(124,106,255,0.6); }
    .dot-cyan   { background: var(--cyan);   box-shadow: 0 0 6px rgba(0,229,255,0.6); }
    .dot-pink   { background: var(--pink);   box-shadow: 0 0 6px rgba(255,107,157,0.6); }
    .insight-text { font-size: 0.83rem; color: var(--muted); line-height: 1.85; }

    /* ══ ACCORDION ══ */
    details.acc-item > summary { list-style: none; }
    details.acc-item > summary::-webkit-details-marker { display: none; }

    .acc-item {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      margin-bottom: 6px; overflow: hidden; transition: border-color 0.15s;
    }
    .acc-item:last-child { margin-bottom: 0; }
    .acc-item:hover { border-color: var(--accent); }

    .acc-title {
      display: flex; align-items: center; gap: 12px;
      padding: 0.85rem 1.1rem; background: var(--bg2);
      cursor: pointer; user-select: none;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.15s; width: 100%;
    }
    .acc-title:hover { background: rgba(124,106,255,0.06); }
    details[open] > .acc-title {
      background: rgba(124,106,255,0.1);
      border-bottom: 1px solid var(--border);
    }

    .acc-index {
      font-size: 0.6rem; font-weight: 700; color: var(--accent);
      background: rgba(124,106,255,0.12); border: 1px solid rgba(124,106,255,0.25);
      padding: 2px 7px; border-radius: 4px;
      flex-shrink: 0; min-width: 28px; text-align: center;
      font-family: 'Space Grotesk', monospace; transition: all 0.15s;
    }
    details[open] > .acc-title .acc-index {
      background: var(--accent); color: #fff; border-color: var(--accent);
      box-shadow: 0 0 8px rgba(124,106,255,0.5);
    }
    .acc-text {
      flex: 1; font-size: 0.88rem; font-weight: 500;
      color: var(--text); line-height: 1.5;
    }
    .acc-arrow {
      color: var(--muted2); transition: transform 0.22s ease, color 0.15s;
      flex-shrink: 0; display: flex; align-items: center;
    }
    details[open] > .acc-title .acc-arrow { transform: rotate(90deg); color: var(--accent); }

    /* acc-body：摘要 + 底部工具栏 */
    .acc-body {
      padding: 1rem 1.1rem 1rem 3.1rem;
      background: var(--bg);
      font-size: 0.85rem; color: var(--muted); line-height: 1.9;
    }
    .acc-summary { margin-bottom: 0.75rem; }

    /* 底部：标签 + 原文链接 同行排列 */
    .acc-footer {
      display: flex; align-items: center; gap: 8px;
      flex-wrap: wrap;
    }
    .acc-tag {
      display: inline-flex; align-items: center;
      font-size: 0.68rem; font-weight: 600; color: var(--cyan);
      background: rgba(0,229,255,0.08); border: 1px solid rgba(0,229,255,0.2);
      padding: 2px 10px; border-radius: 4px; letter-spacing: 0.5px;
    }

    /* 原文链接按钮 */
    .acc-source-link {
      display: inline-flex; align-items: center;
      font-size: 0.68rem; font-weight: 600;
      color: var(--muted); text-decoration: none;
      background: var(--bg2); border: 1px solid var(--border2);
      padding: 2px 10px; border-radius: 4px;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
      letter-spacing: 0.5px;
    }
    .acc-source-link:hover {
      color: var(--accent); border-color: rgba(124,106,255,0.4);
      background: rgba(124,106,255,0.08);
    }

    .empty {
      font-size: 0.82rem; color: var(--muted2); padding: 1.5rem 0;
      text-align: center; border: 1px dashed var(--border);
      border-radius: var(--radius-md); letter-spacing: 2px;
    }

    /* ══ FOOTER ══ */
    footer {
      max-width: 1240px; margin: 0 auto 2.5rem;
      padding: 1.5rem 1.5rem 0; border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .footer-left  { font-size: 0.72rem; color: var(--muted2); letter-spacing: 1px; }
    .footer-right {
      font-size: 0.65rem; color: var(--accent);
      background: rgba(124,106,255,0.08); border: 1px solid rgba(124,106,255,0.2);
      padding: 3px 12px; border-radius: 20px; letter-spacing: 1px;
    }

    /* ══ SCROLLBAR ══ */
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 10px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--muted2); }

    /* ══ MOBILE ══ */
    @media (max-width: 768px) {
      header { padding: 0 1rem; height: 56px; }
      .header-divider, .header-tag { display: none; }
      .layout {
        grid-template-columns: 1fr;
        margin: 1rem auto; padding: 0 0.75rem; gap: 0.85rem;
      }
      .sidenav {
        position: static; display: flex; flex-wrap: wrap; gap: 6px; padding: 0.75rem;
      }
      .sidenav-title { width: 100%; margin-bottom: 0.2rem; }
      .nav-link {
        padding: 0.38rem 0.75rem; background: var(--bg2);
        border: 1px solid var(--border); border-radius: 20px; font-size: 0.78rem;
      }
      .section { padding: 1rem; }
      .insight-grid { grid-template-columns: 1fr; gap: 0.75rem; }
      .acc-title { padding: 0.9rem 1rem; }
      .acc-body  { padding: 0.85rem 0.9rem 0.9rem 2.4rem; }
      footer {
        flex-direction: column; gap: 0.5rem;
        text-align: center; padding: 1.25rem 1rem 0; margin-bottom: 1.5rem;
      }
    }

    @media (max-width: 400px) {
      .acc-text { font-size: 0.84rem; }
      .section  { padding: 0.9rem; }
    }
  `;

  return (
    '<!DOCTYPE html>\n' +
    '<html lang="zh-CN">\n' +
    '<head>\n' +
    '  <meta charset="UTF-8">\n' +
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '  <title>Joy 每日新闻播报 · ' + dateStr + '</title>\n' +
    '  <style>' + css + '</style>\n' +
    '</head>\n' +
    '<body>\n' +

    '<header>\n' +
    '  <div class="header-inner">\n' +
    '    <div class="brand">\n' +
    '      <div class="brand-mark">📡</div>\n' +
    '      <div>\n' +
    '        <div class="brand-name">Joy 每日新闻播报</div>\n' +
    '        <div class="brand-sub">AI · TECH · INSIGHT</div>\n' +
    '      </div>\n' +
    '    </div>\n' +
    '    <div class="header-right">\n' +
    '      <div class="header-tag">DAILY BRIEFING</div>\n' +
    '      <div class="header-divider"></div>\n' +
    '      <div class="header-date-block">\n' +
    '        <div class="date-main">' + dateStr + '</div>\n' +
    '        <div class="date-week">' + weekDay + '</div>\n' +
    '      </div>\n' +
    '    </div>\n' +
    '  </div>\n' +
    '</header>\n' +

    '<div class="layout">\n' +
    '  <nav class="sidenav">\n' +
    '    <div class="sidenav-title">栏目导航</div>\n' +
    '    ' + navHTML + '\n' +
    '  </nav>\n' +
    '  <main class="main-content">\n' +
    '    ' + cat1HTML + '\n' +
    '    ' + otherHTML + '\n' +
    '  </main>\n' +
    '</div>\n' +

    '<footer>\n' +
    '  <div class="footer-left">Joy 每日新闻播报 · ' + dateStr + ' · ' + weekDay + '</div>\n' +
    '  <div class="footer-right">Powered by Moonshot AI</div>\n' +
    '</footer>\n' +

    '</body>\n' +
    '</html>'
  );
}

// ── 主流程 ────────────────────────────────────────────
async function main() {
  const { dateStr, weekDay } = getBeijingDate();
  console.log('📰 正在生成 ' + dateStr + ' 日报...');

  console.log('🌐 正在抓取新闻源...');
  const allArticles = await fetchAllSources(SOURCES);
  const recent = filterRecent(allArticles);
  console.log('✅ 抓取完成，24小时内有效文章：' + recent.length + ' 篇');

  if (recent.length === 0) {
    console.warn('⚠️  没有抓取到任何文章，请检查网络或 RSS 源');
    process.exit(1);
  }

  console.log('📊 正在评分筛选...');
  const filtered = scoreAndFilter(recent);
  console.log('✅ 筛选完成，送入 AI 处理：' + filtered.length + ' 篇');

  console.log('🤖 正在调用 AI 分类整理...');
  const promptJson = articlesToPromptJson(filtered);
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

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
    dateStr: y + '-' + m + '-' + d,
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
    summary: a.summary.slice(0, 300),
    source: a.source,
    time: a.publishedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
  }));
  return JSON.stringify(simplified, null, 2);
}

// ── 调用 AI 分类整理 ──────────────────────────────────
async function generateSections(rawJson: string, dateStr: string): Promise<string> {
  const prompt = '你是一位专业的AI科技日报主编，今天是' + dateStr + '。\n\n'
    + '以下是今日抓取的原始新闻列表（JSON格式）：\n'
    + rawJson + '\n\n'
    + '请根据这些新闻生成结构化日报，严格按以下JSON格式返回，不要有任何多余内容。\n\n'
    + '【重要】每条新闻的 summary 字段必须严格满足：\n'
    + '1. 字数：80到120个中文字符，绝对不能少于80字\n'
    + '2. 内容：第一句说明事件是什么，第二句说明背景或原因，第三句说明影响或意义\n'
    + '3. 语言：简洁专业，不使用"该公司""此次"等模糊表达，直接说主语\n'
    + '4. 禁止：不得只写一句话，不得少于三句话\n\n'
    + '返回格式：\n'
    + '{\n'
    + '  "cat1": {\n'
    + '    "highlights": [\n'
    + '      { "title": "中文标题", "summary": "80-120字三句话摘要" }\n'
    + '    ],\n'
    + '    "crossSector": "跨板块关联分析100字以内",\n'
    + '    "startupAdvice": "创业方向建议100字以内",\n'
    + '    "riskWarning": "风险预警100字以内"\n'
    + '  },\n'
    + '  "cat2": [\n'
    + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "company": "企业名" }\n'
    + '  ],\n'
    + '  "cat3": [\n'
    + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "amount": "融资金额" }\n'
    + '  ],\n'
    + '  "cat4": [\n'
    + '    { "title": "中文标题", "summary": "80-120字三句话摘要" }\n'
    + '  ],\n'
    + '  "cat5": [\n'
    + '    { "title": "中文标题", "summary": "80-120字三句话摘要", "product": "产品名" }\n'
    + '  ],\n'
    + '  "cat6": [\n'
    + '    { "title": "中文标题", "summary": "80-120字三句话摘要" }\n'
    + '  ]\n'
    + '}\n\n'
    + '分类规则：\n'
    + '- cat1.highlights：今日最重要3-5条，标题译成中文\n'
    + '- cat2：OpenAI/Google/Meta/Microsoft/Anthropic等头部企业动态，3-5条\n'
    + '- cat3：融资/投资/估值/收购新闻，3-5条\n'
    + '- cat4：模型发布/算法突破/硬件革新，3-5条\n'
    + '- cat5：新产品/功能上线/App发布/平台更新，3-5条\n'
    + '- cat6：AI教育/学习工具/在线课程/技能培训，3-5条\n'
    + '- 无相关内容返回空数组[]\n'
    + '- 所有title和summary必须是中文\n'
    + '- 不得编造原始新闻中没有的内容';

  const response = await client.chat.completions.create({
    model: 'moonshot-v1-32k',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
  });

  return response.choices[0].message.content || '{}';
}

// ── 生成手风琴列表 HTML ───────────────────────────────
function newsAccordion(items: any[], extraField?: string): string {
  if (!items.length) return '<p class="empty">暂无相关内容</p>';
  return items.map((item, i) => {
    const idx = String(i + 1).padStart(2, '0');
    const extra = extraField && item[extraField]
      ? '<span class="acc-tag">' + item[extraField] + '</span>'
      : '';
    return (
      '<div class="acc-item">' +
        '<button class="acc-title" data-toggle="accordion" type="button">' +
          '<span class="acc-index">' + idx + '</span>' +
          '<span class="acc-text">' + item.title + '</span>' +
          '<span class="acc-arrow">' +
            '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
              '<path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' +
            '</svg>' +
          '</span>' +
        '</button>' +
        '<div class="acc-body">' +
          '<p>' + (item.summary || '') + '</p>' +
          extra +
        '</div>' +
      '</div>'
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

  const cat1HTML =
    '<div class="section" id="sec-1">' +
      '<div class="sec-header">' +
        '<div class="sec-header-left">' +
          '<span class="sec-icon">📋</span>' +
          '<h2>综合要闻</h2>' +
        '</div>' +
        '<span class="sec-badge">' + total + ' 篇</span>' +
      '</div>' +
      '<div class="sub-block">' +
        '<div class="sub-label">今日新闻摘录</div>' +
        newsAccordion(highlights) +
      '</div>' +
      '<div class="insight-grid">' +
        '<div class="insight-card">' +
          '<div class="insight-label"><span class="insight-dot dot-gray"></span>跨板块关联</div>' +
          '<div class="insight-text">' + (cat1.crossSector || '暂无分析') + '</div>' +
        '</div>' +
        '<div class="insight-card accent-blue">' +
          '<div class="insight-label"><span class="insight-dot dot-blue"></span>创业方向建议</div>' +
          '<div class="insight-text">' + (cat1.startupAdvice || '暂无建议') + '</div>' +
        '</div>' +
        '<div class="insight-card accent-amber">' +
          '<div class="insight-label"><span class="insight-dot dot-amber"></span>风险预警</div>' +
          '<div class="insight-text">' + (cat1.riskWarning || '暂无预警') + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  const sections = [
    { id: 2, icon: '🏭', title: '行业动态',    items: cat2, extra: 'company' },
    { id: 3, icon: '💰', title: '投资融资',    items: cat3, extra: 'amount'  },
    { id: 4, icon: '⚡', title: '技术突破',    items: cat4, extra: ''        },
    { id: 5, icon: '📦', title: '产品上线',    items: cat5, extra: 'product' },
    { id: 6, icon: '🎓', title: 'AI 教育资讯', items: cat6, extra: ''        },
  ];

  const otherHTML = sections.map(s =>
    '<div class="section" id="sec-' + s.id + '">' +
      '<div class="sec-header">' +
        '<div class="sec-header-left">' +
          '<span class="sec-icon">' + s.icon + '</span>' +
          '<h2>' + s.title + '</h2>' +
        '</div>' +
        '<span class="sec-badge">' + s.items.length + ' 条</span>' +
      '</div>' +
      newsAccordion(s.items, s.extra || undefined) +
    '</div>'
  ).join('');

  const navItems = [
    { id: 1, icon: '📋', label: '综合要闻' },
    { id: 2, icon: '🏭', label: '行业动态' },
    { id: 3, icon: '💰', label: '投资融资' },
    { id: 4, icon: '⚡', label: '技术突破' },
    { id: 5, icon: '📦', label: '产品上线' },
    { id: 6, icon: '🎓', label: 'AI 教育'  },
  ];

  const navHTML = navItems.map(n =>
    '<a href="#sec-' + n.id + '" class="nav-link">' +
      '<span class="nav-icon">' + n.icon + '</span>' +
      '<span>' + n.label + '</span>' +
    '</a>'
  ).join('');

  const css = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --primary:      #0f2744;
      --accent:       #2563eb;
      --accent-light: #eff6ff;
      --accent-mid:   #bfdbfe;
      --border:       #e4e9f0;
      --border-light: #f0f4f8;
      --bg:           #f0f4f8;
      --surface:      #ffffff;
      --surface-2:    #f8fafc;
      --text-main:    #0f172a;
      --text-sub:     #475569;
      --text-mute:    #94a3b8;
      --amber:        #d97706;
      --amber-light:  #fffbeb;
      --amber-mid:    #fde68a;
      --radius-lg:    14px;
      --radius-md:    10px;
      --radius-sm:    6px;
      --shadow-sm:    0 1px 3px rgba(15,39,68,0.06), 0 1px 2px rgba(15,39,68,0.04);
      --shadow-md:    0 4px 12px rgba(15,39,68,0.08), 0 2px 4px rgba(15,39,68,0.04);
    }

    body {
      font-family: 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.75;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Header ── */
    header {
      background: var(--primary);
      height: 64px;
      display: flex;
      align-items: center;
      padding: 0 2rem;
      position: sticky;
      top: 0;
      z-index: 200;
      box-shadow: 0 2px 16px rgba(15,39,68,0.25);
    }
    header::after {
      content: '';
      position: absolute;
      bottom: 0; left: 0; right: 0;
      height: 2px;
      background: linear-gradient(90deg, #2563eb 0%, #60a5fa 50%, #2563eb 100%);
    }
    .header-inner {
      max-width: 1240px; margin: 0 auto; width: 100%;
      display: flex; align-items: center; justify-content: space-between;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark {
      width: 36px; height: 36px;
      background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
      border-radius: 9px;
      display: flex; align-items: center; justify-content: center;
      font-size: 17px;
      box-shadow: 0 2px 8px rgba(37,99,235,0.4);
      flex-shrink: 0;
    }
    .brand-name { font-size: 1rem; font-weight: 700; color: #f1f5f9; letter-spacing: 0.3px; }
    .brand-sub  { font-size: 0.65rem; color: #64a0d4; letter-spacing: 2.5px; margin-top: 2px; }
    .header-right { display: flex; align-items: center; gap: 1.5rem; }
    .header-date-block { text-align: right; }
    .date-main { font-size: 0.88rem; font-weight: 600; color: #e2e8f0; }
    .date-week { font-size: 0.68rem; color: #64a0d4; margin-top: 2px; letter-spacing: 1px; }
    .header-divider { width: 1px; height: 28px; background: rgba(255,255,255,0.12); }
    .header-tag {
      font-size: 0.68rem; font-weight: 600; color: #93c5fd;
      background: rgba(37,99,235,0.2);
      border: 1px solid rgba(37,99,235,0.35);
      padding: 3px 10px; border-radius: 20px; letter-spacing: 1px;
    }

    /* ── Layout ── */
    .layout {
      max-width: 1240px; margin: 1.75rem auto;
      padding: 0 1.5rem;
      display: grid;
      grid-template-columns: 172px 1fr;
      gap: 1.5rem;
      align-items: start;
    }

    /* ── Sidenav ── */
    .sidenav {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1rem 0.75rem;
      position: sticky; top: 76px;
      box-shadow: var(--shadow-sm);
    }
    .sidenav-title {
      font-size: 0.62rem; font-weight: 700; color: var(--text-mute);
      letter-spacing: 2.5px; text-transform: uppercase;
      padding: 0 0.5rem 0.65rem;
      border-bottom: 1px solid var(--border-light);
      margin-bottom: 0.6rem;
    }
    .nav-link {
      display: flex; align-items: center; gap: 8px;
      padding: 0.5rem 0.65rem;
      border-radius: var(--radius-sm);
      font-size: 0.82rem; font-weight: 500;
      color: var(--text-sub); text-decoration: none;
      transition: all 0.15s ease; margin-bottom: 2px;
    }
    .nav-link:hover { background: var(--accent-light); color: var(--accent); }
    .nav-icon { font-size: 0.9rem; flex-shrink: 0; }

    /* ── Sections ── */
    .main-content { display: flex; flex-direction: column; gap: 1.25rem; }
    .section {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.6rem 1.8rem;
      box-shadow: var(--shadow-sm);
      transition: box-shadow 0.2s;
    }
    .section:hover { box-shadow: var(--shadow-md); }
    .sec-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 1.3rem; padding-bottom: 0.9rem;
      border-bottom: 1px solid var(--border-light);
    }
    .sec-header-left { display: flex; align-items: center; gap: 9px; }
    .sec-icon { font-size: 1.05rem; }
    .sec-header h2 { font-size: 0.97rem; font-weight: 700; color: var(--primary); }
    .sec-badge {
      font-size: 0.68rem; font-weight: 600; color: var(--text-mute);
      background: var(--surface-2); border: 1px solid var(--border);
      padding: 3px 11px; border-radius: 20px;
    }

    /* ── Sub Label ── */
    .sub-block { margin-bottom: 1.3rem; }
    .sub-block:last-child { margin-bottom: 0; }
    .sub-label {
      font-size: 0.7rem; font-weight: 700; color: var(--text-sub);
      text-transform: uppercase; letter-spacing: 2px;
      margin-bottom: 0.8rem;
      display: flex; align-items: center; gap: 8px;
    }
    .sub-label::after { content: ''; flex: 1; height: 1px; background: var(--border-light); }

    /* ── Insight Grid ── */
    .insight-grid {
      display: grid; grid-template-columns: repeat(3, 1fr);
      gap: 1rem; margin-top: 1.1rem;
    }
    .insight-card {
      border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: 1.1rem 1.2rem; background: var(--surface-2);
      transition: box-shadow 0.15s;
    }
    .insight-card:hover { box-shadow: var(--shadow-sm); }
    .insight-card.accent-blue  { background: var(--accent-light); border-color: var(--accent-mid); }
    .insight-card.accent-amber { background: var(--amber-light);  border-color: var(--amber-mid); }
    .insight-label {
      font-size: 0.72rem; font-weight: 700; color: var(--text-sub);
      margin-bottom: 0.6rem;
      display: flex; align-items: center; gap: 6px;
    }
    .insight-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .dot-gray  { background: var(--text-mute); }
    .dot-blue  { background: var(--accent); }
    .dot-amber { background: var(--amber); }
    .insight-text { font-size: 0.84rem; color: var(--text-main); line-height: 1.8; }

    /* ── Accordion ── */
    .acc-item {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      margin-bottom: 7px; overflow: hidden;
      transition: box-shadow 0.15s, border-color 0.15s;
    }
    .acc-item:last-child { margin-bottom: 0; }
    .acc-item:hover {
      border-color: var(--accent-mid);
      box-shadow: 0 2px 8px rgba(37,99,235,0.07);
    }
    .acc-title {
      width: 100%; display: flex; align-items: center; gap: 11px;
      padding: 0.85rem 1.1rem;
      background: var(--surface); border: none; cursor: pointer;
      text-align: left; transition: background 0.15s;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      user-select: none;
      outline: none;
    }
    .acc-title:hover { background: var(--surface-2); }
    .acc-title.open  { background: var(--accent-light); }
    .acc-index {
      font-size: 0.62rem; font-weight: 700;
      color: var(--accent); background: var(--accent-light);
      border: 1px solid var(--accent-mid);
      padding: 2px 7px; border-radius: 4px;
      flex-shrink: 0; min-width: 28px; text-align: center;
    }
    .acc-title.open .acc-index {
      background: var(--accent); color: #fff; border-color: var(--accent);
    }
    .acc-text {
      flex: 1; font-size: 0.88rem; font-weight: 600;
      color: var(--text-main); line-height: 1.55;
    }
    .acc-arrow {
      color: var(--text-mute);
      transition: transform 0.22s ease, color 0.15s;
      flex-shrink: 0; display: flex; align-items: center;
    }
    .acc-title.open .acc-arrow { transform: rotate(90deg); color: var(--accent); }
    .acc-body {
      display: none;
      padding: 1rem 1.1rem 1.1rem 3rem;
      background: linear-gradient(180deg, var(--accent-light) 0%, var(--surface) 100%);
      border-top: 1px solid var(--border-light);
      font-size: 0.86rem; color: var(--text-sub); line-height: 1.9;
    }
    .acc-body.open { display: block; }
    .acc-body p { margin-bottom: 0.5rem; }
    .acc-body p:last-child { margin-bottom: 0; }
    .acc-tag {
      display: inline-flex; align-items: center;
      margin-top: 0.6rem;
      font-size: 0.72rem; font-weight: 600;
      color: var(--accent); background: var(--accent-light);
      border: 1px solid var(--accent-mid);
      padding: 2px 10px; border-radius: 4px;
    }

    .empty { font-size: 0.84rem; color: var(--text-mute); padding: 0.75rem 0; font-style: italic; }

    /* ── Footer ── */
    footer {
      max-width: 1240px; margin: 0 auto 2rem;
      padding: 1.5rem 1.5rem 0;
      border-top: 1px solid var(--border);
      display: flex; align-items: center; justify-content: space-between;
    }
    .footer-left  { font-size: 0.72rem; color: var(--text-mute); }
    .footer-right {
      font-size: 0.68rem; color: var(--text-mute);
      background: var(--surface-2); border: 1px solid var(--border);
      padding: 3px 12px; border-radius: 20px;
    }

    /* ── Scrollbar ── */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 10px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-mute); }

    /* ── Mobile ── */
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
        padding: 0.38rem 0.75rem;
        background: var(--surface-2); border: 1px solid var(--border);
        border-radius: 20px; font-size: 0.78rem;
      }
      .section { padding: 1rem 1rem; }
      .insight-grid { grid-template-columns: 1fr; gap: 0.75rem; }
      .acc-title { padding: 0.8rem 0.9rem; min-height: 48px; }
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

  // ── 关键修复：用 pointerdown 替代 click+touchend ──
  const script = `
    (function() {
      function doToggle(btn) {
        var body = btn.nextElementSibling;
        if (!body) return;
        var isOpen = btn.classList.contains('open');
        var section = btn.closest('.section');
        if (section) {
          section.querySelectorAll('.acc-title.open').forEach(function(ob) {
            if (ob !== btn) {
              ob.classList.remove('open');
              ob.nextElementSibling.classList.remove('open');
            }
          });
        }
        btn.classList.toggle('open', !isOpen);
        body.classList.toggle('open', !isOpen);
      }

      document.addEventListener('pointerdown', function(e) {
        var btn = e.target.closest('[data-toggle="accordion"]');
        if (!btn) return;
        e.preventDefault();
        doToggle(btn);
      });
    })();
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
    '<script>' + script + '<\/script>\n' +
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

import { TIER1_DOMAINS } from './config.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const BASE_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

/**
 * 단순 쿼리 3개만 실행 (배치 수 최소화)
 * - 쿼리가 짧을수록 GDELT 성공률 높음
 * - 6개 지역 배치 대신 키워드 기반 3개 쿼리로 변경
 */
const QUERIES = [
  {
    label: '군사/분쟁',
    query: 'theme:MILITARY sourcelang:eng',
  },
  {
    label: '무역/제재',
    query: 'theme:TRADE sourcelang:eng',
  },
  {
    label: '외교/에너지',
    query: '(theme:DIPLOMACY OR theme:SANCTION) sourcelang:eng',
  }
];

async function fetchOne(query, label) {
  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    maxrecords: '250',
    format: 'json',
    timespan: '72h'
  });
  const url = `${BASE_URL}?${params.toString()}`;

  // 최대 3회 시도, 15초 간격
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url);
      const text = await res.text();

      if (res.status === 429 || !text.startsWith('{')) {
        console.warn(`  [RETRY] ${label} (${attempt}/3)`);
        await sleep(15000);
        continue;
      }

      const data = JSON.parse(text);
      const articles = data.articles || [];
      console.log(`  [OK] ${label}: ${articles.length} articles`);
      return articles;
    } catch (err) {
      console.warn(`  [FAIL] ${label}: ${err.message}`);
      await sleep(15000);
    }
  }
  console.warn(`  [SKIP] ${label}`);
  return [];
}

function tagArticle(article) {
  const domain = (article.domain || '').toLowerCase();
  const isTier1 = TIER1_DOMAINS.has(domain) ||
    [...TIER1_DOMAINS].some(d => domain.endsWith(`.${d}`));
  return {
    ...article,
    tier: isTier1 ? 1 : 2,
    tierTag: isTier1 ? '[T1]' : '[T2]'
  };
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

export async function fetchGdelt() {
  console.log('[GDELT] Starting fetch...');
  const allArticles = [];

  for (let i = 0; i < QUERIES.length; i++) {
    const q = QUERIES[i];
    if (i > 0) await sleep(10000); // 쿼리 간 10초 대기
    const articles = await fetchOne(q.query, q.label);
    allArticles.push(...articles);
  }

  const unique = deduplicateArticles(allArticles);
  const tagged = unique.map(tagArticle);
  tagged.sort((a, b) => a.tier - b.tier);

  const t1Count = tagged.filter(a => a.tier === 1).length;
  console.log(`[GDELT] Done: ${tagged.length} unique articles (T1: ${t1Count}, T2: ${tagged.length - t1Count})`);

  return tagged;
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  const articles = await fetchGdelt();
  const fs = await import('fs');
  fs.writeFileSync('data/gdelt-raw.json', JSON.stringify(articles, null, 2));
  console.log(`Saved to data/gdelt-raw.json`);
}

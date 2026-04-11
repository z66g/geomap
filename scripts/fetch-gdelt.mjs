import { REGION_GROUPS, COUNTRY_FIPS, GDELT_THEMES, GDELT_CONFIG, TIER1_DOMAINS } from './config.mjs';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * GDELT DOC 2.0 API 쿼리 URL 생성
 * 쿼리를 짧게 유지하기 위해 테마 3개씩만 사용
 */
function buildQueryUrl(fipsCodes) {
  const countryFilter = fipsCodes.map(c => `sourcecountry:${c}`).join(' OR ');
  // 핵심 테마만 사용 (쿼리 길이 제한 대응)
  const coreThemes = ['MILITARY', 'TRADE', 'SANCTION'];
  const themeFilter = coreThemes.map(t => `theme:${t}`).join(' OR ');
  const query = `(${countryFilter}) (${themeFilter}) sourcelang:eng`;

  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    maxrecords: String(GDELT_CONFIG.maxRecords),
    format: 'json',
    timespan: GDELT_CONFIG.timespan
  });

  return `${GDELT_CONFIG.baseUrl}?${params.toString()}`;
}

function buildGlobalQueryUrl(themes) {
  const themeFilter = themes.map(t => `theme:${t}`).join(' OR ');
  const query = `(${themeFilter}) sourcelang:eng`;

  const params = new URLSearchParams({
    query,
    mode: 'artlist',
    maxrecords: String(GDELT_CONFIG.maxRecords),
    format: 'json',
    timespan: GDELT_CONFIG.timespan
  });

  return `${GDELT_CONFIG.baseUrl}?${params.toString()}`;
}

async function fetchBatch(url, label, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await sleep(12000);
      const res = await fetch(url);

      if (res.status === 429) {
        console.warn(`  [RATE LIMIT] ${label} — waiting 15s...`);
        await sleep(15000);
        continue;
      }

      const text = await res.text();

      // GDELT가 에러 메시지를 텍스트로 반환하는 경우
      if (!text.startsWith('{') && !text.startsWith('[')) {
        console.warn(`  [WARN] ${label}: non-JSON response — "${text.slice(0, 80)}"`);
        if (attempt < retries) {
          await sleep(15000);
          continue;
        }
        return [];
      }

      const data = JSON.parse(text);
      const articles = data.articles || [];
      console.log(`  [OK] ${label}: ${articles.length} articles`);
      return articles;
    } catch (err) {
      console.warn(`  [FAIL] ${label} attempt ${attempt + 1}: ${err.message}`);
      if (attempt < retries) await sleep(12000);
    }
  }
  console.warn(`  [SKIP] ${label} — all retries exhausted`);
  return [];
}

/**
 * 기사에 Tier 태그 부착
 */
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

/**
 * URL 기준 중복 제거
 */
function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(a => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
}

/**
 * 메인: GDELT에서 지역 배치 + 글로벌 쿼리 실행
 */
export async function fetchGdelt() {
  console.log('[GDELT] Starting fetch...');
  const allArticles = [];
  const DELAY = 10000; // 10초 딜레이 (GDELT rate limit 대응)

  // 6개 지역 배치 쿼리
  for (let i = 0; i < REGION_GROUPS.length; i++) {
    const group = REGION_GROUPS[i];
    const fipsCodes = group.countries.map(id => COUNTRY_FIPS[id]).filter(Boolean);

    // 국가가 6개 이상이면 분할
    if (fipsCodes.length > 5) {
      const mid = Math.ceil(fipsCodes.length / 2);
      const batch1 = fipsCodes.slice(0, mid);
      const batch2 = fipsCodes.slice(mid);

      const url1 = buildQueryUrl(batch1);
      const articles1 = await fetchBatch(url1, `${group.label}-1`);
      allArticles.push(...articles1);
      await sleep(DELAY);

      const url2 = buildQueryUrl(batch2);
      const articles2 = await fetchBatch(url2, `${group.label}-2`);
      allArticles.push(...articles2);
    } else {
      const url = buildQueryUrl(fipsCodes);
      const articles = await fetchBatch(url, group.label);
      allArticles.push(...articles);
    }

    if (i < REGION_GROUPS.length - 1) await sleep(DELAY);
  }

  // 글로벌 테마 쿼리 2개 (DIPLOMACY/ENERGY + ECON)
  await sleep(DELAY);
  const globalUrl1 = buildGlobalQueryUrl(['DIPLOMACY', 'ENERGY_CORE_COMMODITIES']);
  const global1 = await fetchBatch(globalUrl1, '글로벌-외교/에너지');
  allArticles.push(...global1);

  await sleep(DELAY);
  const globalUrl2 = buildGlobalQueryUrl(['ECON_ECONPREVLI', 'MILITARY']);
  const global2 = await fetchBatch(globalUrl2, '글로벌-경제/군사');
  allArticles.push(...global2);

  // 중복 제거 + Tier 태깅
  const unique = deduplicateArticles(allArticles);
  const tagged = unique.map(tagArticle);

  // Tier 1을 상단으로 정렬
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

import { BigQuery } from '@google-cloud/bigquery';
import { writeFileSync } from 'fs';
import { TIER1_DOMAINS } from './config.mjs';

/**
 * BigQuery로 GDELT GKG 파티션 테이블에서 72시간치 지정학 뉴스 조회
 * - rate limit 없음
 * - SQL 한 번으로 전체 데이터 수집
 * - 무료 1TB/월 (이 쿼리는 ~5-10GB)
 */

const QUERY = `
SELECT
  DocumentIdentifier AS url,
  SourceCommonName AS source,
  DATE AS date_int,
  V2Themes AS themes,
  SPLIT(V2Tone, ',')[OFFSET(0)] AS tone,
  V2Locations AS locations
FROM \`gdelt-bq.gdeltv2.gkg_partitioned\`
WHERE
  _PARTITIONTIME >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 72 HOUR)
  AND (
    V2Themes LIKE '%MILITARY%'
    OR V2Themes LIKE '%ECON_TRADE%'
    OR V2Themes LIKE '%TAX_FNCACT_SANCTION%'
    OR V2Themes LIKE '%DIPLOMACY%'
    OR V2Themes LIKE '%EPU_POLICY%'
    OR V2Themes LIKE '%ECON_ECONPREVLI%'
    OR V2Themes LIKE '%CRISISLEX_%'
    OR V2Themes LIKE '%TAX_POLITICAL_VIOLENCE%'
  )
  AND TranslationInfo IS NULL
ORDER BY DATE DESC
LIMIT 800
`;

function tagArticle(row) {
  // URL에서 도메인 추출
  let domain = '';
  try {
    domain = new URL(row.url).hostname.replace('www.', '').toLowerCase();
  } catch { /* ignore */ }

  const isTier1 = TIER1_DOMAINS.has(domain) ||
    [...TIER1_DOMAINS].some(d => domain.endsWith(`.${d}`));

  // 테마에서 주요 카테고리 추출
  const themes = (row.themes || '').split(';').slice(0, 10);
  const mainThemes = themes
    .filter(t => /MILITARY|TRADE|SANCTION|DIPLOMACY|CRISIS|POLITICAL_VIOLENCE|ECON_/i.test(t))
    .slice(0, 5);

  // 날짜 포맷 (20260411123000 → 2026.04.11)
  const ds = String(row.date_int);
  const dateStr = ds.length >= 8 ? `${ds.slice(0,4)}.${ds.slice(4,6)}.${ds.slice(6,8)}` : '';

  // 소스 국가 추출 (V2Locations에서)
  const locMatch = (row.locations || '').match(/#([A-Z]{2})#/);
  const sourceCountry = locMatch ? locMatch[1] : '';

  // URL에서 제목 추출 (GDELT GKG에는 title이 없으므로 URL에서 유추)
  const pathParts = row.url.split('/').pop()?.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') || '';
  const title = row.source ? `[${row.source}] ${pathParts.slice(0, 80)}` : pathParts.slice(0, 80);

  return {
    url: row.url,
    domain,
    source: row.source || domain,
    date: dateStr,
    tone: parseFloat(row.tone) || 0,
    sourceCountry,
    themes: mainThemes,
    title,
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
  console.log('[GDELT/BigQuery] Running query...');

  // 서비스 계정 인증 (환경변수 또는 파일)
  let bigquery;
  if (process.env.GCP_SA_KEY) {
    const credentials = JSON.parse(process.env.GCP_SA_KEY);
    bigquery = new BigQuery({
      projectId: credentials.project_id,
      credentials
    });
  } else {
    // GOOGLE_APPLICATION_CREDENTIALS 환경변수 사용
    bigquery = new BigQuery();
  }

  const [rows] = await bigquery.query({ query: QUERY, location: 'US' });
  console.log(`[GDELT/BigQuery] Raw rows: ${rows.length}`);

  const tagged = rows.map(tagArticle);
  const unique = deduplicateArticles(tagged);

  // Tier 1 상단, 그 안에서 톤(부정적 우선) 정렬
  unique.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.tone - b.tone; // 부정적 톤 우선
  });

  const t1Count = unique.filter(a => a.tier === 1).length;
  console.log(`[GDELT/BigQuery] Done: ${unique.length} unique articles (T1: ${t1Count}, T2: ${unique.length - t1Count})`);

  return unique;
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  const articles = await fetchGdelt();
  writeFileSync('data/gdelt-raw.json', JSON.stringify(articles, null, 2));
  console.log(`Saved to data/gdelt-raw.json`);
}

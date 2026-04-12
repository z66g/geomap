import { BigQuery } from '@google-cloud/bigquery';
import { writeFileSync } from 'fs';
import { TIER1_DOMAINS } from './config.mjs';

/**
 * BigQuery로 GDELT GKG 파티션 테이블에서 72시간치 지정학 뉴스 조회
 * - PAGE_TITLE 추출로 기사 제목 확보
 * - V2Locations에서 국가 코드 추출
 * - rate limit 없음, SQL 한 번으로 전체 수집
 */

const QUERY = `
SELECT
  DocumentIdentifier AS url,
  SourceCommonName AS source,
  DATE AS date_int,
  V2Themes AS themes,
  SPLIT(V2Tone, ',')[OFFSET(0)] AS tone,
  V2Locations AS locations,
  REGEXP_EXTRACT(Extras, r'<PAGE_TITLE>(.*?)</PAGE_TITLE>') AS title
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
  AND Extras IS NOT NULL
ORDER BY DATE DESC
LIMIT 1500
`;

/**
 * BigQuery DATE 정수 → 날짜 문자열
 * DATE는 YYYYMMDDHHMMSS 형식의 정수 또는 BigQueryInt
 */
function parseDateInt(dateVal) {
  // BigQueryInt 객체 또는 숫자를 문자열로 변환
  const ds = String(dateVal?.value ?? dateVal ?? '');
  if (ds.length >= 8) {
    return `${ds.slice(0, 4)}.${ds.slice(4, 6)}.${ds.slice(6, 8)}`;
  }
  // fallback: 오늘 날짜
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/**
 * HTML 엔티티 디코딩 (GKG PAGE_TITLE은 HTML escaped)
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'");
}

/**
 * V2Locations에서 FIPS 국가 코드 추출
 * 형식: "1#country#CC#..." 세미콜론 구분
 */
function extractCountries(locations) {
  if (!locations) return [];
  const matches = locations.match(/\d#[^#]*#([A-Z]{2})#/g) || [];
  const codes = matches.map(m => {
    const match = m.match(/#([A-Z]{2})#/);
    return match ? match[1] : null;
  }).filter(Boolean);
  return [...new Set(codes)];
}

function tagArticle(row) {
  let domain = '';
  try {
    domain = new URL(row.url).hostname.replace('www.', '').toLowerCase();
  } catch { /* ignore */ }

  // 도메인 + SourceCommonName 양쪽에서 T1 매칭
  const sourceLower = (row.source || '').toLowerCase();
  const isTier1 = TIER1_DOMAINS.has(domain) ||
    [...TIER1_DOMAINS].some(d => domain.endsWith(`.${d}`) || domain.includes(d.split('.')[0])) ||
    /reuters|bloomberg|associated press|financial times|bbc|nytimes|new york times|wsj|wall street journal|guardian|economist|al jazeera|cnbc|scmp/i.test(sourceLower);

  // 테마에서 주요 카테고리 추출
  const themes = (row.themes || '').split(';');
  const mainThemes = themes
    .filter(t => /MILITARY|TRADE|SANCTION|DIPLOMACY|CRISIS|POLITICAL_VIOLENCE|ECON_/i.test(t))
    .filter((v, i, a) => a.indexOf(v) === i) // 중복 제거
    .slice(0, 5);

  const title = decodeHtmlEntities(row.title) || `[${row.source || domain}]`;
  const countries = extractCountries(row.locations);

  return {
    url: row.url,
    domain,
    source: row.source || domain,
    date: parseDateInt(row.date_int),
    tone: parseFloat(row.tone) || 0,
    countries,
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

  let bigquery;
  if (process.env.GCP_SA_KEY) {
    const credentials = JSON.parse(process.env.GCP_SA_KEY);
    bigquery = new BigQuery({
      projectId: credentials.project_id,
      credentials
    });
  } else {
    bigquery = new BigQuery();
  }

  const [rows] = await bigquery.query({ query: QUERY, location: 'US' });
  console.log(`[GDELT/BigQuery] Raw rows: ${rows.length}`);

  const tagged = rows.map(tagArticle);
  const unique = deduplicateArticles(tagged);

  // Tier 1 상단, 그 안에서 톤(부정적 우선) 정렬
  unique.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.tone - b.tone;
  });

  const t1Count = unique.filter(a => a.tier === 1).length;
  const withTitle = unique.filter(a => !a.title.startsWith('[')).length;
  console.log(`[GDELT/BigQuery] Done: ${unique.length} unique articles (T1: ${t1Count}, T2: ${unique.length - t1Count}, with title: ${withTitle})`);

  return unique;
}

// 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}`) {
  const articles = await fetchGdelt();
  writeFileSync('data/gdelt-raw.json', JSON.stringify(articles, null, 2));
  console.log(`Saved to data/gdelt-raw.json`);
}

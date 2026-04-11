import { readFileSync, writeFileSync, existsSync } from 'fs';
import { COUNTRY_IDS } from './config.mjs';

const DATA_DIR = new URL('../data/', import.meta.url).pathname;

function getKstTimestamp() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d} ${h}:${min} KST`;
}

function getNextUpdateKst() {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d} 09:00 KST`;
}

/**
 * 뉴스 데이터 검증
 */
function validateNews(newsItems) {
  if (!Array.isArray(newsItems) || newsItems.length === 0) {
    throw new Error('News items is empty or not an array');
  }

  const required = ['date', 'badge', 'badgeText', 'title', 'body', 'impact'];
  for (const item of newsItems) {
    for (const field of required) {
      if (!item[field]) {
        throw new Error(`News item missing field: ${field} — ${JSON.stringify(item).slice(0, 100)}`);
      }
    }
  }

  return newsItems;
}

/**
 * 국가 업데이트 검증
 */
function validateCountryUpdates(updates) {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Country updates is not an object');
  }

  const validIds = new Set(COUNTRY_IDS);
  const validatedUpdates = {};

  for (const [id, data] of Object.entries(updates)) {
    if (!validIds.has(id)) {
      console.warn(`  [WARN] Unknown country ID: ${id} — skipping`);
      continue;
    }
    if (!data || typeof data !== 'object') continue;
    if (!data.summary || !data.watchlist) {
      console.warn(`  [WARN] Incomplete update for ${id} — skipping`);
      continue;
    }
    validatedUpdates[id] = data;
  }

  return validatedUpdates;
}

/**
 * 이전 데이터 로드 (fallback용)
 */
function loadPrevious(filename) {
  const path = `${DATA_DIR}${filename}`;
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch { /* ignore */ }
  }
  return null;
}

/**
 * 출력 파일 생성
 */
export function buildOutput(newsItems, countryUpdates) {
  console.log('[BUILD] Validating and writing output...');

  const fetchedAtKr = getKstTimestamp();
  const nextUpdateKr = getNextUpdateKst();

  // ── news.json ──
  let newsOutput;
  try {
    const validNews = validateNews(newsItems);
    newsOutput = {
      items: validNews,
      fetchedAtKr,
      nextUpdateKr
    };
    console.log(`  [OK] news.json: ${validNews.length} items`);
  } catch (err) {
    console.error(`  [FAIL] news.json validation: ${err.message}`);
    const prev = loadPrevious('news.json');
    if (prev) {
      console.log('  [FALLBACK] Using previous news.json');
      newsOutput = { ...prev, fetchedAtKr, nextUpdateKr };
    } else {
      throw new Error('No valid news data and no fallback available');
    }
  }

  // ── country-updates.json ──
  let countryOutput;
  try {
    const validUpdates = validateCountryUpdates(countryUpdates);
    // 이전 데이터와 병합 (이전에 업데이트된 국가 유지)
    const prev = loadPrevious('country-updates.json');
    const mergedUpdates = prev?.updates ? { ...prev.updates } : {};
    for (const [id, data] of Object.entries(validUpdates)) {
      mergedUpdates[id] = data;
    }

    countryOutput = {
      updates: mergedUpdates,
      connections: {},
      fetchedAtKr
    };
    console.log(`  [OK] country-updates.json: ${Object.keys(validUpdates).length} new, ${Object.keys(mergedUpdates).length} total`);
  } catch (err) {
    console.error(`  [FAIL] country-updates validation: ${err.message}`);
    const prev = loadPrevious('country-updates.json');
    if (prev) {
      console.log('  [FALLBACK] Using previous country-updates.json');
      countryOutput = { ...prev, fetchedAtKr };
    } else {
      throw new Error('No valid country updates and no fallback available');
    }
  }

  // ── 파일 쓰기 ──
  writeFileSync(`${DATA_DIR}news.json`, JSON.stringify(newsOutput, null, 2));
  writeFileSync(`${DATA_DIR}country-updates.json`, JSON.stringify(countryOutput, null, 2));

  console.log('[BUILD] Output files written successfully');

  return { newsOutput, countryOutput };
}

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { COUNTRY_IDS } from './config.mjs';

const DATA_DIR = new URL('../data/', import.meta.url).pathname;

function toKst(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}
function fmtKst(kst) {
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return { y, m, d, h, min };
}

function getKstTimestamp() {
  const k = fmtKst(toKst(new Date()));
  return `${k.y}-${k.m}-${k.d} ${k.h}:${k.min} KST`;
}

function getNextUpdateKst() {
  // 현재 KST 시간 기준으로 다음 07:00 KST 계산
  const kstNow = toKst(new Date());
  const k = fmtKst(kstNow);
  const kstHour = parseInt(k.h);
  // 오늘 07:00이 아직 안 지났으면 오늘, 지났으면 내일
  const daysToAdd = kstHour < 7 ? 0 : 1;
  const next = new Date(kstNow.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  const n = fmtKst(next);
  return `${n.y}-${n.m}-${n.d} 07:00 KST`;
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

// LLM이 자주 틀리는 국가 코드 자동 보정
const ID_CORRECTIONS = {
  uk: 'gb', britain: 'gb', england: 'gb',
  is: 'il', israel: 'il',
  ch: 'cn', china: 'cn',
  ja: 'jp', japan: 'jp',
  ks: 'kr', korea: 'kr',
  rs: 'ru', russia: 'ru',
  gm: 'de', germany: 'de',
  sf: 'za', southafrica: 'za',
  as: 'au', australia: 'au',
  up: 'ua', ukraine: 'ua',
  tu: 'tr', turkey: 'tr', turkiye: 'tr',
  vm: 'vn', vietnam: 'vn',
  ci: 'cl', chile: 'cl',
  ni: 'ng', nigeria: 'ng',
  cg: 'cd', congo: 'cd',
  kn: 'kp', northkorea: 'kp',
  sn: 'sg', singapore: 'sg',
};

/**
 * 국가 업데이트 검증
 */
function validateCountryUpdates(updates) {
  if (!updates || typeof updates !== 'object') {
    throw new Error('Country updates is not an object');
  }

  const validIds = new Set(COUNTRY_IDS);
  const validatedUpdates = {};

  for (let [id, data] of Object.entries(updates)) {
    // ID 자동 보정
    id = id.toLowerCase().trim();
    if (ID_CORRECTIONS[id]) {
      console.log(`  [FIX] ${id} → ${ID_CORRECTIONS[id]}`);
      id = ID_CORRECTIONS[id];
    }
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
export function buildOutput(newsItems, countryUpdates, connectionUpdates = {}) {
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

    // connections 업데이트 병합
    const prevConnections = prev?.connections || {};
    const mergedConnections = { ...prevConnections };
    for (const [key, data] of Object.entries(connectionUpdates)) {
      if (data && typeof data === 'object') {
        mergedConnections[key] = data;
      }
    }

    countryOutput = {
      updates: mergedUpdates,
      connections: mergedConnections,
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

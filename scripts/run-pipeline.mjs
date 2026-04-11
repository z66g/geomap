import { fetchGdelt } from './fetch-gdelt.mjs';
import { generateNews, generateCountryUpdates } from './process-llm.mjs';
import { buildOutput } from './build-output.mjs';

async function main() {
  const startTime = Date.now();
  console.log('='.repeat(50));
  console.log(`[PIPELINE] Started at ${new Date().toISOString()}`);
  console.log('='.repeat(50));

  // Step 1: GDELT에서 기사 수집
  const articles = await fetchGdelt();
  if (articles.length === 0) {
    console.error('[PIPELINE] No articles fetched — aborting');
    process.exit(1);
  }

  // Step 2: LLM 처리 (2회 호출)
  let newsItems, countryUpdates;

  // 뉴스 생성 (최대 2회 재시도)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      newsItems = await generateNews(articles);
      break;
    } catch (err) {
      console.error(`[PIPELINE] News generation attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) {
        console.error('[PIPELINE] All news generation attempts failed');
        newsItems = null;
      }
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }

  // 국가 업데이트 생성 (최대 2회 재시도)
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      countryUpdates = await generateCountryUpdates(articles);
      break;
    } catch (err) {
      console.error(`[PIPELINE] Country updates attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) {
        console.error('[PIPELINE] All country update attempts failed');
        countryUpdates = null;
      }
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }

  // 둘 다 실패하면 종료 (이전 데이터 유지)
  if (!newsItems && !countryUpdates) {
    console.error('[PIPELINE] Both LLM calls failed — keeping previous data');
    process.exit(1);
  }

  // Step 3: 출력 파일 생성
  buildOutput(newsItems || [], countryUpdates || {});

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('='.repeat(50));
  console.log(`[PIPELINE] Completed in ${elapsed}s`);
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('[PIPELINE] Fatal error:', err);
  process.exit(1);
});

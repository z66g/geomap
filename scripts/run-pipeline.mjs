import { fetchGdelt } from './fetch-gdelt.mjs';
import { generateNews, generateCountryUpdates, generateConnectionUpdates } from './process-llm.mjs';
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

  // Step 2: LLM 처리 (3회 호출)
  let newsItems, countryUpdates, connectionUpdates;

  // 뉴스 생성
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      newsItems = await generateNews(articles);
      break;
    } catch (err) {
      console.error(`[PIPELINE] News generation attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) newsItems = null;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }

  // 국가 업데이트 생성
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      countryUpdates = await generateCountryUpdates(articles);
      break;
    } catch (err) {
      console.error(`[PIPELINE] Country updates attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) countryUpdates = null;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }

  // Connections 업데이트 생성
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      connectionUpdates = await generateConnectionUpdates(articles);
      break;
    } catch (err) {
      console.error(`[PIPELINE] Connection updates attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) connectionUpdates = null;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }

  // 모두 실패하면 종료
  if (!newsItems && !countryUpdates && !connectionUpdates) {
    console.error('[PIPELINE] All LLM calls failed — keeping previous data');
    process.exit(1);
  }

  // Step 3: 출력 파일 생성
  buildOutput(newsItems || [], countryUpdates || {}, connectionUpdates || {});

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('='.repeat(50));
  console.log(`[PIPELINE] Completed in ${elapsed}s`);
  console.log('='.repeat(50));
}

main().catch(err => {
  console.error('[PIPELINE] Fatal error:', err);
  process.exit(1);
});

import { fetchGdelt } from './fetch-gdelt.mjs';
import { generateNews, generateCountryUpdates, generateConnectionUpdates } from './process-llm.mjs';
import { buildOutput } from './build-output.mjs';
import { sendTelegram, sendTelegramError, sendTelegramStart } from './notify-telegram.mjs';

async function main() {
  const startTime = Date.now();
  console.log('='.repeat(50));
  console.log(`[PIPELINE] Started at ${new Date().toISOString()}`);
  console.log('='.repeat(50));

  await sendTelegramStart();

  // Step 1: GDELT에서 기사 수집
  const articles = await fetchGdelt();
  if (articles.length === 0) {
    await sendTelegramError('GDELT에서 기사를 가져오지 못했습니다.');
    console.error('[PIPELINE] No articles fetched — aborting');
    process.exit(1);
  }

  // Step 2: LLM 처리 (5회 재시도, 30초 점진 대기)
  const MAX_RETRIES = 5;
  async function retryLLM(name, fn) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        const wait = 15000 * attempt; // 15s, 30s, 45s, 60s, 75s
        console.error(`[PIPELINE] ${name} attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
        if (attempt < MAX_RETRIES) {
          console.log(`[PIPELINE] Waiting ${wait/1000}s before retry...`);
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }
    return null;
  }

  let newsItems, countryUpdates, connectionUpdates;
  newsItems = await retryLLM('News', () => generateNews(articles));
  countryUpdates = await retryLLM('Country updates', () => generateCountryUpdates(articles));
  connectionUpdates = await retryLLM('Connection updates', () => generateConnectionUpdates(articles));

  if (!newsItems && !countryUpdates && !connectionUpdates) {
    await sendTelegramError('모든 LLM 호출이 실패했습니다. 이전 데이터를 유지합니다.');
    console.error('[PIPELINE] All LLM calls failed — keeping previous data');
    process.exit(1);
  }

  // Step 3: 출력 파일 생성
  const countryCount = countryUpdates ? Object.keys(countryUpdates).length : 0;
  const connCount = connectionUpdates ? Object.keys(connectionUpdates).length : 0;
  buildOutput(newsItems || [], countryUpdates || {}, connectionUpdates || {});

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('='.repeat(50));
  console.log(`[PIPELINE] Completed in ${elapsed}s`);
  console.log('='.repeat(50));

  // Step 4: Telegram 알림
  await sendTelegram(newsItems, countryCount, connCount, elapsed);
}

main().catch(async err => {
  console.error('[PIPELINE] Fatal error:', err);
  await sendTelegramError(`Fatal error: ${err.message}`);
  process.exit(1);
});

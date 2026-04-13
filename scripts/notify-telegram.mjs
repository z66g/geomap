/**
 * Telegram 알림 전송
 * 파이프라인 완료 시 뉴스 요약을 Telegram으로 전송
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function sendTelegram(newsItems, countryCount, connCount, elapsed) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[TELEGRAM] No token/chat ID — skipping notification');
    return;
  }

  // KST 시간
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const timeStr = `${now.getUTCFullYear()}.${String(now.getUTCMonth()+1).padStart(2,'0')}.${String(now.getUTCDate()).padStart(2,'0')} ${String(now.getUTCHours()).padStart(2,'0')}:${String(now.getUTCMinutes()).padStart(2,'0')} KST`;

  // 뉴스 전체 요약
  let newsText = '';
  const total = newsItems?.length || 0;
  if (total > 0) {
    newsText = newsItems.map((n, i) =>
      `${i+1}. [${n.badgeText}] ${n.title}`
    ).join('\n');
  }

  const message = `🌐 *GEOMAP 업데이트 완료*
📅 ${timeStr} · ⏱ ${elapsed}초

📰 *뉴스 ${total}건*
${newsText || '(없음)'}

🏳️ 국가: ${countryCount}개국 · 🔗 관계: ${connCount}건
[→ 지도 보기](https://geomap.zbbg.kr)`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
    if (res.ok) {
      console.log('[TELEGRAM] Notification sent');
    } else {
      const err = await res.text();
      console.warn(`[TELEGRAM] Failed: ${err}`);
    }
  } catch (err) {
    console.warn(`[TELEGRAM] Error: ${err.message}`);
  }
}

export async function sendTelegramError(errorMsg) {
  if (!BOT_TOKEN || !CHAT_ID) return;

  const message = `⚠️ *GEOMAP 파이프라인 실패*\n\n${errorMsg}\n\n🔗 [로그 확인](https://github.com/z66g/geomap/actions)`;

  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      })
    });
  } catch { /* silent */ }
}

import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { COUNTRY_IDS } from './config.mjs';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5';

/**
 * Claude 응답에서 JSON만 추출
 * (간혹 ```json 코드블록으로 감싸서 반환하는 경우 대응)
 */
function extractJson(text) {
  const trimmed = text.trim();
  // 코드블록 제거
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) return codeBlockMatch[1];
  // 첫 { 또는 [ 부터 끝까지 추출
  const jsonStart = trimmed.search(/[{[]/);
  if (jsonStart > 0) return trimmed.slice(jsonStart);
  return trimmed;
}

async function callClaude(prompt, maxTokens = 4096) {
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature: 0.3,
    messages: [{ role: 'user', content: prompt }]
  });
  return msg.content[0].text;
}

// ── 프롬프트 빌더 ──

function buildNewsPrompt(articles) {
  const articleList = articles.slice(0, 700).map(a =>
    `${a.tierTag} [${a.date}] [${a.countries?.join(',')||''}] [${a.source}] ${a.title}`
  ).join('\n');

  return `당신은 한국 기관투자자를 위한 지정학 리스크 분석가입니다.

아래는 GDELT에서 수집한 최근 72시간 뉴스 메타데이터입니다.
[T1]은 Reuters, Bloomberg, AP 등 Tier 1 공신력 매체, [T2]는 기타 매체입니다.

## 임무
12~15건의 가장 중요한 지정학 이벤트를 선별하고, 한국어로 구조화된 뉴스 브리프를 작성하세요.

## 선별 기준 (우선순위순)
1. 무력 충돌, 군사 작전
2. 무역전쟁, 관세, 제재
3. 중앙은행 금리 결정
4. 에너지/자원 공급 교란
5. 주요 외교적 전환
6. 선거, 정권 교체 (시장 영향이 있는 경우만)

## Source 신뢰도
- [T1] 태그 기사를 우선 참조하되, [T2]에서만 보도된 중요 이벤트도 놓치지 마세요
- 동일 이벤트를 다룬 기사가 여러 개면 [T1] 매체의 관점을 우선 반영하세요

## impact 필드 규칙
단순 "영향"이 아닌, 구체적 자산군을 명시하세요:
- 환율 (예: KRW/USD 변동성 확대)
- 채권 (예: 미국 10년물 금리 상승 압력)
- 주식 (예: 반도체 섹터 하방 리스크)
- 에너지/원자재 (예: 브렌트유 상방, 금 안전자산 수요)
복합적이면 여러 자산군을 함께 기술하세요.

## 출력 형식 (매우 중요)
반드시 순수 JSON 배열만 반환하세요. 설명이나 코드블록 마커 없이 JSON만.
각 항목 필드:
- date: "YYYY.MM.DD" 형식
- badge: "risk" | "geo" | "ind" | "resource"
- badgeText: 한국어 카테고리 (전쟁, 지정학, 무역전쟁, 통화정책, 자원, 정책변화)
- title: 한국어 제목, 40자 이내, 핵심 수치 포함
- body: 한국어 본문, 2~3문장, 80자 이내
- impact: 자산군 명시 (환율/채권/주식/에너지/원자재)

## 참고 예시
${JSON.stringify([
  { date: "2026.04.07", badge: "risk", badgeText: "전쟁", title: "호르무즈 해협 봉쇄 — 브렌트유 110달러 상회", body: "이란 선박 통행 제한. 쿠웨이트 발전소 드론 공격. IEA '사상 최대 공급 충격'.", impact: "에너지 수입국(한·일·EU) 무역수지 악화. 브렌트유·WTI 상방. KRW/USD 상승 압력" },
  { date: "2026.04.03", badge: "geo", badgeText: "무역전쟁", title: "미중 대중 무역적자 20년 최저 — 5월 정상회담 앞두고 긴장", body: "2월 대중 상품 적자 131억달러. 트럼프 제약 관세 예고. 5월 베이징 정상회담.", impact: "반도체·희토류 공급망 관련 주식 변동성 확대. CNY/USD 주시" }
], null, 2)}

## 기사 데이터
${articleList}`;
}

function buildCountryUpdatesPrompt(articles, currentCountries) {
  const articleList = articles.slice(0, 700).map(a =>
    `${a.tierTag} [${a.date}] [${a.countries?.join(',')||''}] [${a.source}] ${a.title}`
  ).join('\n');

  const countryContext = currentCountries.map(c => ({
    id: c.id,
    name: c.name,
    region: c.region,
    alignLabel: c.alignLabel,
    summary: c.summary,
    watchlist: c.watchlist
  }));

  return `당신은 한국 기관투자자를 위한 지정학 대시보드 업데이트 담당자입니다.

아래에 최근 72시간 뉴스 메타데이터와 현재 34개국 프로필이 주어집니다.
[T1]은 공신력 매체, [T2]는 기타 매체입니다.

## 임무
각 국가의 "summary"와 "watchlist"를 최신 뉴스 기반으로 갱신하세요.

## 기사 데이터 형식
각 기사는 다음과 같은 형식입니다:
[T1/T2] [날짜] [관련국가코드] [매체명] 기사 제목
- 관련국가코드는 FIPS 코드입니다 (US=미국, CH=중국, KS=한국, JA=일본, RS=러시아 등)

## 규칙
1. 뉴스에서 언급된 국가의 summary와 watchlist를 갱신하세요
2. 최소 15개 이상의 국가를 업데이트하세요. 주요국(us, cn, ru, kr, jp, de, gb, fr, ir, il, ua, tw, in, sa, au)은 반드시 포함
3. 직접 관련 뉴스가 없더라도 간접 영향이 있으면 업데이트
4. summary: 현재 상황 한줄 요약, 120자 이내, 한국어
5. rate: 중앙은행 금리 뉴스가 있을 때만 포함. 형식: {"name": "중앙은행명", "val": "금리값%", "trend": "up|down|hold", "trendLabel": "인상|인하|동결", "note": "배경 50자 이내"}
6. riskScore: 0~100 정수 (0~20 안정, 21~40 관심, 41~60 경계, 61~80 위험, 81~100 극심). 모든 국가에 반드시 포함
7. watchlist: 2~3개. 각 항목 형식:
   - icon: "📌"
   - text: "<b>이벤트명(시기)</b> — 트리거 조건 발생 시 → 구체적 투자 액션 힌트"

## 출력 형식 (매우 중요)
반드시 순수 JSON 객체만 반환하세요. 설명이나 코드블록 마커 없이 JSON만.
키는 반드시 2글자 소문자 국가 ID입니다.

출력 예시:
{
  "us": { "summary": "...", "riskScore": 65, "watchlist": [{"icon": "📌", "text": "<b>이벤트</b> — 설명"}] },
  "cn": { "summary": "...", "riskScore": 55, "watchlist": [...] }
}

사용 가능한 국가 ID (반드시 이 중에서만 사용):
us=미국, cn=중국, jp=일본, kr=한국, de=독일, ru=러시아, in=인도, sa=사우디,
tw=대만, ir=이란, au=호주, br=브라질, cl=칠레, ua=우크라이나, ng=나이지리아,
cd=콩고, kp=북한, gb=영국(uk 아님!), fr=프랑스, tr=튀르키예, il=이스라엘(is 아님!),
pk=파키스탄, vn=베트남, id=인도네시아, mx=멕시코, pl=폴란드, za=남아공,
eg=이집트, ar=아르헨티나, ca=캐나다, my=말레이시아, sg=싱가포르, ae=UAE, th=태국

## 현재 국가 프로필
${JSON.stringify(countryContext, null, 2)}

## 최근 기사 데이터
${articleList}`;
}

function buildConnectionsPrompt(articles) {
  const articleList = articles.slice(0, 700).map(a =>
    `${a.tierTag} [${a.date}] [${a.countries?.join(',')||''}] [${a.source}] ${a.title}`
  ).join('\n');

  const connectionsPath = new URL('../connections.json', import.meta.url);
  const connections = JSON.parse(readFileSync(connectionsPath, 'utf8'));

  const connContext = connections.map(c => ({
    key: `${c.from}-${c.to}`,
    from: c.from,
    to: c.to,
    type: c.type,
    label: c.label,
    note: c.rel?.note?.slice(0, 80) || '',
    watch: c.rel?.watch?.slice(0, 80) || ''
  }));

  return `당신은 한국 기관투자자를 위한 지정학 관계 분석가입니다.

아래에 최근 72시간 뉴스 메타데이터와 현재 86개 양자관계 프로필이 주어집니다.

## 임무
뉴스에서 변화가 감지된 양자관계의 note, watch, keyItems를 갱신하세요.

## 규칙
1. 뉴스에서 실제로 언급되거나 영향받는 관계만 업데이트
2. 최소 5개 이상의 관계를 업데이트
3. note: 현재 양자관계 상태 요약, 한국어, 100자 이내
4. watch: 향후 주목할 이벤트와 투자 시사점, 한국어, 80자 이내
5. keyItems: 핵심 이슈 2~4개, 각각 {l: "라벨", v: "현재 상태"} 형식

## 출력 형식 (매우 중요)
반드시 순수 JSON 객체만 반환하세요. 설명이나 코드블록 마커 없이 JSON만.
키는 반드시 "from-to" 형식 (예: "us-cn", "ru-ua")

출력 예시:
{
  "us-cn": {
    "note": "미중 기술 패권 경쟁 심화. 반도체 수출통제 확대.",
    "watch": "5월 정상회담 결과 — 관세·희토류 협상이 테크주 방향 결정",
    "keyItems": [{"l": "반도체", "v": "엔비디아 H200 수출 통제 강화"}]
  }
}

## 현재 양자관계 목록
${JSON.stringify(connContext, null, 2)}

## 최근 기사 데이터
${articleList}`;
}

// ── LLM 호출 ──

export async function generateNews(articles) {
  console.log('[LLM] Generating news...');
  const prompt = buildNewsPrompt(articles);
  const text = await callClaude(prompt, 4096);
  const news = JSON.parse(extractJson(text));
  console.log(`[LLM] News generated: ${news.length} items`);
  return news;
}

export async function generateCountryUpdates(articles) {
  console.log('[LLM] Generating country updates...');
  const countriesPath = new URL('../countries.json', import.meta.url);
  const currentCountries = JSON.parse(readFileSync(countriesPath, 'utf8'));

  const prompt = buildCountryUpdatesPrompt(articles, currentCountries);
  const text = await callClaude(prompt, 8192);
  const updates = JSON.parse(extractJson(text));

  const updatedCount = Object.keys(updates).length;
  console.log(`[LLM] Country updates: ${updatedCount}/${COUNTRY_IDS.length} countries updated`);
  return updates;
}

export async function generateConnectionUpdates(articles) {
  console.log('[LLM] Generating connection updates...');
  const prompt = buildConnectionsPrompt(articles);
  const text = await callClaude(prompt, 4096);
  const updates = JSON.parse(extractJson(text));

  const updatedCount = Object.keys(updates).length;
  console.log(`[LLM] Connection updates: ${updatedCount} relations updated`);
  return updates;
}

import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { readFileSync } from 'fs';
import { COUNTRY_IDS } from './config.mjs';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ── JSON 스키마 정의 (Structured Output) ──

const newsItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    date: { type: SchemaType.STRING, description: 'YYYY.MM.DD 형식' },
    badge: { type: SchemaType.STRING, enum: ['risk', 'geo', 'ind', 'resource'] },
    badgeText: { type: SchemaType.STRING, description: '한국어 카테고리 (전쟁, 지정학, 무역전쟁, 통화정책, 자원, 정책변화)' },
    title: { type: SchemaType.STRING, description: '한국어 제목, 40자 이내, 핵심 수치 포함' },
    body: { type: SchemaType.STRING, description: '한국어 본문, 2~3문장, 80자 이내' },
    impact: { type: SchemaType.STRING, description: '자산군 명시 (환율/채권/주식/에너지/원자재). 예: KRW/USD 변동성 확대 + 에너지주 하방' }
  },
  required: ['date', 'badge', 'badgeText', 'title', 'body', 'impact']
};

const newsResponseSchema = {
  type: SchemaType.ARRAY,
  items: newsItemSchema
};

const watchlistItemSchema = {
  type: SchemaType.OBJECT,
  properties: {
    icon: { type: SchemaType.STRING },
    text: { type: SchemaType.STRING, description: '<b>이벤트(날짜)</b> — 트리거 발생 시 → 액션 힌트 형식' }
  },
  required: ['icon', 'text']
};

const countryUpdateSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING, description: '현재 상황 한줄 요약, 120자 이내' },
    watchlist: { type: SchemaType.ARRAY, items: watchlistItemSchema }
  },
  required: ['summary', 'watchlist']
};

// country-updates는 동적 키(country id)를 가지므로 스키마를 유연하게 정의
const countryUpdatesResponseSchema = {
  type: SchemaType.OBJECT,
  description: '국가별 업데이트. 키는 국가 ID (us, cn, kr 등). 변화 없는 국가는 포함하지 않음.'
};

// ── 프롬프트 빌더 ──

function buildNewsPrompt(articles) {
  const articleList = articles.slice(0, 500).map(a =>
    `${a.tierTag} [${a.date}] [${a.countries?.join(',')||''}] [${a.source}] ${a.title}`
  ).join('\n');

  return `당신은 한국 기관투자자를 위한 지정학 리스크 분석가입니다.

아래는 GDELT에서 수집한 최근 72시간 뉴스 메타데이터입니다.
[T1]은 Reuters, Bloomberg, AP 등 Tier 1 공신력 매체, [T2]는 기타 매체입니다.

## 임무
8~10건의 가장 중요한 지정학 이벤트를 선별하고, 한국어로 구조화된 뉴스 브리프를 작성하세요.

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

## 참고 예시
${JSON.stringify([
  { date: "2026.04.07", badge: "risk", badgeText: "전쟁", title: "호르무즈 해협 봉쇄 — 브렌트유 110달러 상회", body: "이란 선박 통행 제한. 쿠웨이트 발전소 드론 공격. IEA '사상 최대 공급 충격'.", impact: "에너지 수입국(한·일·EU) 무역수지 악화. 브렌트유·WTI 상방. KRW/USD 상승 압력" },
  { date: "2026.04.03", badge: "geo", badgeText: "무역전쟁", title: "미중 대중 무역적자 20년 최저 — 5월 정상회담 앞두고 긴장", body: "2월 대중 상품 적자 131억달러. 트럼프 제약 관세 예고. 5월 베이징 정상회담.", impact: "반도체·희토류 공급망 관련 주식 변동성 확대. CNY/USD 주시" }
], null, 2)}

## 기사 데이터
${articleList}`;
}

function buildCountryUpdatesPrompt(articles, currentCountries) {
  const articleList = articles.slice(0, 500).map(a =>
    `${a.tierTag} [${a.date}] [${a.countries?.join(',')||''}] [${a.source}] ${a.title}`
  ).join('\n');

  // 현재 국가 프로필에서 필요한 필드만 추출
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
- 제목에서 어떤 국가에 관한 뉴스인지 판단하세요

## 규칙
1. 뉴스에서 언급된 국가의 summary와 watchlist를 갱신하세요
2. 최소 5개 이상의 국가를 업데이트하세요. 주요국(us, cn, ru, kr, jp 등)은 적극적으로 업데이트하세요
3. 뉴스가 전혀 없는 국가만 제외하세요
4. summary: 현재 상황 한줄 요약, 120자 이내, 한국어
5. watchlist: 2~3개 항목. 각 항목은 다음 형식을 따르세요:
   - icon: "📌"
   - text: "<b>이벤트명(시기)</b> — 트리거 조건 발생 시 → 구체적 투자 액션 힌트"
   - 예: "<b>미중 정상회담(5월)</b> — '관세 인상' 언급 시 → 반도체 섹터 비중 축소 검토"
   - 예: "<b>BOK 금통위(5/29)</b> — 인하 결정 시 → 부동산·건설주 반등 가능"

## Source 신뢰도
[T1] 매체 기사를 우선 참조하되, [T2]에서만 보도된 중요 이벤트도 반영하세요.

## 출력 형식 (매우 중요 — 정확히 따르세요)
반드시 아래와 같은 JSON 객체를 반환하세요. 키는 반드시 2글자 소문자 국가 ID입니다.
배열이나 숫자 인덱스를 사용하지 마세요.

출력 예시:
{
  "us": { "summary": "미국 현재 상황 요약", "watchlist": [{"icon": "📌", "text": "<b>이벤트</b> — 설명"}] },
  "cn": { "summary": "중국 현재 상황 요약", "watchlist": [{"icon": "📌", "text": "<b>이벤트</b> — 설명"}] },
  "kr": { "summary": "한국 현재 상황 요약", "watchlist": [{"icon": "📌", "text": "<b>이벤트</b> — 설명"}] }
}

사용 가능한 국가 ID: us, cn, jp, kr, de, ru, in, sa, tw, ir, au, br, cl, ua, ng, cd, kp, gb, fr, tr, il, pk, vn, id, mx, pl, za, eg, ar, ca, my, sg, ae, th

## 현재 국가 프로필
${JSON.stringify(countryContext, null, 2)}

## 최근 기사 데이터
${articleList}`;
}

// ── LLM 호출 ──

export async function generateNews(articles) {
  console.log('[LLM] Generating news...');
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: newsResponseSchema,
      temperature: 0.3
    }
  });

  const prompt = buildNewsPrompt(articles);
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const news = JSON.parse(text);
  console.log(`[LLM] News generated: ${news.length} items`);
  return news;
}

export async function generateCountryUpdates(articles) {
  console.log('[LLM] Generating country updates...');
  const countriesPath = new URL('../countries.json', import.meta.url);
  const currentCountries = JSON.parse(readFileSync(countriesPath, 'utf8'));

  // country-updates는 동적 키(country id)라 strict schema 사용 불가
  // JSON 모드만 사용하고 스키마는 프롬프트로 제어
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.3
    }
  });

  const prompt = buildCountryUpdatesPrompt(articles, currentCountries);
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const updates = JSON.parse(text);

  const updatedCount = Object.keys(updates).length;
  console.log(`[LLM] Country updates: ${updatedCount}/${COUNTRY_IDS.length} countries updated`);
  return updates;
}

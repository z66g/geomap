// 34개국 ID 목록
export const COUNTRY_IDS = [
  'us','cn','jp','kr','de','ru','in','sa','tw','ir','au','br','cl','ua',
  'ng','cd','kp','gb','fr','tr','il','pk','vn','id','mx','pl','za','eg',
  'ar','ca','my','sg','ae','th'
];

// GDELT sourcecountry 코드 매핑 (ISO 2-letter → FIPS)
// GDELT uses FIPS 10-4 country codes, not ISO
export const COUNTRY_FIPS = {
  us:'US', cn:'CH', jp:'JA', kr:'KS', de:'GM', ru:'RS', in:'IN', sa:'SA',
  tw:'TW', ir:'IR', au:'AS', br:'BR', cl:'CI', ua:'UP', ng:'NI', cd:'CG',
  kp:'KN', gb:'UK', fr:'FR', tr:'TU', il:'IS', pk:'PK', vn:'VM', id:'ID',
  mx:'MX', pl:'PL', za:'SF', eg:'EG', ar:'AR', ca:'CA', my:'MY', sg:'SN',
  ae:'AE', th:'TH'
};

// 6개 지역 배치 그룹 (GDELT 쿼리용)
export const REGION_GROUPS = [
  {
    name: 'east_asia',
    label: '동아시아',
    countries: ['kr','jp','cn','tw','kp']
  },
  {
    name: 'southeast_asia',
    label: '동남아시아',
    countries: ['vn','id','my','sg','th']
  },
  {
    name: 'south_west_asia_mideast',
    label: '남/서아시아·중동',
    countries: ['in','pk','ir','sa','ae','il','tr','eg']
  },
  {
    name: 'europe',
    label: '유럽',
    countries: ['de','gb','fr','pl','ua','ru']
  },
  {
    name: 'americas',
    label: '아메리카',
    countries: ['us','ca','mx','br','ar','cl']
  },
  {
    name: 'africa_oceania',
    label: '아프리카·오세아니아',
    countries: ['ng','cd','za','au']
  }
];

// GDELT 지정학 테마 필터
export const GDELT_THEMES = [
  'MILITARY',
  'TRADE',
  'SANCTION',
  'DIPLOMACY',
  'ECON_ECONPREVLI',
  'ENERGY_CORE_COMMODITIES'
];

// Tier 1 신뢰 매체 도메인
export const TIER1_DOMAINS = new Set([
  'reuters.com',
  'bloomberg.com',
  'apnews.com',
  'ft.com',
  'bbc.com', 'bbc.co.uk',
  'nytimes.com',
  'wsj.com',
  'economist.com',
  'aljazeera.com',
  'scmp.com',
  'nikkei.com',
  'theguardian.com',
  'washingtonpost.com',
  'cnbc.com',
  'foreignaffairs.com',
  'foreignpolicy.com'
]);

// GDELT API 설정
export const GDELT_CONFIG = {
  baseUrl: 'https://api.gdeltproject.org/api/v2/doc/doc',
  maxRecords: 250,
  timespan: '72h',
  sourceLang: 'eng',
  requestDelay: 6000, // 6초 (5초 제한 + 안전 마진)
};

// 뉴스 badge 카테고리
export const NEWS_BADGES = {
  risk: { badge: 'risk', badgeText: '전쟁' },
  geo: { badge: 'geo', badgeText: '지정학' },
  trade: { badge: 'geo', badgeText: '무역전쟁' },
  monetary: { badge: 'ind', badgeText: '통화정책' },
  resource: { badge: 'resource', badgeText: '자원' },
  policy: { badge: 'ind', badgeText: '정책변화' },
  investment: { badge: 'ind', badgeText: '투자' }
};

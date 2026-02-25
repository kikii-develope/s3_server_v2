import { createClient } from "webdav";
import https from 'https';
import http from 'http';

const webdavUrl = process.env.WEBDAV_URL;
const webdavRootPath = process.env.WEBDAV_ROOT_PATH || 'www';

// HTTP/HTTPS Agent 설정 (keep-alive, 연결 재사용)
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 60000
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 60000,
  rejectUnauthorized: process.env.NODE_ENV === 'production'
});

// 디렉토리 캐시 (경로 → 타임스탬프)
export const dirCache = new Map();
export const CACHE_TTL = 3600000; // 1시간

/** WebDAV용 경로 정규화 (중복 슬래시 제거, 백슬래시 → 슬래시) */
export const normalizeWebDAVPath = (input) => {
  let p = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  p = p.replace(/\/\.$/, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

// WebDAV 클라이언트 생성
export const client = createClient(
  webdavUrl,
  {
    username: process.env.WEBDAV_USER,
    password: process.env.WEBDAV_PASSWORD,
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
    maxBodyLength: 3 * 1024 * 1024 * 1024,
    maxContentLength: 3 * 1024 * 1024 * 1024
  }
);

// 캐시 주기적 정리 (1시간마다)
setInterval(() => {
  const now = Date.now();
  let cleanedCount = 0;

  for (const [key, timestamp] of dirCache.entries()) {
    if (now - timestamp > CACHE_TTL) {
      dirCache.delete(key);
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    console.log(`[CACHE] ${cleanedCount}개 만료된 디렉토리 캐시 정리`);
  }
}, CACHE_TTL);

export const getBaseUrl = () => webdavUrl;
export const getRootPath = () => webdavRootPath;

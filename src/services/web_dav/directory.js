import { client, getRootPath, normalizeWebDAVPath, dirCache, CACHE_TTL } from './client.js';

// ── Singleflight ────────────────────────────────────────────────────────────
// 동일 fullPath에 대해 동시에 여러 ensureDirectory가 호출되면
// MKCOL을 한 번만 실행하고 나머지는 같은 Promise를 await한다.
// → N개 동시 요청 → 1개 MKCOL + (N-1)개 대기 → 레이스 컨디션 원천 차단
const inFlightDirCreates = new Map();

/**
 * 디렉토리 생성 로직
 * @param {string} path
 */
export const createDirectory = async (path) => {
  try {
    await client.createDirectory(`/${getRootPath()}/${path}`);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

/**
 * 디렉토리 확인 및 생성 (캐싱 + Singleflight 적용)
 * - 캐시 히트시 네트워크 요청 없이 즉시 반환
 * - 동일 경로 동시 호출 시 하나의 Promise를 공유 (singleflight)
 * - 전체 경로를 한 번에 생성 시도 후 실패시 PROPFIND → 순차 생성
 */
export const ensureDirectory = async (path) => {
  const normalized = normalizeWebDAVPath(path);

  if (!normalized || normalized === "/") return;

  const fullPath = `/${getRootPath()}/${normalized}`;

  // 1. 캐시 확인 — 네트워크 요청 없이 즉시 반환
  const cached = dirCache.get(fullPath);
  if (cached && Date.now() - cached < CACHE_TTL) {
    console.log(`[DIR] 캐시 히트: ${fullPath}`);
    return;
  }

  // 2. Singleflight — 이미 같은 경로에 대해 진행 중이면 그 Promise를 공유
  if (inFlightDirCreates.has(fullPath)) {
    console.log(`[DIR] Singleflight 대기: ${fullPath}`);
    return inFlightDirCreates.get(fullPath);
  }

  // 3. 새로운 생성 요청: Promise를 등록하고 실행
  const promise = _ensureDirectoryImpl(fullPath, normalized);
  inFlightDirCreates.set(fullPath, promise);

  try {
    await promise;
  } finally {
    // 완료 후 반드시 제거 (성공/실패 모두)
    inFlightDirCreates.delete(fullPath);
  }
};

/**
 * ensureDirectory 실제 구현 (singleflight 내부에서 1회만 실행됨)
 */
const _ensureDirectoryImpl = async (fullPath, normalized) => {
  // Step 1: MKCOL로 전체 경로 한 번에 생성 시도
  try {
    console.log(`[DIR] MKCOL 시도: ${fullPath}`);
    await client.createDirectory(fullPath);
    dirCache.set(fullPath, Date.now());
    console.log(`[DIR] 생성 성공: ${normalized}`);
    return;
  } catch (err) {
    const code = err?.status || err?.statusCode;
    const msg = String(err?.message || err);
    console.log(`[DIR] MKCOL 실패: ${fullPath} → ${code} ${msg}`);
  }

  // Step 2: MKCOL 실패 → HTTP 상태 코드에 의존하지 않고 PROPFIND로 실제 존재 확인
  // (405/409/500 등 구현체마다 의미가 다르므로 코드 분기 하지 않음)
  const exists = await existDirectory(fullPath);
  if (exists) {
    console.log(`[DIR] PROPFIND 확인: 이미 존재 → ${fullPath}`);
    dirCache.set(fullPath, Date.now());
    return;
  }

  // Step 3: 존재하지 않음 → 부모 디렉토리가 없는 경우이므로 순차 생성
  console.log(`[DIR] 순차 생성으로 위임: ${normalized}`);
  await ensureDirectorySequential(normalized);
};

/**
 * 디렉토리 순차 생성
 * 경로를 세그먼트 단위로 분리해서 루트부터 하나씩 생성한다.
 * 각 단계마다: 캐시 확인 → PROPFIND → MKCOL → 실패시 PROPFIND 재확인
 */
const ensureDirectorySequential = async (path) => {
  const normalized = normalizeWebDAVPath(path);
  const isAbsolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);

  console.log(`[DIR-SEQ] 순차 생성 시작: ${normalized} (${parts.length}단계)`);
  let acc = isAbsolute ? "/" : "";

  for (const part of parts) {
    const next = acc === "/" ? `/${part}` : acc ? `${acc}/${part}` : part;
    const fullPath = `/${getRootPath()}${next.startsWith('/') ? '' : '/'}${next}`;

    // 캐시 확인
    const cached = dirCache.get(fullPath);
    if (cached && Date.now() - cached < CACHE_TTL) {
      console.log(`[DIR-SEQ] 캐시 히트: ${fullPath}`);
      acc = next;
      continue;
    }

    // 존재 여부 확인
    const exists = await existDirectory(fullPath);
    console.log(`[DIR-SEQ] 존재 확인: ${fullPath} → ${exists}`);

    if (!exists) {
      try {
        await client.createDirectory(fullPath);
        console.log(`[DIR-SEQ] 생성 성공: ${fullPath}`);
      } catch (err) {
        const code = err?.status || err?.statusCode;
        const msg = String(err?.message || err);
        console.log(`[DIR-SEQ] MKCOL 실패: ${fullPath} → ${code} ${msg}`);

        // HTTP 상태 코드에 의존하지 않고 PROPFIND로 실제 존재 여부 재확인
        // 동시 요청이 사이에 생성했을 수 있으므로 최종 존재 여부가 기준
        const existsAfterError = await existDirectory(fullPath);
        console.log(`[DIR-SEQ] 재확인: ${fullPath} → ${existsAfterError}`);
        if (!existsAfterError) {
          throw new Error(`디렉토리 생성 실패: "${next}" — ${msg}`);
        }
      }
    }

    // 캐시 저장
    dirCache.set(fullPath, Date.now());
    acc = next;
  }
  console.log(`[DIR-SEQ] 순차 생성 완료: ${normalized}`);
};

export const getDirectoryContents = async (path) => {
  try {
    console.log(`[WebDAV] 디렉토리 조회: ${path}`);
    const res = await client.getDirectoryContents(path);
    return res;
  } catch (error) {
    console.log(`[WebDAV] 디렉토리 조회 실패: ${path} - ${error.message}`);
    return null;
  }
}

export const existDirectory = async (path) => {
  const res = await getDirectoryContents(path);
  return res !== null;
}

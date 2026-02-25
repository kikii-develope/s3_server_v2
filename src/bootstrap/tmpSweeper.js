import fs from 'fs';
import path from 'path';
import os from 'os';

// ── 기본 옵션 ────────────────────────────────────────────────────────────────
const DEFAULTS = {
  // 최근 수정된 항목은 건드리지 않음 (진행중 업로드 보호)
  SAFE_WINDOW_MS: 10 * 60 * 1000,       // 10분
  // 이 시간보다 오래된 항목만 삭제
  TTL_MS: 6 * 60 * 60 * 1000,           // 6시간
  // 주기 실행 간격
  INTERVAL_MS: 60 * 60 * 1000,          // 1시간
  // stale lock 판단 기준
  LOCK_STALE_MS: 30 * 60 * 1000,        // 30분
};

// ── 삭제 대상 경로 ───────────────────────────────────────────────────────────
//  A. multer tmp:  os.tmpdir()/file-upload-server/ 내부 파일들
//  B. merge tmp:   os.tmpdir()/merge-* 디렉토리들 (청크 병합 잔여물)
const TMP_ROOT = os.tmpdir();
const MULTER_DIR = path.join(TMP_ROOT, 'file-upload-server');
const LOCK_FILE = path.join(TMP_ROOT, '.tmp-sweeper.lock');
const MERGE_DIR_PATTERN = /^merge-/;

// ── Lock (동시 실행 방지) ────────────────────────────────────────────────────

/**
 * lock 파일을 원자적으로 생성한다.
 * 이미 존재하면 stale 여부를 확인하고, stale이면 제거 후 재시도한다.
 * @returns {boolean} lock 획득 성공 여부
 */
const acquireLock = async (staleLimitMs) => {
  try {
    // 'wx' = 없을 때만 생성 (원자적)
    const fd = await fs.promises.open(LOCK_FILE, 'wx');
    await fd.close();
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') {
      console.warn(`[SWEEPER] lock 생성 실패: ${err.message}`);
      return false;
    }

    // lock 파일이 이미 존재 → stale 체크
    try {
      const stat = await fs.promises.stat(LOCK_FILE);
      if (Date.now() - stat.mtimeMs > staleLimitMs) {
        console.warn(`[SWEEPER] stale lock 감지 (${Math.round((Date.now() - stat.mtimeMs) / 60000)}분 경과), 제거 후 재시도`);
        await fs.promises.rm(LOCK_FILE, { force: true });
        // 재시도 1회
        try {
          const fd = await fs.promises.open(LOCK_FILE, 'wx');
          await fd.close();
          return true;
        } catch {
          return false;
        }
      }
    } catch {
      // stat 실패 = 이미 삭제됨 → 재시도
      try {
        const fd = await fs.promises.open(LOCK_FILE, 'wx');
        await fd.close();
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }
};

const releaseLock = async () => {
  try {
    await fs.promises.rm(LOCK_FILE, { force: true });
  } catch {
    // 이미 없어도 무시
  }
};

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/**
 * 디렉토리 내부 파일들의 최신 mtime을 반환한다.
 * 진행중인 청크 업로드는 chunk 파일의 mtime이 계속 갱신되므로
 * 최신 mtime이 최근이면 삭제하지 않는다.
 */
const getNewestMtime = async (dirPath) => {
  let newest = 0;
  try {
    const entries = await fs.promises.readdir(dirPath);
    for (const entry of entries) {
      try {
        const stat = await fs.promises.stat(path.join(dirPath, entry));
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
      } catch {
        // 개별 파일 stat 실패는 무시
      }
    }
  } catch {
    // readdir 실패 = 디렉토리 자체가 없어짐
  }
  return newest;
};

// ── Core sweep ───────────────────────────────────────────────────────────────

/**
 * 실제 스윕 로직
 * @param {Object} opts
 * @param {number} opts.TTL_MS       - 이 시간보다 오래된 항목만 삭제
 * @param {number} opts.SAFE_WINDOW_MS - 최근 수정된 항목 보호
 */
const sweep = async (opts) => {
  const now = Date.now();
  const ttl = opts.TTL_MS;
  const safeWindow = opts.SAFE_WINDOW_MS;

  const stats = {
    multerDeleted: 0, multerSkipped: 0, multerFailed: 0,
    mergeDeleted: 0, mergeSkipped: 0, mergeFailed: 0,
  };

  // ── A. multer tmp 파일 정리 ──────────────────────────────────────────────
  // 대상: os.tmpdir()/file-upload-server/ 내부 파일
  // 조건: mtime이 TTL + SAFE_WINDOW 모두 초과한 파일만 삭제
  try {
    const entries = await fs.promises.readdir(MULTER_DIR);
    for (const entry of entries) {
      const filePath = path.join(MULTER_DIR, entry);
      try {
        const stat = await fs.promises.stat(filePath);
        const age = now - stat.mtimeMs;

        if (age > ttl && age > safeWindow) {
          await fs.promises.rm(filePath, { recursive: true, force: true });
          stats.multerDeleted++;
        } else {
          stats.multerSkipped++;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn(`[SWEEPER] multer 파일 삭제 실패: ${entry} — ${err.message}`);
          stats.multerFailed++;
        }
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[SWEEPER] multer 디렉토리 읽기 실패: ${err.message}`);
    }
  }

  // ── B. merge tmp 디렉토리 정리 ───────────────────────────────────────────
  // 대상: os.tmpdir()/merge-* 디렉토리
  // 조건: 디렉토리 내부 파일 중 최신 mtime 기준으로 판단
  //       (진행중이면 chunk 파일의 mtime이 계속 갱신됨)
  try {
    const entries = await fs.promises.readdir(TMP_ROOT);
    for (const entry of entries) {
      if (!MERGE_DIR_PATTERN.test(entry)) continue;

      const dirPath = path.join(TMP_ROOT, entry);
      try {
        const stat = await fs.promises.stat(dirPath);
        if (!stat.isDirectory()) continue;

        // 디렉토리 내부 파일의 최신 mtime 확인
        const newestMtime = await getNewestMtime(dirPath);
        // 내부 파일이 없으면 디렉토리 자체 mtime 사용
        const refTime = newestMtime > 0 ? newestMtime : stat.mtimeMs;
        const age = now - refTime;

        if (opts.STARTUP_FORCE_MERGE_CLEAN || (age > ttl && age > safeWindow)) {
          await fs.promises.rm(dirPath, { recursive: true, force: true });
          stats.mergeDeleted++;
        } else {
          stats.mergeSkipped++;
        }
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.warn(`[SWEEPER] merge 디렉토리 삭제 실패: ${entry} — ${err.message}`);
          stats.mergeFailed++;
        }
      }
    }
  } catch (err) {
    console.warn(`[SWEEPER] tmpdir 읽기 실패: ${err.message}`);
  }

  return stats;
};

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 서버 부팅 시 1회 실행 (listen 직후 백그라운드)
 * 부팅 직후에는 TTL을 짧게 적용해서 이전 세션의 잔여물을 빠르게 정리한다.
 *
 * @param {Object} [options]
 * @param {number} [options.SAFE_WINDOW_MS=600000]  - 최근 항목 보호 시간 (기본 10분)
 * @param {number} [options.TTL_MS=21600000]        - 삭제 기준 시간 (기본 6시간)
 * @param {number} [options.LOCK_STALE_MS=1800000]  - stale lock 판단 (기본 30분)
 */
export const runStartupSweeper = async (options = {}) => {
  const opts = { ...DEFAULTS, ...options };
  const startTime = Date.now();

  console.log(`[SWEEPER] start (startup, TTL=${Math.round(opts.TTL_MS / 60000)}min, safe=${Math.round(opts.SAFE_WINDOW_MS / 60000)}min, forceMergeClean=true)`);

  // 동시 실행 방지
  const locked = await acquireLock(opts.LOCK_STALE_MS);
  if (!locked) {
    console.log('[SWEEPER] skip — another instance is running');
    return;
  }

  try {
    const stats = await sweep({ ...opts, STARTUP_FORCE_MERGE_CLEAN: true });
    const elapsed = Date.now() - startTime;

    console.log(`[SWEEPER] multer deleted: ${stats.multerDeleted}, skipped: ${stats.multerSkipped}, failed: ${stats.multerFailed}`);
    console.log(`[SWEEPER] merge dirs deleted: ${stats.mergeDeleted}, skipped: ${stats.mergeSkipped}, failed: ${stats.mergeFailed}`);
    console.log(`[SWEEPER] done in ${elapsed}ms`);
  } catch (err) {
    console.error(`[SWEEPER] unexpected error: ${err.message}`);
  } finally {
    await releaseLock();
  }
};

/**
 * 주기적 스윕 스케줄러
 * setInterval로 등록하고, SIGTERM/SIGINT 시 interval 정리 + 임시파일 최종 정리를 수행한다.
 *
 * @param {Object} [options]
 * @param {number} [options.INTERVAL_MS=3600000]    - 실행 간격 (기본 1시간)
 * @param {number} [options.SAFE_WINDOW_MS=600000]  - 최근 항목 보호 시간
 * @param {number} [options.TTL_MS=21600000]        - 삭제 기준 시간
 * @param {number} [options.LOCK_STALE_MS=1800000]  - stale lock 판단
 */
export const scheduleSweeper = (options = {}) => {
  const opts = { ...DEFAULTS, ...options };

  const intervalId = setInterval(async () => {
    const startTime = Date.now();

    const locked = await acquireLock(opts.LOCK_STALE_MS);
    if (!locked) {
      console.log('[SWEEPER] periodic skip — another instance is running');
      return;
    }

    try {
      console.log(`[SWEEPER] periodic start (TTL=${Math.round(opts.TTL_MS / 60000)}min)`);
      const stats = await sweep(opts);
      const elapsed = Date.now() - startTime;
      console.log(`[SWEEPER] multer deleted: ${stats.multerDeleted}, skipped: ${stats.multerSkipped}, failed: ${stats.multerFailed}`);
      console.log(`[SWEEPER] merge dirs deleted: ${stats.mergeDeleted}, skipped: ${stats.mergeSkipped}, failed: ${stats.mergeFailed}`);
      console.log(`[SWEEPER] periodic done in ${elapsed}ms`);
    } catch (err) {
      console.error(`[SWEEPER] periodic error: ${err.message}`);
    } finally {
      await releaseLock();
    }
  }, opts.INTERVAL_MS);

  // ── Graceful shutdown (SIGTERM/SIGINT) ───────────────────────────────────
  // SIGKILL은 잡을 수 없으므로, 그 경우는 다음 부팅 시 runStartupSweeper가 처리
  const shutdownHandler = async (signal) => {
    console.log(`[SWEEPER] ${signal} received — cleaning up...`);
    clearInterval(intervalId);

    // 종료 전 가능한 범위에서 임시파일 정리 (짧은 TTL 적용)
    const locked = await acquireLock(opts.LOCK_STALE_MS);
    if (locked) {
      try {
        const stats = await sweep({ ...opts, TTL_MS: opts.SAFE_WINDOW_MS });
        console.log(`[SWEEPER] shutdown cleanup — multer: ${stats.multerDeleted}, merge: ${stats.mergeDeleted}`);
      } catch {
        // 종료 중 에러는 무시
      } finally {
        await releaseLock();
      }
    }

    process.exit(0);
  };

  process.on('SIGTERM', shutdownHandler);
  process.on('SIGINT', shutdownHandler);

  console.log(`[SWEEPER] scheduled every ${Math.round(opts.INTERVAL_MS / 60000)}min`);

  return intervalId;
};

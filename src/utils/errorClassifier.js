/**
 * src/utils/errorClassifier.js
 * 에러를 재시도 가능(retryable) vs 영구 실패(permanent)로 분류
 * console 미사용
 */

// 일시적 에러 — 재시도 의미 있음
const RETRYABLE_PATTERNS = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'socket hang up',
    'EAGAIN',
    'EBUSY',
    '503',
    '502',
    '504',
    'network',
];

// 영구적 에러 — 재시도 의미 없음
const PERMANENT_PATTERNS = [
    'Invalid data found',     // ffmpeg: 손상된 파일
    'moov atom not found',   // ffmpeg: 깨진 영상
    'No such file',
    'ENOENT',
    'ENOMEM',
    '401',
    '403',
    'Unsupported codec',
    'ffmpeg timeout',
];

/**
 * @param {Error|string} error
 * @returns {boolean} true = 재시도 가능, false = 즉시 포기
 */
export const isRetryable = (error) => {
    const msg = String(error?.message || error || '');
    if (PERMANENT_PATTERNS.some((p) => msg.includes(p))) return false;
    if (RETRYABLE_PATTERNS.some((p) => msg.includes(p))) return true;
    return true; // 분류 불가 → 안전하게 재시도
};

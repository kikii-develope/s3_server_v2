/**
 * 대용량 영상 동적 타임아웃 계산
 * 공식:
 *   base = 420 + ceil(sizeMB/100) * 90
 *   timeout = clamp(base, 420, 3600)
 *   재업로드(timeout 실패 이력) 시 timeout = min(round(base * 1.35), 3600)
 */

const MIN_TIMEOUT_SEC = 420;
const MAX_TIMEOUT_SEC = 3600;
const STEP_MB = 100;
const STEP_SEC = 90;
const REUPLOAD_MULTIPLIER = 1.35;

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const computeDynamicTimeoutSec = ({
    sizeBytes = 0,
    isReupload = false,
    previousFailureType = '',
    previousError = '',
} = {}) => {
    const sizeMB = Math.max(1, Math.ceil(Number(sizeBytes || 0) / (1024 * 1024)));
    const base = MIN_TIMEOUT_SEC + Math.ceil(sizeMB / STEP_MB) * STEP_SEC;
    const baseTimeout = clamp(base, MIN_TIMEOUT_SEC, MAX_TIMEOUT_SEC);

    const prevErr = String(previousError || '').toLowerCase();
    const prevFailure = String(previousFailureType || '').toLowerCase();
    const isTimeoutReupload = isReupload
        && (prevErr.includes('ffmpeg timeout') || (prevFailure === 'retryable' && prevErr.includes('timeout')));
    if (!isTimeoutReupload) return baseTimeout;

    return Math.min(Math.round(baseTimeout * REUPLOAD_MULTIPLIER), MAX_TIMEOUT_SEC);
};

export const VIDEO_TIMEOUT_POLICY = {
    MIN_TIMEOUT_SEC,
    MAX_TIMEOUT_SEC,
    STEP_MB,
    STEP_SEC,
    REUPLOAD_MULTIPLIER,
};

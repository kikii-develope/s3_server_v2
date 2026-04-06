/**
 * src/utils/dbRetry.js
 * DB 쿼리 최대 3회 재시도 (deadlock, connection 에러 대비)
 * console 미사용 — 장애는 호출 측에서 DB에 기록
 */

const RETRYABLE_DB_CODES = [
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
    'ER_LOCK_DEADLOCK',
    'ETIMEDOUT',
    'ECONNREFUSED',
];

/**
 * @param {Function} fn - 실행할 async 함수
 * @param {number} maxRetries - 최대 재시도 횟수 (기본 3)
 */
export const dbRetry = async (fn, maxRetries = 3) => {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (err) {
            const isLast = i === maxRetries - 1;
            const msg = String(err?.code || err?.message || '');
            const isRetryable = RETRYABLE_DB_CODES.some((code) => msg.includes(code));

            if (isLast || !isRetryable) throw err;

            // 지수 백오프: 100ms → 200ms → 400ms
            await new Promise((r) => setTimeout(r, 100 * Math.pow(2, i)));
        }
    }
};

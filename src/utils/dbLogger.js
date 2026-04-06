/**
 * src/utils/dbLogger.js
 * DB 기반 최소 로그 — console/파일 완전 미사용
 * convert_log 테이블에만 기록, 7일 자동 삭제
 */

import convertPool from '../config/convertDatabase.js';

/**
 * @param {'info'|'warn'|'error'} level
 * @param {string} message
 * @param {number|null} metadataId
 * @param {string|null} detail
 */
export const dbLog = async (level, message, metadataId = null, detail = null) => {
    try {
        await convertPool.execute(
            'INSERT INTO convert_log (metadata_id, level, message, detail) VALUES (?,?,?,?)',
            [
                metadataId || null,
                level,
                String(message).substring(0, 500),
                detail ? String(detail).substring(0, 5000) : null,
            ]
        );
    } catch {
        // DB 로그 실패 → 무시 (로그 시스템이 서비스 흐름을 방해하면 안 됨)
    }
};

/**
 * 7일 이상 된 로그 삭제 (6시간 간격 자동 실행)
 */
export const pruneOldLogs = async () => {
    try {
        await convertPool.execute(
            'DELETE FROM convert_log WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)'
        );
    } catch {
        // 무시
    }
};

export const startLogPruner = () => {
    setInterval(pruneOldLogs, 6 * 3600 * 1000);
};

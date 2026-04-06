/**
 * src/services/watchdog.js
 * 서버 크래시 등 비정상 상황에서 남은 잔여물 복구
 * console 미사용
 */

import convertPool from '../config/convertDatabase.js';
import { clientInstance as client } from './web_dav/webdavClient.js';
import { dbLog } from '../utils/dbLogger.js';
import * as repo from '../repositories/convertMetadataRepo.js';

const STUCK_MIN = parseInt(process.env.STUCK_THRESHOLD_MIN) || 30;
const ZOMBIE_MIN = 10; // uploaded 좀비 판정

/**
 * 1. Stuck Job (Worker 크래시로 processing/uploading 영원히 멈춤)
 */
const recoverStuckJobs = async () => {
    try {
        const [rows] = await convertPool.execute(
            `SELECT id FROM file_convert_metadata
       WHERE convert_status IN ('processing','uploading')
         AND updated_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [STUCK_MIN]
        );

        for (const row of rows) {
            await repo.updateStatus(row.id, 'failed', `[WATCHDOG] ${STUCK_MIN}분 초과 - 자동 실패 반환`);
            await repo.updateFailureType(row.id, 'stuck');
            await dbLog('warn', `stuck 감지 → failed 처리`, row.id);
        }
    } catch {
        // DB 에러 무시
    }
};

/**
 * 2. NAS temp 파일 삭제 (temp_upload_path 추적 기반)
 */
const cleanupNasTempFiles = async () => {
    try {
        // 10분이 넘어가는 실패/완료 대상자 (완료했는데 NULL 갱신에 실패한 케이스도 포함)
        const [rows] = await convertPool.execute(
            `SELECT id, temp_upload_path FROM file_convert_metadata
       WHERE temp_upload_path IS NOT NULL
         AND convert_status IN ('failed','completed', 'stuck')
         AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)`
        );

        for (const row of rows) {
            try {
                await client.deleteFile(row.temp_upload_path);
            } catch {
                /* NAS에 없거나 이미 삭제됐으면 무시 (404 Not Found) */
            }
            await convertPool.execute(
                'UPDATE file_convert_metadata SET temp_upload_path = NULL WHERE id = ?',
                [row.id]
            );
        }
    } catch {
        // DB 에러 무시
    }
};

/**
 * 3. uploaded 상태에서 컨트롤러가 크래시나서 큐잉하지 못한 파일 대응
 */
const recoverUploadedZombies = async () => {
    try {
        const [rows] = await convertPool.execute(
            `SELECT id, original_path, original_name, original_ext, mime_type
       FROM file_convert_metadata
       WHERE convert_status = 'uploaded'
         AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [ZOMBIE_MIN]
        );

        for (const row of rows) {
            const isVid = row.mime_type && String(row.mime_type).startsWith('video/');

            if (isVid) {
                await repo.updateStatus(row.id, 'failed', '[WATCHDOG] uploaded 유실 - 임시 원본 파일 없음');
                await repo.updateFailureType(row.id, 'permanent');
                await dbLog('error', `uploaded 영상 복구 불가 (원본 임시파일 유실)`, row.id);
            } else {
                // 이미지는 동기이므로 그냥 실패 처리
                await repo.updateStatus(row.id, 'failed', '[WATCHDOG] uploaded 유실 - 재업로드 요망');
                await dbLog('warn', `uploaded 좀비 이미지 failed 처리`, row.id);
            }
        }
    } catch {
        // 무시
    }
};

/**
 * 서버 시작시와 주기적으로 백그라운드 Watchdog 기동
 */
export const startWatchdog = () => {
    // 시작 직후 즉시 1회 루프
    recoverStuckJobs();
    cleanupNasTempFiles();
    recoverUploadedZombies();

    // 매 5분 마다 주기적 실행
    setInterval(() => {
        recoverStuckJobs();
        cleanupNasTempFiles();
        recoverUploadedZombies();
    }, 5 * 60 * 1000);
};

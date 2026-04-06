/**
 * src/utils/tempCleaner.js
 * AWS 서버 /tmp 임시파일 관리 — console 미사용
 */

import fs from 'fs';
import path from 'path';

const TEMP_DIR = process.env.TEMP_DIR || '/tmp/upload-temp';
const MAX_AGE_MS = (parseInt(process.env.TEMP_MAX_AGE_HOURS) || 1) * 3600 * 1000;

/**
 * 단일 파일 안전 삭제 — 파일 없거나 권한 문제여도 절대 에러 안 던짐
 */
export const safeDelete = (filePath) => {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch {
        // 삭제 실패해도 무시
    }
};

/**
 * 여러 파일 안전 삭제
 */
export const safeDeleteMany = (...paths) => {
    for (const p of paths) {
        if (p) safeDelete(p);
    }
};

/**
 * fn 실행 후 tempFiles 반드시 삭제 (성공/실패 무관)
 */
export const withCleanup = async (tempFiles, fn) => {
    try {
        return await fn();
    } finally {
        safeDeleteMany(...tempFiles);
    }
};

/**
 * 서버 시작 시: 일정 시간 이상 된 파일 정리
 */
export const cleanupOnStartup = () => {
    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
            return;
        }
        const now = Date.now();
        for (const file of fs.readdirSync(TEMP_DIR)) {
            try {
                const fp = path.join(TEMP_DIR, file);
                const stat = fs.statSync(fp);
                if (now - stat.mtimeMs > MAX_AGE_MS) {
                    fs.unlinkSync(fp);
                }
            } catch {
                // 개별 파일 실패 무시
            }
        }
    } catch {
        // 전체 실패 무시
    }
};

/**
 * 주기적 정리 (환경변수 TEMP_CLEANUP_INTERVAL_MIN, 기본 10분)
 */
export const startPeriodicCleanup = () => {
    const intervalMs = (parseInt(process.env.TEMP_CLEANUP_INTERVAL_MIN) || 10) * 60 * 1000;
    setInterval(cleanupOnStartup, intervalMs);
};

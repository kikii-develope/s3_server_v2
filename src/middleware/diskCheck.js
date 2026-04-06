/**
 * src/middleware/diskCheck.js
 * 업로드 전 디스크 여유공간 체크 미들웨어
 * 필요 공간 = 파일크기 × 2 + 최소보장 (원본 + 변환본 동시 존재)
 * console 미사용
 */

import { execSync } from 'child_process';

const MIN_FREE_MB = parseInt(process.env.MIN_DISK_FREE_MB) || 500;
const TEMP_DIR = process.env.TEMP_DIR || '/tmp/upload-temp';

const getFreeDiskMB = () => {
    try {
        const out = execSync(`df -m "${TEMP_DIR}" 2>/dev/null | tail -1 | awk '{print $4}'`)
            .toString().trim();
        const val = parseInt(out);
        return isNaN(val) ? Infinity : val;
    } catch {
        return Infinity; // df 실패 시 차단하지 않음 (안전 방향)
    }
};

export const checkDiskSpace = (req, res, next) => {
    try {
        const freeMB = getFreeDiskMB();
        const contentLength = parseInt(req.headers['content-length'] || '0');
        const fileSizeMB = contentLength / 1048576;
        const requiredMB = fileSizeMB * 2 + MIN_FREE_MB;

        if (freeMB < requiredMB) {
            return res.status(503).json({
                success: false,
                message: `서버 디스크 공간 부족`,
                detail: `잔여: ${freeMB}MB, 필요: ${Math.ceil(requiredMB)}MB`,
                status: 503,
            });
        }
    } catch {
        // 체크 실패 시 통과 (서비스 차단하지 않음)
    }
    next();
};

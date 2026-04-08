/**
 * src/repositories/convertMetadataRepo.js
 * file_convert_metadata 테이블 CRUD — 기존 fileMetadataRepo.js 미수정
 * 모든 업데이트는 dbRetry 래퍼로 최대 3회 재시도
 */

import convertPool from '../config/convertDatabase.js';
import { dbRetry } from '../utils/dbRetry.js';

// ─── 조회 ───────────────────────────────────────────────

export const findById = async (id) => {
    const [rows] = await convertPool.execute(
        'SELECT * FROM file_convert_metadata WHERE id = ?',
        [id]
    );
    return rows[0] || null;
};

export const findByHash = async (contentHash) => {
    const [rows] = await convertPool.execute(
        `SELECT * FROM file_convert_metadata
     WHERE content_hash = ? AND convert_status = 'completed' LIMIT 1`,
        [contentHash]
    );
    return rows[0] || null;
};

export const findLatestByHash = async (contentHash) => {
    const [rows] = await convertPool.execute(
        `SELECT * FROM file_convert_metadata
     WHERE content_hash = ?
     ORDER BY id DESC
     LIMIT 1`,
        [contentHash]
    );
    return rows[0] || null;
};

export const findByStatus = async (status) => {
    const [rows] = await convertPool.execute(
        'SELECT * FROM file_convert_metadata WHERE convert_status = ?',
        [status]
    );
    return rows;
};

// ─── 생성 ───────────────────────────────────────────────

export const create = async (data) => {
    const {
        domainType = null,
        domainId = null,
        originalPath,
        originalName,
        originalExt,
        originalSize,
        mimeType,
        contentHash = null,
        etag = null,
    } = data;

    const [result] = await convertPool.execute(
        `INSERT INTO file_convert_metadata
     (domain_type, domain_id, original_path, original_name, original_ext,
      original_size, mime_type, content_hash, etag)
     VALUES (?,?,?,?,?,?,?,?,?)`,
        [domainType, domainId, originalPath, originalName, originalExt,
            originalSize, mimeType, contentHash, etag]
    );

    return findById(result.insertId);
};

// ─── 상태 업데이트 ─────────────────────────────────────

export const updateStatus = (id, status, error = null) => dbRetry(async () => {
    const tsCol =
        status === 'processing' ? ', processing_started_at = NOW()' :
            status === 'uploading' ? ', uploading_started_at = NOW()' :
                status === 'completed' ? ', completed_at = NOW()' :
                    status === 'failed' ? ', last_retry_at = NOW()' : '';

    const errClause = error ? ', convert_error = ?' : '';
    const params = error ? [status, error, id] : [status, id];

    await convertPool.execute(
        `UPDATE file_convert_metadata
     SET convert_status = ?${errClause}${tsCol}
     WHERE id = ?`,
        params
    );
});

export const markCompleted = (id, info) => dbRetry(async () => {
    await convertPool.execute(
        `UPDATE file_convert_metadata SET
       convert_status = 'completed',
       converted_path = ?, converted_name = ?, converted_ext = ?,
       converted_size = ?, temp_upload_path = NULL, completed_at = NOW()
     WHERE id = ?`,
        [info.convertedPath, info.convertedName, info.convertedExt, info.convertedSize, id]
    );
});

export const updateFailureType = (id, type) => dbRetry(async () => {
    await convertPool.execute(
        'UPDATE file_convert_metadata SET failure_type = ? WHERE id = ?',
        [type, id]
    );
});

export const incrementRetry = (id) => dbRetry(async () => {
    await convertPool.execute(
        'UPDATE file_convert_metadata SET retry_count = retry_count + 1, last_retry_at = NOW() WHERE id = ?',
        [id]
    );
});

export const updateJobId = (id, jobId) => dbRetry(async () => {
    await convertPool.execute(
        'UPDATE file_convert_metadata SET convert_job_id = ? WHERE id = ?',
        [jobId, id]
    );
});

export const resetForReprocess = (id, info = {}) => dbRetry(async () => {
    const {
        originalPath = null,
        originalName = null,
        originalExt = null,
        originalSize = null,
        mimeType = null,
        etag = null,
    } = info;

    await convertPool.execute(
        `UPDATE file_convert_metadata SET
       convert_status = 'uploaded',
       convert_job_id = NULL,
       convert_error = NULL,
       retry_count = 0,
       failure_type = NULL,
       worker_id = NULL,
       locked_at = NULL,
       temp_upload_path = NULL,
       converted_path = NULL,
       converted_name = NULL,
       converted_ext = NULL,
       converted_size = NULL,
       converted_hash = NULL,
       converted_etag = NULL,
       processing_started_at = NULL,
       uploading_started_at = NULL,
       completed_at = NULL,
       last_retry_at = NULL,
       original_path = COALESCE(?, original_path),
       original_name = COALESCE(?, original_name),
       original_ext = COALESCE(?, original_ext),
       original_size = COALESCE(?, original_size),
       mime_type = COALESCE(?, mime_type),
       etag = COALESCE(?, etag)
     WHERE id = ?`,
        [originalPath, originalName, originalExt, originalSize, mimeType, etag, id]
    );
});

export const updateWorkerId = (id, workerId) => dbRetry(async () => {
    await convertPool.execute(
        'UPDATE file_convert_metadata SET worker_id = ? WHERE id = ?',
        [workerId, id]
    );
});

export const saveTempPath = (id, tempPath) => dbRetry(async () => {
    await convertPool.execute(
        'UPDATE file_convert_metadata SET temp_upload_path = ? WHERE id = ?',
        [tempPath, id]
    );
});

export const clearTempPath = (id) => dbRetry(async () => {
    await convertPool.execute(
        'UPDATE file_convert_metadata SET temp_upload_path = NULL WHERE id = ?',
        [id]
    );
});

// ─── Worker 락 ─────────────────────────────────────────

/**
 * 락 획득: locked_at이 NULL이거나 30분 이상 만료된 경우만 성공
 * @returns {boolean} true = 락 획득 성공
 */
export const acquireLock = async (id, workerId) => {
    const [result] = await convertPool.execute(
        `UPDATE file_convert_metadata
     SET locked_at = NOW(), worker_id = ?
     WHERE id = ?
       AND (locked_at IS NULL OR locked_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE))`,
        [workerId, id]
    );
    return result.affectedRows > 0;
};

export const releaseLock = async (id) => {
    try {
        await convertPool.execute(
            'UPDATE file_convert_metadata SET locked_at = NULL WHERE id = ?',
            [id]
        );
    } catch {
        // 락 해제 실패 → watchdog이 30분 후 만료 처리
    }
};

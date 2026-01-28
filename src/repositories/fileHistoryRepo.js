import pool from '../config/database.js';

/**
 * 파일 이력 생성
 * @param {Object} data
 * @returns {Object}
 */
export const create = async (data) => {
    const {
        fileMetadataId,
        action,
        oldEtag = null,
        newEtag = null,
        oldHash = null,
        newHash = null,
        changedBy,
        reason = null
    } = data;

    const [result] = await pool.execute(
        `INSERT INTO file_metadata_history
        (file_metadata_id, action, old_etag, new_etag, old_hash, new_hash, changed_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [fileMetadataId, action, oldEtag, newEtag, oldHash, newHash, changedBy, reason]
    );

    return findById(result.insertId);
};

/**
 * ID로 이력 조회
 * @param {number} id
 * @returns {Object|null}
 */
export const findById = async (id) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata_history WHERE id = ?',
        [id]
    );
    return rows[0] || null;
};

/**
 * 파일 메타데이터 ID로 이력 조회
 * @param {number} fileMetadataId
 * @returns {Array}
 */
export const findByFileMetadataId = async (fileMetadataId) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata_history WHERE file_metadata_id = ? ORDER BY created_at DESC',
        [fileMetadataId]
    );
    return rows;
};

/**
 * 액션 타입으로 이력 조회
 * @param {string} action - UPLOAD, UPDATE, DELETE, DESYNC, VERIFY
 * @param {number} limit
 * @returns {Array}
 */
export const findByAction = async (action, limit = 100) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata_history WHERE action = ? ORDER BY created_at DESC LIMIT ?',
        [action, limit]
    );
    return rows;
};

/**
 * 변경자로 이력 조회
 * @param {string} changedBy
 * @param {number} limit
 * @returns {Array}
 */
export const findByChangedBy = async (changedBy, limit = 100) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata_history WHERE changed_by = ? ORDER BY created_at DESC LIMIT ?',
        [changedBy, limit]
    );
    return rows;
};

/**
 * 기간별 이력 조회
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array}
 */
export const findByDateRange = async (startDate, endDate) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata_history WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC',
        [startDate, endDate]
    );
    return rows;
};

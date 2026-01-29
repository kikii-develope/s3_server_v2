import pool from '../config/database.js';

/**
 * file_path로 파일 메타데이터 조회
 * @param {string} filePath
 * @returns {Object|null}
 */
export const findByFilePath = async (filePath) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata WHERE file_path = ?',
        [filePath]
    );
    return rows[0] || null;
};

/**
 * ID로 파일 메타데이터 조회
 * @param {number} id
 * @returns {Object|null}
 */
export const findById = async (id) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata WHERE id = ?',
        [id]
    );
    return rows[0] || null;
};

/**
 * 도메인으로 파일 목록 조회
 * @param {string} domainType
 * @param {number} domainId
 * @returns {Array}
 */
export const findByDomain = async (domainType, domainId) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata WHERE domain_type = ? AND domain_id = ?',
        [domainType, domainId]
    );
    return rows;
};

/**
 * 파일 메타데이터 생성
 * @param {Object} data
 * @returns {Object} 생성된 레코드
 */
export const create = async (data) => {
    const {
        domainType = null,
        domainId = null,
        filePath,
        fileName,
        extension,
        mimeType,
        fileSize,
        contentHash = null,
        etag = null,
        status = 'ACTIVE'
    } = data;

    const [result] = await pool.execute(
        `INSERT INTO file_metadata
        (domain_type, domain_id, file_path, file_name, extension, mime_type, file_size, content_hash, etag, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [domainType, domainId, filePath, fileName, extension, mimeType, fileSize, contentHash, etag, status]
    );

    return findById(result.insertId);
};

/**
 * ETag 업데이트
 * @param {number} id
 * @param {string} etag
 * @returns {Object}
 */
export const updateEtag = async (id, etag) => {
    await pool.execute(
        'UPDATE file_metadata SET etag = ?, updated_at = NOW() WHERE id = ?',
        [etag, id]
    );
    return findById(id);
};

/**
 * content_hash 업데이트
 * @param {number} id
 * @param {string} contentHash
 * @returns {Object}
 */
export const updateContentHash = async (id, contentHash) => {
    await pool.execute(
        'UPDATE file_metadata SET content_hash = ?, updated_at = NOW() WHERE id = ?',
        [contentHash, id]
    );
    return findById(id);
};

/**
 * ETag와 content_hash 동시 업데이트
 * @param {number} id
 * @param {string} etag
 * @param {string} contentHash
 * @returns {Object}
 */
export const updateEtagAndHash = async (id, etag, contentHash) => {
    await pool.execute(
        'UPDATE file_metadata SET etag = ?, content_hash = ?, updated_at = NOW() WHERE id = ?',
        [etag, contentHash, id]
    );
    return findById(id);
};

/**
 * 파일 정보 업데이트 (업데이트 시)
 * @param {number} id
 * @param {Object} data
 * @returns {Object}
 */
export const updateFileInfo = async (id, data) => {
    const { fileSize, contentHash, etag } = data;
    await pool.execute(
        'UPDATE file_metadata SET file_size = ?, content_hash = ?, etag = ?, updated_at = NOW() WHERE id = ?',
        [fileSize, contentHash, etag, id]
    );
    return findById(id);
};

/**
 * 상태 변경
 * @param {number} id
 * @param {string} status - ACTIVE, DESYNC, MISSING, DELETED
 * @returns {Object}
 */
export const updateStatus = async (id, status) => {
    await pool.execute(
        'UPDATE file_metadata SET status = ?, updated_at = NOW() WHERE id = ?',
        [status, id]
    );
    return findById(id);
};

/**
 * 마지막 검증 시간 업데이트
 * @param {number} id
 * @returns {Object}
 */
export const updateLastVerified = async (id) => {
    await pool.execute(
        'UPDATE file_metadata SET last_verified_at = NOW(), updated_at = NOW() WHERE id = ?',
        [id]
    );
    return findById(id);
};

/**
 * 물리 삭제 (실제로 사용하지 않음, 논리 삭제 권장)
 * @param {number} id
 */
export const remove = async (id) => {
    await pool.execute(
        'DELETE FROM file_metadata WHERE id = ?',
        [id]
    );
};

/**
 * 상태별 파일 목록 조회
 * @param {string} status
 * @returns {Array}
 */
export const findByStatus = async (status) => {
    const [rows] = await pool.execute(
        'SELECT * FROM file_metadata WHERE status = ?',
        [status]
    );
    return rows;
};

/**
 * 검증이 필요한 파일 목록 (마지막 검증 후 N일 경과)
 * @param {number} days
 * @returns {Array}
 */
export const findNeedVerification = async (days = 7) => {
    const [rows] = await pool.execute(
        `SELECT * FROM file_metadata
        WHERE status = 'ACTIVE'
        AND (last_verified_at IS NULL OR last_verified_at < DATE_SUB(NOW(), INTERVAL ? DAY))`,
        [days]
    );
    return rows;
};

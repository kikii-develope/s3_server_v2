"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findNeedVerification = exports.findByStatus = exports.remove = exports.updateLastVerified = exports.updateStatus = exports.updateFileInfo = exports.updateEtagAndHash = exports.updateContentHash = exports.updateEtag = exports.create = exports.findByDomain = exports.findById = exports.findByFilePath = void 0;
const database_js_1 = __importDefault(require("../config/database.js"));
/**
 * file_path로 파일 메타데이터 조회
 * @param {string} filePath
 * @returns {Object|null}
 */
const findByFilePath = async (filePath) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata WHERE file_path = ?', [filePath]);
    return rows[0] || null;
};
exports.findByFilePath = findByFilePath;
/**
 * ID로 파일 메타데이터 조회
 * @param {number} id
 * @returns {Object|null}
 */
const findById = async (id) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata WHERE id = ?', [id]);
    return rows[0] || null;
};
exports.findById = findById;
/**
 * 도메인으로 파일 목록 조회
 * @param {string} domainType
 * @param {number} domainId
 * @returns {Array}
 */
const findByDomain = async (domainType, domainId) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata WHERE domain_type = ? AND domain_id = ?', [domainType, domainId]);
    return rows;
};
exports.findByDomain = findByDomain;
/**
 * 파일 메타데이터 생성
 * @param {Object} data
 * @returns {Object} 생성된 레코드
 */
const create = async (data) => {
    const { domainType = null, domainId = null, filePath, fileName, extension, mimeType, fileSize, contentHash = null, etag = null, status = 'ACTIVE' } = data;
    const [result] = await database_js_1.default.execute(`INSERT INTO file_metadata
        (domain_type, domain_id, file_path, file_name, extension, mime_type, file_size, content_hash, etag, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [domainType, domainId, filePath, fileName, extension, mimeType, fileSize, contentHash, etag, status]);
    return (0, exports.findById)(result.insertId);
};
exports.create = create;
/**
 * ETag 업데이트
 * @param {number} id
 * @param {string} etag
 * @returns {Object}
 */
const updateEtag = async (id, etag) => {
    await database_js_1.default.execute('UPDATE file_metadata SET etag = ?, updated_at = NOW() WHERE id = ?', [etag, id]);
    return (0, exports.findById)(id);
};
exports.updateEtag = updateEtag;
/**
 * content_hash 업데이트
 * @param {number} id
 * @param {string} contentHash
 * @returns {Object}
 */
const updateContentHash = async (id, contentHash) => {
    await database_js_1.default.execute('UPDATE file_metadata SET content_hash = ?, updated_at = NOW() WHERE id = ?', [contentHash, id]);
    return (0, exports.findById)(id);
};
exports.updateContentHash = updateContentHash;
/**
 * ETag와 content_hash 동시 업데이트
 * @param {number} id
 * @param {string} etag
 * @param {string} contentHash
 * @returns {Object}
 */
const updateEtagAndHash = async (id, etag, contentHash) => {
    await database_js_1.default.execute('UPDATE file_metadata SET etag = ?, content_hash = ?, updated_at = NOW() WHERE id = ?', [etag, contentHash, id]);
    return (0, exports.findById)(id);
};
exports.updateEtagAndHash = updateEtagAndHash;
/**
 * 파일 정보 업데이트 (업데이트 시)
 * @param {number} id
 * @param {Object} data
 * @returns {Object}
 */
const updateFileInfo = async (id, data) => {
    const { fileSize, contentHash, etag } = data;
    await database_js_1.default.execute('UPDATE file_metadata SET file_size = ?, content_hash = ?, etag = ?, updated_at = NOW() WHERE id = ?', [fileSize, contentHash, etag, id]);
    return (0, exports.findById)(id);
};
exports.updateFileInfo = updateFileInfo;
/**
 * 상태 변경
 * @param {number} id
 * @param {string} status - ACTIVE, DESYNC, MISSING, DELETED
 * @returns {Object}
 */
const updateStatus = async (id, status) => {
    await database_js_1.default.execute('UPDATE file_metadata SET status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    return (0, exports.findById)(id);
};
exports.updateStatus = updateStatus;
/**
 * 마지막 검증 시간 업데이트
 * @param {number} id
 * @returns {Object}
 */
const updateLastVerified = async (id) => {
    await database_js_1.default.execute('UPDATE file_metadata SET last_verified_at = NOW(), updated_at = NOW() WHERE id = ?', [id]);
    return (0, exports.findById)(id);
};
exports.updateLastVerified = updateLastVerified;
/**
 * 물리 삭제 (실제로 사용하지 않음, 논리 삭제 권장)
 * @param {number} id
 */
const remove = async (id) => {
    await database_js_1.default.execute('DELETE FROM file_metadata WHERE id = ?', [id]);
};
exports.remove = remove;
/**
 * 상태별 파일 목록 조회
 * @param {string} status
 * @returns {Array}
 */
const findByStatus = async (status) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata WHERE status = ?', [status]);
    return rows;
};
exports.findByStatus = findByStatus;
/**
 * 검증이 필요한 파일 목록 (마지막 검증 후 N일 경과)
 * @param {number} days
 * @returns {Array}
 */
const findNeedVerification = async (days = 7) => {
    const [rows] = await database_js_1.default.execute(`SELECT * FROM file_metadata
        WHERE status = 'ACTIVE'
        AND (last_verified_at IS NULL OR last_verified_at < DATE_SUB(NOW(), INTERVAL ? DAY))`, [days]);
    return rows;
};
exports.findNeedVerification = findNeedVerification;

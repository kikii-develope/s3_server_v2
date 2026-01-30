"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findByDateRange = exports.findByChangedBy = exports.findByAction = exports.findByFileMetadataId = exports.findById = exports.create = void 0;
const database_js_1 = __importDefault(require("../config/database.js"));
/**
 * 파일 이력 생성
 * @param {Object} data
 * @returns {Object}
 */
const create = async (data) => {
    const { fileMetadataId, action, oldEtag = null, newEtag = null, oldHash = null, newHash = null, changedBy, reason = null } = data;
    const [result] = await database_js_1.default.execute(`INSERT INTO file_metadata_history
        (file_metadata_id, action, old_etag, new_etag, old_hash, new_hash, changed_by, reason)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [fileMetadataId, action, oldEtag, newEtag, oldHash, newHash, changedBy, reason]);
    return (0, exports.findById)(result.insertId);
};
exports.create = create;
/**
 * ID로 이력 조회
 * @param {number} id
 * @returns {Object|null}
 */
const findById = async (id) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata_history WHERE id = ?', [id]);
    return rows[0] || null;
};
exports.findById = findById;
/**
 * 파일 메타데이터 ID로 이력 조회
 * @param {number} fileMetadataId
 * @returns {Array}
 */
const findByFileMetadataId = async (fileMetadataId) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata_history WHERE file_metadata_id = ? ORDER BY created_at DESC', [fileMetadataId]);
    return rows;
};
exports.findByFileMetadataId = findByFileMetadataId;
/**
 * 액션 타입으로 이력 조회
 * @param {string} action - UPLOAD, UPDATE, DELETE, DESYNC, VERIFY
 * @param {number} limit
 * @returns {Array}
 */
const findByAction = async (action, limit = 100) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata_history WHERE action = ? ORDER BY created_at DESC LIMIT ?', [action, limit]);
    return rows;
};
exports.findByAction = findByAction;
/**
 * 변경자로 이력 조회
 * @param {string} changedBy
 * @param {number} limit
 * @returns {Array}
 */
const findByChangedBy = async (changedBy, limit = 100) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata_history WHERE changed_by = ? ORDER BY created_at DESC LIMIT ?', [changedBy, limit]);
    return rows;
};
exports.findByChangedBy = findByChangedBy;
/**
 * 기간별 이력 조회
 * @param {Date} startDate
 * @param {Date} endDate
 * @returns {Array}
 */
const findByDateRange = async (startDate, endDate) => {
    const [rows] = await database_js_1.default.execute('SELECT * FROM file_metadata_history WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC', [startDate, endDate]);
    return rows;
};
exports.findByDateRange = findByDateRange;

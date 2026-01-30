"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatEtagHeader = exports.parseIfMatchHeader = exports.compareHash = exports.extractHashFromEtag = exports.generateEtag = exports.calculateHash = void 0;
const crypto_1 = __importDefault(require("crypto"));
/**
 * SHA-256 해시 계산
 * @param {Buffer} buffer - 파일 버퍼
 * @returns {string} hex 문자열
 */
const calculateHash = (buffer) => {
    return crypto_1.default.createHash('sha256').update(buffer).digest('hex');
};
exports.calculateHash = calculateHash;
/**
 * ETag 생성 (v1-contentHash 형식)
 * @param {string} contentHash - 콘텐츠 해시
 * @returns {string} ETag 값
 */
const generateEtag = (contentHash) => {
    return `v1-${contentHash}`;
};
exports.generateEtag = generateEtag;
/**
 * ETag에서 content_hash 추출
 * @param {string} etag - ETag 값 (v1-xxx 형식)
 * @returns {string|null} content_hash
 */
const extractHashFromEtag = (etag) => {
    if (!etag)
        return null;
    const match = etag.match(/^v\d+-(.+)$/);
    return match ? match[1] : etag;
};
exports.extractHashFromEtag = extractHashFromEtag;
/**
 * 두 해시 비교
 * @param {string} hash1
 * @param {string} hash2
 * @returns {boolean}
 */
const compareHash = (hash1, hash2) => {
    if (!hash1 || !hash2)
        return false;
    return hash1.toLowerCase() === hash2.toLowerCase();
};
exports.compareHash = compareHash;
/**
 * If-Match 헤더에서 ETag 추출
 * @param {string} ifMatchHeader - If-Match 헤더 값 (예: "abc123" 또는 abc123)
 * @returns {string|null}
 */
const parseIfMatchHeader = (ifMatchHeader) => {
    if (!ifMatchHeader)
        return null;
    // 쌍따옴표 제거
    return ifMatchHeader.replace(/^"(.*)"$/, '$1').trim();
};
exports.parseIfMatchHeader = parseIfMatchHeader;
/**
 * ETag 포맷팅 (응답 헤더용)
 * @param {string} etag
 * @returns {string} 쌍따옴표로 감싼 ETag
 */
const formatEtagHeader = (etag) => {
    if (!etag)
        return null;
    // 이미 쌍따옴표가 있으면 그대로 반환
    if (etag.startsWith('"') && etag.endsWith('"')) {
        return etag;
    }
    return `"${etag}"`;
};
exports.formatEtagHeader = formatEtagHeader;

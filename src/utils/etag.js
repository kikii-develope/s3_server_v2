import crypto from 'crypto';

/**
 * SHA-256 해시 계산
 * @param {Buffer} buffer - 파일 버퍼
 * @returns {string} hex 문자열
 */
export const calculateHash = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

/**
 * ETag 생성 (SHA-256 기반)
 * @param {Buffer} buffer - 파일 버퍼
 * @returns {string} ETag 값
 */
export const generateEtag = (buffer) => {
    return calculateHash(buffer);
};

/**
 * 두 해시 비교
 * @param {string} hash1
 * @param {string} hash2
 * @returns {boolean}
 */
export const compareHash = (hash1, hash2) => {
    if (!hash1 || !hash2) return false;
    return hash1.toLowerCase() === hash2.toLowerCase();
};

/**
 * If-Match 헤더에서 ETag 추출
 * @param {string} ifMatchHeader - If-Match 헤더 값 (예: "abc123" 또는 abc123)
 * @returns {string|null}
 */
export const parseIfMatchHeader = (ifMatchHeader) => {
    if (!ifMatchHeader) return null;
    // 쌍따옴표 제거
    return ifMatchHeader.replace(/^"(.*)"$/, '$1').trim();
};

/**
 * ETag 포맷팅 (응답 헤더용)
 * @param {string} etag
 * @returns {string} 쌍따옴표로 감싼 ETag
 */
export const formatEtagHeader = (etag) => {
    if (!etag) return null;
    // 이미 쌍따옴표가 있으면 그대로 반환
    if (etag.startsWith('"') && etag.endsWith('"')) {
        return etag;
    }
    return `"${etag}"`;
};

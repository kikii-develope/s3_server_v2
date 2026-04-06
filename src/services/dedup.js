/**
 * src/services/dedup.js
 * content_hash 기반 중복 변환 방지
 * SHA-256을 Stream으로 계산 (파일 전체를 메모리에 올리지 않음)
 * console 미사용
 */

import crypto from 'crypto';
import fs from 'fs';
import { findByHash } from '../repositories/convertMetadataRepo.js';

/**
 * 파일 SHA-256 해시 계산 (Stream 방식)
 * @param {string} filePath
 * @returns {Promise<string>} hex hash
 */
export const hashFileStream = (filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
};

/**
 * 이미 완료된 동일 파일 조회
 * @returns {object|null} DB 레코드 or null
 */
export const findDuplicate = async (contentHash) => {
    return findByHash(contentHash);
};

/**
 * ETag 생성 (content_hash 기반)
 */
export const generateEtag = (contentHash) => {
    return `"${contentHash.substring(0, 16)}"`;
};

/**
 * B-lite NAS 파일 스캔 스크립트
 *
 * NAS의 모든 파일을 스캔하여 file_metadata에 등록
 * - hash 계산 없이 경량으로 등록
 * - etag, content_hash는 NULL (나중에 lazy 생성)
 *
 * 사용법: node src/scripts/scanNasFiles.js [시작경로]
 * 예시: node src/scripts/scanNasFiles.js /
 *       node src/scripts/scanNasFiles.js /www (배포 환경)
 *       node src/scripts/scanNasFiles.js /kikii_test (개발 환경)
 */

import 'dotenv/config';
import { createClient } from 'webdav';
import pool from '../config/database.js';
import * as fileMetadataRepo from '../repositories/fileMetadataRepo.js';
import mime from 'mime-types';

const webdavUrl = process.env.WEBDAV_URL;

const client = createClient(webdavUrl, {
    username: process.env.WEBDAV_USER,
    password: process.env.WEBDAV_PASSWORD
});

// 통계
const stats = {
    scanned: 0,
    inserted: 0,
    skipped: 0,
    errors: 0
};

/**
 * 디렉토리 내용 조회
 */
const getDirectoryContents = async (path) => {
    try {
        return await client.getDirectoryContents(path);
    } catch (error) {
        console.error(`디렉토리 조회 실패: ${path}`, error.message);
        return null;
    }
};

/**
 * 파일 메타데이터 등록
 */
const registerFile = async (item, parentPath) => {
    const filePath = parentPath === '/'
        ? item.basename
        : `${parentPath.replace(/^\//, '')}/${item.basename}`;

    try {
        // 이미 등록된 파일인지 확인
        const existing = await fileMetadataRepo.findByFilePath(filePath);

        if (existing) {
            stats.skipped++;
            return;
        }

        // 파일 정보 추출
        const fileName = item.basename;
        const extension = fileName.includes('.')
            ? fileName.split('.').pop()?.toLowerCase()
            : '';
        const mimeType = mime.lookup(extension) || 'application/octet-stream';
        const fileSize = item.size || 0;

        // INSERT (hash, etag 없이)
        await fileMetadataRepo.create({
            filePath: filePath,
            fileName: fileName,
            extension: extension,
            mimeType: mimeType,
            fileSize: fileSize,
            contentHash: null,
            etag: null,
            status: 'ACTIVE'
        });

        stats.inserted++;
        console.log(`[등록] ${filePath}`);

    } catch (error) {
        stats.errors++;
        console.error(`[에러] ${filePath}:`, error.message);
    }
};

/**
 * 재귀적으로 디렉토리 스캔
 */
const scanDirectory = async (path) => {
    console.log(`\n[스캔] ${path}`);

    const contents = await getDirectoryContents(path);

    if (!contents) {
        return;
    }

    for (const item of contents) {
        stats.scanned++;

        if (item.type === 'directory') {
            // 재귀 탐색
            const subPath = path === '/' ? `/${item.basename}` : `${path}/${item.basename}`;
            await scanDirectory(subPath);
        } else if (item.type === 'file') {
            await registerFile(item, path);
        }
    }
};

/**
 * 메인 실행
 */
const main = async () => {
    const startPath = process.argv[2] || '/';

    console.log('========================================');
    console.log('B-lite NAS 파일 스캔 시작');
    console.log('========================================');
    console.log(`WebDAV URL: ${webdavUrl}`);
    console.log(`시작 경로: ${startPath}`);
    console.log(`시작 시간: ${new Date().toISOString()}`);
    console.log('----------------------------------------');

    const startTime = Date.now();

    try {
        await scanDirectory(startPath);
    } catch (error) {
        console.error('스캔 중 오류 발생:', error);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n========================================');
    console.log('스캔 완료');
    console.log('========================================');
    console.log(`총 스캔: ${stats.scanned}개`);
    console.log(`신규 등록: ${stats.inserted}개`);
    console.log(`이미 존재 (스킵): ${stats.skipped}개`);
    console.log(`에러: ${stats.errors}개`);
    console.log(`소요 시간: ${duration}초`);
    console.log(`종료 시간: ${new Date().toISOString()}`);
    console.log('========================================');

    // DB 연결 종료
    await pool.end();
    process.exit(0);
};

main().catch((error) => {
    console.error('치명적 오류:', error);
    process.exit(1);
});

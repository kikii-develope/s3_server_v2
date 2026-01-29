/**
 * DESYNC 감지 크론잡 스크립트
 *
 * DB의 file_metadata와 실제 NAS 파일을 비교하여 불일치 감지
 * - 파일 존재 여부 확인
 * - 파일 크기 비교
 * - (선택) 해시 비교
 *
 * 사용법: node src/scripts/detectDesync.js [--verify-hash] [--limit=1000]
 *
 * 크론잡 예시 (매일 새벽 3시):
 * 0 3 * * * cd /path/to/project && node src/scripts/detectDesync.js >> logs/desync.log 2>&1
 */

import 'dotenv/config';
import { createClient } from 'webdav';
import pool from '../config/database.js';
import * as fileMetadataRepo from '../repositories/fileMetadataRepo.js';
import * as fileHistoryRepo from '../repositories/fileHistoryRepo.js';
import { calculateHash, generateEtag } from '../utils/etag.js';

const webdavUrl = process.env.WEBDAV_URL;

const client = createClient(webdavUrl, {
    username: process.env.WEBDAV_USER,
    password: process.env.WEBDAV_PASSWORD
});

// 명령줄 옵션 파싱
const args = process.argv.slice(2);
const verifyHash = args.includes('--verify-hash');
const limitArg = args.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 1000;

// 통계
const stats = {
    checked: 0,
    ok: 0,
    missing: 0,
    sizeMismatch: 0,
    hashMismatch: 0,
    errors: 0
};

/**
 * DB에서 ACTIVE 상태 파일 목록 조회
 */
const getActiveFiles = async (limit = 1000, offset = 0) => {
    const [rows] = await pool.execute(
        `SELECT id, file_path, file_name, file_size, content_hash, etag
         FROM file_metadata
         WHERE status = 'ACTIVE'
         ORDER BY id
         LIMIT ? OFFSET ?`,
        [limit.toString(), offset.toString()]
    );
    return rows;
};

/**
 * 전체 ACTIVE 파일 수 조회
 */
const getTotalActiveCount = async () => {
    const [rows] = await pool.execute(
        `SELECT COUNT(*) as total FROM file_metadata WHERE status = 'ACTIVE'`
    );
    return rows[0].total;
};

/**
 * WebDAV에서 파일 정보 조회
 */
const getFileInfo = async (filePath) => {
    try {
        // 경로 정규화 - 슬래시로 시작해야 함
        const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
        const stat = await client.stat(normalizedPath);
        return {
            exists: true,
            size: stat.size,
            lastmod: stat.lastmod
        };
    } catch (error) {
        if (error.response?.status === 404 || error.message.includes('404')) {
            return { exists: false };
        }
        throw error;
    }
};

/**
 * WebDAV에서 파일 다운로드 후 해시 계산
 */
const getFileHash = async (filePath) => {
    try {
        const normalizedPath = filePath.startsWith('/') ? filePath : '/' + filePath;
        const content = await client.getFileContents(normalizedPath);
        return calculateHash(Buffer.from(content));
    } catch (error) {
        console.error(`해시 계산 실패: ${filePath}`, error.message);
        return null;
    }
};

/**
 * 파일 상태를 DESYNC로 업데이트
 */
const markAsDesync = async (fileId, filePath, reason) => {
    try {
        await fileMetadataRepo.updateStatus(fileId, 'DESYNC');
        await fileHistoryRepo.create({
            fileMetadataId: fileId,
            action: 'DESYNC',
            reason: reason,
            etag: null,
            contentHash: null,
            fileSize: null,
            userId: 'system:desync_detector'
        });
        console.log(`[DESYNC] ${filePath} - ${reason}`);
    } catch (error) {
        console.error(`[에러] DESYNC 마킹 실패: ${filePath}`, error.message);
    }
};

/**
 * 파일 상태를 MISSING으로 업데이트
 */
const markAsMissing = async (fileId, filePath) => {
    try {
        await fileMetadataRepo.updateStatus(fileId, 'MISSING');
        await fileHistoryRepo.create({
            fileMetadataId: fileId,
            action: 'DESYNC',
            reason: 'NAS에서 파일을 찾을 수 없음',
            etag: null,
            contentHash: null,
            fileSize: null,
            userId: 'system:desync_detector'
        });
        console.log(`[MISSING] ${filePath}`);
    } catch (error) {
        console.error(`[에러] MISSING 마킹 실패: ${filePath}`, error.message);
    }
};

/**
 * 단일 파일 검증
 */
const verifyFile = async (file) => {
    stats.checked++;

    try {
        // 1. 파일 존재 여부 확인
        const fileInfo = await getFileInfo(file.file_path);

        if (!fileInfo.exists) {
            stats.missing++;
            await markAsMissing(file.id, file.file_path);
            return;
        }

        // 2. 파일 크기 비교 (DB에 크기가 있는 경우만)
        if (file.file_size && fileInfo.size !== file.file_size) {
            stats.sizeMismatch++;
            await markAsDesync(file.id, file.file_path,
                `파일 크기 불일치 (DB: ${file.file_size}, NAS: ${fileInfo.size})`);
            return;
        }

        // 3. 해시 비교 (옵션이 활성화되고, DB에 해시가 있는 경우만)
        if (verifyHash && file.content_hash) {
            const actualHash = await getFileHash(file.file_path);
            if (actualHash && actualHash !== file.content_hash) {
                stats.hashMismatch++;
                await markAsDesync(file.id, file.file_path,
                    `해시 불일치 (DB: ${file.content_hash.substring(0, 16)}..., NAS: ${actualHash.substring(0, 16)}...)`);
                return;
            }
        }

        stats.ok++;

    } catch (error) {
        stats.errors++;
        console.error(`[에러] ${file.file_path}:`, error.message);
    }
};

/**
 * 배치 검증
 */
const verifyBatch = async (files) => {
    // 동시 처리 수 제한 (NAS 부하 방지)
    const concurrency = 5;

    for (let i = 0; i < files.length; i += concurrency) {
        const batch = files.slice(i, i + concurrency);
        await Promise.all(batch.map(file => verifyFile(file)));

        // 진행 상황 출력 (100건마다)
        if (stats.checked % 100 === 0) {
            console.log(`진행: ${stats.checked}건 검사 완료...`);
        }
    }
};

/**
 * 메인 실행
 */
const main = async () => {
    console.log('========================================');
    console.log('DESYNC 감지 스크립트 시작');
    console.log('========================================');
    console.log(`WebDAV URL: ${webdavUrl}`);
    console.log(`해시 검증: ${verifyHash ? '활성화' : '비활성화'}`);
    console.log(`처리 제한: ${limit}건`);
    console.log(`시작 시간: ${new Date().toISOString()}`);
    console.log('----------------------------------------');

    const startTime = Date.now();

    try {
        // 전체 파일 수 확인
        const totalCount = await getTotalActiveCount();
        console.log(`전체 ACTIVE 파일 수: ${totalCount}개`);
        console.log(`이번 검사 대상: ${Math.min(limit, totalCount)}개`);
        console.log('----------------------------------------');

        // 배치로 파일 조회 및 검증
        let offset = 0;
        const batchSize = 100;

        while (offset < limit) {
            const files = await getActiveFiles(Math.min(batchSize, limit - offset), offset);

            if (files.length === 0) break;

            await verifyBatch(files);
            offset += files.length;
        }

    } catch (error) {
        console.error('검증 중 오류 발생:', error);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n========================================');
    console.log('검증 완료');
    console.log('========================================');
    console.log(`총 검사: ${stats.checked}개`);
    console.log(`정상: ${stats.ok}개`);
    console.log(`누락: ${stats.missing}개`);
    console.log(`크기 불일치: ${stats.sizeMismatch}개`);
    console.log(`해시 불일치: ${stats.hashMismatch}개`);
    console.log(`에러: ${stats.errors}개`);
    console.log(`소요 시간: ${duration}초`);
    console.log(`종료 시간: ${new Date().toISOString()}`);
    console.log('========================================');

    // 요약 - 문제가 발견된 경우 강조
    const problems = stats.missing + stats.sizeMismatch + stats.hashMismatch;
    if (problems > 0) {
        console.log(`\n[경고] ${problems}개의 불일치가 발견되었습니다!`);
    } else {
        console.log('\n[정상] 모든 파일이 동기화 상태입니다.');
    }

    // DB 연결 종료
    await pool.end();
    process.exit(problems > 0 ? 1 : 0);
};

main().catch((error) => {
    console.error('치명적 오류:', error);
    process.exit(1);
});

/**
 * src/services/videoQueue.js
 * 영상 변환을 비동기로 처리하기 위한 BullMQ Queue & Worker
 * console 미사용 (저수준 로그 툴 사용)
 */

import { Queue, Worker } from 'bullmq';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { processVideo } from './mediaProcessor.js';
import { atomicUpload, webdavFileExists } from './web_dav/webdavClient.js';
import { safeDeleteMany } from '../utils/tempCleaner.js';
import { isRetryable } from '../utils/errorClassifier.js';
import { dbLog } from '../utils/dbLogger.js';
import * as repo from '../repositories/convertMetadataRepo.js';
import { getWebdavRootPath } from '../utils/webdavRootPath.js';

const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT) || 6379,
};
const rootPath = getWebdavRootPath();

// Queue 인스턴스
export const videoQueue = new Queue('video-convert', { connection });

/**
 * CPU 연산 코어 수 기반 동시성 확보
 */
const getConcurrency = () => {
    const env = parseInt(process.env.VIDEO_CONCURRENCY);
    if (!isNaN(env) && env > 0) return env;
    // 코어 수의 절반을 활용하되, 최소 1, 최대 2 수준에서 보수적으로 동작
    return Math.max(1, Math.floor(os.cpus().length / 2));
};

/**
 * 작업을 큐에 추가
 */
export const addVideoJob = async (metadataId, inputPath, webdavPath) => {
    return videoQueue.add(
        'convert',
        { metadataId, inputPath, webdavPath },
        {
            attempts: 3, // 최대 3회 시도
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true, // 메모리 릭 방지
            removeOnFail: 1000,
        }
    );
};

/**
 * Worker 기동
 */
export const startVideoWorker = () => {
    const workerId = `w-${os.hostname()}-${process.pid}`;

    const worker = new Worker(
        'video-convert',
        async (job) => {
            const { metadataId, inputPath, webdavPath } = job.data;
            let outputPath = null;
            let completed = false;

            // ── 1. DB 락 (중복 Worker 실행 방지) ──
            const locked = await repo.acquireLock(metadataId, workerId);
            if (!locked) return;

            try {
                // ── 2. 멱등성 (이미 업로드 되어있나 체크) ──
                if (await webdavFileExists(webdavPath)) {
                    await repo.updateStatus(metadataId, 'completed');
                    safeDeleteMany(inputPath);
                    return;
                }

                // ── 3. processing ──
                await repo.updateStatus(metadataId, 'processing');
                await dbLog('info', '영상 변환 시작', metadataId);

                // inputPath가 없을 수 있음 (좀비 재복구된 경우 원본에서 다시 받거나 실패 처리 등)
                // 현재 v7.1에서는 임시 파일이 존재하는 경우만 지원
                if (!inputPath || !fs.existsSync(inputPath)) {
                    throw new Error('No such file: 임시 원본 파일이 유실되었습니다.');
                }

                const result = await processVideo(inputPath);
                outputPath = result.outputPath;

                // ── 4. uploading → atomic ──
                await repo.updateStatus(metadataId, 'uploading');
                const tempNasPath = `/${rootPath}/${webdavPath}.__uploading__`;
                await repo.saveTempPath(metadataId, tempNasPath); // 충돌 시 cleanup 추적용

                await atomicUpload(`/${rootPath}/${webdavPath}`, outputPath);

                // ── 5. completed ──
                const stat = fs.statSync(outputPath);
                await repo.markCompleted(metadataId, {
                    convertedPath: webdavPath,
                    convertedName: path.basename(webdavPath),
                    convertedExt: result.format,
                    convertedSize: stat.size,
                });
                await dbLog('info', '영상 변환 분산 처리 완료', metadataId);
                completed = true;
            } finally {
                if (completed) {
                    safeDeleteMany(inputPath, outputPath);
                } else {
                    safeDeleteMany(outputPath);
                }
                await repo.releaseLock(metadataId);
            }
        },
        { connection, concurrency: getConcurrency() }
    );

    worker.on('failed', async (job, err) => {
        if (!job) return;
        const { metadataId, inputPath } = job.data;
        const retryable = isRetryable(err);
        const maxAttempts = Number(job.opts?.attempts || 1);
        const exhausted = Number(job.attemptsMade || 0) >= maxAttempts;

        try {
            const metadata = await repo.findById(metadataId);
            const isCya = String(metadata?.original_ext || '').toLowerCase() === 'cya';

            if (isCya && inputPath && fs.existsSync(inputPath) && (!retryable || exhausted)) {
                const originalPath = String(metadata?.original_path || '').replace(/^\/+/, '');
                if (originalPath) {
                    await repo.updateStatus(metadataId, 'uploading');
                    await repo.saveTempPath(metadataId, `/${rootPath}/${originalPath}.__uploading__`);
                    await atomicUpload(`/${rootPath}/${originalPath}`, inputPath);

                    const stat = fs.statSync(inputPath);
                    await repo.markCompleted(metadataId, {
                        convertedPath: originalPath,
                        convertedName: path.basename(originalPath),
                        convertedExt: metadata?.original_ext || path.extname(originalPath).replace('.', ''),
                        convertedSize: stat.size,
                    });

                    safeDeleteMany(inputPath);
                    await dbLog('warn', `CYA 변환 실패로 원본 업로드로 대체: ${err.message}`, metadataId);
                    await repo.releaseLock(metadataId);
                    return;
                }
            }
        } catch (fallbackErr) {
            await dbLog('error', `CYA fallback 처리 실패: ${fallbackErr.message}`, metadataId);
        }

        await repo.updateStatus(metadataId, 'failed', err.message);
        await repo.updateFailureType(metadataId, retryable ? 'retryable' : 'permanent');
        await repo.incrementRetry(metadataId);
        await dbLog(
            'error',
            `영상 실패[${retryable ? 'retry' : 'perm'}]: ${err.message}`,
            metadataId
        );

        if (!retryable) {
            job.discard(); // 영구 실패면 재시도 큐에서 완전 버림
            safeDeleteMany(inputPath);
        } else if (exhausted) {
            safeDeleteMany(inputPath);
        }
        await repo.releaseLock(metadataId);
    });

    return worker;
};

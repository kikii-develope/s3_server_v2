import {
    createDirectory,
    getBaseUrl,
    getRootPath,
    existDirectory,
    deleteFile,
    deleteDirectory,
    moveFile,
    copyFile,
    updateFile,
    getDirectoryContents,
    getFileStream,
    fileExists,
    getFileStat,
    downloadToTempFile,
    uploadLargeFile,
    calculateHashFromFile,
    deleteLocalFile
} from '../services/web_dav/index.js';
import mime from 'mime-types';
import { successResponse, errorResponse } from '../utils/response.js';
import { generateEtag, compareHash, formatEtagHeader } from '../utils/etag.js';
import path from 'path';
import os from 'os';

// CPU 사용률 측정을 위한 이전 값 저장
let prevCpuUsage = process.cpuUsage();
let prevCpuTime = Date.now();

/**
 * multer가 받은 파일명을 올바르게 디코딩
 * multer는 파일명을 latin1로 디코딩하므로 한글이 깨짐
 * @param {string} filename - 원본 파일명
 * @returns {string} - 디코딩된 파일명
 */
const decodeFilename = (filename) => {
    if (!filename) return filename;

    try {
        // multer는 파일명을 latin1로 디코딩하므로, utf-8로 재인코딩
        return Buffer.from(filename, 'latin1').toString('utf8');
    } catch (error) {
        console.warn('[파일명 디코딩 실패]', filename, error.message);
        return filename;
    }
};

/**
 * 파일명에 확장자가 없으면 원본 파일의 확장자를 추가
 * @param {string} filename - 사용자가 입력한 파일명
 * @param {string} originalname - 원본 파일명
 * @returns {string} - 확장자가 포함된 파일명
 */
const ensureFileExtension = (filename, originalname) => {
    if (!filename || !originalname) return filename;

    // filename에 확장자가 있는지 확인 (마지막 . 이후에 문자가 있는지)
    const hasExtension = /\.[^.]+$/.test(filename);

    if (!hasExtension) {
        // originalname에서 확장자 추출
        const match = originalname.match(/\.[^.]+$/);
        if (match) {
            filename += match[0]; // 확장자 추가
            console.log(`[확장자 자동 추가] ${filename.replace(match[0], '')} → ${filename}`);
        }
    }

    return filename;
};

/**
 * URL 또는 경로에서 실제 파일 경로만 추출
 * @param {string} input - 전체 URL 또는 경로
 * @returns {string} - 루트 경로 이후의 실제 경로
 */
const extractFilePath = (input) => {
    if (!input) return input;

    // URL인 경우 pathname 추출
    if (input.startsWith('http://') || input.startsWith('https://')) {
        try {
            const url = new URL(input);
            input = url.pathname;
        } catch {
            // URL 파싱 실패시 그대로 사용
        }
    }

    const rootPath = getRootPath();

    // /{rootPath}/로 시작하면 제거
    if (input.startsWith(`/${rootPath}/`)) {
        input = input.slice(rootPath.length + 2); // '/{rootPath}/' 제거
    } else if (input.startsWith(`/${rootPath}`)) {
        input = input.slice(rootPath.length + 1); // '/{rootPath}' 제거
    }

    // 앞의 슬래시 제거
    if (input.startsWith('/')) {
        input = input.slice(1);
    }

    return input;
};

/**
 * WebDAV 파일 업로드 컨트롤러 (Disk Storage + 청크 업로드)
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const uploadFileToWebDAV = async (req, res) => {
    // 시작 시간 및 메모리 측정
    const startTime = Date.now();
    const startMemory = process.memoryUsage();

    try {
        const { path: uploadPath, filename, domain_type, domain_id, userId } = req.body;
        const file = req.file;

        if (!file) {
            return errorResponse(res, '파일이 없습니다.', 400);
        }

        if (!uploadPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // filename이 없으면 file.originalname 사용 (디코딩 필요)
        let uploadFilename = filename || decodeFilename(file.originalname);

        // 확장자가 없으면 원본 파일의 확장자 추가
        uploadFilename = ensureFileExtension(uploadFilename, decodeFilename(file.originalname));

        // multer 임시파일명에서 수신 시작 시간 추출 (파일명 형식: {timestamp}-{random}-{originalname})
        const multerTimestamp = parseInt(file.filename.split('-')[0], 10) || startTime;

        console.log(`[UPLOAD] 파일: ${uploadFilename} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
        console.log(`[UPLOAD] 임시 파일 경로: ${file.path}`);

        // 진행률 콜백
        const onProgress = (progress) => {
            if (progress.type === 'single') {
                console.log(`[PROGRESS] ${progress.percentage}%`);
            } else if (progress.type === 'multipart') {
                console.log(`[PROGRESS] 청크 ${progress.uploadedChunks}/${progress.totalChunks} (${progress.percentage}%)`);
            }
        };

        const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

        // 100MB 미만: 업로드+해시 병렬, 100MB 이상: 순차 (I/O 과부하 방지)
        const isLargeFile = file.size >= 100 * 1024 * 1024;
        const parallelStart = Date.now();
        let uploadDuration, hashDuration;
        let result, contentHash;

        if (isLargeFile) {
            // 대용량: 업로드 완료 후 해시 (디스크 I/O 분산)
            const uploadStart = Date.now();
            result = await uploadLargeFile(uploadPath, file, uploadFilename, onProgress);
            uploadDuration = Date.now() - uploadStart;

            const hashStart = Date.now();
            contentHash = await calculateHashFromFile(file.path);
            hashDuration = Date.now() - hashStart;

            console.log(`[UPLOAD] 대용량 파일 — 업로드→해시 순차 실행`);
        } else {
            // 소용량: 병렬 실행 (multer 임시파일을 동시에 읽기만 하므로 충돌 없음)
            [result, contentHash] = await Promise.all([
                (async () => {
                    const start = Date.now();
                    const r = await uploadLargeFile(uploadPath, file, uploadFilename, onProgress);
                    uploadDuration = Date.now() - start;
                    return r;
                })(),
                (async () => {
                    const start = Date.now();
                    const h = await calculateHashFromFile(file.path);
                    hashDuration = Date.now() - start;
                    return h;
                })()
            ]);
        }

        const afterParallelMemory = process.memoryUsage();

        // 파일 정보 추출
        const actualFilename = result.filename;
        const extension = actualFilename.includes('.')
            ? actualFilename.split('.').pop()?.toLowerCase()
            : '';
        const filePath = `${uploadPath}/${actualFilename}`;
        const mimeType = file.mimetype || mime.lookup(extension) || 'application/octet-stream';
        const etag = generateEtag(contentHash);

        // 로컬 임시 파일 삭제
        const cleanupStart = Date.now();
        await deleteLocalFile(file.path);
        const cleanupDuration = Date.now() - cleanupStart;

        // 종료 시간 및 메모리 측정
        const endTime = Date.now();
        const endMemory = process.memoryUsage();
        const multerReceiveSec = ((startTime - multerTimestamp) / 1000).toFixed(2);
        const processingSec = ((endTime - startTime) / 1000).toFixed(2);
        const totalWallClockSec = ((endTime - multerTimestamp) / 1000).toFixed(2);
        const fileSizeMB = toMB(file.size);
        const uploadSpeedMBps = uploadDuration > 0 ? (file.size / 1024 / 1024 / (uploadDuration / 1000)).toFixed(2) : '0';

        // 통계 로그 출력
        const parallelSaved = Math.max(0, (uploadDuration + hashDuration) - (Date.now() - parallelStart - cleanupDuration));
        console.log('\n┌─────────────────────────────────────────────────────────────');
        console.log(`| [UPLOAD] ${actualFilename}`);
        console.log('├─────────────────────────────────────────────────────────────');
        console.log(`| 파일 크기: ${fileSizeMB} MB`);
        console.log(`| 업로드 방식: ${result.uploadType === 'multipart' ? `청크 (${result.chunks}개)` : '단일'}`);
        console.log('├── 소요 시간 (업로드+해시 병렬) ──────────────────────────────');
        console.log(`| 파일 수신(multer): ${multerReceiveSec}초`);
        console.log(`| WebDAV 업로드:     ${(uploadDuration / 1000).toFixed(2)}초 (${uploadSpeedMBps} MB/s)`);
        console.log(`| 해시 계산:         ${(hashDuration / 1000).toFixed(2)}초 (병렬 실행)`);
        console.log(`| 임시파일 삭제:     ${(cleanupDuration / 1000).toFixed(2)}초`);
        console.log(`| 병렬 절감:         ~${(parallelSaved / 1000).toFixed(2)}초`);
        console.log('├── 총 시간 ───────────────────────────────────────────────────');
        console.log(`| 처리 시간:         ${processingSec}초`);
        console.log(`| 총 시간(수신+처리): ${totalWallClockSec}초`);
        console.log('├── 메모리 ────────────────────────────────────────────────────');
        console.log(`| 시작:          ${toMB(startMemory.heapUsed)} MB`);
        console.log(`| 병렬 처리 후:  ${toMB(afterParallelMemory.heapUsed)} MB (+${toMB(afterParallelMemory.heapUsed - startMemory.heapUsed)} MB)`);
        console.log(`| 최종:          ${toMB(endMemory.heapUsed)} MB`);
        console.log('├── 메모리 요약 ───────────────────────────────────────────────');
        console.log(`| 힙: ${toMB(endMemory.heapUsed)} / ${toMB(endMemory.heapTotal)} MB | RSS: ${toMB(endMemory.rss)} MB`);
        console.log(`| 총 증가: ${toMB(endMemory.heapUsed - startMemory.heapUsed)} MB`);
        console.log('└─────────────────────────────────────────────────────────────\n');

        res.set('ETag', formatEtagHeader(etag));
        return successResponse(res, 'WebDAV 파일 업로드 성공', {
            path: `${getBaseUrl()}/${getRootPath()}/${filePath}`,
            filename: result.filename,
            size: result.size,
            url: result.url,
            uploadType: result.uploadType, // 'single' 또는 'multipart'
            chunks: result.chunks, // 청크 업로드시만
            etag: etag,
            stats: {
                multerReceiveSeconds: parseFloat(multerReceiveSec),
                processingSeconds: parseFloat(processingSec),
                totalWallClockSeconds: parseFloat(totalWallClockSec),
                uploadSeconds: parseFloat((uploadDuration / 1000).toFixed(2)),
                hashSeconds: parseFloat((hashDuration / 1000).toFixed(2)),
                uploadSpeedMBps: parseFloat(uploadSpeedMBps),
                memoryHeapUsedMB: parseFloat(toMB(endMemory.heapUsed)),
                memoryIncreaseMB: parseFloat(toMB(endMemory.heapUsed - startMemory.heapUsed)),
                memoryRssMB: parseFloat(toMB(endMemory.rss))
            }
        });

    } catch (error) {
        console.error('WebDAV 업로드 에러:', error);

        // 실패시 로컬 임시 파일 정리
        if (req.file?.path) {
            await deleteLocalFile(req.file.path);
        }

        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일 다운로드 컨트롤러 (스트리밍 방식)
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const downloadFileFromWebDAV = async (req, res) => {
    try {
        const rawPath = req.params[0] || req.params.path;

        if (!rawPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출
        const filePath = extractFilePath(rawPath);
        const filename = filePath.split('/').pop() || 'download';
        const extension = path.extname(filename).slice(1).toLowerCase();

        // WebDAV에서 파일 stat 조회 (존재 여부 + 크기)
        const webdavPath = `/${getRootPath()}/${filePath}`;
        const stat = await getFileStat(webdavPath);

        if (!stat) {
            return errorResponse(res, '파일을 찾을 수 없습니다.', 404);
        }

        const fileSize = stat.size;

        // 파일 타입별 처리
        let contentType = mime.lookup(extension) || 'application/octet-stream';
        let contentDisposition = req.query.disposition || 'inline';

        if (['txt', 'json', 'xml', 'html', 'css', 'js'].includes(extension)) {
            contentType = 'text/plain';
        }

        // Range 요청 지원 (이어받기)
        const range = req.headers.range;

        // 기본 헤더 설정
        res.set({
            'Content-Type': contentType,
            'Content-Disposition': `${contentDisposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'public, max-age=31536000'
        });

        if (range) {
            // Range 요청 처리 (부분 다운로드)
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            if (start >= fileSize || end >= fileSize) {
                res.status(416).set('Content-Range', `bytes */${fileSize}`);
                return res.end();
            }

            const chunkSize = end - start + 1;

            res.status(206);
            res.set({
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Content-Length': chunkSize
            });

            console.log(`[DOWNLOAD] Range 요청: ${filename} (${start}-${end}/${fileSize})`);

            const stream = getFileStream(webdavPath, { range: { start, end } });
            stream.on('error', (err) => {
                console.error('[DOWNLOAD] Range 스트림 에러:', err.message);
                if (!res.headersSent) {
                    return errorResponse(res, '파일 다운로드 실패', 500);
                }
            });
            return stream.pipe(res);
        } else {
            // 전체 파일 스트리밍
            res.set('Content-Length', fileSize);

            console.log(`[DOWNLOAD] 스트리밍: ${filename} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

            const stream = getFileStream(webdavPath);
            stream.on('error', (err) => {
                console.error('[DOWNLOAD] 스트림 에러:', err.message);
                if (!res.headersSent) {
                    return errorResponse(res, '파일 다운로드 실패', 500);
                }
            });
            return stream.pipe(res);
        }

    } catch (error) {
        console.error('WebDAV 다운로드 에러:', error);
        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 디렉토리 생성 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const createWebDAVDirectory = async (req, res) => {
    try {
        const { path } = req.body;

        if (!path) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        await createDirectory(path);

        return successResponse(res, 'WebDAV 디렉토리 생성 성공', { path });

    } catch (error) {
        console.error('WebDAV 디렉토리 생성 에러:', error);
        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 디렉토리 목록 조회 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const getWebDAVDirectory = async (req, res) => {
    try {
        // 경로 추출 (req.params.path 대신 req.params[0] 사용)
        const rawPath = req.params[0] || req.params.path;

        if (!rawPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출 및 디코딩
        const dirPath = extractFilePath(decodeURIComponent(rawPath));

        const directory = await existDirectory(`/${getRootPath()}/${dirPath}`);

        return successResponse(res, 'WebDAV 디렉토리 조회 성공', { path: dirPath, directory });

    } catch (error) {
        console.error('WebDAV 디렉토리 조회 에러:', error);
        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 서버 정보 조회 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const getWebDAVInfo = async (req, res) => {
    try {
        const baseUrl = getBaseUrl();

        return successResponse(res, 'WebDAV 서버 정보 조회 성공', {
            baseUrl,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('WebDAV 정보 조회 에러:', error);
        return errorResponse(res, error.message);
    }
};


/**
 * 다중 파일 WebDAV 업로드 컨트롤러 (Disk Storage + 청크 업로드)
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const uploadMultipleFilesToWebDAV = async (req, res) => {
    const startTime = Date.now();
    const startMemory = process.memoryUsage();
    const toMB = (bytes) => (bytes / 1024 / 1024).toFixed(2);

    try {
        const { path: uploadPath, filenames } = req.body;
        const files = req.files;

        if (!files || files.length === 0) {
            return errorResponse(res, '파일이 없습니다.', 400);
        }

        if (!uploadPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        let filenamesArray = [];

        // filenames가 없으면 원본 파일명 사용
        if (!filenames) {
            filenamesArray = files.map(f => decodeFilename(f.originalname));
        } else {
            try {
                if (filenames.startsWith("[") && filenames.endsWith("]")) {
                    filenamesArray = JSON.parse(filenames);
                } else {
                    filenamesArray = filenames.split(",").map(s => s.trim());
                }
            } catch (e) {
                console.error("filenames 파싱 실패:", e.message);
                return errorResponse(res, `파일명 배열 형식이 올바르지 않습니다 [${filenames}]`, 400);
            }

            if (files.length !== filenamesArray.length) {
                return errorResponse(res, '파일 개수와 파일명 개수가 동일하지 않습니다.', 400);
            }

            // 각 파일명에 확장자 자동 추가
            filenamesArray = filenamesArray.map((name, i) =>
                ensureFileExtension(name, decodeFilename(files[i].originalname))
            );
        }

        // multer 임시파일명에서 수신 시작 시간 추출 (파일명 형식: {timestamp}-{random}-{originalname})
        const multerFirstTimestamp = parseInt(files[0].filename.split('-')[0], 10) || startTime;

        const totalSizeBytes = files.reduce((sum, f) => sum + f.size, 0);
        console.log(`[MULTI-UPLOAD] ${files.length}개 파일 업로드 시작 (총 ${toMB(totalSizeBytes)} MB)`);

        // 동시성 제한하여 병렬 업로드 (2개씩, 대용량 I/O 안정화)
        const CONCURRENCY = 2;
        const results = [];

        for (let i = 0; i < files.length; i += CONCURRENCY) {
            const batch = files.slice(i, i + CONCURRENCY);
            const batchFilenames = filenamesArray.slice(i, i + CONCURRENCY);

            const batchPromises = batch.map(async (file, index) => {
                const fileStart = Date.now();
                try {
                    const filename = batchFilenames[index];
                    const isLarge = file.size >= 100 * 1024 * 1024;

                    let result, contentHash;
                    if (isLarge) {
                        // 대용량: 순차 (I/O 과부하 방지)
                        result = await uploadLargeFile(uploadPath, file, filename);
                        contentHash = await calculateHashFromFile(file.path);
                    } else {
                        // 소용량: 병렬
                        [result, contentHash] = await Promise.all([
                            uploadLargeFile(uploadPath, file, filename),
                            calculateHashFromFile(file.path)
                        ]);
                    }

                    // 로컬 임시 파일 삭제
                    await deleteLocalFile(file.path);

                    const etag = generateEtag(contentHash);
                    const fileDuration = ((Date.now() - fileStart) / 1000).toFixed(2);
                    console.log(`[MULTI-UPLOAD] ${result.filename} 완료 (${toMB(file.size)} MB, ${fileDuration}초, 해시 병렬)`);

                    return {
                        filename: result.filename,
                        originalFilename: filename,
                        success: true,
                        size: result.size,
                        url: result.url,
                        uploadType: result.uploadType,
                        chunks: result.chunks,
                        etag: etag,
                        durationSeconds: parseFloat(fileDuration)
                    };
                } catch (error) {
                    console.error(`[MULTI-UPLOAD] ${decodeFilename(file.originalname)} 실패:`, error.message);

                    // 실패시 로컬 임시 파일 삭제
                    await deleteLocalFile(file.path);

                    return {
                        filename: decodeFilename(file.originalname),
                        success: false,
                        error: error.message
                    };
                }
            });

            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults);

            console.log(`[MULTI-UPLOAD] 진행중... ${Math.min(i + CONCURRENCY, files.length)}/${files.length}개 완료`);
        }

        const endTime = Date.now();
        const endMemory = process.memoryUsage();
        const multerReceiveSec = ((startTime - multerFirstTimestamp) / 1000).toFixed(2);
        const processingSec = ((endTime - startTime) / 1000).toFixed(2);
        const totalWallClockSec = ((endTime - multerFirstTimestamp) / 1000).toFixed(2);
        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;
        const totalWallClockNum = parseFloat(totalWallClockSec);
        const speedDisplay = totalWallClockNum > 0.1
            ? `${(totalSizeBytes / 1024 / 1024 / totalWallClockNum).toFixed(2)} MB/s`
            : 'N/A';

        console.log('\n┌─────────────────────────────────────────────────────────────');
        console.log(`| [MULTI-UPLOAD] ${files.length}개 파일`);
        console.log('├─────────────────────────────────────────────────────────────');
        console.log(`| 총 크기: ${toMB(totalSizeBytes)} MB | 성공: ${successCount} | 실패: ${failCount}`);
        console.log('├── 소요 시간 ─────────────────────────────────────────────────');
        console.log(`| 파일 수신(multer):  ${multerReceiveSec}초`);
        console.log(`| 처리 시간:          ${processingSec}초`);
        console.log(`| 총 시간(수신+처리): ${totalWallClockSec}초 (${speedDisplay})`);
        console.log('├── 메모리 ────────────────────────────────────────────────────');
        console.log(`| 시작: ${toMB(startMemory.heapUsed)} MB | 최종: ${toMB(endMemory.heapUsed)} MB`);
        console.log(`| 힙: ${toMB(endMemory.heapUsed)} / ${toMB(endMemory.heapTotal)} MB | RSS: ${toMB(endMemory.rss)} MB`);
        console.log(`| 총 증가: ${toMB(endMemory.heapUsed - startMemory.heapUsed)} MB`);
        console.log('└─────────────────────────────────────────────────────────────\n');

        const responseData = {
            path: uploadPath,
            results,
            summary: {
                total: results.length,
                success: successCount,
                failed: failCount
            },
            stats: {
                multerReceiveSeconds: parseFloat(multerReceiveSec),
                processingSeconds: parseFloat(processingSec),
                totalWallClockSeconds: totalWallClockNum,
                totalSizeMB: parseFloat(toMB(totalSizeBytes)),
                memoryHeapUsedMB: parseFloat(toMB(endMemory.heapUsed)),
                memoryIncreaseMB: parseFloat(toMB(endMemory.heapUsed - startMemory.heapUsed)),
                memoryRssMB: parseFloat(toMB(endMemory.rss))
            }
        };

        if (successCount === 0) {
            return errorResponse(res, `다중 파일 업로드 전체 실패: ${failCount}개 실패`, 500, responseData);
        }

        if (failCount > 0) {
            return successResponse(res, `다중 파일 업로드 부분 성공: ${successCount}개 성공, ${failCount}개 실패`, responseData, 207);
        }

        return successResponse(res, `다중 파일 업로드 완료: ${successCount}개 성공`, responseData);

    } catch (error) {
        console.error('WebDAV 다중 업로드 에러:', error);

        // 실패시 모든 로컬 임시 파일 정리
        if (req.files) {
            for (const file of req.files) {
                await deleteLocalFile(file.path);
            }
        }

        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일 업데이트 (덮어쓰기) 컨트롤러
 * - 메모리 개선: 기존 파일을 버퍼로 로드하지 않고 stat/임시파일 방식 사용
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const updateFileInWebDAV = async (req, res) => {
    try {
        const rawPath = req.params[0] || req.params.path;
        const file = req.file;
        const { userId } = req.body;

        if (!file) {
            return errorResponse(res, '파일이 없습니다.', 400);
        }

        if (!rawPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출
        const filePath = extractFilePath(rawPath);

        // 경로에서 디렉토리와 파일명 분리
        const pathParts = filePath.split('/');
        let filename = pathParts.pop();
        const directoryPath = pathParts.join('/');

        // 확장자 추출
        let originalExtension = filename.includes('.')
            ? filename.split('.').pop()?.toLowerCase()
            : null;

        // 확장자가 없으면 디렉토리에서 파일 찾아서 자동 판단
        if (!originalExtension) {
            const searchPath = directoryPath ? `/${directoryPath}` : '/';
            const contents = await getDirectoryContents(searchPath);
            if (contents) {
                let matchedFile = contents.find(item =>
                    item.type === 'file' &&
                    item.basename.includes('.') &&
                    item.basename.split('.').slice(0, -1).join('.').normalize('NFKC') === filename.normalize('NFKC')
                );

                if (!matchedFile) {
                    matchedFile = contents.find(item =>
                        item.type === 'file' &&
                        item.basename.normalize('NFKC') === filename.normalize('NFKC')
                    );
                }

                if (matchedFile) {
                    if (matchedFile.basename.includes('.')) {
                        originalExtension = matchedFile.basename.split('.').pop()?.toLowerCase();
                    }
                    filename = matchedFile.basename;
                } else {
                    return errorResponse(res, `파일을 찾을 수 없습니다: ${filename}`, 404);
                }
            } else {
                return errorResponse(res, `디렉토리를 찾을 수 없습니다: ${directoryPath}`, 404);
            }
        }

        // 실제 파일 경로 (확장자 포함)
        const actualFilePath = directoryPath ? `${directoryPath}/${filename}` : filename;
        const webdavPath = `/${getRootPath()}/${actualFilePath}`;

        // 파일 존재 여부 확인 (메모리 로드 없이 stat 사용)
        const exists = await fileExists(webdavPath);
        if (!exists) {
            return errorResponse(res, '파일을 찾을 수 없습니다.', 404);
        }

        // MIME 타입 검증
        const originalMime = originalExtension ? mime.lookup(originalExtension) : null;
        const uploadMime = file.mimetype;

        if (originalMime && originalMime !== uploadMime) {
            return errorResponse(res, `파일 타입이 다릅니다. 기존: ${originalMime}, 업로드: ${uploadMime}. 삭제 후 새로 업로드해주세요.`, 409);
        }

        // 새 파일 해시 계산 (업로드된 임시파일에서 스트림 방식)
        const newContentHash = await calculateHashFromFile(file.path);

        // 기존 파일 해시: 임시파일로 다운로드 후 계산 (메모리 사용 0)
        let oldContentHash;
        let tmpPath;
        try {
            tmpPath = await downloadToTempFile(webdavPath);
            oldContentHash = await calculateHashFromFile(tmpPath);
        } finally {
            if (tmpPath) await deleteLocalFile(tmpPath);
        }

        // 콘텐츠 해시 비교 (동일하면 업데이트 불필요)
        if (compareHash(oldContentHash, newContentHash)) {
            await deleteLocalFile(file.path);

            const etag = generateEtag(oldContentHash);
            res.set('ETag', formatEtagHeader(etag));
            return successResponse(res, '파일이 동일하여 변경 없음', {
                path: actualFilePath,
                filename: filename,
                etag: etag,
                changed: false
            });
        }

        // 파일 업데이트 실행
        const { res: result, file: f } = await updateFile(directoryPath, file, filename);

        // 로컬 임시 파일 삭제
        await deleteLocalFile(file.path);

        // 새 ETag 생성
        const newEtag = generateEtag(newContentHash);

        res.set('ETag', formatEtagHeader(newEtag));
        return successResponse(res, '파일 업데이트 성공', {
            path: actualFilePath,
            filename: f.originalname,
            size: f.size,
            url: `${getBaseUrl()}/${getRootPath()}/${directoryPath}/${f.originalname}`,
            etag: newEtag,
            changed: true
        });

    } catch (error) {
        console.error('WebDAV 파일 업데이트 에러:', error);

        // 실패시 로컬 임시 파일 정리
        if (req.file?.path) {
            await deleteLocalFile(req.file.path);
        }

        if (error.status === 404 || error.message?.includes('not found')) {
            return errorResponse(res, '파일을 찾을 수 없습니다.', 404);
        }

        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일 삭제 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const deleteFileFromWebDAV = async (req, res) => {
    try {
        const rawPath = req.params[0] || req.params.path;
        const userId = req.query.userId;

        if (!rawPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출
        const filePath = extractFilePath(rawPath);

        // 실제 파일 삭제
        await deleteFile(filePath);

        return successResponse(res, '파일 삭제 성공', { path: filePath });

    } catch (error) {
        console.error('WebDAV 파일 삭제 에러:', error);

        if (error.status === 404 || error.message?.includes('not found')) {
            return errorResponse(res, '파일을 찾을 수 없습니다.', 404);
        }

        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 디렉토리 삭제 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const deleteDirectoryFromWebDAV = async (req, res) => {
    try {
        const rawPath = req.params[0] || req.params.path;
        const force = req.query.force === 'true';

        if (!rawPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출
        const dirPath = extractFilePath(rawPath);

        // force가 false일 때 디렉토리 내용 확인
        if (!force) {
            const contents = await getDirectoryContents(`/${getRootPath()}/${dirPath}`);

            if (contents && contents.length > 0) {
                return errorResponse(res, '디렉토리 내부에 파일이 있습니다. 삭제하려면 force=true를 사용하세요.', 409, {
                    path: dirPath,
                    contents: contents.map(item => ({
                        basename: item.basename,
                        type: item.type
                    }))
                });
            }
        }

        await deleteDirectory(dirPath);

        return successResponse(res, '디렉토리 삭제 성공', { path: dirPath });

    } catch (error) {
        console.error('WebDAV 디렉토리 삭제 에러:', error);

        if (error.status === 404 || error.message?.includes('not found')) {
            return errorResponse(res, '디렉토리를 찾을 수 없습니다.', 404);
        }

        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일/디렉토리 이동 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const moveFileInWebDAV = async (req, res) => {
    try {
        const { sourcePath: rawSourcePath, destPath: rawDestPath, overwrite = true } = req.body;

        if (!rawSourcePath) {
            return errorResponse(res, 'sourcePath가 필요합니다.', 400);
        }

        if (!rawDestPath) {
            return errorResponse(res, 'destPath가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출
        const sourcePath = extractFilePath(rawSourcePath);
        const destPath = extractFilePath(rawDestPath);

        await moveFile(sourcePath, destPath, overwrite);

        return successResponse(res, '이동 성공', { sourcePath, destPath });

    } catch (error) {
        console.error('WebDAV 이동 에러:', error);

        if (error.status === 404 || error.message?.includes('not found')) {
            return errorResponse(res, '원본 파일/디렉토리를 찾을 수 없습니다.', 404);
        }

        if (error.status === 412 || error.message?.includes('precondition')) {
            return errorResponse(res, '대상이 이미 존재합니다.', 409);
        }

        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일/디렉토리 복사 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const copyFileInWebDAV = async (req, res) => {
    try {
        const { sourcePath: rawSourcePath, destPath: rawDestPath, overwrite = true } = req.body;

        if (!rawSourcePath) {
            return errorResponse(res, 'sourcePath가 필요합니다.', 400);
        }

        if (!rawDestPath) {
            return errorResponse(res, 'destPath가 필요합니다.', 400);
        }

        // URL에서 실제 경로 추출
        const sourcePath = extractFilePath(rawSourcePath);
        const destPath = extractFilePath(rawDestPath);

        await copyFile(sourcePath, destPath, overwrite);

        return successResponse(res, '복사 성공', { sourcePath, destPath });

    } catch (error) {
        console.error('WebDAV 복사 에러:', error);

        if (error.status === 404 || error.message?.includes('not found')) {
            return errorResponse(res, '원본 파일/디렉토리를 찾을 수 없습니다.', 404);
        }

        if (error.status === 412 || error.message?.includes('precondition')) {
            return errorResponse(res, '대상이 이미 존재합니다.', 409);
        }

        return errorResponse(res, error.message);
    }
};

/**
 * 시스템 통계 조회 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const getWebDAVStats = async (req, res) => {
    try {
        const memoryUsage = process.memoryUsage();

        // CPU 사용률 계산 (이전 호출 대비 delta)
        const currentCpuUsage = process.cpuUsage();
        const currentTime = Date.now();
        const elapsedMs = currentTime - prevCpuTime;

        // user + system CPU 시간 (microseconds → ms)
        const userDelta = (currentCpuUsage.user - prevCpuUsage.user) / 1000;
        const systemDelta = (currentCpuUsage.system - prevCpuUsage.system) / 1000;
        const cpuPercent = elapsedMs > 0
            ? Math.min(((userDelta + systemDelta) / elapsedMs) * 100, 100 * os.cpus().length)
            : 0;

        prevCpuUsage = currentCpuUsage;
        prevCpuTime = currentTime;

        // OS 레벨 정보
        const totalMemBytes = os.totalmem();
        const freeMemBytes = os.freemem();
        const usedMemBytes = totalMemBytes - freeMemBytes;
        const cpus = os.cpus();
        const loadAvg = os.loadavg();

        return successResponse(res, '통계 조회 성공', {
            memory: {
                heapUsedMB: (memoryUsage.heapUsed / 1024 / 1024).toFixed(2),
                heapTotalMB: (memoryUsage.heapTotal / 1024 / 1024).toFixed(2),
                rssMB: (memoryUsage.rss / 1024 / 1024).toFixed(2),
                externalMB: (memoryUsage.external / 1024 / 1024).toFixed(2),
                arrayBuffersMB: ((memoryUsage.arrayBuffers || 0) / 1024 / 1024).toFixed(2)
            },
            cpu: {
                percent: parseFloat(cpuPercent.toFixed(1)),
                userMs: parseFloat(userDelta.toFixed(1)),
                systemMs: parseFloat(systemDelta.toFixed(1)),
                cores: cpus.length
            },
            os: {
                totalMemMB: parseFloat((totalMemBytes / 1024 / 1024).toFixed(0)),
                freeMemMB: parseFloat((freeMemBytes / 1024 / 1024).toFixed(0)),
                usedMemMB: parseFloat((usedMemBytes / 1024 / 1024).toFixed(0)),
                memPercent: parseFloat(((usedMemBytes / totalMemBytes) * 100).toFixed(1)),
                loadAvg1m: parseFloat(loadAvg[0].toFixed(2)),
                loadAvg5m: parseFloat(loadAvg[1].toFixed(2)),
                loadAvg15m: parseFloat(loadAvg[2].toFixed(2)),
                platform: os.platform(),
                hostname: os.hostname()
            },
            uptime: process.uptime()
        });

    } catch (error) {
        console.error('통계 조회 에러:', error);
        return errorResponse(res, error.message);
    }
};

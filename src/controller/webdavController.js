import {
    getFile,
    createDirectory,
    getBaseUrl,
    uploadMultipleFilesParallel,
    existDirectory,
    uploadSingle,
    deleteFile,
    deleteDirectory,
    moveFile,
    copyFile,
    updateFile,
    getDirectoryContents
} from '../services/web_dav/webdavClient.js';
import mime from 'mime-types';
import { successResponse, errorResponse } from '../utils/response.js';
import * as fileMetadataRepo from '../repositories/fileMetadataRepo.js';
import * as fileHistoryRepo from '../repositories/fileHistoryRepo.js';
import pool from '../config/database.js';
import { calculateHash, generateEtag, compareHash, parseIfMatchHeader, formatEtagHeader } from '../utils/etag.js';
import { getWebdavRootPath } from '../utils/webdavRootPath.js';

/**
 * URL 또는 경로에서 실제 파일 경로만 추출
 * @param {string} input - 전체 URL 또는 경로
 * @returns {string} - WebDAV 루트 이후의 실제 경로
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

    const rootPath = getWebdavRootPath();
    const rootPrefix = `/${rootPath}`;

    // 현재 루트(/kikii_test 또는 /www)가 포함되면 제거
    if (input === rootPrefix) {
        input = '';
    } else if (input.startsWith(`${rootPrefix}/`)) {
        input = input.slice(rootPrefix.length + 1);
    }

    // 하위 호환: /www 경로도 허용
    if (input.startsWith('/www/')) {
        input = input.slice(5);
    } else if (input === '/www') {
        input = '';
    }

    // 앞의 슬래시 제거
    if (input.startsWith('/')) {
        input = input.slice(1);
    }

    return input;
};

/**
 * WebDAV 파일 업로드 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const uploadFileToWebDAV = async (req, res) => {
    try {
        const { path, filename, domain_type, domain_id, userId } = req.body;
        const file = req.file;

        if (!file) {
            return errorResponse(res, '파일이 없습니다.', 400);
        }

        if (!path) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // filename이 없으면 file.originalname 사용
        const uploadFilename = filename || file.originalname;

        const result = await uploadSingle(path, file, uploadFilename);

        if (!result.success) {
            return errorResponse(res, result.error || '파일 업로드 실패', 500);
        }

        // 파일 정보 추출
        const actualFilename = result.filename;
        const extension = actualFilename.includes('.')
            ? actualFilename.split('.').pop()?.toLowerCase()
            : '';
        const filePath = `${path}/${actualFilename}`;
        const mimeType = file.mimetype || mime.lookup(extension) || 'application/octet-stream';

        // contentHash와 ETag 생성
        const contentHash = calculateHash(file.buffer);
        const etag = generateEtag(contentHash);

        // file_metadata INSERT (DB 실패해도 업로드 응답은 성공 처리)
        let metadata = { id: null };
        try {
            metadata = await fileMetadataRepo.create({
                domainType: domain_type || null,
                domainId: domain_id ? parseInt(domain_id) : null,
                filePath: filePath,
                fileName: actualFilename,
                extension: extension,
                mimeType: mimeType,
                fileSize: file.size,
                contentHash: contentHash,
                etag: etag,
                status: 'ACTIVE'
            });

            // history 기록
            await fileHistoryRepo.create({
                fileMetadataId: metadata.id,
                action: 'UPLOAD',
                oldEtag: null,
                newEtag: etag,
                oldHash: null,
                newHash: contentHash,
                changedBy: userId || 'system'
            });
        } catch (dbError) {
            console.error('메타데이터 DB 저장 실패 (파일 업로드는 성공):', dbError.message);
        }

        res.set('ETag', formatEtagHeader(etag));
        return successResponse(res, 'WebDAV 파일 업로드 성공', {
            path: `${getBaseUrl()}/${filePath}`,
            filename: result.filename,
            size: result.size,
            url: result.url,
            etag: etag,
            metadataId: metadata.id
        });

    } catch (error) {
        console.error('WebDAV 업로드 에러:', error);
        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일 다운로드 컨트롤러
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

        const rootPath = getWebdavRootPath();
        const fullPath = `${getBaseUrl()}/${rootPath}/${filePath}`;

        const fileBuffer = await getFile(fullPath);

        if (!fileBuffer) {
            return errorResponse(res, '파일이 없습니다.', 404);
        }

        const filename = filePath.split('/').pop() || 'download';
        const extension = filePath.split('.').pop()?.toLowerCase();

        // file_metadata 조회 또는 lazy 생성
        let metadata = await fileMetadataRepo.findByFilePath(filePath);
        let etag = null;

        if (!metadata) {
            // lazy INSERT (B-lite 스캔 전 또는 누락된 파일)
            const mimeType = mime.lookup(extension) || 'application/octet-stream';
            const contentHash = calculateHash(fileBuffer);
            etag = generateEtag(contentHash);

            metadata = await fileMetadataRepo.create({
                filePath: filePath,
                fileName: filename,
                extension: extension || '',
                mimeType: mimeType,
                fileSize: fileBuffer.length,
                contentHash: contentHash,
                etag: etag,
                status: 'ACTIVE'
            });
        } else if (!metadata.etag) {
            // ETag가 없으면 lazy 생성
            const contentHash = metadata.content_hash || calculateHash(fileBuffer);
            etag = generateEtag(contentHash);
            await fileMetadataRepo.updateEtagAndHash(metadata.id, etag, contentHash);
        } else {
            etag = metadata.etag;
        }

        // 파일 타입별 처리
        let contentType = mime.lookup(extension) || 'application/octet-stream';
        let contentDisposition = req.query.disposition || 'inline';

        if (['txt', 'json', 'xml', 'html', 'css', 'js'].includes(extension)) {
            contentType = 'text/plain';
        }

        res.set({
            'Content-Type': contentType,
            'Content-Disposition': `${contentDisposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Content-Length': fileBuffer.length,
            'Cache-Control': 'no-store',
            'ETag': formatEtagHeader(etag)
        });
        return res.status(200).send(fileBuffer);

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

        const directory = await existDirectory(dirPath);

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
 * 다중 파일 WebDAV 업로드 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const uploadMultipleFilesToWebDAV = async (req, res) => {

    try {
        const { path, filenames } = req.body;
        const files = req.files; // multer에서 다중 파일 설정 필요

        if (!files || files.length === 0) {
            return errorResponse(res, '파일이 없습니다.', 400);
        }

        let filenamesArray = [];

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

        if (!path) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // 병렬 업로드 실행 (동시성 제한: 3개)
        const results = await uploadMultipleFilesParallel(path, files, filenamesArray, 3);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        return successResponse(res, `다중 파일 업로드 완료: ${successCount}개 성공, ${failCount}개 실패`, {
            path,
            results,
            summary: {
                total: results.length,
                success: successCount,
                failed: failCount
            }
        });

    } catch (error) {
        console.error('WebDAV 다중 업로드 에러:', error);
        return errorResponse(res, error.message);
    }
};

/**
 * WebDAV 파일 업데이트 (덮어쓰기) 컨트롤러
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

        if (!userId) {
            return errorResponse(res, 'userId가 필요합니다.', 400);
        }

        // 경로에서 디렉토리와 파일명 분리
        const pathParts = filePath.split('/');
        let filename = pathParts.pop();
        const directoryPath = pathParts.join('/');
        const normalizedFilePath = directoryPath ? `${directoryPath}/${filename}` : filename;

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

        // MIME 타입 검증
        const originalMime = originalExtension ? mime.lookup(originalExtension) : null;
        const uploadMime = file.mimetype;

        if (originalMime && originalMime !== uploadMime) {
            return errorResponse(res, `파일 타입이 다릅니다. 기존: ${originalMime}, 업로드: ${uploadMime}. 삭제 후 새로 업로드해주세요.`, 409);
        }

        // file_metadata 조회
        let metadata = await fileMetadataRepo.findByFilePath(actualFilePath);

        // 기존 파일 내용 조회 (ETag lazy 생성용)
        const fullPath = `${getBaseUrl()}/${actualFilePath}`;
        const existingFileBuffer = await getFile(fullPath);

        if (!existingFileBuffer) {
            return errorResponse(res, '파일을 찾을 수 없습니다.', 404);
        }

        // metadata가 없으면 lazy 생성 후 428 반환
        if (!metadata) {
            const contentHash = calculateHash(existingFileBuffer);
            const currentEtag = generateEtag(contentHash);
            const mimeType = mime.lookup(originalExtension) || 'application/octet-stream';

            metadata = await fileMetadataRepo.create({
                filePath: actualFilePath,
                fileName: filename,
                extension: originalExtension || '',
                mimeType: mimeType,
                fileSize: existingFileBuffer.length,
                contentHash: contentHash,
                etag: currentEtag,
                status: 'ACTIVE'
            });

            res.set('ETag', formatEtagHeader(currentEtag));
            return errorResponse(res, 'If-Match 헤더가 필요합니다. ETag를 확인 후 재요청해주세요.', 428, {
                etag: currentEtag
            });
        }

        // ETag가 없으면 lazy 생성 후 428 반환
        if (!metadata.etag) {
            const contentHash = metadata.content_hash || calculateHash(existingFileBuffer);
            const currentEtag = generateEtag(contentHash);
            await fileMetadataRepo.updateEtagAndHash(metadata.id, currentEtag, contentHash);

            res.set('ETag', formatEtagHeader(currentEtag));
            return errorResponse(res, 'If-Match 헤더가 필요합니다. ETag를 확인 후 재요청해주세요.', 428, {
                etag: currentEtag
            });
        }

        // If-Match 헤더 체크
        const ifMatch = parseIfMatchHeader(req.headers['if-match']);
        if (!ifMatch) {
            res.set('ETag', formatEtagHeader(metadata.etag));
            return errorResponse(res, 'If-Match 헤더가 필요합니다.', 428, {
                etag: metadata.etag
            });
        }

        // ETag 비교
        if (!compareHash(ifMatch, metadata.etag)) {
            res.set('ETag', formatEtagHeader(metadata.etag));
            return errorResponse(res, '파일이 변경되었습니다. 최신 버전을 다시 받아주세요.', 412, {
                etag: metadata.etag
            });
        }

        // 새 파일 해시 계산
        const newContentHash = calculateHash(file.buffer);
        const oldContentHash = metadata.content_hash || calculateHash(existingFileBuffer);

        // 콘텐츠 해시 비교 (동일하면 업데이트 불필요)
        if (compareHash(oldContentHash, newContentHash)) {
            res.set('ETag', formatEtagHeader(metadata.etag));
            return successResponse(res, '파일이 동일하여 변경 없음', {
                path: actualFilePath,
                filename: filename,
                etag: metadata.etag,
                changed: false
            });
        }

        // 파일 업데이트 실행
        const { res: result, file: f } = await updateFile(directoryPath, file, filename);

        // 새 ETag 생성
        const newEtag = generateEtag(newContentHash);
        const oldEtag = metadata.etag;

        // metadata 업데이트
        await fileMetadataRepo.updateFileInfo(metadata.id, {
            fileSize: file.size,
            contentHash: newContentHash,
            etag: newEtag
        });

        // history 기록
        await fileHistoryRepo.create({
            fileMetadataId: metadata.id,
            action: 'UPDATE',
            oldEtag: oldEtag,
            newEtag: newEtag,
            oldHash: oldContentHash,
            newHash: newContentHash,
            changedBy: userId
        });

        res.set('ETag', formatEtagHeader(newEtag));
        return successResponse(res, '파일 업데이트 성공', {
            path: actualFilePath,
            filename: f.originalname,
            size: f.size,
            url: `${getBaseUrl()}/${directoryPath}/${f.originalname}`,
            etag: newEtag,
            changed: true
        });

    } catch (error) {
        console.error('WebDAV 파일 업데이트 에러:', error);

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

        // file_metadata 상태 변경 (논리 삭제)
        const metadata = await fileMetadataRepo.findByFilePath(filePath);

        if (metadata) {
            await fileMetadataRepo.updateStatus(metadata.id, 'DELETED');

            // history 기록
            await fileHistoryRepo.create({
                fileMetadataId: metadata.id,
                action: 'DELETE',
                oldEtag: metadata.etag,
                newEtag: null,
                oldHash: metadata.content_hash,
                newHash: null,
                changedBy: userId || 'system'
            });
        }

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
            const contents = await getDirectoryContents(dirPath);

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
        // file_metadata 요약
        const [summaryRows] = await pool.execute(`
            SELECT
                COUNT(*) as totalFiles,
                SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as activeFiles,
                SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) as deletedFiles,
                SUM(CASE WHEN status = 'DESYNC' THEN 1 ELSE 0 END) as desyncFiles,
                SUM(CASE WHEN status = 'MISSING' THEN 1 ELSE 0 END) as missingFiles
            FROM file_metadata
        `);

        // history 액션별 통계
        const [historyRows] = await pool.execute(`
            SELECT action, COUNT(*) as count
            FROM file_metadata_history
            GROUP BY action
        `);

        // 사용자별 통계
        const [userRows] = await pool.execute(`
            SELECT changed_by, COUNT(*) as count
            FROM file_metadata_history
            GROUP BY changed_by
            ORDER BY count DESC
            LIMIT 10
        `);

        // 최근 7일 일별 통계
        const [dailyRows] = await pool.execute(`
            SELECT
                DATE(created_at) as date,
                action,
                COUNT(*) as count
            FROM file_metadata_history
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            GROUP BY DATE(created_at), action
            ORDER BY date DESC
        `);

        // history를 객체로 변환
        const historyStats = {};
        historyRows.forEach(row => {
            historyStats[row.action] = row.count;
        });

        // user를 객체로 변환
        const userStats = {};
        userRows.forEach(row => {
            userStats[row.changed_by] = row.count;
        });

        return successResponse(res, '통계 조회 성공', {
            summary: summaryRows[0],
            stats: historyStats,
            byUser: userStats,
            daily: dailyRows
        });

    } catch (error) {
        console.error('통계 조회 에러:', error);
        return errorResponse(res, error.message);
    }
};

// ==========================================
// v7 미디어 변환 전용 추가 로직
// ==========================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import * as convertRepo from '../repositories/convertMetadataRepo.js';
import { hashFileStream, findDuplicate } from '../services/dedup.js';
import { isVideo, isImage, processImage } from '../services/mediaProcessor.js';
import { addVideoJob } from '../services/videoQueue.js';
import { atomicUpload } from '../services/web_dav/webdavClient.js';
import { safeDelete, safeDeleteMany } from '../utils/tempCleaner.js';
import { dbLog } from '../utils/dbLogger.js';

const toSuccessResult = (message, data = {}, status = 200) => ({
    status,
    body: { message, status, ...data },
});

const toErrorResult = (message, status = 500, data = {}) => ({
    status,
    body: { message: String(message || 'Internal server error'), status, ...data },
});

const processConvertUploadFile = async ({ file, rawPath, domainType, domainId }) => {
    if (!file) {
        return toErrorResult('파일이 거부되었거나 전송되지 않았습니다.', 400);
    }

    const uploadPath = extractFilePath(rawPath);
    if (!uploadPath) {
        safeDelete(file.path);
        return toErrorResult('path가 필요합니다.', 400);
    }

    const ext = file.originalname.split('.').pop()?.toLowerCase() || '';

    try {
        const hash = await hashFileStream(file.path);

        let record;
        try {
            record = await convertRepo.create({
                domainType: domainType || null,
                domainId: domainId ? parseInt(domainId, 10) : null,
                originalPath: `${uploadPath}/${file.originalname}`,
                originalName: file.originalname,
                originalExt: ext,
                originalSize: file.size,
                mimeType: file.mimetype,
                contentHash: hash,
                etag: `"${hash.substring(0, 16)}"`,
            });
        } catch (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                const existing = await findDuplicate(hash);
                safeDelete(file.path);

                if (existing) {
                    return toSuccessResult('기변환 파일 재사용', {
                        metadataId: existing.id,
                        convertedPath: existing.converted_path,
                        reused: true,
                    });
                }
                return toErrorResult('동일 파일 변환 중이거나 대기 중입니다.', 409);
            }
            throw err;
        }

        if (isVideo(file.mimetype, ext)) {
            const newName = `${Date.now()}-${crypto.randomUUID()}.${process.env.VIDEO_OUTPUT_FORMAT || 'mp4'}`;
            const webdavPath = `${uploadPath}/${newName}`;
            const job = await addVideoJob(record.id, file.path, webdavPath);
            await convertRepo.updateJobId(record.id, job.id);

            return toSuccessResult('영상 업로드 및 변환 작업 접수 완료', {
                metadataId: record.id,
                jobId: job.id,
                statusUrl: `/webdav/convert-status/${record.id}`,
            }, 202);
        }

        const rootPath = getWebdavRootPath();

        // CYA는 ffmpeg 변환 대상에서 제외하고 원본 업로드 정책으로 처리
        if (ext === 'cya') {
            await convertRepo.updateStatus(record.id, 'skipped');
            await atomicUpload(`/${rootPath}/${uploadPath}/${file.originalname}`, file.path);
            safeDelete(file.path);
            return toSuccessResult('CYA 원본 업로드 완료 (변환 생략)', {
                metadataId: record.id,
                path: `${uploadPath}/${file.originalname}`,
                skipped: true,
            });
        }

        if (!isImage(file.mimetype, ext)) {
            await convertRepo.updateStatus(record.id, 'skipped');
            await atomicUpload(`/${rootPath}/${uploadPath}/${file.originalname}`, file.path);
            safeDelete(file.path);
            return toSuccessResult('업로드 완료 (변환 불필요)', {
                metadataId: record.id,
                path: `${uploadPath}/${file.originalname}`,
                skipped: true,
            });
        }

        let outputPath = null;
        try {
            await convertRepo.updateStatus(record.id, 'processing');
            const result = await processImage(file.path);
            outputPath = result.outputPath;

            const newName = `${Date.now()}-${crypto.randomUUID()}.${result.format}`;
            const webdavPath = `/${rootPath}/${uploadPath}/${newName}`;

            await convertRepo.updateStatus(record.id, 'uploading');
            const tempNasPath = `${webdavPath}.__uploading__`;
            await convertRepo.saveTempPath(record.id, tempNasPath);

            await atomicUpload(webdavPath, outputPath);

            const stat = fs.statSync(outputPath);
            await convertRepo.markCompleted(record.id, {
                convertedPath: `${uploadPath}/${newName}`,
                convertedName: newName,
                convertedExt: result.format,
                convertedSize: stat.size,
            });

            safeDeleteMany(file.path, outputPath);
            return toSuccessResult('이미지 변환 및 업로드 완료', {
                metadataId: record.id,
                conversion: {
                    from: ext,
                    to: result.format,
                    originalSize: file.size,
                    convertedSize: stat.size,
                },
                path: `${uploadPath}/${newName}`,
            });
        } catch (processErr) {
            await convertRepo.updateStatus(record.id, 'failed', processErr.message);
            await dbLog('error', `이미지 처리 실패: ${processErr.message}`, record.id);
            safeDeleteMany(file.path, outputPath);
            return toErrorResult(processErr.message, 500, { metadataId: record.id });
        }
    } catch (globalErr) {
        safeDelete(file.path);
        return toErrorResult(globalErr.message, 500);
    }
};

export const uploadWithConvert = async (req, res) => {
    const result = await processConvertUploadFile({
        file: req.file,
        rawPath: req.body?.path,
        domainType: req.body?.domain_type,
        domainId: req.body?.domain_id,
    });
    return res.status(result.status).json(result.body);
};

export const uploadWithConvertMultiple = async (req, res) => {
    const files = Array.isArray(req.files) ? req.files : [];
    const { path: rawPath, domain_type, domain_id } = req.body || {};

    if (!files.length) {
        return errorResponse(res, '파일이 없습니다.', 400);
    }

    if (!rawPath) {
        safeDeleteMany(...files.map((file) => file?.path).filter(Boolean));
        return errorResponse(res, 'path가 필요합니다.', 400);
    }

    const results = [];
    let queued = 0;
    let converted = 0;
    let skipped = 0;
    let reused = 0;
    let failed = 0;

    for (const file of files) {
        const result = await processConvertUploadFile({
            file,
            rawPath,
            domainType: domain_type,
            domainId: domain_id,
        });

        if (result.status === 202) queued += 1;
        else if (result.status === 200 && result.body?.reused) reused += 1;
        else if (result.status === 200 && result.body?.skipped) skipped += 1;
        else if (result.status === 200) converted += 1;
        else failed += 1;

        results.push({
            originalName: file.originalname,
            status: result.status,
            ...result.body,
        });
    }

    return successResponse(res, '다중 업로드/변환 처리 완료', {
        summary: {
            total: files.length,
            queued,
            converted,
            skipped,
            reused,
            failed,
        },
        results,
    });
};

export const getConvertStatus = async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return errorResponse(res, '유효하지 않은 상태 조회 ID입니다.', 400);
        }

        const row = await convertRepo.findById(id);
        if (!row) {
            return errorResponse(res, '변환 메타데이터를 찾을 수 없습니다.', 404);
        }

        return successResponse(res, '변환 상태 조회 성공', {
            id: row.id,
            convertStatus: row.convert_status,
            jobId: row.convert_job_id,
            failureType: row.failure_type,
            error: row.convert_error,
            convertedPath: row.converted_path,
            retryCount: row.retry_count,
            updatedAt: row.updated_at,
            completedAt: row.completed_at,
        });
    } catch (err) {
        return errorResponse(res, err.message, 500);
    }
};

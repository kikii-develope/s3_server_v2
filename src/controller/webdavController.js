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
import { calculateHash, generateEtag, compareHash, parseIfMatchHeader, formatEtagHeader } from '../utils/etag.js';

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

        const result = await uploadSingle(path, file, filename);

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

        // file_metadata INSERT
        const metadata = await fileMetadataRepo.create({
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
        const path = req.params[0] || req.params.path;

        if (!path) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        const fullPath = path.includes(getBaseUrl())
            ? path
            : `${getBaseUrl()}/${path}`;

        const fileBuffer = await getFile(fullPath);

        if (!fileBuffer) {
            return errorResponse(res, '파일이 없습니다.', 404);
        }

        const filename = path.split('/').pop() || 'download';
        const extension = path.split('.').pop()?.toLowerCase();

        // file_metadata 조회 또는 lazy 생성
        let metadata = await fileMetadataRepo.findByFilePath(path);
        let etag = null;

        if (!metadata) {
            // lazy INSERT (B-lite 스캔 전 또는 누락된 파일)
            const mimeType = mime.lookup(extension) || 'application/octet-stream';
            const contentHash = calculateHash(fileBuffer);
            etag = generateEtag(contentHash);

            metadata = await fileMetadataRepo.create({
                filePath: path,
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
        const path = req.params[0] || req.params.path;

        // URL 디코딩
        const decodedPath = decodeURIComponent(path || '');

        if (!decodedPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        const directory = await existDirectory(decodedPath);

        return successResponse(res, 'WebDAV 디렉토리 조회 성공', { path, directory });

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
        const filePath = req.params[0] || req.params.path;
        const file = req.file;
        const { userId } = req.body;

        if (!file) {
            return errorResponse(res, '파일이 없습니다.', 400);
        }

        if (!filePath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

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
        const filePath = req.params[0] || req.params.path;
        const userId = req.query.userId;

        if (!filePath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

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
        const dirPath = req.params[0] || req.params.path;
        const force = req.query.force === 'true';

        if (!dirPath) {
            return errorResponse(res, 'path가 필요합니다.', 400);
        }

        // force가 false일 때 디렉토리 내용 확인
        if (!force) {
            const contents = await getDirectoryContents(`/${dirPath}`);

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
        const { sourcePath, destPath, overwrite = true } = req.body;

        if (!sourcePath) {
            return errorResponse(res, 'sourcePath가 필요합니다.', 400);
        }

        if (!destPath) {
            return errorResponse(res, 'destPath가 필요합니다.', 400);
        }

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
        const { sourcePath, destPath, overwrite = true } = req.body;

        if (!sourcePath) {
            return errorResponse(res, 'sourcePath가 필요합니다.', 400);
        }

        if (!destPath) {
            return errorResponse(res, 'destPath가 필요합니다.', 400);
        }

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

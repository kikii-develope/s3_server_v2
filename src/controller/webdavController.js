import { uploadFile, getFile, createDirectory, getBaseUrl, uploadMultipleFilesParallel, existDirectory, uploadSingle } from '../services/web_dav/webdavClient.js';
import { decodePathTwiceToNFC } from '../utils/decoder.js';
import mime from 'mime-types';

/**
 * WebDAV 파일 업로드 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const uploadFileToWebDAV = async (req, res) => {

    console.log("uploadFileToWebDAV");
    console.log(req.body);


    try {
        const { path, filename } = req.body;
        const file = req.file;

        console.log(req);
        console.log(file);

        if (!file) {
            return res.status(400).json({
                message: '파일이 없습니다.',
                status: 400
            });
        }

        if (!path) {
            return res.status(400).json({
                message: 'path가 필요합니다.',
                status: 400
            });
        }

        const result = await uploadSingle(path, file, filename);

        return res.status(200).json({
            message: 'WebDAV 파일 업로드 성공',
            status: 200,
            path: `${getBaseUrl()}/${path}/${file.originalname}`,
            filename: result.filename,
            success: result.success,
            size: result.size,
            url: result.url
        });

    } catch (error) {
        console.error('WebDAV 업로드 에러:', error);
        res.status(500).json({
            message: error.message,
            status: 500
        });
    }
};

/**
 * WebDAV 파일 다운로드 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const downloadFileFromWebDAV = async (req, res) => {
    try {
        // 경로 추출 (req.params.path 대신 req.params[0] 사용)
        const path = req.params[0] || req.params.path;


        if (!path) {
            return res.status(400).json({
                message: 'path가 필요합니다.',
                status: 400
            });
        }

        if (!path.includes(getBaseUrl())) {
            return res.status(400).json({
                message: 'path가 올바르지 않습니다.',
                status: 400
            });
        }

        const url = new URL(path);


        // URL 디코딩
        const decodedPath = decodePathTwiceToNFC(url.pathname);
        console.log('원본 path:', path);
        console.log('디코딩된 path:', decodedPath);

        const file = await getFile(decodedPath);

        if (!file) {
            return res.status(404).json({
                message: '파일이 없습니다.',
                status: 404
            });
        }

        // 파일 정보를 JSON으로 반환 (Swagger에서 확인용)
        const filename = decodedPath.split('/').pop() || 'download';
        const extension = decodedPath.split('.').pop()?.toLowerCase();

        // 파일 타입별 처리
        let fileContent = '';
        let contentType = mime.lookup(extension) || 'application/octet-stream';
        let contentDisposition = req.query.disposition || 'inline';

        if (['txt', 'json', 'xml', 'html', 'css', 'js'].includes(extension)) {
            fileContent = file.toString('utf8');
            contentType = 'text/plain';
        }

        res.set({
            'Content-Type': contentType,
            'Content-Disposition': `${contentDisposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Content-Length': file.length,
            'Cache-Control': 'no-store',
        });
        return res.status(200).send(file);

    } catch (error) {
        console.error('WebDAV 다운로드 에러:', error);
        res.status(500).json({
            message: error.message,
            status: 500
        });
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
            return res.status(400).json({
                message: 'path가 필요합니다.',
                status: 400
            });
        }

        await createDirectory(path);

        return res.status(200).json({
            message: 'WebDAV 디렉토리 생성 성공',
            status: 200,
            path: path
        });

    } catch (error) {
        console.error('WebDAV 디렉토리 생성 에러:', error);
        res.status(500).json({
            message: error.message,
            status: 500
        });
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
        console.log('원본 path:', path);
        console.log('디코딩된 path:', decodedPath);

        if (!decodedPath) {
            return res.status(400).json({
                message: 'path가 필요합니다.',
                status: 400
            });
        }

        const directory = await existDirectory(decodedPath);

        return res.status(200).json({
            message: 'WebDAV 디렉토리 조회 성공',
            status: 200,
            path: path,
            directory: directory
        });

    } catch (error) {
        console.error('WebDAV 디렉토리 조회 에러:', error);
        res.status(500).json({
            message: error.message,
            status: 500
        });
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

        return res.status(200).json({
            message: 'WebDAV 서버 정보 조회 성공',
            status: 200,
            baseUrl: baseUrl,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('WebDAV 정보 조회 에러:', error);
        res.status(500).json({
            message: error.message,
            status: 500
        });
    }
};


/**
 * 다중 파일 WebDAV 업로드 컨트롤러
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 */
export const uploadMultipleFilesToWebDAV = async (req, res) => {
    console.log("uploadMultipleFilesToWebDAV");
    console.log(req.body);

    try {
        const { path, filenames } = req.body;
        const files = req.files; // multer에서 다중 파일 설정 필요

        if (!files || files.length === 0) {
            return res.status(400).json({
                message: '파일이 없습니다.',
                status: 400
            });
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
            return res.status(400).json({
                message: `파일명 배열 형식이 올바르지 않습니다 [${filenames}]`,
                status: 400
            });
        }

        if (files.length !== filenamesArray.length) {
            return res.status(400).json({
                message: '파일 개수와 파일명 개수가 동일하지 않습니다.',
                status: 400
            });

        }

        if (!path) {
            return res.status(400).json({
                message: 'path가 필요합니다.',
                status: 400
            });
        }

        // 병렬 업로드 실행 (동시성 제한: 3개)
        const results = await uploadMultipleFilesParallel(path, files, filenamesArray, 3);

        const successCount = results.filter(r => r.success).length;
        const failCount = results.length - successCount;

        return res.status(200).json({
            message: `다중 파일 업로드 완료: ${successCount}개 성공, ${failCount}개 실패`,
            status: 200,
            path: path,
            results: results,
            summary: {
                total: results.length,
                success: successCount,
                failed: failCount
            }
        });

    } catch (error) {
        console.error('WebDAV 다중 업로드 에러:', error);
        res.status(500).json({
            message: error.message,
            status: 500
        });
    }
};

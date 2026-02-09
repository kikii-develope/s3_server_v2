"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateFile = exports.copyFile = exports.moveFile = exports.deleteDirectory = exports.deleteFile = exports.uploadMultipleFilesParallel = exports.existDirectory = exports.getDirectoryContents = exports.getFileFromDirectory = exports.getFile = exports.ensureDirectory = exports.uploadSingle = exports.createDirectory = exports.uploadFile = exports.client = exports.getRootPath = exports.getBaseUrl = void 0;
const webdav_1 = require("webdav");
const fs_1 = __importDefault(require("fs"));
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const uuid_1 = require("uuid");
const decoder_js_1 = require("../../utils/decoder.js");
const webdavUrl = process.env.WEBDAV_URL;
const webdavRootPath = process.env.WEBDAV_ROOT_PATH || 'www';
// HTTP/HTTPS Agent 설정 (keep-alive, 연결 재사용)
const httpAgent = new http_1.default.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 10, // 동시 연결 수
    maxFreeSockets: 5,
    timeout: 60000
});
const httpsAgent = new https_1.default.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 10,
    maxFreeSockets: 5,
    timeout: 60000,
    rejectUnauthorized: process.env.NODE_ENV === 'production' // 개발 환경에서는 자체 서명 인증서 허용
});
// 디렉토리 캐시 (경로 → 타임스탬프)
const dirCache = new Map();
const CACHE_TTL = 3600000; // 1시간
/** WebDAV용 경로 정규화 (중복 슬래시 제거, 백슬래시 → 슬래시) */
const normalizeWebDAVPath = (input) => {
    let p = input.replace(/\\/g, "/").replace(/\/+/g, "/");
    // '/.' 같은 끝 처리
    p = p.replace(/\/\.$/, "/");
    // 끝 슬래시는 제거(루트 '/'는 유지)
    if (p.length > 1 && p.endsWith("/"))
        p = p.slice(0, -1);
    return p;
};
// WebDAV 클라이언트 생성
const client = (0, webdav_1.createClient)(webdavUrl, {
    username: process.env.WEBDAV_USER,
    password: process.env.WEBDAV_PASSWORD,
    httpAgent: httpAgent,
    httpsAgent: httpsAgent,
    maxBodyLength: 3 * 1024 * 1024 * 1024, // 3GB
    maxContentLength: 3 * 1024 * 1024 * 1024
});
exports.client = client;
// 캐시 주기적 정리 (1시간마다)
setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [key, timestamp] of dirCache.entries()) {
        if (now - timestamp > CACHE_TTL) {
            dirCache.delete(key);
            cleanedCount++;
        }
    }
    if (cleanedCount > 0) {
        console.log(`[CACHE] ${cleanedCount}개 만료된 디렉토리 캐시 정리`);
    }
}, CACHE_TTL);
const getBaseUrl = () => webdavUrl;
exports.getBaseUrl = getBaseUrl;
const getRootPath = () => webdavRootPath;
exports.getRootPath = getRootPath;
/**
 * 중복 파일명 처리 - 파일명(1), 파일명(2) 형태로 고유 파일명 생성
 * @param {string} dirPath - 디렉토리 경로
 * @param {string} filename - 원본 파일명
 * @returns {string} 고유 파일명
 */
const getUniqueFilename = async (dirPath, filename) => {
    const normalizedPath = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
    const contents = await (0, exports.getDirectoryContents)(`/${webdavRootPath}${normalizedPath}`);
    if (!contents) {
        return filename;
    }
    const existingFiles = contents
        .filter(item => item.type === 'file')
        .map(item => item.basename.normalize('NFKC'));
    if (!existingFiles.includes(filename.normalize('NFKC'))) {
        return filename;
    }
    // 확장자 분리
    const lastDotIndex = filename.lastIndexOf('.');
    const hasExtension = lastDotIndex > 0;
    const baseName = hasExtension ? filename.slice(0, lastDotIndex) : filename;
    const extension = hasExtension ? filename.slice(lastDotIndex) : '';
    // 숫자 증가시키며 고유 파일명 찾기
    let counter = 1;
    let newFilename = `${baseName}(${counter})${extension}`;
    while (existingFiles.includes(newFilename.normalize('NFKC'))) {
        counter++;
        newFilename = `${baseName}(${counter})${extension}`;
    }
    console.log(`[RENAME] 중복 파일명 발견: ${filename} -> ${newFilename}`);
    return newFilename;
};
/**
 * 단일 파일 업로드 (내부 사용, Disk Storage)
 * 주의: 이 함수는 더 이상 권장되지 않음. uploadLargeFile 사용 권장.
 */
const uploadFile = async (path, file, filename) => {
    filename = filename.replace(/ /g, "_");
    await (0, exports.ensureDirectory)(path);
    if (path.startsWith("/")) {
        path = path.replace("/", "");
    }
    file.originalname = filename;
    const fullPath = `/${webdavRootPath}/${path}/${filename}`;
    console.log(`[UPLOAD] 파일 업로드중... [${filename}] (${(file.size / 1024).toFixed(2)} KB)`);
    try {
        // Disk Storage: file.path 또는 file.buffer 지원 (하위 호환성)
        const fileData = file.path ? fs_1.default.createReadStream(file.path) : file.buffer;
        const res = await client.putFileContents(fullPath, fileData);
        console.log(`[UPLOAD] 완료: ${filename}`);
        return { res, file };
    }
    catch (error) {
        console.log(`[UPLOAD] 실패: ${filename} - ${error.message}`);
        console.log(error);
        throw error;
    }
};
exports.uploadFile = uploadFile;
/**
 * 디렉토리 생성 로직
 * @param {string} path
 */
const createDirectory = async (path) => {
    try {
        await client.createDirectory(`/${webdavRootPath}/${path}`);
    }
    catch (error) {
        console.error(error);
        throw error;
    }
};
exports.createDirectory = createDirectory;
const uploadSingle = async (path, file, filename) => {
    try {
        // 중복 파일명 처리
        const uniqueFilename = await getUniqueFilename(path, filename.replace(/ /g, "_"));
        const { res, file: f } = await (0, exports.uploadFile)(path, file, uniqueFilename);
        return {
            filename: f.originalname,
            originalFilename: filename,
            success: true,
            size: f.size,
            url: (0, exports.getBaseUrl)() + `/${webdavRootPath}/${path}/${f.originalname}`,
            renamed: uniqueFilename !== filename.replace(/ /g, "_")
        };
    }
    catch (error) {
        return {
            filename: file.originalname,
            success: false,
            error: error.message
        };
    }
};
exports.uploadSingle = uploadSingle;
/**
 * 디렉토리 확인 및 생성 (캐싱 적용)
 * - 캐시 히트시 네트워크 요청 없이 즉시 반환
 * - 전체 경로를 한 번에 생성 시도 후 실패시 순차 생성
 */
const ensureDirectory = async (path) => {
    const normalized = normalizeWebDAVPath(path);
    if (!normalized || normalized === "/")
        return;
    const fullPath = `/${webdavRootPath}/${normalized}`;
    // 캐시 확인
    const cached = dirCache.get(fullPath);
    if (cached && Date.now() - cached < CACHE_TTL) {
        return; // 캐시 히트
    }
    // 전체 경로 한 번에 생성 시도
    try {
        await client.createDirectory(fullPath);
        dirCache.set(fullPath, Date.now());
        console.log(`[DIR] 생성: ${normalized}`);
        return;
    }
    catch (err) {
        const code = err?.status || err?.statusCode;
        // 이미 존재하면 캐시 저장
        if (code === 405 || code === 409 || /exists|allowed/i.test(String(err?.message))) {
            dirCache.set(fullPath, Date.now());
            return;
        }
        // 실패시 순차 생성 (부모 디렉토리가 없는 경우)
        console.log(`[DIR] 순차 생성 시도: ${normalized}`);
        await ensureDirectorySequential(normalized);
    }
};
exports.ensureDirectory = ensureDirectory;
/**
 * 디렉토리 순차 생성 (하위 호환성)
 */
const ensureDirectorySequential = async (path) => {
    const normalized = normalizeWebDAVPath(path);
    const isAbsolute = normalized.startsWith("/");
    const parts = normalized.split("/").filter(Boolean);
    let acc = isAbsolute ? "/" : "";
    for (const part of parts) {
        const next = acc === "/" ? `/${part}` : acc ? `${acc}/${part}` : part;
        const fullPath = `/${webdavRootPath}${next.startsWith('/') ? '' : '/'}${next}`;
        // 캐시 확인
        const cached = dirCache.get(fullPath);
        if (cached && Date.now() - cached < CACHE_TTL) {
            acc = next;
            continue;
        }
        // 존재 여부 확인
        const exists = await (0, exports.existDirectory)(fullPath);
        if (!exists) {
            try {
                await client.createDirectory(fullPath);
                console.log(`[DIR] 생성: ${next}`);
            }
            catch (err) {
                const code = err?.status || err?.statusCode;
                const msg = String(err?.message || err);
                const maybeAlreadyExists = code === 405 || code === 409 || /exists|allowed/i.test(msg);
                if (!maybeAlreadyExists) {
                    throw new Error(`디렉토리 생성 실패: "${next}" — ${msg}`);
                }
            }
        }
        // 캐시 저장
        dirCache.set(fullPath, Date.now());
        acc = next;
    }
};
const getFile = async (path) => {
    try {
        const url = new URL(path);
        const decodedPath = (0, decoder_js_1.decodePathTwiceToNFKC)(url.pathname);
        console.log(`[WebDAV] 요청 URL: ${webdavUrl}${decodedPath}`);
        let file = null;
        try {
            file = await client.getFileContents(decodedPath.normalize('NFKC'));
        }
        catch (error) {
            const directoryPath = decodedPath.split('/').slice(0, -1).join('/');
            const fName = decodedPath.split('/').pop();
            console.log(`[WebDAV] 디렉토리 검색: ${webdavUrl}${directoryPath}`);
            file = await (0, exports.getFileFromDirectory)(directoryPath, fName);
        }
        return file;
    }
    catch (error) {
        console.error("[WebDAV] 파일 내용 조회 실패:", error.message);
        console.error("::: ERROR :::");
        console.error(error);
    }
};
exports.getFile = getFile;
const getFileFromDirectory = async (directoryPath, fileName) => {
    try {
        // 디렉토리에서 특정 파일 찾기
        const directoryContents = await (0, exports.getDirectoryContents)(directoryPath);
        if (!directoryContents) {
            throw new Error(`디렉토리를 찾을 수 없습니다: ${directoryPath}`);
        }
        const targetFile = directoryContents.find(item => {
            // 더 정확한 유니코드 코드 포인트 확인
            const s2_1_1 = fileName.normalize('NFKC').split('').map(char => char.codePointAt(0));
            const s2_3 = item.basename.normalize('NFKC').split('').map(char => char.codePointAt(0));
            return item.type === 'file' && s2_1_1.every((code, index) => code === s2_3[index]);
        });
        if (!targetFile) {
            throw new Error(`파일을 찾을 수 없습니다: ${fileName}`);
        }
        // 파일 내용 불러오기
        const result = await client.getFileContents(targetFile.filename);
        return result;
    }
    catch (error) {
        console.error('파일 내용 조회 실패:', error);
        throw error;
    }
};
exports.getFileFromDirectory = getFileFromDirectory;
const getDirectoryContents = async (path) => {
    try {
        console.log(`[WebDAV] 디렉토리 조회: ${webdavUrl}${path}`);
        const res = await client.getDirectoryContents(path);
        return res;
    }
    catch (error) {
        console.log(`[WebDAV] 디렉토리 조회 실패: ${path} - ${error.message}`);
        return null;
    }
};
exports.getDirectoryContents = getDirectoryContents;
const existDirectory = async (path) => {
    const res = await (0, exports.getDirectoryContents)(path);
    return res !== null;
};
exports.existDirectory = existDirectory;
/**
 * 병렬 다중 파일 업로드 메소드 (빠르지만 동시성 제한)
 * @param {string} path - 업로드 경로
 * @param {Array} files - 파일 배열
 * @param {number} concurrency - 동시 업로드 수 (기본값: 3)
 * @returns {Array} 업로드 결과 배열
 */
const uploadMultipleFilesParallel = async (path, files, filenames, concurrency = 3) => {
    const results = [];
    console.log(`[UPLOAD] 다중 파일 업로드 시작 (총 ${files.length}개)`);
    await (0, exports.ensureDirectory)(path);
    // 청크 단위로 분할하여 병렬 처리
    for (let i = 0; i < files.length; i += concurrency) {
        const chunk = files.slice(i, i + concurrency);
        const filenameChunk = filenames.slice(i, i + concurrency);
        const chunkPromises = chunk.map(async (file, index) => {
            try {
                const filename = filenameChunk[index];
                const filenameExtension = filename.split('.').pop();
                const fileExtension = file.originalname.split(".").pop();
                if (filenameExtension != fileExtension) {
                    return {
                        filename: (0, decoder_js_1.decodePathTwiceToNFC)(file.originalname),
                        success: false,
                        size: 0,
                        url: "",
                        msg: `파일과 파일명의 확장자가 다릅니다. (파일: ${fileExtension}, 파일명: ${filenameExtension})`
                    };
                }
                // 중복 파일명 처리
                const uniqueFilename = await getUniqueFilename(path, filename.replace(/ /g, "_"));
                const wasRenamed = uniqueFilename !== filename.replace(/ /g, "_");
                const { res, file: f } = await (0, exports.uploadFile)(path, file, uniqueFilename);
                return {
                    filename: f.originalname,
                    originalFilename: filename,
                    success: true,
                    size: f.size,
                    url: (0, exports.getBaseUrl)() + `/${webdavRootPath}/${path}/${f.originalname}`,
                    msg: wasRenamed ? `중복으로 이름 변경: ${filename} → ${uniqueFilename}` : "신규 생성 완료",
                    renamed: wasRenamed
                };
            }
            catch (error) {
                return {
                    filename: file.originalname,
                    success: false,
                    error: error.message
                };
            }
        });
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
        console.log(`[UPLOAD] 진행중... ${Math.min(i + concurrency, files.length)}/${files.length}개 완료`);
    }
    const successCount = results.filter(r => r.success).length;
    console.log(`[UPLOAD] 다중 파일 업로드 완료: ${successCount}/${files.length}개 성공`);
    return results;
};
exports.uploadMultipleFilesParallel = uploadMultipleFilesParallel;
/**
 * 파일 삭제
 * @param {string} path - 삭제할 파일 경로
 */
const deleteFile = async (path) => {
    const fullPath = `/${webdavRootPath}/${path}`.normalize('NFKC');
    try {
        await client.deleteFile(fullPath);
    }
    catch (error) {
        console.error('파일 삭제 실패:', error);
        throw error;
    }
};
exports.deleteFile = deleteFile;
/**
 * 디렉토리 삭제
 * @param {string} path - 삭제할 디렉토리 경로
 */
const deleteDirectory = async (path) => {
    const fullPath = `/${webdavRootPath}/${path}`.normalize('NFKC');
    try {
        await client.deleteFile(fullPath);
    }
    catch (error) {
        console.error('디렉토리 삭제 실패:', error);
        throw error;
    }
};
exports.deleteDirectory = deleteDirectory;
/**
 * 파일/디렉토리 이동
 * @param {string} sourcePath - 원본 경로
 * @param {string} destPath - 대상 경로
 * @param {boolean} overwrite - 덮어쓰기 여부 (기본값: true)
 */
const moveFile = async (sourcePath, destPath, overwrite = true) => {
    const src = `/${webdavRootPath}/${sourcePath}`.normalize('NFKC');
    const dest = `/${webdavRootPath}/${destPath}`.normalize('NFKC');
    try {
        await client.moveFile(src, dest, { overwrite });
    }
    catch (error) {
        console.error('파일 이동 실패:', error);
        throw error;
    }
};
exports.moveFile = moveFile;
/**
 * 파일/디렉토리 복사
 * @param {string} sourcePath - 원본 경로
 * @param {string} destPath - 대상 경로
 * @param {boolean} overwrite - 덮어쓰기 여부 (기본값: true)
 */
const copyFile = async (sourcePath, destPath, overwrite = true) => {
    const src = `/${webdavRootPath}/${sourcePath}`.normalize('NFKC');
    const dest = `/${webdavRootPath}/${destPath}`.normalize('NFKC');
    try {
        await client.copyFile(src, dest, { overwrite });
    }
    catch (error) {
        console.error('파일 복사 실패:', error);
        throw error;
    }
};
exports.copyFile = copyFile;
/**
 * 파일 업데이트 (덮어쓰기)
 * @param {string} path - 파일 경로 (디렉토리)
 * @param {Object} file - 업로드할 파일 객체
 * @param {string} filename - 파일명
 */
/**
 * 파일 업데이트 (덮어쓰기) - Disk Storage 사용
 */
const updateFile = async (path, file, filename) => {
    filename = filename.replace(/ /g, "_");
    if (path.startsWith("/")) {
        path = path.replace("/", "");
    }
    file.originalname = filename;
    const fullPath = `/${webdavRootPath}/${path}/${filename}`.normalize('NFKC');
    console.log(`[UPDATE] 파일 업데이트중... [${filename}] (${(file.size / 1024).toFixed(2)} KB)`);
    try {
        // Disk Storage: file.path에서 스트림 생성
        const fileStream = fs_1.default.createReadStream(file.path);
        const res = await client.putFileContents(fullPath, fileStream, { overwrite: true });
        console.log(`[UPDATE] 완료: ${filename}`);
        return { res, file };
    }
    catch (error) {
        console.log(`[UPDATE] 실패: ${filename} - ${error.message}`);
        console.error('파일 업데이트 실패:', error);
        throw error;
    }
};
exports.updateFile = updateFile;

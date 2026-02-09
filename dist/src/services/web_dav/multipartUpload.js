"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteLocalFile = exports.calculateHashFromFile = exports.uploadLargeFile = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const webdavClient_js_1 = require("./webdavClient.js");
// 설정값
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB 청크
const PARALLEL_CHUNKS = 5; // 동시 업로드 5개
const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024 * 1024; // 10GB 이상이면 청크 업로드 (실질적으로 비활성화)
/**
 * 중복 파일명 처리 - 파일명(1), 파일명(2) 형태로 고유 파일명 생성
 * @param {string} dirPath - 디렉토리 경로
 * @param {string} filename - 원본 파일명
 * @returns {Promise<string>} 고유 파일명
 */
const getUniqueFilename = async (dirPath, filename) => {
    const normalizedPath = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
    const contents = await (0, webdavClient_js_1.getDirectoryContents)(`/${(0, webdavClient_js_1.getRootPath)()}${normalizedPath}`);
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
 * 대용량 파일 업로드 (자동으로 청크/단일 업로드 선택)
 * @param {string} dirPath - 업로드 경로 (예: "accident/test/2026-01-28")
 * @param {Object} file - multer file 객체 (file.path, file.size 사용)
 * @param {string} filename - 저장할 파일명
 * @param {Function} onProgress - 진행률 콜백 (선택)
 * @returns {Promise<Object>} - 업로드 결과
 */
const uploadLargeFile = async (dirPath, file, filename, onProgress = null) => {
    const fileSize = file.size;
    console.log(`[UPLOAD] 파일: ${filename} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);
    // 100MB 미만이면 단일 업로드
    if (fileSize < LARGE_FILE_THRESHOLD) {
        return await uploadSingleFile(dirPath, file, filename, onProgress);
    }
    // 100MB 이상이면 청크 업로드
    return await uploadFileInChunks(dirPath, file, filename, onProgress);
};
exports.uploadLargeFile = uploadLargeFile;
/**
 * 단일 파일 업로드 (100MB 미만)
 * @param {string} dirPath - 업로드 경로
 * @param {Object} file - multer file 객체
 * @param {string} filename - 저장할 파일명
 * @param {Function} onProgress - 진행률 콜백
 * @returns {Promise<Object>}
 */
const uploadSingleFile = async (dirPath, file, filename, onProgress) => {
    const fileSize = file.size;
    // 디렉토리 확인 및 생성
    await (0, webdavClient_js_1.ensureDirectory)(dirPath);
    // 공백을 밑줄로 치환
    const sanitizedFilename = filename.replace(/ /g, '_');
    // 중복 파일명 자동 처리 (파일명(1).pdf 형태로 변경)
    const uniqueFilename = await getUniqueFilename(dirPath, sanitizedFilename);
    const fullPath = `/${(0, webdavClient_js_1.getRootPath)()}/${dirPath}/${uniqueFilename}`;
    console.log(`[SINGLE UPLOAD] ${uniqueFilename} 업로드 시작...`);
    // 스트림으로 업로드
    const fileStream = fs_1.default.createReadStream(file.path);
    let uploaded = 0;
    fileStream.on('data', (chunk) => {
        uploaded += chunk.length;
        if (onProgress) {
            onProgress({
                type: 'single',
                uploaded,
                total: fileSize,
                percentage: ((uploaded / fileSize) * 100).toFixed(1)
            });
        }
    });
    await webdavClient_js_1.client.putFileContents(fullPath, fileStream);
    console.log(`[SINGLE UPLOAD] ${uniqueFilename} 완료`);
    return {
        filename: uniqueFilename,
        originalFilename: filename,
        size: fileSize,
        url: `${(0, webdavClient_js_1.getBaseUrl)()}/${(0, webdavClient_js_1.getRootPath)()}/${dirPath}/${uniqueFilename}`,
        uploadType: 'single',
        renamed: uniqueFilename !== sanitizedFilename
    };
};
/**
 * 청크 분할 병렬 업로드 (100MB 이상)
 * - 청크를 로컬에서만 관리하고 병합 후 최종 파일만 WebDAV에 업로드
 * @param {string} dirPath - 업로드 경로
 * @param {Object} file - multer file 객체
 * @param {string} filename - 저장할 파일명
 * @param {Function} onProgress - 진행률 콜백
 * @returns {Promise<Object>}
 */
const uploadFileInChunks = async (dirPath, file, filename, onProgress) => {
    const fileSize = file.size;
    const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
    // 공백을 밑줄로 치환
    const sanitizedFilename = filename.replace(/ /g, '_');
    // 중복 파일명 자동 처리 (파일명(1).pdf 형태로 변경)
    const uniqueFilename = await getUniqueFilename(dirPath, sanitizedFilename);
    console.log(`[MULTIPART] ${uniqueFilename}: ${totalChunks}개 청크로 분할 업로드`);
    // 디렉토리 확인 및 생성
    await (0, webdavClient_js_1.ensureDirectory)(dirPath);
    // 로컬 임시 디렉토리 생성
    const localTempDir = path_1.default.join(require('os').tmpdir(), `merge-${Date.now()}`);
    await fs_1.default.promises.mkdir(localTempDir, { recursive: true });
    let uploadedChunks = 0;
    try {
        // 청크를 로컬 임시 파일로 분할 저장 (병렬 처리)
        const chunkFiles = [];
        const chunkIndexes = Array.from({ length: totalChunks }, (_, i) => i);
        for (let i = 0; i < chunkIndexes.length; i += PARALLEL_CHUNKS) {
            const batch = chunkIndexes.slice(i, i + PARALLEL_CHUNKS);
            const batchPromises = batch.map(async (chunkIndex) => {
                const start = chunkIndex * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, fileSize);
                const chunkSize = end - start;
                // 파일에서 청크 읽기
                const buffer = Buffer.allocUnsafe(chunkSize);
                const fd = await fs_1.default.promises.open(file.path, 'r');
                await fd.read(buffer, 0, chunkSize, start);
                await fd.close();
                // 로컬 임시 파일로 저장
                const chunkPath = path_1.default.join(localTempDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);
                await fs_1.default.promises.writeFile(chunkPath, buffer);
                chunkFiles[chunkIndex] = chunkPath;
                uploadedChunks++;
                if (onProgress) {
                    onProgress({
                        type: 'multipart',
                        uploadedChunks,
                        totalChunks,
                        percentage: ((uploadedChunks / totalChunks) * 100).toFixed(1)
                    });
                }
                console.log(`[CHUNK] ${chunkIndex + 1}/${totalChunks} 완료 (${((uploadedChunks / totalChunks) * 100).toFixed(1)}%)`);
            });
            await Promise.all(batchPromises);
        }
        // 로컬에서 청크 병합
        console.log(`[MERGE] 로컬에서 청크 병합 시작...`);
        const mergedPath = path_1.default.join(localTempDir, uniqueFilename);
        const writeStream = fs_1.default.createWriteStream(mergedPath);
        for (let i = 0; i < totalChunks; i++) {
            const chunkData = await fs_1.default.promises.readFile(chunkFiles[i]);
            await new Promise((resolve, reject) => {
                writeStream.write(chunkData, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            if ((i + 1) % 10 === 0 || i === totalChunks - 1) {
                console.log(`[MERGE] ${i + 1}/${totalChunks} 청크 병합중...`);
            }
        }
        await new Promise((resolve) => writeStream.end(resolve));
        console.log(`[MERGE] 병합 완료: ${uniqueFilename}`);
        // 병합된 파일을 WebDAV에 업로드
        console.log(`[UPLOAD] WebDAV에 최종 파일 업로드 시작...`);
        const finalPath = `/${(0, webdavClient_js_1.getRootPath)()}/${dirPath}/${uniqueFilename}`;
        const fileStream = fs_1.default.createReadStream(mergedPath);
        await webdavClient_js_1.client.putFileContents(finalPath, fileStream);
        console.log(`[UPLOAD] 업로드 완료: ${uniqueFilename}`);
        return {
            filename: uniqueFilename,
            originalFilename: filename,
            size: fileSize,
            url: `${(0, webdavClient_js_1.getBaseUrl)()}/${(0, webdavClient_js_1.getRootPath)()}/${dirPath}/${uniqueFilename}`,
            chunks: totalChunks,
            uploadType: 'multipart',
            renamed: uniqueFilename !== sanitizedFilename
        };
    }
    finally {
        // 로컬 임시 파일 정리
        try {
            const files = await fs_1.default.promises.readdir(localTempDir);
            for (const file of files) {
                await fs_1.default.promises.unlink(path_1.default.join(localTempDir, file));
            }
            await fs_1.default.promises.rmdir(localTempDir);
            console.log(`[CLEANUP] 로컬 임시 파일 정리 완료`);
        }
        catch (err) {
            console.warn(`[CLEANUP] 임시 파일 정리 실패 (무시): ${err.message}`);
        }
    }
};
/**
 * 청크 병합
 * @param {string} tempDir - 임시 디렉토리 경로
 * @param {string} targetDir - 최종 저장 경로
 * @param {string} filename - 최종 파일명
 * @param {number} totalChunks - 총 청크 수
 */
const mergeChunks = async (tempDir, targetDir, filename, totalChunks) => {
    // 로컬에 임시 파일 생성하여 병합
    const mergedPath = path_1.default.join(fs_1.default.mkdtempSync(path_1.default.join(require('os').tmpdir(), 'merge-')), filename);
    const writeStream = fs_1.default.createWriteStream(mergedPath);
    try {
        // 청크를 순서대로 다운로드하여 병합
        for (let i = 0; i < totalChunks; i++) {
            const chunkPath = `/${(0, webdavClient_js_1.getRootPath)()}/${tempDir}/chunk_${String(i).padStart(5, '0')}`;
            const chunkBuffer = await webdavClient_js_1.client.getFileContents(chunkPath);
            await new Promise((resolve, reject) => {
                writeStream.write(chunkBuffer, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve();
                });
            });
            if ((i + 1) % 10 === 0) {
                console.log(`[MERGE] ${i + 1}/${totalChunks} 청크 병합중...`);
            }
        }
        await new Promise((resolve) => writeStream.end(resolve));
        // 병합된 파일 업로드
        const finalPath = `/${(0, webdavClient_js_1.getRootPath)()}/${targetDir}/${filename}`;
        const fileStream = fs_1.default.createReadStream(mergedPath);
        await webdavClient_js_1.client.putFileContents(finalPath, fileStream);
        console.log(`[MERGE] 완료: ${filename}`);
    }
    finally {
        // 로컬 임시 파일 삭제
        try {
            await fs_1.default.promises.unlink(mergedPath);
            await fs_1.default.promises.rmdir(path_1.default.dirname(mergedPath));
        }
        catch (err) {
            console.warn(`[CLEANUP] 병합 임시 파일 삭제 실패 (무시): ${err.message}`);
        }
    }
};
/**
 * 파일 해시 계산 (스트림 방식)
 * @param {string} filePath - 파일 경로
 * @param {string} algorithm - 해시 알고리즘 (기본: sha256)
 * @returns {Promise<string>} - 해시값 (hex)
 */
const calculateHashFromFile = async (filePath, algorithm = 'sha256') => {
    const hash = crypto_1.default.createHash(algorithm);
    const stream = fs_1.default.createReadStream(filePath);
    for await (const chunk of stream) {
        hash.update(chunk);
    }
    return hash.digest('hex');
};
exports.calculateHashFromFile = calculateHashFromFile;
/**
 * 파일 삭제 (로컬 임시 파일)
 * @param {string} filePath - 삭제할 파일 경로
 */
const deleteLocalFile = async (filePath) => {
    try {
        await fs_1.default.promises.unlink(filePath);
        console.log(`[CLEANUP] 로컬 임시 파일 삭제: ${path_1.default.basename(filePath)}`);
    }
    catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`[CLEANUP] 파일 삭제 실패: ${filePath}`, err.message);
        }
    }
};
exports.deleteLocalFile = deleteLocalFile;

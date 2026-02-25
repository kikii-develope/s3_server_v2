import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import os from 'os';
import { pipeline } from 'stream/promises';
import { client, getBaseUrl, getRootPath } from './client.js';
import { ensureDirectory, getDirectoryContents } from './directory.js';

// 설정값
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB 청크
const PARALLEL_CHUNKS = 2; // 동시 청크 처리 2개 (메모리 안정화)
const LARGE_FILE_THRESHOLD = 100 * 1024 * 1024; // 100MB 이상이면 청크 업로드

// 동시 업로드 시 파일명 충돌 방지를 위한 인메모리 예약 맵
const reservedFilenames = new Map();

/**
 * 예약 해제 (업로드 완료/실패 후 호출)
 */
export const releaseFilename = (dirPath, filename) => {
  const key = dirPath.normalize('NFKC');
  const reserved = reservedFilenames.get(key);
  if (reserved) {
    reserved.delete(filename.normalize('NFKC'));
    if (reserved.size === 0) reservedFilenames.delete(key);
  }
};

/**
 * 중복 파일명 처리 - 파일명(1), 파일명(2) 형태로 고유 파일명 생성
 * 동시 요청 시 인메모리 예약으로 레이스 컨디션 방지
 */
const getUniqueFilename = async (dirPath, filename) => {
  const normalizedPath = dirPath.startsWith('/') ? dirPath : `/${dirPath}`;
  const contents = await getDirectoryContents(`/${getRootPath()}${normalizedPath}`);

  const existingFiles = contents
    ? contents.filter(item => item.type === 'file').map(item => item.basename.normalize('NFKC'))
    : [];

  const dirKey = dirPath.normalize('NFKC');
  if (!reservedFilenames.has(dirKey)) {
    reservedFilenames.set(dirKey, new Set());
  }
  const reserved = reservedFilenames.get(dirKey);
  const allUsed = [...existingFiles, ...reserved];

  let finalFilename = filename;

  if (allUsed.includes(filename.normalize('NFKC'))) {
    const lastDotIndex = filename.lastIndexOf('.');
    const hasExtension = lastDotIndex > 0;
    const baseName = hasExtension ? filename.slice(0, lastDotIndex) : filename;
    const extension = hasExtension ? filename.slice(lastDotIndex) : '';

    let counter = 1;
    finalFilename = `${baseName}(${counter})${extension}`;

    while (allUsed.includes(finalFilename.normalize('NFKC'))) {
      counter++;
      finalFilename = `${baseName}(${counter})${extension}`;
    }

    console.log(`[RENAME] 중복 파일명 발견: ${filename} -> ${finalFilename}`);
  }

  reserved.add(finalFilename.normalize('NFKC'));
  return finalFilename;
};

/**
 * 대용량 파일 업로드 (자동으로 청크/단일 업로드 선택)
 */
export const uploadLargeFile = async (dirPath, file, filename, onProgress = null) => {
  const fileSize = file.size;

  console.log(`[UPLOAD] 파일: ${filename} (${(fileSize / 1024 / 1024).toFixed(2)}MB)`);

  if (fileSize < LARGE_FILE_THRESHOLD) {
    return await uploadSingleFile(dirPath, file, filename, onProgress);
  }

  return await uploadFileInChunks(dirPath, file, filename, onProgress);
};

/**
 * 단일 파일 업로드 (100MB 미만)
 */
const uploadSingleFile = async (dirPath, file, filename, onProgress) => {
  const fileSize = file.size;

  await ensureDirectory(dirPath);

  const sanitizedFilename = filename.replace(/ /g, '_');
  const uniqueFilename = await getUniqueFilename(dirPath, sanitizedFilename);
  const fullPath = `/${getRootPath()}/${dirPath}/${uniqueFilename}`;

  console.log(`[SINGLE UPLOAD] ${uniqueFilename} 업로드 시작...`);

  try {
    const fileStream = fs.createReadStream(file.path);
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

    await client.putFileContents(fullPath, fileStream);

    console.log(`[SINGLE UPLOAD] ${uniqueFilename} 완료`);

    return {
      filename: uniqueFilename,
      originalFilename: filename,
      size: fileSize,
      url: `${getBaseUrl()}/${getRootPath()}/${dirPath}/${uniqueFilename}`,
      uploadType: 'single',
      renamed: uniqueFilename !== sanitizedFilename
    };
  } finally {
    releaseFilename(dirPath, uniqueFilename);
  }
};

/**
 * 청크 분할 업로드 (100MB 이상) — Stream 방식
 * Buffer.allocUnsafe / readFile 금지 → createReadStream + pipeline 사용
 */
const uploadFileInChunks = async (dirPath, file, filename, onProgress) => {
  const fileSize = file.size;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);

  const sanitizedFilename = filename.replace(/ /g, '_');
  const uniqueFilename = await getUniqueFilename(dirPath, sanitizedFilename);

  console.log(`[MULTIPART] ${uniqueFilename}: ${totalChunks}개 청크로 분할 (스트림 방식)`);

  await ensureDirectory(dirPath);

  const localTempDir = path.join(os.tmpdir(), `merge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.promises.mkdir(localTempDir, { recursive: true });

  let uploadedChunks = 0;

  try {
    // === 1단계: 스트림으로 청크 분할 (Buffer 없음) ===
    const chunkFiles = [];
    const chunkIndexes = Array.from({ length: totalChunks }, (_, i) => i);

    for (let i = 0; i < chunkIndexes.length; i += PARALLEL_CHUNKS) {
      const batch = chunkIndexes.slice(i, i + PARALLEL_CHUNKS);

      const batchPromises = batch.map(async (chunkIndex) => {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileSize) - 1;

        const chunkPath = path.join(localTempDir, `chunk_${String(chunkIndex).padStart(5, '0')}`);

        const readStream = fs.createReadStream(file.path, { start, end });
        const writeStream = fs.createWriteStream(chunkPath);
        await pipeline(readStream, writeStream);

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

    // === 2단계: 스트림으로 청크 병합 (append 모드) ===
    console.log(`[MERGE] 스트림 병합 시작...`);
    const mergedPath = path.join(localTempDir, uniqueFilename);
    await fs.promises.writeFile(mergedPath, '');

    for (let i = 0; i < totalChunks; i++) {
      const rs = fs.createReadStream(chunkFiles[i]);
      const ws = fs.createWriteStream(mergedPath, { flags: 'a' });
      await pipeline(rs, ws);

      if ((i + 1) % 10 === 0 || i === totalChunks - 1) {
        console.log(`[MERGE] ${i + 1}/${totalChunks} 청크 병합중...`);
      }
    }
    console.log(`[MERGE] 병합 완료: ${uniqueFilename}`);

    // === 3단계: 병합된 파일을 WebDAV에 업로드 ===
    const finalPath = `/${getRootPath()}/${dirPath}/${uniqueFilename}`;
    const mergedSize = (await fs.promises.stat(mergedPath)).size;
    console.log(`[UPLOAD] WebDAV PUT 시작: ${finalPath} (${(mergedSize / 1024 / 1024).toFixed(2)}MB)`);
    const fileStream = fs.createReadStream(mergedPath);
    await client.putFileContents(finalPath, fileStream);
    console.log(`[UPLOAD] 업로드 완료: ${uniqueFilename}`);

    return {
      filename: uniqueFilename,
      originalFilename: filename,
      size: fileSize,
      url: `${getBaseUrl()}/${getRootPath()}/${dirPath}/${uniqueFilename}`,
      chunks: totalChunks,
      uploadType: 'multipart',
      renamed: uniqueFilename !== sanitizedFilename
    };
  } finally {
    releaseFilename(dirPath, uniqueFilename);

    // 로컬 임시 파일 정리
    try {
      const tempFiles = await fs.promises.readdir(localTempDir);
      for (const f of tempFiles) {
        await fs.promises.unlink(path.join(localTempDir, f));
      }
      await fs.promises.rmdir(localTempDir);
      console.log(`[CLEANUP] 로컬 임시 파일 정리 완료`);
    } catch (err) {
      console.warn(`[CLEANUP] 임시 파일 정리 실패 (무시): ${err.message}`);
    }
  }
};

/**
 * 파일 해시 계산 (스트림 방식)
 */
export const calculateHashFromFile = async (filePath, algorithm = 'sha256') => {
  const hash = crypto.createHash(algorithm);
  const stream = fs.createReadStream(filePath);

  for await (const chunk of stream) {
    hash.update(chunk);
  }

  return hash.digest('hex');
};

/**
 * 파일 삭제 (로컬 임시 파일)
 */
export const deleteLocalFile = async (filePath) => {
  try {
    await fs.promises.unlink(filePath);
    console.log(`[CLEANUP] 로컬 임시 파일 삭제: ${path.basename(filePath)}`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[CLEANUP] 파일 삭제 실패: ${filePath}`, err.message);
    }
  }
};

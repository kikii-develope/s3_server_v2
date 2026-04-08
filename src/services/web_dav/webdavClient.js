import { createClient } from "webdav";
import fs from 'fs';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { decodePathTwiceToNFC, decodePathTwiceToNFKC } from "../../utils/decoder.js";
import { getWebdavRootPath } from "../../utils/webdavRootPath.js";

// SSL 인증서 설정 (필요시 주석 해제)
// const ca = fs.readFileSync('local.crt');
// const agent = new https.Agent({
//   ca: ca,
//   rejectUnauthorized: true
// });

const webdavUrl = process.env.WEBDAV_URL;
const WEBDAV_ROOT_PATH = getWebdavRootPath();
const ROOT_PREFIX = `/${WEBDAV_ROOT_PATH}`;

/** WebDAV용 경로 정규화 (중복 슬래시 제거, 백슬래시 → 슬래시) */
const normalizeWebDAVPath = (input) => {
  let p = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  // '/.' 같은 끝 처리
  p = p.replace(/\/\.$/, "/");
  // 끝 슬래시는 제거(루트 '/'는 유지)
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

const normalizeRelativePath = (input = '') =>
  String(input).replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');

const sanitizeFilenameForPath = (filename = '') =>
  String(filename).replace(/[\/\\\0]/g, '_');

const toRootPath = (input = '') => {
  const normalized = normalizeWebDAVPath(String(input || ''));
  if (!normalized || normalized === '/') return ROOT_PREFIX;

  if (normalized === ROOT_PREFIX || normalized.startsWith(`${ROOT_PREFIX}/`)) {
    return normalized;
  }
  if (normalized === '/www' || normalized.startsWith('/www/')) {
    return `${ROOT_PREFIX}${normalized.slice(4)}`;
  }
  return `${ROOT_PREFIX}/${normalizeRelativePath(normalized)}`;
};

const client = createClient(
  webdavUrl,
  {
    username: process.env.WEBDAV_USER,
    password: process.env.WEBDAV_PASSWORD,
    // 추가 SSL 옵션
    // httpsAgent: agent,
    // timeout: 30000,
    // fetch 옵션 추가
    // fetch: (url, options) => {
    //   return fetch(url, {
    //     ...options,
    //     // agent
    //   });
    // }
  }
);

export const getBaseUrl = () => webdavUrl;

/**
 * 중복 파일명 처리 - 파일명(1), 파일명(2) 형태로 고유 파일명 생성
 * @param {string} dirPath - 디렉토리 경로
 * @param {string} filename - 원본 파일명
 * @returns {string} 고유 파일명
 */
const getUniqueFilename = async (dirPath, filename) => {
  const contents = await getDirectoryContents(toRootPath(dirPath));

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

export const resolveUniqueFilename = async (dirPath, filename) => {
  const safeFilename = sanitizeFilenameForPath(filename);
  return getUniqueFilename(dirPath, safeFilename);
};

export const uploadFile = async (path, file, filename) => {
  filename = sanitizeFilenameForPath(filename);

  await ensureDirectory(path);

  if (path.startsWith("/")) {
    path = path.replace("/", "");
  }

  file.originalname = filename;

  const fullPath = toRootPath(`${path}/${filename}`);
  console.log(`[UPLOAD] 파일 업로드중... [${filename}] (${(file.size / 1024).toFixed(2)} KB)`);
  try {
    const res = await client.putFileContents(fullPath, file.buffer);
    console.log(`[UPLOAD] 완료: ${filename}`);

    return { res, file };
  } catch (error) {
    console.log(`[UPLOAD] 실패: ${filename} - ${error.message}`);
    console.log(error);

    throw error;
  }
}

/**
 * 디렉토리 생성 로직
 * @param {string} path
 */
export const createDirectory = async (path) => {
  try {
    await client.createDirectory(toRootPath(path));
  } catch (error) {
    const code = error?.status || error?.statusCode;
    const msg = String(error?.message || '');
    const maybeAlreadyExists = code === 405 || code === 409 || /exists|allowed/i.test(msg);
    if (!maybeAlreadyExists) {
      console.error(error);
      throw error;
    }
  }
}

export const uploadSingle = async (path, file, filename) => {
  try {
    // 중복 파일명 처리
    const safeFilename = sanitizeFilenameForPath(filename);
    const uniqueFilename = await getUniqueFilename(path, safeFilename);

    const { res, file: f } = await uploadFile(path, file, uniqueFilename);

    return {
      filename: f.originalname,
      originalFilename: filename,
      success: true,
      size: f.size,
      url: getBaseUrl() + toRootPath(`${path}/${f.originalname}`),
      renamed: uniqueFilename !== safeFilename
    };
  } catch (error) {
    return {
      filename: file.originalname,
      success: false,
      error: error.message
    };
  }
}


/** 상위부터 한 계단씩 존재 여부 확인 후 생성 */
export const ensureDirectory = async (path) => {
  let normalized = normalizeWebDAVPath(path);
  if (normalized === ROOT_PREFIX) {
    normalized = "/";
  } else if (normalized.startsWith(`${ROOT_PREFIX}/`)) {
    normalized = normalized.slice(ROOT_PREFIX.length);
  } else if (normalized === "/www") {
    normalized = "/";
  } else if (normalized.startsWith("/www/")) {
    normalized = normalized.slice(4);
  }

  if (!normalized || normalized === "/") return;

  const isAbsolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);

  // 누적 경로(절대경로면 '/'부터 시작)
  let acc = isAbsolute ? "/" : "";

  for (const part of parts) {
    const next = acc === "/" ? `/${part}` : acc ? `${acc}/${part}` : part;


    // 1) 이미 있으면 통과
    const exists = await existDirectory(toRootPath(next));


    if (!exists) {
      try {

        await client.createDirectory(toRootPath(next));
      } catch (err) {
        // 경쟁 상태 혹은 서버별 응답 차이를 관용적으로 처리
        const code = err?.status || err?.statusCode;
        const msg = String(err?.message || err);
        const maybeAlreadyExists =
          code === 405 || code === 409 || /exists|allowed/i.test(msg);

        if (!maybeAlreadyExists) {
          throw new Error(`디렉토리 생성 실패: "${next}" — ${msg}`);
        }
      }
    }

    acc = next;
  }
}

export const getFile = async (path) => {

  try {

    const url = new URL(path);

    const decodedPath = decodePathTwiceToNFKC(url.pathname);

    console.log(`[WebDAV] 요청 URL: ${webdavUrl}${decodedPath}`);

    let file = null;
    try {
      file = await client.getFileContents(decodedPath.normalize('NFKC'));
    } catch (error) {

      const directoryPath = decodedPath.split('/').slice(0, -1).join('/');
      const fName = decodedPath.split('/').pop();

      console.log(`[WebDAV] 디렉토리 검색: ${webdavUrl}${directoryPath}`);

      file = await getFileFromDirectory(directoryPath, fName);
    }

    return file;
  } catch (error) {
    console.error("[WebDAV] 파일 내용 조회 실패:", error.message);
    console.error("::: ERROR :::")
    console.error(error);
  }
}

export const getFileFromDirectory = async (directoryPath, fileName) => {
  try {
    // 디렉토리에서 특정 파일 찾기
    const directoryContents = await getDirectoryContents(directoryPath);

    if (!directoryContents) {
      throw new Error(`디렉토리를 찾을 수 없습니다: ${directoryPath}`);
    }

    const targetFile = directoryContents.find(item => {

      // 더 정확한 유니코드 코드 포인트 확인

      const s2_1_1 = fileName.normalize('NFKC').split('').map(char => char.codePointAt(0));
      const s2_3 = item.basename.normalize('NFKC').split('').map(char => char.codePointAt(0));

      return item.type === 'file' && s2_1_1.every((code, index) => code === s2_3[index])
    }
    );

    if (!targetFile) {
      throw new Error(`파일을 찾을 수 없습니다: ${fileName}`);
    }

    // 파일 내용 불러오기
    const result = await client.getFileContents(targetFile.filename);

    return result;
  } catch (error) {
    console.error('파일 내용 조회 실패:', error);
    throw error;
  }
}

export const getDirectoryContents = async (path) => {
  try {
    const targetPath = toRootPath(path);
    console.log(`[WebDAV] 디렉토리 조회: ${webdavUrl}${targetPath}`);
    const res = await client.getDirectoryContents(targetPath);
    return res;
  } catch (error) {
    console.log(`[WebDAV] 디렉토리 조회 실패: ${path} - ${error.message}`);
    return null;
  }
}

export const existDirectory = async (path) => {
  const res = await getDirectoryContents(path);
  return res !== null;
}


/**
 * 병렬 다중 파일 업로드 메소드 (빠르지만 동시성 제한)
 * @param {string} path - 업로드 경로
 * @param {Array} files - 파일 배열
 * @param {number} concurrency - 동시 업로드 수 (기본값: 3)
 * @returns {Array} 업로드 결과 배열
 */
export const uploadMultipleFilesParallel = async (path, files, filenames, concurrency = 3) => {
  const results = [];
  console.log(`[UPLOAD] 다중 파일 업로드 시작 (총 ${files.length}개)`);

  await ensureDirectory(path);

  // 청크 단위로 분할하여 병렬 처리
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);
    const filenameChunk = filenames.slice(i, i + concurrency);

    const chunkPromises = chunk.map(async (file, index) => {
      try {
        const filename = filenameChunk[index];
        const safeFilename = sanitizeFilenameForPath(filename);

        const filenameExtension = safeFilename.split('.').pop();
        const fileExtension = file.originalname.split(".").pop();
        if (filenameExtension != fileExtension) {
          return {
            filename: decodePathTwiceToNFC(file.originalname),
            success: false,
            size: 0,
            url: "",
            msg: `파일과 파일명의 확장자가 다릅니다. (파일: ${fileExtension}, 파일명: ${filenameExtension})`
          }

        }


        // 중복 파일명 처리
        const uniqueFilename = await getUniqueFilename(path, safeFilename);
        const wasRenamed = uniqueFilename !== safeFilename;

        const { res, file: f } = await uploadFile(path, file, uniqueFilename);

        return {
          filename: f.originalname,
          originalFilename: filename,
          success: true,
          size: f.size,
          url: getBaseUrl() + toRootPath(`${path}/${f.originalname}`),
          msg: wasRenamed ? `중복으로 이름 변경: ${filename} → ${uniqueFilename}` : "신규 생성 완료",
          renamed: wasRenamed
        };
      } catch (error) {
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

/**
 * 파일 삭제
 * @param {string} path - 삭제할 파일 경로
 */
export const deleteFile = async (path) => {
  const fullPath = toRootPath(path).normalize('NFKC');
  try {
    await client.deleteFile(fullPath);
  } catch (error) {
    console.error('파일 삭제 실패:', error);
    throw error;
  }
}

/**
 * 디렉토리 삭제
 * @param {string} path - 삭제할 디렉토리 경로
 */
export const deleteDirectory = async (path) => {
  const fullPath = toRootPath(path).normalize('NFKC');
  try {
    await client.deleteFile(fullPath);
  } catch (error) {
    console.error('디렉토리 삭제 실패:', error);
    throw error;
  }
}

/**
 * 파일/디렉토리 이동
 * @param {string} sourcePath - 원본 경로
 * @param {string} destPath - 대상 경로
 * @param {boolean} overwrite - 덮어쓰기 여부 (기본값: true)
 */
export const moveFile = async (sourcePath, destPath, overwrite = true) => {
  const src = toRootPath(sourcePath).normalize('NFKC');
  const dest = toRootPath(destPath).normalize('NFKC');
  try {
    await client.moveFile(src, dest, { overwrite });
  } catch (error) {
    console.error('파일 이동 실패:', error);
    throw error;
  }
}

/**
 * 파일/디렉토리 복사
 * @param {string} sourcePath - 원본 경로
 * @param {string} destPath - 대상 경로
 * @param {boolean} overwrite - 덮어쓰기 여부 (기본값: true)
 */
export const copyFile = async (sourcePath, destPath, overwrite = true) => {
  const src = toRootPath(sourcePath).normalize('NFKC');
  const dest = toRootPath(destPath).normalize('NFKC');
  try {
    await client.copyFile(src, dest, { overwrite });
  } catch (error) {
    console.error('파일 복사 실패:', error);
    throw error;
  }
}

/**
 * 파일 업데이트 (덮어쓰기)
 * @param {string} path - 파일 경로 (디렉토리)
 * @param {Object} file - 업로드할 파일 객체
 * @param {string} filename - 파일명
 */
export const updateFile = async (path, file, filename) => {
  filename = sanitizeFilenameForPath(filename);

  if (path.startsWith("/")) {
    path = path.replace("/", "");
  }

  file.originalname = filename;

  const fullPath = toRootPath(`${path}/${filename}`).normalize('NFKC');
  console.log(`[UPDATE] 파일 업데이트중... [${filename}] (${(file.size / 1024).toFixed(2)} KB)`);
  try {
    const res = await client.putFileContents(fullPath, file.buffer, { overwrite: true });
    console.log(`[UPDATE] 완료: ${filename}`);
    return { res, file };
  } catch (error) {
    console.log(`[UPDATE] 실패: ${filename} - ${error.message}`);
    console.error('파일 업데이트 실패:', error);
    throw error;
  }
}

// ==========================================
// v7 미디어 변환 전용 추가 로직
// ==========================================

export const clientInstance = client; // client 객체 노출 (삭제 작업 등)

/**
 * 안전한 Stream 업로드 (양방향 에러 핸들링, timeout 0)
 * 메모리 사용량: ~64KB 고정
 */
const streamUploadSafe = (webdavPath, localFilePath) => {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };

    const rs = fs.createReadStream(localFilePath);
    const ws = client.createWriteStream(webdavPath);

    // 대용량 파일 timeout 방지 (v7)
    if (rs.setTimeout) rs.setTimeout(0);
    if (ws.setTimeout) ws.setTimeout(0);

    rs.on('error', (e) => {
      fail(e);
      ws.destroy();
    });

    ws.on('error', (e) => {
      fail(e);
      rs.destroy();
    });

    ws.on('finish', () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });

    rs.pipe(ws);
  });
};

/**
 * 원자적 업로드: 임시 경로(.__uploading__)에 먼저 업로드 후 완료 시 rename
 * NAS에 깨진 파일이 남는 것을 원천 방지
 */
export const atomicUpload = async (finalPath, localFilePath) => {
  // webdav는 상위 디렉토리가 없으면 에러나므로 기존 보장 로직 활용
  const dirPath = finalPath.split('/').slice(0, -1).join('/');
  await ensureDirectory(dirPath);

  const tempPath = `${finalPath}.__uploading__`;

  // 1. 임시 경로에 업로드
  await streamUploadSafe(tempPath, localFilePath);

  // 2. 업로드 완료 후 최종 경로로 이동 (원자적 교체)
  try {
    await client.moveFile(tempPath, finalPath, { overwrite: true });
  } catch (moveErr) {
    // rename 실패 시 temp 파일 정리
    try {
      await client.deleteFile(tempPath);
    } catch { }
    throw moveErr;
  }
};

/**
 * NAS 파일 존재 여부 확인 (멱등성 체크용)
 */
export const webdavFileExists = async (path) => {
  try {
    await client.stat(toRootPath(path));
    return true;
  } catch {
    return false;
  }
};

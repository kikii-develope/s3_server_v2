import { createClient } from "webdav";
import fs from 'fs';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { toUtf8FromFile } from "../../utils/decoder.js";

const ca = fs.readFileSync('local.crt');
const agent = new https.Agent({
  ca: ca,
  rejectUnauthorized: true
});

const webdavUrl = process.env.WEBDAV_URL;

/** WebDAV용 경로 정규화 (중복 슬래시 제거, 백슬래시 → 슬래시) */
const normalizeWebDAVPath = (input) => {
  let p = input.replace(/\\/g, "/").replace(/\/+/g, "/");
  // '/.' 같은 끝 처리
  p = p.replace(/\/\.$/, "/");
  // 끝 슬래시는 제거(루트 '/'는 유지)
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

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

export const uploadFile = async (path, file) => {

  await ensureDirectory(path);

  const originalname = file.originalname;

  console.log("originalname");
  console.log(originalname);

  const extension = originalname.split('.').pop()?.toLowerCase();

  // 날짜 형식 생성 (YYYYMMDD)
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0') +
    String(today.getHours()).padStart(2, '0') +
    String(today.getMinutes()).padStart(2, '0') +
    String(today.getSeconds()).padStart(2, '0');


  // UUID 생성 후 앞 5자리만 추출
  const uuidShort = uuidv4().replace(/-/g, '').substring(0, 5);

  // 새로운 파일명 생성: 날짜_UUID(5자리).확장자
  const newFilename = `${dateStr}_${uuidShort}.${extension}`;
  if (path.startsWith("/")) {
    path = path.replace("/", "");
  }

  file.originalname = newFilename;

  try {
    const res = await client.putFileContents(`www/${path}/${file.originalname}`, file.buffer);

    return { res, file };
  } catch (error) {
    console.log(error);

    throw error;
  }
}


export const uploadFile2 = async (path, file, filename) => {

  console.log(filename);
  filename = filename.replace(/ /g, "_");

  await ensureDirectory(path);

  if (path.startsWith("/")) {
    path = path.replace("/", "");
  }

  file.originalname = filename;

  const fullPath = `www/${path}/${filename}`;
  try {
    const res = await client.putFileContents(fullPath, file.buffer);

    console.log(fullPath);
    console.log(res);

    return { res, file };
  } catch (error) {
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
    await client.createDirectory(`/www/${path}`);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export const uploadSingle = async (path, file, filename) => {
  try {
    const { res, file: f } = await uploadFile2(path, file, filename);

    return {
      filename: f.originalname,
      success: true,
      size: f.size,
      url: getBaseUrl() + `/www/${path}/${file.originalname}`
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

  console.log(path);
  const normalized = normalizeWebDAVPath(path);

  console.log(normalized);
  if (!normalized || normalized === "/") return;

  const isAbsolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);

  // 누적 경로(절대경로면 '/'부터 시작)
  let acc = isAbsolute ? "/" : "";

  for (const part of parts) {
    const next = acc === "/" ? `/${part}` : acc ? `${acc}/${part}` : part;


    // 1) 이미 있으면 통과
    const exists = await existDirectory(next);
    console.log(next + " : " + exists);


    if (!exists) {
      try {

        await client.createDirectory(`/www/${next}`);
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

  console.log(path);

  try {
    const file = await client.getFileContents(path);

    return file;
  } catch (error) {
    console.error(error);
  }
}

export const existDirectory = async (path) => {
  try {
    const directory = await client.getDirectoryContents(`/www/${path}`);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}


/**
 * 병렬 다중 파일 업로드 메소드 (빠르지만 동시성 제한)
 * @param {string} path - 업로드 경로
 * @param {Array} files - 파일 배열
 * @param {number} concurrency - 동시 업로드 수 (기본값: 3)
 * @returns {Array} 업로드 결과 배열
 */
export const uploadMultipleFilesParallel = async (path, files, concurrency = 3) => {
  const results = [];

  await ensureDirectory(path);

  // 청크 단위로 분할하여 병렬 처리
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);

    const chunkPromises = chunk.map(async (file) => {
      try {
        const { res, file: f } = await uploadFile(path, file);

        return {
          filename: f.originalname,
          success: true,
          size: f.size,
          url: getBaseUrl() + `/www/${path}/${file.originalname}`
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
  }

  return results;
};

import { createClient } from "webdav";
import fs from 'fs';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';

const ca = fs.readFileSync('local.crt');
const agent = new https.Agent({
  ca: ca,
  rejectUnauthorized: true
});

const webdavUrl = process.env.WEBDAV_URL;


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

  const originalname = file.originalname;

  const extension = originalname.split('.').pop()?.toLowerCase();

  // 날짜 형식 생성 (YYYYMMDD)
  const today = new Date();
  const dateStr = today.getFullYear().toString() +
    String(today.getMonth() + 1).padStart(2, '0') +
    String(today.getDate()).padStart(2, '0');

  // UUID 생성 후 앞 5자리만 추출
  const uuidShort = uuidv4().replace(/-/g, '').substring(0, 5);

  // 새로운 파일명 생성: 날짜_UUID(5자리).확장자
  const newFilename = `${dateStr}_${uuidShort}.${extension}`;

  file.originalname = newFilename;

  try {
    const res = await client.putFileContents(`www/${path}/${file.originalname}`, file.buffer);

    return res;
  } catch (error) {
    console.log(error);
    const status = error.status;

    // PUT:: 405 에러 발생 시 디렉토리 생성 후 다시 시도
    if (status === 405) {
      console.error("405: 디렉토리 생성 후 다시 시도합니다.");
      await createDirectory(`/www/${path}`);
      try {
        const res = await client.putFileContents(`www/${path}/${file.originalname}`, file.buffer);

        return res;
      } catch (error) {
        console.error(error);
        throw error;
      }
    }
  }
}

/**
 * 디렉토리 생성 로직
 * @param {string} path
 */
export const createDirectory = async (path) => {
  try {
    await client.createDirectory(path);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export const getFile = async (path) => {
  try {
    const file = await client.getFileContents(path);

    return file;
  } catch (error) {
    console.error(error);
  }
}

export const getDirectoryTest = async () => {
  try {
    const directory = await client.getDirectoryContents("/www/tests");
    console.log(directory);
  } catch (error) {
    console.error(error);
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

  // 청크 단위로 분할하여 병렬 처리
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);

    const chunkPromises = chunk.map(async (file) => {
      try {
        const result = await uploadFile(path, file);
        return {
          filename: file.originalname,
          success: true,
          result: result
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

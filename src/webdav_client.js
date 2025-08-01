import { createClient } from "webdav";
import fs from 'fs';
import https from 'https';

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

export const test = async () => {
  try {
    await client.putFileContents("/www/test/hello.txt", "hello, world");
  } catch (error) {
    console.log(error);
    const status = error.status;

    // PUT:: 405 에러 발생 시 디렉토리 생성 후 다시 시도
    if(status === 405) {
      await createDirectory("/www/test");
      await client.putFileContents("/www/test/hello.txt", "hello, world");

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

export const getFileTest = async () => {
  try {
    const file = await client.getFileContents("/www/test/hello.txt");
    console.log(file);
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

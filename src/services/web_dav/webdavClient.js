import { createClient } from "webdav";
import fs from 'fs';
import https from 'https';
import { v4 as uuidv4 } from 'uuid';
import { decodePathTwiceToNFC, decodePathTwiceToNFKC } from "../../utils/decoder.js";

// SSL 인증서 설정 (필요시 주석 해제)
// const ca = fs.readFileSync('local.crt');
// const agent = new https.Agent({
//   ca: ca,
//   rejectUnauthorized: true
// });

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

export const uploadFile = async (path, file, filename) => {

  filename = filename.replace(/ /g, "_");

  await ensureDirectory(path);

  if (path.startsWith("/")) {
    path = path.replace("/", "");
  }

  file.originalname = filename;

  const fullPath = `/${path}/${filename}`;
  try {
    const res = await client.putFileContents(fullPath, file.buffer);

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
    await client.createDirectory(`/${path}`);
  } catch (error) {
    console.error(error);
    throw error;
  }
}

export const uploadSingle = async (path, file, filename) => {
  try {
    const { res, file: f } = await uploadFile(path, file, filename);

    return {
      filename: f.originalname,
      success: true,
      size: f.size,
      url: getBaseUrl() + `/${path}/${file.originalname}`
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

  const normalized = normalizeWebDAVPath(path);

  if (!normalized || normalized === "/") return;

  const isAbsolute = normalized.startsWith("/");
  const parts = normalized.split("/").filter(Boolean);

  // 누적 경로(절대경로면 '/'부터 시작)
  let acc = isAbsolute ? "/" : "";

  for (const part of parts) {
    const next = acc === "/" ? `/${part}` : acc ? `${acc}/${part}` : part;


    // 1) 이미 있으면 통과
    const exists = await existDirectory(next);


    if (!exists) {
      try {

        await client.createDirectory(`/${next}`);
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

    let file = null;
    try {
      file = await client.getFileContents(decodedPath.normalize('NFKC'));
    } catch (error) {

      const directoryPath = decodedPath.split('/').slice(0, -1).join('/');
      const fName = decodedPath.split('/').pop();


      file = await getFileFromDirectory(directoryPath, fName);
    }

    return file;
  } catch (error) {
    console.error("::: ERROR :::")
    console.error(error);
  }
}

export const getFileFromDirectory = async (directoryPath, fileName) => {
  try {
    // 디렉토리에서 특정 파일 찾기
    const directoryContents = await getDirectoryContents(directoryPath);


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
    const res = await client.getDirectoryContents(path);
    return res;
  } catch (error) {
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

  await ensureDirectory(path);

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
            filename: decodePathTwiceToNFC(file.originalname),
            success: false,
            size: 0,
            url: "",
            msg: `파일과 파일명의 확장자가 다릅니다. (파일: ${fileExtension}, 파일명: ${filenameExtension})`
          }

        }


        const fullPath = getBaseUrl() + `/${path}/${filename}`;

        const existedFile = await getFile(fullPath);

        if (existedFile) {
          return {
            filename: filename,
            success: true,
            size: existedFile.size,
            url: getBaseUrl() + `/${path}/${filename}`,
            msg: "파일 존재, 요청을 생략합니다."
          }
        }

        const { res, file: f } = await uploadFile(path, file, filename);

        return {
          filename: f.originalname,
          success: true,
          size: f.size,
          url: getBaseUrl() + `/${path}/${file.originalname}`,
          msg: "신규 생성 완료"
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

/**
 * 파일 삭제
 * @param {string} path - 삭제할 파일 경로
 */
export const deleteFile = async (path) => {
  const fullPath = `/${path}`.normalize('NFKC');
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
  const fullPath = `/${path}`.normalize('NFKC');
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
  const src = `/${sourcePath}`.normalize('NFKC');
  const dest = `/${destPath}`.normalize('NFKC');
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
  const src = `/${sourcePath}`.normalize('NFKC');
  const dest = `/${destPath}`.normalize('NFKC');
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
  filename = filename.replace(/ /g, "_");

  if (path.startsWith("/")) {
    path = path.replace("/", "");
  }

  file.originalname = filename;

  const fullPath = `/${path}/${filename}`.normalize('NFKC');
  try {
    const res = await client.putFileContents(fullPath, file.buffer, { overwrite: true });
    return { res, file };
  } catch (error) {
    console.error('파일 업데이트 실패:', error);
    throw error;
  }
}

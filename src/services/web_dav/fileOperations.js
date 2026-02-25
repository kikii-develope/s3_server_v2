import fs from 'fs';
import os from 'os';
import path from 'path';
import { pipeline } from 'stream/promises';
import { client, getRootPath } from './client.js';
import { getDirectoryContents } from './directory.js';
import { decodePathTwiceToNFKC } from "../../utils/decoder.js";

export const getFile = async (filePath) => {
  try {
    const url = new URL(filePath);
    const decodedPath = decodePathTwiceToNFKC(url.pathname);

    console.log(`[WebDAV] 요청 URL: ${filePath}`);

    let file = null;
    try {
      file = await client.getFileContents(decodedPath.normalize('NFKC'));
    } catch (error) {
      const directoryPath = decodedPath.split('/').slice(0, -1).join('/');
      const fName = decodedPath.split('/').pop();

      console.log(`[WebDAV] 디렉토리 검색: ${directoryPath}`);
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
    const directoryContents = await getDirectoryContents(directoryPath);

    if (!directoryContents) {
      throw new Error(`디렉토리를 찾을 수 없습니다: ${directoryPath}`);
    }

    const targetFile = directoryContents.find(item => {
      const s2_1_1 = fileName.normalize('NFKC').split('').map(char => char.codePointAt(0));
      const s2_3 = item.basename.normalize('NFKC').split('').map(char => char.codePointAt(0));

      return item.type === 'file' && s2_1_1.every((code, index) => code === s2_3[index])
    });

    if (!targetFile) {
      throw new Error(`파일을 찾을 수 없습니다: ${fileName}`);
    }

    const result = await client.getFileContents(targetFile.filename);
    return result;
  } catch (error) {
    console.error('파일 내용 조회 실패:', error);
    throw error;
  }
}

/**
 * 스트림 방식 파일 조회 (다운로드용)
 */
export const getFileStream = (filePath, options = {}) => {
  return client.createReadStream(filePath, options);
};

/**
 * 파일 존재 여부만 확인 (파일 내용 로드 없이)
 */
export const fileExists = async (filePath) => {
  try {
    await client.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * 파일의 stat 정보 조회 (크기 등)
 */
export const getFileStat = async (filePath) => {
  try {
    return await client.stat(filePath);
  } catch {
    return null;
  }
};

/**
 * 파일을 로컬 임시파일로 다운로드 (해시 계산용)
 */
export const downloadToTempFile = async (webdavPath) => {
  const tmpPath = path.join(os.tmpdir(), `webdav-tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const readStream = client.createReadStream(webdavPath);
  const writeStream = fs.createWriteStream(tmpPath);

  await pipeline(readStream, writeStream);
  return tmpPath;
};

/**
 * 파일 삭제
 */
export const deleteFile = async (filePath) => {
  const fullPath = `/${getRootPath()}/${filePath}`.normalize('NFKC');
  try {
    await client.deleteFile(fullPath);
  } catch (error) {
    console.error('파일 삭제 실패:', error);
    throw error;
  }
}

/**
 * 디렉토리 삭제
 */
export const deleteDirectory = async (dirPath) => {
  const fullPath = `/${getRootPath()}/${dirPath}`.normalize('NFKC');
  try {
    await client.deleteFile(fullPath);
  } catch (error) {
    console.error('디렉토리 삭제 실패:', error);
    throw error;
  }
}

/**
 * 파일/디렉토리 이동
 */
export const moveFile = async (sourcePath, destPath, overwrite = true) => {
  const src = `/${getRootPath()}/${sourcePath}`.normalize('NFKC');
  const dest = `/${getRootPath()}/${destPath}`.normalize('NFKC');
  try {
    await client.moveFile(src, dest, { overwrite });
  } catch (error) {
    console.error('파일 이동 실패:', error);
    throw error;
  }
}

/**
 * 파일/디렉토리 복사
 */
export const copyFile = async (sourcePath, destPath, overwrite = true) => {
  const src = `/${getRootPath()}/${sourcePath}`.normalize('NFKC');
  const dest = `/${getRootPath()}/${destPath}`.normalize('NFKC');
  try {
    await client.copyFile(src, dest, { overwrite });
  } catch (error) {
    console.error('파일 복사 실패:', error);
    throw error;
  }
}

/**
 * 파일 업데이트 (덮어쓰기) - Disk Storage 사용
 */
export const updateFile = async (dirPath, file, filename) => {
  filename = filename.replace(/ /g, "_");

  if (dirPath.startsWith("/")) {
    dirPath = dirPath.replace("/", "");
  }

  file.originalname = filename;

  const fullPath = `/${getRootPath()}/${dirPath}/${filename}`.normalize('NFKC');
  console.log(`[UPDATE] 파일 업데이트중... [${filename}] (${(file.size / 1024).toFixed(2)} KB)`);

  try {
    const fileStream = fs.createReadStream(file.path);
    const res = await client.putFileContents(fullPath, fileStream, { overwrite: true });
    console.log(`[UPDATE] 완료: ${filename}`);
    return { res, file };
  } catch (error) {
    console.log(`[UPDATE] 실패: ${filename} - ${error.message}`);
    console.error('파일 업데이트 실패:', error);
    throw error;
  }
}

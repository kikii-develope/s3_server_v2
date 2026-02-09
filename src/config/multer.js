import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';

// 임시 업로드 디렉토리 설정 (OS의 임시 폴더 사용)
const uploadDir = path.join(os.tmpdir(), 'file-upload-server');

// 디렉토리 생성
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log(`[MULTER] 임시 디렉토리 생성: ${uploadDir}`);
}

/**
 * Multer Disk Storage 설정
 * - 메모리 대신 디스크에 임시 저장하여 메모리 사용량 최소화
 * - 대용량 파일(500MB~3GB) 안정적 처리
 */
export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      // 고유 파일명 생성: 타임스탬프-랜덤값-원본파일명
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
      cb(null, `${uniqueSuffix}-${originalName}`);
    }
  }),
  limits: {
    fileSize: 3 * 1024 * 1024 * 1024, // 3GB 제한
    files: 10 // 최대 10개 파일
  },
  fileFilter: (req, file, cb) => {
    // 모든 파일 허용 (보안 주의!)
    cb(null, true);

    // 또는 특정 파일만 차단하려면:
    // const blockedExtensions = ['.exe', '.sh', '.bat', '.cmd'];
    // const extension = path.extname(file.originalname).toLowerCase();
    // if (blockedExtensions.includes(extension)) {
    //   cb(new Error(`보안상 차단된 파일 형식입니다: ${extension}`));
    // } else {
    //   cb(null, true);
    // }
  }
});

/**
 * 오래된 임시 파일 정리
 * - 2시간 이상 된 파일 자동 삭제
 * - 1시간마다 실행
 */
const cleanupOldTempFiles = async () => {
  try {
    const files = await fs.promises.readdir(uploadDir);
    const now = Date.now();
    const maxAge = 2 * 3600000; // 2시간
    let deletedCount = 0;

    for (const file of files) {
      const filePath = path.join(uploadDir, file);

      try {
        const stats = await fs.promises.stat(filePath);

        // 2시간 이상 된 파일 삭제
        if (now - stats.mtimeMs > maxAge) {
          await fs.promises.unlink(filePath);
          deletedCount++;
          console.log(`[CLEANUP] 오래된 임시 파일 삭제: ${file}`);
        }
      } catch (err) {
        // 파일이 이미 삭제되었거나 접근 불가능한 경우 무시
        if (err.code !== 'ENOENT') {
          console.warn(`[CLEANUP] 파일 정리 실패: ${file}`, err.message);
        }
      }
    }

    if (deletedCount > 0) {
      console.log(`[CLEANUP] 총 ${deletedCount}개 임시 파일 정리 완료`);
    }
  } catch (error) {
    console.error('[CLEANUP] 임시 파일 정리 중 오류:', error);
  }
};

// 1시간마다 정리 작업 실행
setInterval(cleanupOldTempFiles, 3600000);

// 서버 시작시 한 번 실행
setTimeout(cleanupOldTempFiles, 10000); // 10초 후 실행

console.log('[MULTER] Disk Storage 설정 완료');
console.log(`[MULTER] 임시 디렉토리: ${uploadDir}`);
console.log(`[MULTER] 최대 파일 크기: 3GB`);
console.log(`[MULTER] 최대 파일 개수: 10개`);

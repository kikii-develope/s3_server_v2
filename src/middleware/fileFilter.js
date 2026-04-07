/**
 * src/middleware/fileFilter.js
 * Multer fileFilter — 디스크 저장 전 확장자/MIME 사전 차단
 * console 미사용
 */

const ALLOWED = {
    image: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'gif'],
    video: ['mp4', 'avi', 'mov', 'wmv', 'mkv', 'flv', 'webm', 'cya'],
    document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv'],
};

const ALL_ALLOWED_EXT = Object.values(ALLOWED).flat();

const ALLOWED_MIMES = [
    // 이미지
    'image/jpeg', 'image/png', 'image/bmp', 'image/webp', 'image/tiff', 'image/gif',
    // 영상
    'video/mp4', 'video/avi', 'video/x-msvideo', 'video/quicktime',
    'video/x-ms-wmv', 'video/x-matroska', 'video/x-flv', 'video/webm',
    // 문서
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'text/csv',
    'application/octet-stream', // 브라우저 차이 대응
];

export const fileFilter = (req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase();

    if (!ext || !ALL_ALLOWED_EXT.includes(ext)) {
        return cb(new Error(`허용되지 않는 확장자: .${ext}`), false);
    }

    // application/octet-stream은 브라우저 환경에 따라 올 수 있으므로 통과
    if (file.mimetype !== 'application/octet-stream' && !ALLOWED_MIMES.includes(file.mimetype)) {
        return cb(new Error(`허용되지 않는 MIME 타입: ${file.mimetype}`), false);
    }

    cb(null, true);
};

export const getFileCategory = (mimeType, ext) => {
    if (ALLOWED.image.includes(ext)) return 'image';
    if (ALLOWED.video.includes(ext)) return 'video';
    return 'document';
};

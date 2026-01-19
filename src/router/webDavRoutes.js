import express from 'express';
import multer from 'multer';
import {
    uploadFileToWebDAV,
    downloadFileFromWebDAV,
    createWebDAVDirectory,
    getWebDAVDirectory,
    getWebDAVInfo,
    uploadMultipleFilesToWebDAV,
    updateFileInWebDAV,
    deleteFileFromWebDAV,
    deleteDirectoryFromWebDAV,
    moveFileInWebDAV,
    copyFileInWebDAV
} from '../controller/webdavController.js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), preservePath: false });


/**
 * @swagger
 * /webdav/info:
 *   get:
 *     summary: WebDAV 서버 정보 조회
 *     description: WebDAV 서버의 기본 정보를 조회합니다
 *     tags: [WebDAV]
 *     responses:
 *       200:
 *         description: 서버 정보 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 baseUrl:
 *                   type: string
 *                 timestamp:
 *                   type: string
 *       500:
 *         description: 서버 오류
 */
router.get('/info', getWebDAVInfo);

/**
 * @swagger
 * /webdav/upload:
 *   post:
 *     summary: WebDAV 파일 업로드
 *     description: 파일을 WebDAV 서버에 업로드합니다
 *     tags: [WebDAV]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - path
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: 업로드할 파일
 *               filename:
 *                 type: string
 *                 description: 파일명
 *               path:
 *                 type: string
 *                 description: WebDAV 서버의 경로
 *     responses:
 *       200:
 *         description: 파일 업로드 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 size:
 *                   type: integer
 *                 url:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       500:
 *         description: 서버 오류
 */
router.post('/upload', upload.single('file'), uploadFileToWebDAV);


/**
 * @swagger
 * /webdav/upload-multiple:
 *   post:
 *     summary: WebDAV 다중 파일 업로드
 *     description: 여러 파일을 WebDAV 서버에 동시에 업로드합니다
 *     tags: [WebDAV]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - files
 *               - path
 *               - filenames
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: 업로드할 파일들 (여러 개 선택 가능)
 *               path:
 *                 type: string
 *                 description: WebDAV 서버의 경로
 *               filenames:
 *                  type: array
 *                  items:
 *                    type: string
 *     responses:
 *       200:
 *         description: 다중 파일 업로드 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *                 results:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       filename:
 *                         type: string
 *                       success:
 *                         type: boolean
 *                       size:
 *                         type: integer
 *                       url:
 *                         type: string
 *                       msg:
 *                         type: string
 *                 summary:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     success:
 *                       type: integer
 *                     failed:
 *                       type: integer
 *       400:
 *         description: 요청 오류
 *       500:
 *         description: 서버 오류
 */
router.post('/upload-multiple', upload.array('files', 10), uploadMultipleFilesToWebDAV);

/**
 * @swagger
 * /webdav/download/{path}:
 *   get:
 *     summary: WebDAV 파일 다운로드
 *     description: WebDAV 서버에서 파일을 다운로드합니다
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: 다운로드할 파일 경로
 *       - in: query
 *         name: disposition
 *         required: false
 *         schema:
 *           type: string
 *           enum: [inline, attachment]
 *         description: >
 *           응답을 브라우저에서 바로 표시할지(inline), 다운로드 받을지(attachment) 선택합니다.  
 *           기본값은 inline 입니다.
 *     responses:
 *       200:
 *         description: 파일 다운로드 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *                 file:
 *                   type: object
 *       400:
 *         description: 요청 오류
 *       500:
 *         description: 서버 오류
 */
router.get('/download/:path(*)', downloadFileFromWebDAV);

/**
 * @swagger
 * /webdav/directory:
 *   post:
 *     summary: WebDAV 디렉토리 생성
 *     description: WebDAV 서버에 디렉토리를 생성합니다
 *     tags: [WebDAV]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - path
 *             properties:
 *               path:
 *                 type: string
 *                 description: 생성할 디렉토리 경로
 *     responses:
 *       200:
 *         description: 디렉토리 생성 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       500:
 *         description: 서버 오류
 */
router.post('/directory', createWebDAVDirectory);

/**
 * @swagger
 * /webdav/directory/{path}:
 *   get:
 *     summary: WebDAV 디렉토리 목록 조회
 *     description: WebDAV 서버의 디렉토리 내용을 조회합니다
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: 디렉토리 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *                 directory:
 *                   type: array
 *       500:
 *         description: 서버 오류
 */
router.get('/directory/:path(*)', getWebDAVDirectory);

/**
 * @swagger
 * /webdav/file/{path}:
 *   put:
 *     summary: WebDAV 파일 업데이트 (덮어쓰기)
 *     description: 기존 파일을 새 파일로 덮어씁니다. 확장자 없이 파일명만 입력해도 자동으로 찾습니다.
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "업데이트할 파일 경로 (예: www/www/스마트체크로고)"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: 업로드할 파일
 *     responses:
 *       200:
 *         description: 파일 업데이트 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 size:
 *                   type: integer
 *                 url:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       404:
 *         description: 파일을 찾을 수 없음
 *       409:
 *         description: 파일 형식이 다름
 *       500:
 *         description: 서버 오류
 */
router.put('/file/:path(*)', upload.single('file'), updateFileInWebDAV);

/**
 * @swagger
 * /webdav/file/{path}:
 *   delete:
 *     summary: WebDAV 파일 삭제
 *     description: 지정된 경로의 파일을 삭제합니다
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "삭제할 파일 경로 (예: documents/report.pdf)"
 *     responses:
 *       200:
 *         description: 파일 삭제 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       404:
 *         description: 파일을 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.delete('/file/:path(*)', deleteFileFromWebDAV);

/**
 * @swagger
 * /webdav/directory/{path}:
 *   delete:
 *     summary: WebDAV 디렉토리 삭제
 *     description: 지정된 경로의 디렉토리를 삭제합니다. 디렉토리에 파일이 있으면 force=true 필요
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "삭제할 디렉토리 경로 (예: documents/old)"
 *       - in: query
 *         name: force
 *         required: false
 *         schema:
 *           type: boolean
 *           default: false
 *         description: true로 설정하면 디렉토리 내부에 파일이 있어도 강제 삭제
 *     responses:
 *       200:
 *         description: 디렉토리 삭제 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       404:
 *         description: 디렉토리를 찾을 수 없음
 *       409:
 *         description: 디렉토리 내부에 파일이 있음 (force=false인 경우)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 path:
 *                   type: string
 *                 contents:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       basename:
 *                         type: string
 *                       type:
 *                         type: string
 *       500:
 *         description: 서버 오류
 */
router.delete('/directory/:path(*)', deleteDirectoryFromWebDAV);

/**
 * @swagger
 * /webdav/move:
 *   put:
 *     summary: WebDAV 파일/디렉토리 이동
 *     description: 파일 또는 디렉토리를 다른 경로로 이동합니다
 *     tags: [WebDAV]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sourcePath
 *               - destPath
 *             properties:
 *               sourcePath:
 *                 type: string
 *                 description: 원본 파일/디렉토리 경로
 *                 example: documents/old/file.pdf
 *               destPath:
 *                 type: string
 *                 description: 대상 파일/디렉토리 경로
 *                 example: documents/new/file.pdf
 *               overwrite:
 *                 type: boolean
 *                 default: true
 *                 description: 대상이 이미 존재할 경우 덮어쓰기 여부
 *     responses:
 *       200:
 *         description: 이동 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 sourcePath:
 *                   type: string
 *                 destPath:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       404:
 *         description: 원본 파일/디렉토리를 찾을 수 없음
 *       409:
 *         description: 대상이 이미 존재함 (overwrite=false인 경우)
 *       500:
 *         description: 서버 오류
 */
router.put('/move', moveFileInWebDAV);

/**
 * @swagger
 * /webdav/copy:
 *   put:
 *     summary: WebDAV 파일/디렉토리 복사
 *     description: 파일 또는 디렉토리를 다른 경로로 복사합니다
 *     tags: [WebDAV]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sourcePath
 *               - destPath
 *             properties:
 *               sourcePath:
 *                 type: string
 *                 description: 원본 파일/디렉토리 경로
 *                 example: documents/file.pdf
 *               destPath:
 *                 type: string
 *                 description: 대상 파일/디렉토리 경로
 *                 example: backup/file.pdf
 *               overwrite:
 *                 type: boolean
 *                 default: true
 *                 description: 대상이 이미 존재할 경우 덮어쓰기 여부
 *     responses:
 *       200:
 *         description: 복사 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                 status:
 *                   type: integer
 *                 sourcePath:
 *                   type: string
 *                 destPath:
 *                   type: string
 *       400:
 *         description: 요청 오류
 *       404:
 *         description: 원본 파일/디렉토리를 찾을 수 없음
 *       409:
 *         description: 대상이 이미 존재함 (overwrite=false인 경우)
 *       500:
 *         description: 서버 오류
 */
router.put('/copy', copyFileInWebDAV);


export default router; 
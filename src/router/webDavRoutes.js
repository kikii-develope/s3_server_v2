import express from 'express';
import multer from 'multer';
import {
    uploadFileToWebDAV,
    downloadFileFromWebDAV,
    createWebDAVDirectory,
    getWebDAVDirectory,
    getWebDAVInfo,
    uploadMultipleFilesToWebDAV
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


export default router; 
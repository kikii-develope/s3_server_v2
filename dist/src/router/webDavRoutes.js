"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_js_1 = require("../config/multer.js");
const webdavController_js_1 = require("../controller/webdavController.js");
const router = express_1.default.Router();
/**
 * @swagger
 * /webdav/info:
 *   get:
 *     summary: WebDAV 서버 정보 조회
 *     description: |
 *       WebDAV 서버의 기본 URL과 현재 시간을 조회합니다.
 *
 *       **환경별 루트 경로:**
 *
 *       - 개발 환경: `/kikii_test`
 *
 *       - 배포 환경: `/www`
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
 *                   example: WebDAV 서버 정보 조회 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 baseUrl:
 *                   type: string
 *                   example: http://211.233.58.24:8800
 *                 timestamp:
 *                   type: string
 *                   example: 2026-01-28T07:00:00.000Z
 *       500:
 *         description: 서버 오류
 */
router.get('/info', webdavController_js_1.getWebDAVInfo);
/**
 * @swagger
 * /webdav/upload:
 *   post:
 *     summary: WebDAV 파일 업로드
 *     description: |
 *       파일을 WebDAV 서버에 업로드하고 메타데이터를 DB에 저장합니다.
 *
 *       **환경별 저장 경로:**
 *
 *       - 개발 환경: `/kikii_test/{path}/{filename}`
 *
 *       - 배포 환경: `/www/{path}/{filename}`
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
 *                 description: "업로드 경로 (예: accident/test/2026-01-28/image) - 환경별 루트 경로(/www 또는 /kikii_test)는 자동으로 추가됩니다"
 *               filename:
 *                 type: string
 *                 description: 저장할 파일명 (미입력시 원본 파일명 사용)
 *               domain_type:
 *                 type: string
 *                 description: 도메인 타입 (선택)
 *               domain_id:
 *                 type: integer
 *                 description: 도메인 ID (선택)
 *               userId:
 *                 type: string
 *                 description: 사용자 ID (선택, 히스토리 기록용)
 *     responses:
 *       200:
 *         description: 파일 업로드 성공
 *         headers:
 *           ETag:
 *             description: 파일의 ETag 값
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: WebDAV 파일 업로드 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 path:
 *                   type: string
 *                   example: http://211.233.58.24:8800/www/accident/test/파일.jpg
 *                   description: "파일의 전체 URL (배포: /www, 개발: /kikii_test)"
 *                 filename:
 *                   type: string
 *                 size:
 *                   type: integer
 *                 url:
 *                   type: string
 *                 etag:
 *                   type: string
 *                   description: 파일의 ETag 값
 *                 metadataId:
 *                   type: integer
 *                   description: DB에 저장된 메타데이터 ID
 *       400:
 *         description: 요청 오류 (파일 없음, path 없음)
 *       500:
 *         description: 서버 오류
 */
router.post('/upload', multer_js_1.upload.single('file'), webdavController_js_1.uploadFileToWebDAV);
/**
 * @swagger
 * /webdav/upload-multiple:
 *   post:
 *     summary: WebDAV 다중 파일 업로드
 *     description: |
 *       여러 파일을 WebDAV 서버에 동시에 업로드합니다.
 *
 *       **환경별 저장 경로:**
 *
 *       - 개발 환경: `/kikii_test/{path}/`
 *
 *       - 배포 환경: `/www/{path}/`
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
router.post('/upload-multiple', multer_js_1.upload.array('files', 10), webdavController_js_1.uploadMultipleFilesToWebDAV);
/**
 * @swagger
 * /webdav/download/{path}:
 *   get:
 *     summary: WebDAV 파일 다운로드
 *     description: |
 *       WebDAV 서버에서 파일을 다운로드합니다. 파일 바이너리를 직접 반환합니다.
 *
 *       **환경별 저장 경로:**
 *
 *       - 개발 환경: `/kikii_test/{path}`에서 파일 조회
 *
 *       - 배포 환경: `/www/{path}`에서 파일 조회
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "다운로드할 파일 경로 (예: accident/test/2026-01-28/image/파일.jpg)"
 *       - in: query
 *         name: disposition
 *         required: false
 *         schema:
 *           type: string
 *           enum: [inline, attachment]
 *           default: inline
 *         description: "inline: 브라우저에서 표시, attachment: 파일 다운로드"
 *     responses:
 *       200:
 *         description: 파일 다운로드 성공
 *         headers:
 *           ETag:
 *             description: 파일의 ETag 값
 *             schema:
 *               type: string
 *           Content-Type:
 *             description: 파일의 MIME 타입
 *             schema:
 *               type: string
 *           Content-Disposition:
 *             description: 파일명 정보
 *             schema:
 *               type: string
 *         content:
 *           application/octet-stream:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: 요청 오류 (path 없음)
 *       404:
 *         description: 파일을 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.get('/download/:path(*)', webdavController_js_1.downloadFileFromWebDAV);
/**
 * @swagger
 * /webdav/directory:
 *   post:
 *     summary: WebDAV 디렉토리 생성
 *     description: |
 *       WebDAV 서버에 디렉토리를 생성합니다.
 *
 *       **환경별 저장 경로:**
 *
 *       - 개발 환경: `/kikii_test/{path}` 디렉토리 생성
 *
 *       - 배포 환경: `/www/{path}` 디렉토리 생성
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
 *                 description: "생성할 디렉토리 경로 (예: accident/test/2026-01-28/image)"
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
 *                   example: WebDAV 디렉토리 생성 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 path:
 *                   type: string
 *       400:
 *         description: 요청 오류 (path 없음)
 *       500:
 *         description: 서버 오류
 */
router.post('/directory', webdavController_js_1.createWebDAVDirectory);
/**
 * @swagger
 * /webdav/directory/{path}:
 *   get:
 *     summary: WebDAV 디렉토리 존재 여부 확인
 *     description: 지정된 경로의 디렉토리가 존재하는지 확인합니다
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "조회할 디렉토리 경로 (예: accident/test/2026-01-28)"
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
 *                   example: WebDAV 디렉토리 조회 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 path:
 *                   type: string
 *                 directory:
 *                   type: boolean
 *                   description: 디렉토리 존재 여부
 *       400:
 *         description: 요청 오류 (path 없음)
 *       500:
 *         description: 서버 오류
 */
router.get('/directory/:path(*)', webdavController_js_1.getWebDAVDirectory);
/**
 * @swagger
 * /webdav/file/{path}:
 *   put:
 *     summary: WebDAV 파일 업데이트 (덮어쓰기)
 *     description: |
 *       기존 파일을 새 파일로 덮어씁니다. ETag 기반 동시성 제어를 사용합니다.
 *       - 확장자 없이 파일명만 입력해도 자동으로 찾습니다
 *       - If-Match 헤더가 필요합니다 (없으면 428 응답과 함께 현재 ETag 반환)
 *       - 파일 타입이 다르면 409 에러 반환
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "업데이트할 파일 경로 (예: accident/test/image/파일명)"
 *       - in: header
 *         name: If-Match
 *         required: true
 *         schema:
 *           type: string
 *         description: "파일의 현재 ETag 값 (다운로드시 받은 ETag)"
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - userId
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: 업로드할 파일
 *               userId:
 *                 type: string
 *                 description: 사용자 ID (히스토리 기록용, 필수)
 *     responses:
 *       200:
 *         description: 파일 업데이트 성공
 *         headers:
 *           ETag:
 *             description: 새 파일의 ETag 값
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: 파일 업데이트 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 path:
 *                   type: string
 *                 filename:
 *                   type: string
 *                 size:
 *                   type: integer
 *                 url:
 *                   type: string
 *                 etag:
 *                   type: string
 *                 changed:
 *                   type: boolean
 *                   description: 실제 변경 여부 (동일 파일이면 false)
 *       400:
 *         description: 요청 오류 (파일 없음, path 없음, userId 없음)
 *       404:
 *         description: 파일을 찾을 수 없음
 *       409:
 *         description: 파일 타입이 다름 (삭제 후 새로 업로드 필요)
 *       412:
 *         description: ETag 불일치 (파일이 다른 곳에서 수정됨)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: 파일이 변경되었습니다. 최신 버전을 다시 받아주세요.
 *                 status:
 *                   type: integer
 *                   example: 412
 *                 etag:
 *                   type: string
 *                   description: 현재 파일의 ETag
 *       428:
 *         description: If-Match 헤더 필요
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: If-Match 헤더가 필요합니다.
 *                 status:
 *                   type: integer
 *                   example: 428
 *                 etag:
 *                   type: string
 *                   description: 현재 파일의 ETag (이 값으로 재요청)
 *       500:
 *         description: 서버 오류
 */
router.put('/file/:path(*)', multer_js_1.upload.single('file'), webdavController_js_1.updateFileInWebDAV);
/**
 * @swagger
 * /webdav/file/{path}:
 *   delete:
 *     summary: WebDAV 파일 삭제
 *     description: 지정된 경로의 파일을 삭제하고 DB에서 상태를 DELETED로 변경합니다
 *     tags: [WebDAV]
 *     parameters:
 *       - in: path
 *         name: path
 *         required: true
 *         schema:
 *           type: string
 *         description: "삭제할 파일 경로 (예: accident/test/image/파일.jpg)"
 *       - in: query
 *         name: userId
 *         required: false
 *         schema:
 *           type: string
 *         description: 사용자 ID (히스토리 기록용)
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
 *                   example: 파일 삭제 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 path:
 *                   type: string
 *       400:
 *         description: 요청 오류 (path 없음)
 *       404:
 *         description: 파일을 찾을 수 없음
 *       500:
 *         description: 서버 오류
 */
router.delete('/file/:path(*)', webdavController_js_1.deleteFileFromWebDAV);
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
router.delete('/directory/:path(*)', webdavController_js_1.deleteDirectoryFromWebDAV);
/**
 * @swagger
 * /webdav/move:
 *   put:
 *     summary: WebDAV 파일/디렉토리 이동
 *     description: 파일 또는 디렉토리를 다른 경로로 이동합니다 (이름 변경에도 사용)
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
 *                 example: accident/test/image/old_name.jpg
 *               destPath:
 *                 type: string
 *                 description: 대상 파일/디렉토리 경로
 *                 example: accident/test/image/new_name.jpg
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
 *                   example: 이동 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 sourcePath:
 *                   type: string
 *                 destPath:
 *                   type: string
 *       400:
 *         description: 요청 오류 (sourcePath 또는 destPath 없음)
 *       404:
 *         description: 원본 파일/디렉토리를 찾을 수 없음
 *       409:
 *         description: 대상이 이미 존재함 (overwrite=false인 경우)
 *       500:
 *         description: 서버 오류
 */
router.put('/move', webdavController_js_1.moveFileInWebDAV);
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
 *                 example: accident/test/image/original.jpg
 *               destPath:
 *                 type: string
 *                 description: 대상 파일/디렉토리 경로
 *                 example: accident/backup/image/copy.jpg
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
 *                   example: 복사 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 sourcePath:
 *                   type: string
 *                 destPath:
 *                   type: string
 *       400:
 *         description: 요청 오류 (sourcePath 또는 destPath 없음)
 *       404:
 *         description: 원본 파일/디렉토리를 찾을 수 없음
 *       409:
 *         description: 대상이 이미 존재함 (overwrite=false인 경우)
 *       500:
 *         description: 서버 오류
 */
router.put('/copy', webdavController_js_1.copyFileInWebDAV);
/**
 * @swagger
 * /webdav/stats:
 *   get:
 *     summary: 파일 시스템 통계 조회
 *     description: 파일 메타데이터 및 히스토리 통계를 조회합니다
 *     tags: [WebDAV]
 *     responses:
 *       200:
 *         description: 통계 조회 성공
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: 통계 조회 성공
 *                 status:
 *                   type: integer
 *                   example: 200
 *                 summary:
 *                   type: object
 *                   description: 파일 상태별 요약
 *                   properties:
 *                     totalFiles:
 *                       type: integer
 *                     activeFiles:
 *                       type: integer
 *                     deletedFiles:
 *                       type: integer
 *                     desyncFiles:
 *                       type: integer
 *                     missingFiles:
 *                       type: integer
 *                 stats:
 *                   type: object
 *                   description: 액션별 히스토리 카운트
 *                   additionalProperties:
 *                     type: integer
 *                   example:
 *                     UPLOAD: 100
 *                     UPDATE: 50
 *                     DELETE: 10
 *                 byUser:
 *                   type: object
 *                   description: 사용자별 액션 카운트
 *                   additionalProperties:
 *                     type: integer
 *                   example:
 *                     user1: 80
 *                     system: 30
 *                 daily:
 *                   type: array
 *                   description: 최근 7일 일별 통계
 *                   items:
 *                     type: object
 *                     properties:
 *                       date:
 *                         type: string
 *                         format: date
 *                       action:
 *                         type: string
 *                       count:
 *                         type: integer
 *       500:
 *         description: 서버 오류
 */
router.get('/stats', webdavController_js_1.getWebDAVStats);
exports.default = router;

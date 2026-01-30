"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const s3Controller_js_1 = require("../controller/s3Controller.js");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), preservePath: false });
/**
 * @swagger
 * /s3/upload:
 *   post:
 *     summary: 단일 파일 S3 업로드
 *     description: 단일 파일을 S3 버킷에 업로드합니다
 *     tags: [S3 Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *               - bucketName
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: 업로드할 파일
 *               bucketName:
 *                 type: string
 *                 description: S3 버킷 이름
 *     responses:
 *       200:
 *         description: 파일 업로드 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UploadResponse'
 *       400:
 *         description: 요청 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    }
    const { bucketName } = req.body;
    if (!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }
    try {
        const result = await (0, s3Controller_js_1.uploadToS3)({
            bucketName: bucketName,
            file: req.file,
        });
        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    }
    catch (error) {
        console.error('업로드 에러:', error);
        res.status(400).json({ message: error.message, status: 400 });
    }
});
/**
 * @swagger
 * /s3/upload/multiple:
 *   post:
 *     summary: 다중 파일 S3 업로드
 *     description: 최대 10개의 파일을 S3 버킷의 지정된 경로에 업로드합니다
 *     tags: [S3 Upload]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - files
 *               - bucketName
 *               - path
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *                 description: 업로드할 파일들 (최대 10개)
 *               bucketName:
 *                 type: string
 *                 description: S3 버킷 이름
 *               path:
 *                 type: string
 *                 description: 업로드할 경로
 *     responses:
 *       200:
 *         description: 파일 업로드 성공
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UploadResponse'
 *       400:
 *         description: 요청 오류
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/upload/multiple', upload.array('files', 10), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    }
    else if (req.files.length > 10) {
        return res.status(400).json({ message: '파일 개수가 10개를 초과했습니다.', status: 400 });
    }
    const { bucketName, path } = req.body;
    if (!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }
    if (!path) {
        return res.status(400).json({ message: 'path is missing in request body.', status: 400 });
    }
    try {
        const result = await (0, s3Controller_js_1.uploadMultipleToS3)({
            bucketName: bucketName,
            path: path,
            files: req.files,
        });
        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    }
    catch (error) {
        console.error('멀티 업로드 에러:', error);
        res.status(400).json({ message: error.message, status: 400 });
    }
});
exports.default = router;

import cors from 'cors';
import express from 'express';
import multer, { memoryStorage } from 'multer';
import { uploadToS3, uploadMultipleToS3 } from './src/uploadController.js';
import 'dotenv/config.js'
import { getDirectoryTest, getFileTest, test } from './src/webdav_client.js';
import { pkg } from './src/app_info.js';
import swaggerUi from 'swagger-ui-express';
import { specs } from './src/swagger.js';


const app = express();

// CORS 설정 - 특정 도메인 허용
// const corsOptions = {
//   origin: [
//     'http://localhost:3000',
//     'http://localhost:3003',
//     'http://localhost:8080',
//     'http://kikii.iptime.org:3013'
//   ],
//   credentials: true,  // 쿠키/인증 헤더 허용
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Typeㄷ', 'Authorization', 'X-Requested-With']
// };

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));
// 요청 패킷 정보를 로깅하는 미들웨어
const requestLogger = (req, res, next) => {
    console.log('\n=== 요청 패킷 정보 ===');
    console.log('Method:', req.method);
    console.log('URL:', req.url);
    console.log('Headers:', req.headers);
    console.log('Query:', req.query);
    console.log('Body:', req.body);
    console.log('File:', req.file);
    console.log('Files:', req.files);
    console.log('=====================\n');
    next();
};

const upload = multer({ storage: memoryStorage(), preservePath: false });

/**
 * @swagger
 * /:
 *   get:
 *     summary: 서버 상태 확인
 *     description: 서버가 정상적으로 작동하는지 확인하는 엔드포인트
 *     tags: [Health Check]
 *     responses:
 *       200:
 *         description: 서버가 정상 작동 중
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: "Hello World"
 */
app.get('/', (req, res) => {
    res.json({ 
        message: 'Hello World',
    });
});

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
app.post('/s3/upload', upload.single('file'), async (req, res) => {

    if (!req.file) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    }

    const { bucketName } = req.body;

    if(!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }

    try {
        const result = await uploadToS3({
            bucketName: bucketName,
            file: req.file,
        });
        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    } catch (error) {
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
app.post('/s3/upload/multiple', upload.array('files', 10), async (req, res) => {

    console.log(req.files);

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: '파일이 없습니다.', status: 400 });
    } else if(req.files.length > 10) {
        return res.status(400).json({ message: '파일 개수가 10개를 초과했습니다.', status: 400 });
    }
    
    const { bucketName, path } = req.body;
    console.log(bucketName, path);

    if(!bucketName) {
        return res.status(400).json({ message: 'bucketName is missing in request body.', status: 400 });
    }

    if(!path) {
        return res.status(400).json({ message: 'path is missing in request body.', status: 400 });
    }

    try {
        const result = await uploadMultipleToS3({
            bucketName: bucketName,
            path: path,
            files: req.files,
        });

        return res.status(200).json({ message: '파일 업로드 성공', status: 200, object: result });
    } catch (error) {
        console.error('멀티 업로드 에러:', error);
        res.status(400).json({ message: error.message, status: 400 });
    }
});

app.use(requestLogger);  // 로깅 미들웨어 추가

const PORT_NUM = 80;

app.listen(PORT_NUM, () => {
    console.log('Server is running on port ' + PORT_NUM);
    console.log("app version: " + pkg.version);
    getDirectoryTest();
});
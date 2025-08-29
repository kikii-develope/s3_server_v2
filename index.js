import cors from 'cors';
import express from 'express';
import 'dotenv/config.js'
import { pkg } from './src/config/appInfo.js';
import swaggerUi from 'swagger-ui-express';
import { specs } from './src/config/swagger.js';
import s3Routes from './src/router/s3Routes.js';
import webDavRoutes from "./src/router/webDavRoutes.js";

const app = express();

// CORS 설정 - 특정 도메인 허용
// const corsOptions = {
//     origin: [
//         'http://localhost:3000',
//         'http://localhost:3003',
//         'http://localhost:8080',
//         'http://kikii.iptime.org:3012',
//         'http://kikii.iptime.org:3013',
//         'http://kikii.iptime.org:8989',
//     ],
//     credentials: true,  // 쿠키/인증 헤더 허용
//     methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//     allowedHeaders: ['Content-Typeㄷ', 'Authorization', 'X-Requested-With']
// };

app.use('/swagger-ui.html', swaggerUi.serve, swaggerUi.setup(specs));

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

app.use(requestLogger);  // 로깅 미들웨어 추가

app.use('/webdav', webDavRoutes);
app.use('/s3', s3Routes);

const PORT_NUM = process.env.PORT || 8989;

app.listen(PORT_NUM, () => {
    console.log('Server is running on port ' + PORT_NUM);
    console.log("app version: " + pkg.version);
}); 
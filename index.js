import cors from 'cors';
import express from 'express';
import 'dotenv/config.js'
import { pkg } from './src/config/appInfo.js';
import swaggerUi from 'swagger-ui-express';
import { specs } from './src/config/swagger.js';
import s3Routes from './src/router/s3Routes.js';
import webDavRoutes from "./src/router/webDavRoutes.js";
import { testConnection } from './src/config/database.js';

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

// 응답 패킷 정보를 로깅하는 미들웨어
const responseLogger = (req, res, next) => {
    const originalSend = res.send;
    const originalJson = res.json;

    // 응답 시작 시간 기록
    const startTime = Date.now();

    // res.send 오버라이드
    res.send = function (data) {
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log('\n=== 응답 패킷 정보 ===');
        console.log('Status Code:', res.statusCode);
        console.log('Headers:', res.getHeaders());
        console.log('Duration:', duration + 'ms');
        console.log('Response Data:', data);
        console.log('========================\n');

        originalSend.call(this, data);
    };

    // res.json 오버라이드
    res.json = function (data) {
        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log('\n=== 응답 패킷 정보 ===');
        console.log('Status Code:', res.statusCode);
        console.log('Headers:', res.getHeaders());
        console.log('Duration:', duration + 'ms');
        console.log('Response Data:', data);
        console.log('========================\n');

        originalJson.call(this, data);
    };

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

app.use(requestLogger);  // 요청 로깅 미들웨어 추가
// app.use(responseLogger); // 응답 로깅 미들웨어 추가

app.use('/webdav', webDavRoutes);
app.use('/s3', s3Routes);

const PORT_NUM = process.env.PORT || 8989;

app.listen(PORT_NUM, async () => {
    console.log('Server is running on port ' + PORT_NUM);
    console.log("app version: " + pkg.version);
    await testConnection();
}); 
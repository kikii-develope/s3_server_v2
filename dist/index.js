"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
if (process.env.NODE_ENV === "development") {
    require("dotenv").config();
}
const appInfo_js_1 = require("./src/config/appInfo.js");
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_js_1 = require("./src/config/swagger.js");
const s3Routes_js_1 = __importDefault(require("./src/router/s3Routes.js"));
const webDavRoutes_js_1 = __importDefault(require("./src/router/webDavRoutes.js"));
const app = (0, express_1.default)();
// CORS 설정 - 환경별 분기
// const getCorsOrigin = () => {
//   if (process.env.NODE_ENV === 'development') {
//     return true; // 개발 환경: 모든 origin 허용
//   }
//   // 프로덕션: 환경변수에서 허용 도메인 가져오기
//   if (process.env.CORS_ORIGINS) {
//     return process.env.CORS_ORIGINS.split(',').map(origin => origin.trim());
//   }
//   // 기본 허용 도메인
//   return [
//     // 'http://localhost:3000',
//     // 'http://localhost:3003',
//     // 'http://kikii.iptime.org:3012',
//     // 'http://kikii.iptime.org:3013'
//   ];
// };
// const corsOptions = {
//   origin: getCorsOrigin(),
//   credentials: true,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
// };
app.use("/swagger-ui.html", swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_js_1.specs));
// app.use(cors(corsOptions));
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// URL 디코딩 헬퍼 함수
const decodeUrl = (url) => {
    try {
        return decodeURIComponent(url);
    }
    catch {
        return url;
    }
};
// HTTP 메서드별 아이콘
const getMethodIcon = (method) => {
    const icons = {
        GET: "📖", // 조회
        POST: "📤", // 업로드/생성
        PUT: "✏️", // 업데이트
        PATCH: "🔧", // 부분 수정
        DELETE: "🗑️", // 삭제
        OPTIONS: "⚙️", // 옵션
        HEAD: "🔍", // 헤더 조회
    };
    return icons[method] || "📨";
};
// API 요청/응답 로깅 미들웨어
const apiLogger = (req, res, next) => {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();
    const decodedUrl = decodeUrl(req.originalUrl);
    const methodIcon = getMethodIcon(req.method);
    // 요청 로그
    console.log("\n┌─────────────────────────────────────────────────────────────");
    console.log(`│ 📥 REQUEST  [${timestamp}]`);
    console.log("├─────────────────────────────────────────────────────────────");
    console.log(`│ ${methodIcon} ${req.method} ${decodedUrl}`);
    console.log(`│ IP: ${req.ip || req.socket.remoteAddress}`);
    if (Object.keys(req.query).length > 0) {
        console.log(`│ Query: ${JSON.stringify(req.query)}`);
    }
    if (req.body && Object.keys(req.body).length > 0) {
        console.log(`│ Body: ${JSON.stringify(req.body)}`);
    }
    if (req.file) {
        console.log(`│ File: ${req.file.originalname} (${req.file.size} bytes)`);
    }
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
        console.log(`│ Files: ${req.files.map((f) => f.originalname).join(", ")}`);
    }
    console.log("└─────────────────────────────────────────────────────────────");
    // 응답 완료 시 로그
    res.on("finish", () => {
        const duration = Date.now() - startTime;
        const statusEmoji = res.statusCode >= 400 ? "❌" : "✅";
        console.log("\n┌─────────────────────────────────────────────────────────────");
        console.log(`│ 📤 RESPONSE [${new Date().toISOString()}]`);
        console.log("├─────────────────────────────────────────────────────────────");
        console.log(`│ ${statusEmoji} ${methodIcon} ${req.method} ${decodedUrl}`);
        console.log(`│ Status: ${res.statusCode} | Duration: ${duration}ms`);
        console.log("└─────────────────────────────────────────────────────────────\n");
    });
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
app.get("/", (req, res) => {
    res.json({
        message: "Hello World",
    });
});
app.use(apiLogger); // API 요청/응답 로깅
app.use("/webdav", webDavRoutes_js_1.default);
app.use("/s3", s3Routes_js_1.default);
const PORT_NUM = process.env.PORT || 8000;
app.listen(PORT_NUM, () => {
    console.log("Server is running on port " + PORT_NUM);
    console.log("app version: " + appInfo_js_1.pkg.version);
});

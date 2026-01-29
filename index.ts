import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
if (process.env.NODE_ENV === "development") {
  await import("dotenv/config.js");
}
import { pkg } from "./src/config/appInfo.js";
import swaggerUi from "swagger-ui-express";
import { specs } from "./src/config/swagger.js";
import s3Routes from "./src/router/s3Routes.js";
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
//     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
// };

app.use("/swagger-ui.html", swaggerUi.serve, swaggerUi.setup(specs));

app.use(cors());

app.use(express.json());

app.use(express.urlencoded({ extended: true }));
// URL 디코딩 헬퍼 함수
const decodeUrl = (url: string): string => {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
};

// HTTP 메서드별 아이콘
const getMethodIcon = (method: string): string => {
  const icons: Record<string, string> = {
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
const apiLogger = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const decodedUrl = decodeUrl(req.originalUrl);
  const methodIcon = getMethodIcon(req.method);

  // 요청 로그
  console.log(
    "\n┌─────────────────────────────────────────────────────────────",
  );
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

    console.log(
      "\n┌─────────────────────────────────────────────────────────────",
    );
    console.log(`│ 📤 RESPONSE [${new Date().toISOString()}]`);
    console.log(
      "├─────────────────────────────────────────────────────────────",
    );
    console.log(`│ ${statusEmoji} ${methodIcon} ${req.method} ${decodedUrl}`);
    console.log(`│ Status: ${res.statusCode} | Duration: ${duration}ms`);
    console.log(
      "└─────────────────────────────────────────────────────────────\n",
    );
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

app.use("/webdav", webDavRoutes);
app.use("/s3", s3Routes);

const PORT_NUM = process.env.PORT || 8000;

app.listen(PORT_NUM, () => {
  console.log("Server is running on port " + PORT_NUM);
  console.log("app version: " + pkg.version);
});

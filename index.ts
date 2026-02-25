import cors from "cors";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";

// 환경별 .env 파일 로드
const envFile = process.env.NODE_ENV === 'production'
  ? '.env.production'
  : process.env.NODE_ENV === 'onprem'
  ? '.env.onprem'
  : '.env.development';

dotenv.config({ path: envFile });
console.log(`Loaded environment from: ${envFile}`);

// 환경변수 확인
console.log("=== 환경변수 확인 ===");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log("PORT:", process.env.PORT);
console.log("WEBDAV_ROOT_PATH:", process.env.WEBDAV_ROOT_PATH);
console.log("WEBDAV_URL:", process.env.WEBDAV_URL);
console.log("DB_HOST:", process.env.DB_HOST);
console.log("CORS_ORIGINS:", process.env.CORS_ORIGINS);
console.log("====================");
import { pkg } from "./src/config/appInfo.js";
import swaggerUi from "swagger-ui-express";
import { specs } from "./src/config/swagger.js";
import { corsOptions, logCorsConfig } from "./src/config/cors.js";
import s3Routes from "./src/router/s3Routes.js";
import webDavRoutes from "./src/router/webDavRoutes.js";
import { runStartupSweeper, scheduleSweeper } from "./src/bootstrap/tmpSweeper.js";

const app = express();

// ── Readiness flag (부팅 스위퍼 완료 전까지 not ready) ──
let startupSweepDone = false;

app.get("/ready", (_req, res) => {
  if (startupSweepDone) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false });
  }
});

// CORS 설정 로그 출력
logCorsConfig();

app.use("/swagger-ui.html", swaggerUi.serve, swaggerUi.setup(specs, {
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    deepLinking: false, // v4.0 경고 방지
  }
}));

// CORS 미들웨어 적용
app.use(cors(corsOptions));

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

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
  console.log("Server is running on port " + PORT);
  console.log("app version: " + pkg.version);

  // 부팅 스위퍼: listen 직후 백그라운드 실행 (요청 수신 차단 없음)
  // 서버 크래시 후 남은 multer tmp + merge tmp 정리
  // 부팅 시점에는 진행중 업로드가 없으므로 짧은 TTL(10초)로 즉시 정리
  // 부팅 직후에는 이전 세션의 stale lock이 남아있을 수 있으므로
  // LOCK_STALE_MS를 0으로 설정하여 무조건 lock 획득
  runStartupSweeper({ TTL_MS: 10_000, SAFE_WINDOW_MS: 5_000, LOCK_STALE_MS: 0 })
    .catch(() => {})
    .finally(() => {
      startupSweepDone = true;
      console.log("[ready] Startup sweeper done — server is ready");
    });

  // 주기 스위퍼: 1시간마다 6시간 이상 된 임시파일 정리
  scheduleSweeper();
});

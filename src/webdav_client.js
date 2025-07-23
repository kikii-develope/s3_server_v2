import { createClient } from "webdav";

const client = createClient(
  "https://211.233.58.24:474/",
  {
    username: "TNAS-8881",
    password: "Zlzl8@@7",
    rejectUnauthorized: false,  // 자체 서명된 인증서 허용
    // 추가 SSL 옵션
    agent: false,
    timeout: 30000,
    // fetch 옵션 추가
    fetch: (url, options) => {
      return fetch(url, {
        ...options,
        rejectUnauthorized: false
      });
    }
  }
);

export const test = async () => {

    await client.putFileContents("/www/test/hello.txt", "hello, world");
}

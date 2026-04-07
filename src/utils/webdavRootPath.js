/**
 * WebDAV 루트 경로 결정 규칙
 * 1) WEBDAV_ROOT_PATH 명시 시 해당 값 우선
 * 2) 미명시 시 NODE_ENV 기반 자동 선택
 *    - production: www
 *    - 그 외: kikii_test
 */

const normalize = (value) => String(value || '').replace(/^\/+|\/+$/g, '');

export const getWebdavRootPath = () => {
    const explicit = normalize(process.env.WEBDAV_ROOT_PATH);
    if (explicit) return explicit;

    return process.env.NODE_ENV === 'production' ? 'www' : 'kikii_test';
};


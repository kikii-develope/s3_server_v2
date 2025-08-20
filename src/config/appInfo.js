import { readFile } from 'fs/promises';

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf-8'));



export { pkg };
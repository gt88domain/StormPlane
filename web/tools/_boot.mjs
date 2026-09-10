/**
 * 自检工具的公共引导：解析开发依赖、统一路径，避免在任何机器上写死绝对路径。
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = (name) => path.join(WEB_ROOT, 'src', name);
export const OUT_DEFAULT = path.join(WEB_ROOT, 'preview');

/** 载入 @napi-rs/canvas（仅开发自检需要，游戏本体零依赖） */
export async function loadCanvas() {
  try {
    return (await import('@napi-rs/canvas')).createCanvas;
  } catch {
    console.error(
      '\n离线自检工具需要开发依赖 @napi-rs/canvas：\n' +
      '    cd web && npm i -D @napi-rs/canvas\n\n' +
      '（游戏本体不需要任何依赖：node server.mjs 即可开玩）\n'
    );
    process.exit(1);
  }
}

export const outDir = (argvIndex) => process.argv[argvIndex] || OUT_DEFAULT;

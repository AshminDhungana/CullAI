/**
 * tests/helpers/fixtures.ts
 *
 * Utilities for generating tiny synthetic image buffers in-memory.
 * Real binary fixtures are avoided to keep the repo small and tests fast.
 */

// Minimal valid 1x1 pixel JPEG encoded as base64
const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDABcQERcRDREXHxQfFxlJfF9uY29yamZgbG9pd3B3eHl4eXx9fX19//bAEMABgQFBgcICQoL/8QAtRAAAgEDBAQGBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJeYl5qZmpyen6ChoqOkpaanqKmqq6ytrq+v8P/2wBDABcQERcRDREXHxQfFxlJfF9uY29yamZgbG9pd3B3eHl4eXx9fX19//bAEMABgQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJeYl5qZmpyen6ChoqOkpaanqKmqq6ytrq+v/9oADAMBAAIRAxEAPwD3/9k=';

// Minimal valid 1x1 PNG encoded as base64 (8-byte IHDR, 1x1 pixel, light green)
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2Nk+M/YBAAABgBdWYYqAAAAAElFTkSuQmCC';

/** Returns a Buffer containing a tiny valid JPEG (1×1 px). */
export function createFakeJpegBuffer(): Buffer {
  return Buffer.from(TINY_JPEG_B64, 'base64');
}

/** Returns a Buffer containing a tiny valid PNG (1×1 px). */
export function createFakePngBuffer(): Buffer {
  return Buffer.from(TINY_PNG_B64, 'base64');
}

/** Creates a zero-byte file with the given extension in a temp directory. */
export function createFakeRawFileSync(fs: typeof import('fs'), dir: string, basename: string): string {
  const filePath = require('path').join(dir, basename);
  fs.writeFileSync(filePath, Buffer.alloc(0));
  return filePath;
}

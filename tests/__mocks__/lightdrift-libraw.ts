/**
 * tests/__mocks__/lightdrift-libraw.ts
 *
 * Shared mock for the lightdrift-libraw native addon.
 * This module is a C++ Node.js addon that can only run inside Electron's
 * main process. When Vitest runs in a plain Node.js process the addon is
 * unavailable, so every test that imports `src/main/raw-decoder.ts` (or any
 * file that transitively imports `lightdrift-libraw`) must use this mock.
 *
 * Usage in the test file:
 *   vi.mock('lightdrift-libraw');
 *   import { LibRawMock, setMockReturnValue } from '../__mocks__/lightdrift-libraw';
 *
 *   setMockReturnValue(Buffer.from('fake-jpeg-data'));
 */

export class LibRawMock {
  loadFile = vi.fn().mockResolvedValue(undefined);
  processImage = vi.fn().mockResolvedValue(undefined);
  unpackThumbnail = vi.fn().mockResolvedValue(undefined);

  createJPEGBuffer = vi.fn().mockImplementation(() =>
    Promise.resolve({
      success: true,
      buffer: Buffer.from('fake-decoded-jpeg-data'),
    }),
  );

  createThumbnailJPEGBuffer = vi.fn().mockImplementation(() =>
    Promise.resolve({
      success: true,
      buffer: Buffer.from('fake-thumbnail-jpeg-data'),
      metadata: {
        outputDimensions: { width: 2048, height: 1536 },
      },
    }),
  );

  thumbOK = vi.fn().mockResolvedValue(true);

  close = vi.fn().mockResolvedValue(undefined);
}

export default LibRawMock;

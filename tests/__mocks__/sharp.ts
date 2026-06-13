/**
 * tests/__mocks__/sharp.ts
 *
 * Shared mock for the `sharp` image-processing library.
 *
 * Usage in the test file:
 *   vi.mock('sharp');
 */

export const sharpMock = vi.fn();

export const sharpInstance = {
  resize: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  toFormat: vi.fn().mockReturnThis(),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('sharp-processed-buffer')),
  metadata: vi.fn().mockResolvedValue({ width: 1024, height: 768 }),
};

sharpMock.mockImplementation(() => sharpInstance);

export default sharpMock;

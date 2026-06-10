/**
 * FaceOverlay.tsx
 *
 * Phase 12 — Renders face detection bounding boxes on top of an image tile.
 * Uses absolute positioning with fractional coordinates from FaceBoundingBox.
 * Green = eyes open, orange = blink detected.
 */

import type { FaceMetadata } from '../../shared/types';

interface FaceOverlayProps {
  faceMetadata: FaceMetadata;
  containerWidth: number;
  containerHeight: number;
}

export default function FaceOverlay({ faceMetadata, containerWidth, containerHeight }: FaceOverlayProps) {
  if (!faceMetadata.hasFaces || faceMetadata.boundingBoxes.length === 0) {
    return null;
  }

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      {faceMetadata.boundingBoxes.map((box, idx) => {
        const left = box.x * containerWidth;
        const top = box.y * containerHeight;
        const width = box.width * containerWidth;
        const height = box.height * containerHeight;

        const isBlinkFace = faceMetadata.blinkDetected;
        const borderColor = isBlinkFace ? 'border-orange-400' : 'border-emerald-400';
        const bgColor = isBlinkFace ? 'bg-orange-400/10' : 'bg-emerald-400/10';
        const labelText = isBlinkFace ? 'blink' : 'eyes open';
        const labelBg = isBlinkFace ? 'bg-orange-500' : 'bg-emerald-500';

        return (
          <div
            key={idx}
            className={`absolute border-2 ${borderColor} ${bgColor} rounded-sm transition-opacity duration-200`}
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
            }}
          >
            <span
              className={`absolute -top-5 left-0 ${labelBg} text-white text-[9px] font-medium px-1 py-0.5 rounded-sm leading-none whitespace-nowrap`}
            >
              {labelText}
            </span>
          </div>
        );
      })}
    </div>
  );
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GENRE_PRESETS = void 0;
/**
 * Pre-configured scoring weights for each shoot genre.
 * All six values in every preset sum to exactly 100.
 */
exports.GENRE_PRESETS = {
    general: { quality: 25, aesthetic: 20, composition: 15, sharpness: 15, exposure: 10, faceEyes: 15 },
    wedding: { quality: 20, aesthetic: 20, composition: 10, sharpness: 15, exposure: 10, faceEyes: 25 },
    portrait: { quality: 20, aesthetic: 15, composition: 10, sharpness: 15, exposure: 10, faceEyes: 30 },
    sports: { quality: 25, aesthetic: 15, composition: 10, sharpness: 30, exposure: 10, faceEyes: 10 },
    landscape: { quality: 25, aesthetic: 25, composition: 20, sharpness: 15, exposure: 15, faceEyes: 0 },
    street: { quality: 20, aesthetic: 25, composition: 20, sharpness: 15, exposure: 10, faceEyes: 10 },
    event: { quality: 20, aesthetic: 15, composition: 10, sharpness: 20, exposure: 10, faceEyes: 25 },
};
//# sourceMappingURL=genre-presets.js.map
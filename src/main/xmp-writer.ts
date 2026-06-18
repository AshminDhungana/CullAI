/**
 * src/main/xmp-writer.ts
 *
 *
 * Writes XMP sidecar files (.xmp) alongside original images so that
 * Lightroom Classic, Capture One, and any XMP-aware DAM can read star
 * ratings, colour labels, AI reasoning, and keyword tags without
 * touching the original RAW or JPEG files.
 *
 * ── Why a custom writer and not xmp-metadata npm? ──────────────────────────
 *
 *   The xmp-metadata package omits the required `<?xpacket ...?>` processing
 *   instructions, writes incorrect namespace prefixes for `dc:` elements, and
 *   cannot produce `rdf:Bag` arrays for `dc:subject`. Lightroom silently
 *   ignores sidecars with malformed namespace declarations, so a hand-rolled
 *   template is both safer and simpler — it is just a string.
 *
 * ── XMP structure required by Lightroom Classic ────────────────────────────
 *
 *   <?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
 *   <x:xmpmeta xmlns:x="adobe:ns:meta/">
 *     <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
 *       <rdf:Description rdf:about=""
 *           xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 *           xmlns:dc="http://purl.org/dc/elements/1.1/">
 *         <xmp:Rating>5</xmp:Rating>
 *         <xmp:Label>Green</xmp:Label>
 *         <dc:description>...</dc:description>           <!-- optional -->
 *         <dc:subject>                                   <!-- optional -->
 *           <rdf:Bag>
 *             <rdf:li>keyword</rdf:li>
 *           </rdf:Bag>
 *         </dc:subject>
 *       </rdf:Description>
 *     </rdf:RDF>
 *   </x:xmpmeta>
 *   <?xpacket end="w"?>
 *
 *   Key requirements:
 *   • The xpacket begin attribute MUST contain the UTF-8 BOM character (\uFEFF).
 *     Lightroom uses it as the XMP sentinel when scanning file bytes.
 *   • Namespace URIs must be exact — a single typo causes silent rejection.
 *   • rdf:about="" (empty string) is correct for sidecar files.
 *   • dc:description uses an rdf:Alt language-tagged alternative wrapper.
 *   • dc:subject uses an rdf:Bag (unordered set) as required by the XMP spec.
 *
 * ── Tier → Lightroom mapping ───────────────────────────────────────────────
 *
 *   Tier      | xmp:Rating | xmp:Label
 *   ----------|------------|----------
 *   S         |     5      | Green
 *   A         |     4      | Blue
 *   B         |     3      | Yellow
 *   rejected  |     1      | Red
 *
 * MAIN-PROCESS ONLY. Never import from src/renderer.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScoreRecord } from '../shared/types';

// ---------------------------------------------------------------------------
// Tier → Lightroom mappings
// ---------------------------------------------------------------------------

const TIER_TO_RATING: Record<string, number> = {
  S:        5,
  A:        4,
  B:        3,
  rejected: 1,
};

const TIER_TO_LABEL: Record<string, string> = {
  S:        'Green',
  A:        'Blue',
  B:        'Yellow',
  rejected: 'Red',
};

// ---------------------------------------------------------------------------
// XML escaping
// ---------------------------------------------------------------------------

/**
 * Escapes the five XML-reserved characters so they are safe inside element
 * text content and attribute values. Must be applied to every string sourced
 * from AI output (reasoning, keywords) before embedding in the XMP XML.
 */
function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')    // must be first — other escapes produce &
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// XMP template builder
// ---------------------------------------------------------------------------

/**
 * Builds the complete XMP XML string for a single ScoreRecord.
 *
 * @param score               The scored image record.
 * @param includeDescription  If true, AI reasoning is embedded in dc:description.
 * @param keywords            Optional keyword array (from Phase 13b auto-tagging).
 *                            Omitted from XMP when empty or undefined.
 * @returns                   UTF-8 XMP XML string.
 */
function buildXmpXml(
  score: ScoreRecord,
  includeDescription: boolean,
  keywords?: string[],
): string {
  const rating = TIER_TO_RATING[score.tier] ?? 1;
  const label  = TIER_TO_LABEL[score.tier]  ?? 'Red';

  // ── dc:description (optional AI reasoning) ────────────────────────────────
  //
  // dc:description requires an rdf:Alt wrapper with an xml:lang attribute.
  // The language tag "x-default" is the XMP convention for "use this value
  // when no better-matching language alternative is present".
  const descriptionBlock = includeDescription && score.reasoning?.trim()
    ? `\n      <dc:description>\n        <rdf:Alt>\n          <rdf:li xml:lang="x-default">${escapeXml(score.reasoning.trim())}</rdf:li>\n        </rdf:Alt>\n      </dc:description>`
    : '';

  // ── dc:subject keyword bag (optional Phase 13b auto-tagging) ──────────────
  //
  // dc:subject uses rdf:Bag (unordered) not rdf:Seq (ordered). Lightroom
  // displays these as its Keyword list. An empty Bag is omitted entirely —
  // some importers treat an empty Bag as "keywords cleared", which is wrong.
  const hasKeywords = Array.isArray(keywords) && keywords.length > 0;
  const keywordBlock = hasKeywords
    ? `\n      <dc:subject>\n        <rdf:Bag>\n${keywords!.map(k => `          <rdf:li>${escapeXml(k)}</rdf:li>`).join('\n')}\n        </rdf:Bag>\n      </dc:subject>`
    : '';

  // ── Assemble the full XMP document ────────────────────────────────────────
  //
  // The \uFEFF in the xpacket begin attribute is the UTF-8 BOM. It is part of
  // the XMP spec (ISO 16684-1) and required by Lightroom's file scanner.
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
        xmlns:xmp="http://ns.adobe.com/xap/1.0/"
        xmlns:dc="http://purl.org/dc/elements/1.1/">
      <xmp:Rating>${rating}</xmp:Rating>
      <xmp:Label>${label}</xmp:Label>${descriptionBlock}${keywordBlock}
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

// ---------------------------------------------------------------------------
// Sidecar path resolution
// ---------------------------------------------------------------------------

/**
 * Computes the XMP sidecar path for a given original image path.
 *
 * The sidecar always sits in the same directory as the original, with the
 * same basename but a `.xmp` extension. This is the convention expected by
 * Lightroom Classic and Capture One.
 *
 * Examples:
 *   /photos/wedding/IMG_001.CR3  →  /photos/wedding/IMG_001.xmp
 *   /photos/portrait/DSC_042.nef →  /photos/portrait/DSC_042.xmp
 */
export function sidecarPath(originalPath: string): string {
  const dir  = path.dirname(originalPath);
  const base = path.basename(originalPath, path.extname(originalPath));
  return path.join(dir, `${base}.xmp`);
}

// ---------------------------------------------------------------------------
// Single-file writer
// ---------------------------------------------------------------------------

/**
 * Writes (or overwrites) the XMP sidecar for a single image.
 *
 * @param score               ScoreRecord for the image.
 * @param originalPath        Absolute path to the original image on disk.
 * @param includeDescription  Embed AI reasoning in dc:description if true.
 * @param keywords            Optional Phase 13b keyword array.
 * @throws                    If the filesystem write fails (propagated to caller).
 */
export async function writeXmpSidecar(
  score: ScoreRecord,
  originalPath: string,
  includeDescription: boolean,
  keywords?: string[],
): Promise<void> {
  const xml      = buildXmpXml(score, includeDescription, keywords);
  const sidePath = sidecarPath(originalPath);
  await fs.promises.writeFile(sidePath, xml, 'utf8');

  if (process.env.NODE_ENV === 'development') {
    console.log(`[xmp-writer] wrote ${path.basename(sidePath)}`);
  }
}

// ---------------------------------------------------------------------------
// Batch writer
// ---------------------------------------------------------------------------

/**
 * Writes XMP sidecars for all scores in parallel, collecting per-file errors
 * without aborting the entire batch.
 *
 * @param scores              All ScoreRecords from the session.
 * @param imagePathMap        Maps score.filename → absolute file path on disk.
 *                            Built by the orchestrator / IPC handler from
 *                            session.settings.inputFolder + score.filename.
 * @param includeDescription  Embed AI reasoning in dc:description if true.
 * @returns                   { written: number; errors: string[] }
 *                            `errors` contains one entry per failed sidecar
 *                            (format: "filename: error message").
 */
export async function writeAllSidecars(
  scores: ScoreRecord[],
  imagePathMap: Record<string, string>,
  includeDescription: boolean,
): Promise<{ written: number; errors: string[] }> {
  const results = await Promise.all(
    scores.map(async (score) => {
      const originalPath = imagePathMap[score.filename];
      if (!originalPath) {
        return {
          ok: false,
          error: `${score.filename}: no path mapping provided`,
        };
      }
      try {
        // Use per-image keywords if stored in the ScoreRecord (Phase 13b).
        await writeXmpSidecar(
          score,
          originalPath,
          includeDescription,
          score.keywords,
        );
        return { ok: true, error: null };
      } catch (err: any) {
        return {
          ok: false,
          error: `${score.filename}: ${err?.message ?? String(err)}`,
        };
      }
    }),
  );

  const written = results.filter(r => r.ok).length;
  const errors  = results.filter(r => !r.ok).map(r => r.error!);

  if (process.env.NODE_ENV === 'development') {
    console.log(
      `[xmp-writer] batch complete — ${written} written, ${errors.length} errors`,
    );
    if (errors.length > 0) {
      console.warn('[xmp-writer] errors:', errors);
    }
  }

  return { written, errors };
}
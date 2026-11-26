/**
 * KindleFlow — Slides / Image Enlargement Converter
 * Prompt 5: Mode B conversion pipeline for lecture slides, presentations, and diagrams.
 *
 * Does NOT reflow text or split slides into multiple pages.
 * Renders each source page at high resolution, optionally trims confirmed empty
 * outer margins (Smart margin adjustment) or retains full page bounds (Original
 * proportions), scales proportionally, and centers onto a landscape (4:3) or
 * portrait (3:4) 6-inch Kindle display profile.
 */
import { jsPDF } from 'jspdf';
import { getLocalPDFJS } from './worker-loader.tmp.mjs';
import { validatePDF } from './validator.tmp.mjs';
import { buildOutputFileName } from './pdf-generator.tmp.mjs';
// ─── Constants & Display Profiles ─────────────────────────────────────────────
const MAX_SLIDE_CANVAS_PX = 3600;
const MARGIN_COLOR_TOLERANCE = 18;
const CORNER_UNIFORMITY_TOLERANCE = 24;
const SAFETY_PAD_PT = 6;
const MIN_CONTENT_AREA_FRACTION = 0.15;
const LOW_RES_IMAGE_DPI_THRESHOLD = 120;
const MAX_AR_DEVIATION = 0.05;
const MAX_MARGIN_ASYMMETRY_RATIO = 0.35;
export const KINDLE_SLIDE_DISPLAY_LANDSCAPE = {
    name: 'Kindle Basic · 6″ (Landscape 4:3)',
    widthPt: 576,
    heightPt: 432,
    paddingPt: 10,
};
export const KINDLE_SLIDE_DISPLAY_PORTRAIT = {
    name: 'Kindle Basic · 6″ (Portrait 3:4)',
    widthPt: 432,
    heightPt: 576,
    paddingPt: 10,
};
export const DEFAULT_SLIDE_SETTINGS = {
    fittingStrategy: 'original-proportions',
    orientation: 'landscape',
    displayProfile: KINDLE_SLIDE_DISPLAY_LANDSCAPE,
    targetDpi: 300,
    imageFormat: 'PNG',
};
export function resolveSlideSettings(partial) {
    const orientation = partial?.orientation ?? DEFAULT_SLIDE_SETTINGS.orientation;
    const baseProfile = orientation === 'portrait' ? KINDLE_SLIDE_DISPLAY_PORTRAIT : KINDLE_SLIDE_DISPLAY_LANDSCAPE;
    return {
        ...DEFAULT_SLIDE_SETTINGS,
        ...partial,
        orientation,
        displayProfile: {
            ...baseProfile,
            ...(partial?.displayProfile ?? {}),
        },
    };
}
// ─── Safe Margin Detection (Pure Pixel Logic) ─────────────────────────────────
/**
 * Conservatively detect empty outer margins from an RGBA pixel buffer.
 *
 * Strategy:
 *  1. Sample the 4 corners. If corners differ significantly (gradient/photo),
 *     fall back safely to the full original page.
 *  2. Scan inward from all 4 edges for pixels differing from corner background.
 *  3. Add conservative safety padding (`SAFETY_PAD_PT`).
 *  4. If detected content covers < 15% of page area (or is empty), fall back
 *     to full original page boundaries so meaningful content is never clipped.
 */
export function detectSafeMarginsFromPixels(rgba, pixelWidth, pixelHeight, pageWidthPt, pageHeightPt, renderScale, displayProfile = KINDLE_SLIDE_DISPLAY_LANDSCAPE) {
    const fullPage = {
        x: 0,
        y: 0,
        width: pageWidthPt,
        height: pageHeightPt,
        usedFallback: true,
        reason: 'Retained full page bounds.',
    };
    if (pixelWidth < 4 || pixelHeight < 4 || rgba.length < pixelWidth * pixelHeight * 4) {
        return { ...fullPage, reason: 'Invalid pixel buffer dimensions; retained full page.' };
    }
    const sampleAt = (px, py) => {
        const idx = (py * pixelWidth + px) * 4;
        return [rgba[idx], rgba[idx + 1], rgba[idx + 2]];
    };
    const corners = [
        sampleAt(0, 0),
        sampleAt(pixelWidth - 1, 0),
        sampleAt(0, pixelHeight - 1),
        sampleAt(pixelWidth - 1, pixelHeight - 1),
    ];
    // Verify uniform background across corners
    const ref = corners[0];
    for (let c = 1; c < corners.length; c++) {
        const diff = Math.abs(corners[c][0] - ref[0]) +
            Math.abs(corners[c][1] - ref[1]) +
            Math.abs(corners[c][2] - ref[2]);
        if (diff > CORNER_UNIFORMITY_TOLERANCE * 3) {
            return {
                ...fullPage,
                reason: 'Non-uniform slide background detected; fell back to original page bounds.',
            };
        }
    }
    const bgR = Math.round((corners[0][0] + corners[1][0] + corners[2][0] + corners[3][0]) / 4);
    const bgG = Math.round((corners[0][1] + corners[1][1] + corners[2][1] + corners[3][1]) / 4);
    const bgB = Math.round((corners[0][2] + corners[1][2] + corners[2][2] + corners[3][2]) / 4);
    const isContentPixel = (px, py) => {
        const idx = (py * pixelWidth + px) * 4;
        return (Math.abs(rgba[idx] - bgR) > MARGIN_COLOR_TOLERANCE ||
            Math.abs(rgba[idx + 1] - bgG) > MARGIN_COLOR_TOLERANCE ||
            Math.abs(rgba[idx + 2] - bgB) > MARGIN_COLOR_TOLERANCE);
    };
    let minX = pixelWidth;
    let maxX = -1;
    let minY = pixelHeight;
    let maxY = -1;
    // Scan rows top-to-bottom and columns to find bounding box of non-background pixels
    for (let y = 0; y < pixelHeight; y++) {
        for (let x = 0; x < pixelWidth; x++) {
            if (isContentPixel(x, y)) {
                if (x < minX)
                    minX = x;
                if (x > maxX)
                    maxX = x;
                if (y < minY)
                    minY = y;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (maxX < minX || maxY < minY) {
        return {
            ...fullPage,
            reason: 'Blank or uniform slide detected; retained original page bounds.',
        };
    }
    const rawXPt = minX / renderScale;
    const rawYPt = minY / renderScale;
    const rawWPt = (maxX - minX + 1) / renderScale;
    const rawHPt = (maxY - minY + 1) / renderScale;
    const areaFraction = (rawWPt * rawHPt) / Math.max(1, pageWidthPt * pageHeightPt);
    if (areaFraction < MIN_CONTENT_AREA_FRACTION) {
        return {
            ...fullPage,
            reason: 'Detected content region too small (< 15% of slide); retained full page bounds for safety.',
        };
    }
    // Apply conservative safety padding so edges/anti-aliased text are never clipped
    const x = Math.max(0, rawXPt - SAFETY_PAD_PT);
    const y = Math.max(0, rawYPt - SAFETY_PAD_PT);
    const right = Math.min(pageWidthPt, rawXPt + rawWPt + SAFETY_PAD_PT);
    const bottom = Math.min(pageHeightPt, rawYPt + rawHPt + SAFETY_PAD_PT);
    const width = Math.max(1, right - x);
    const height = Math.max(1, bottom - y);
    // Outer margins in points
    const mLeft = x;
    const mTop = y;
    const mRight = Math.max(0, pageWidthPt - right);
    const mBottom = Math.max(0, pageHeightPt - bottom);
    // Aspect ratio comparison
    const sourceAR = pageWidthPt / Math.max(1, pageHeightPt);
    const cropAR = width / Math.max(1, height);
    const arDeviation = Math.abs(cropAR - sourceAR) / sourceAR;
    // Detect genuine external letterboxing (e.g. 16:9 widescreen slide inside 4:3 PDF page)
    const isLetterbox = mLeft <= 0.05 * pageWidthPt &&
        mRight <= 0.05 * pageWidthPt &&
        mTop >= 0.04 * pageHeightPt &&
        mBottom >= 0.04 * pageHeightPt &&
        Math.abs(mTop - mBottom) <= Math.max(10, 0.08 * pageHeightPt) &&
        cropAR >= 1.45 &&
        cropAR <= 2.2;
    // Detect genuine external pillarboxing (e.g. 4:3 slide inside 16:9 PDF page)
    const isPillarbox = mTop <= 0.05 * pageHeightPt &&
        mBottom <= 0.05 * pageHeightPt &&
        mLeft >= 0.04 * pageWidthPt &&
        mRight >= 0.04 * pageWidthPt &&
        Math.abs(mLeft - mRight) <= Math.max(10, 0.08 * pageWidthPt) &&
        cropAR >= 0.9 &&
        cropAR <= 1.45;
    // If not standard letterbox or pillarbox, enforce strict aspect ratio, symmetry,
    // and displayed dimension non-shrinkage safeguards
    if (!isLetterbox && !isPillarbox) {
        if (arDeviation > MAX_AR_DEVIATION) {
            return {
                ...fullPage,
                reason: `Detected margins would distort slide aspect ratio (${(arDeviation * 100).toFixed(1)}% change; internal whitespace detected); retained full page bounds.`,
            };
        }
        // Check margin symmetry to avoid trimming intentional one-sided whitespace (e.g. empty slide bottom or side)
        const horizDiff = Math.abs(mLeft - mRight);
        const maxHoriz = Math.max(mLeft, mRight);
        const vertDiff = Math.abs(mTop - mBottom);
        const maxVert = Math.max(mTop, mBottom);
        const horizSym = horizDiff <= Math.max(12, 0.08 * pageWidthPt) ||
            (maxHoriz > 0 && horizDiff / maxHoriz <= MAX_MARGIN_ASYMMETRY_RATIO);
        const vertSym = vertDiff <= Math.max(12, 0.08 * pageHeightPt) ||
            (maxVert > 0 && vertDiff / maxVert <= MAX_MARGIN_ASYMMETRY_RATIO);
        if (!horizSym || !vertSym) {
            return {
                ...fullPage,
                reason: 'Asymmetric margins detected (intentional slide layout whitespace); retained full page bounds.',
            };
        }
        // Display Dimension Safeguard:
        // Never shrink a slide's resulting displayed dimensions below what Original Proportions produces
        const pad = Math.max(0, displayProfile.paddingPt);
        const availW = Math.max(1, displayProfile.widthPt - pad * 2);
        const availH = Math.max(1, displayProfile.heightPt - pad * 2);
        const origScale = Math.min(availW / Math.max(1, pageWidthPt), availH / Math.max(1, pageHeightPt));
        const origDestH = pageHeightPt * origScale;
        const cropScale = Math.min(availW / Math.max(1, width), availH / Math.max(1, height));
        const cropDestH = height * cropScale;
        // If crop is width-constrained and collapses vertical height below Original Proportions, reject
        if (cropDestH < origDestH - 0.5) {
            return {
                ...fullPage,
                reason: `Trimming margins would shrink displayed slide height (${cropDestH.toFixed(1)}pt < ${origDestH.toFixed(1)}pt); retained full page bounds.`,
            };
        }
    }
    return {
        x,
        y,
        width,
        height,
        usedFallback: false,
        reason: isLetterbox
            ? 'External letterboxing trimmed.'
            : isPillarbox
                ? 'External pillarboxing trimmed.'
                : 'Safe outer margins trimmed.',
    };
}
// ─── Proportional Scaling & Centering ─────────────────────────────────────────
/**
 * Scale `cropBox` proportionally to fit inside `displayProfile` padding
 * and center it horizontally and vertically. Never stretches or distorts.
 */
export function computeSlideDestinationBox(cropBox, displayProfile) {
    const pad = Math.max(0, displayProfile.paddingPt);
    const availW = Math.max(1, displayProfile.widthPt - pad * 2);
    const availH = Math.max(1, displayProfile.heightPt - pad * 2);
    const scaleFactor = Math.min(availW / Math.max(1, cropBox.width), availH / Math.max(1, cropBox.height));
    const destWidth = cropBox.width * scaleFactor;
    const destHeight = cropBox.height * scaleFactor;
    const destX = pad + (availW - destWidth) / 2;
    const destY = pad + (availH - destHeight) / 2;
    return {
        destBox: {
            x: destX,
            y: destY,
            width: destWidth,
            height: destHeight,
        },
        scaleFactor,
    };
}
/**
 * Inspect PDF.js operator list for low-resolution embedded bitmaps on the slide.
 */
async function checkEmbeddedImageResolution(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
page, pageNumber, scaleFactor) {
    const warnings = [];
    let lowResDetected = false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfjs = await getLocalPDFJS();
        const OPS = pdfjs.OPS;
        const opList = await page.getOperatorList();
        for (let i = 0; i < opList.fnArray.length; i++) {
            const fn = opList.fnArray[i];
            if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
                let pxW = 0;
                let pxH = 0;
                if (fn === OPS.paintInlineImageXObject && opList.argsArray[i]?.[0]) {
                    pxW = opList.argsArray[i][0].width ?? 0;
                    pxH = opList.argsArray[i][0].height ?? 0;
                }
                else if (fn === OPS.paintImageXObject && typeof opList.argsArray[i]?.[0] === 'string') {
                    const imgName = opList.argsArray[i][0];
                    if (page.objs?.has?.(imgName)) {
                        const imgObj = page.objs.get(imgName);
                        pxW = imgObj?.width ?? 0;
                        pxH = imgObj?.height ?? 0;
                    }
                }
                if (pxW > 0 && pxH > 0) {
                    // Estimate effective DPI at enlarged Kindle destination
                    const baseVp = page.getViewport({ scale: 1.0 });
                    const approxDestWidthIn = (baseVp.width * scaleFactor) / 72;
                    const effectiveDpi = pxW / Math.max(0.5, approxDestWidthIn);
                    if (effectiveDpi < LOW_RES_IMAGE_DPI_THRESHOLD && pxW < 450) {
                        lowResDetected = true;
                        warnings.push(`Slide ${pageNumber} contains a low-resolution embedded image (${pxW}×${pxH}px); enlargement cannot restore missing detail.`);
                        break;
                    }
                }
            }
        }
    }
    catch {
        // Non-fatal: resolution inspection is advisory
    }
    return { lowResDetected, warnings };
}
async function defaultBrowserSlideRasterizer(
// eslint-disable-next-line @typescript-eslint/no-explicit-any
pdfDocument, pageNumber, settings) {
    if (typeof document === 'undefined') {
        throw new Error('HTMLCanvasElement is unavailable in this environment; pass a custom pageRasterizer for non-browser slide rendering.');
    }
    const page = await pdfDocument.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1.0 });
    const desiredScale = Math.max(1.0, settings.targetDpi / 72);
    const maxAllowedScale = MAX_SLIDE_CANVAS_PX / Math.max(1, baseViewport.width, baseViewport.height);
    const renderScale = Math.min(desiredScale, maxAllowedScale);
    const viewport = page.getViewport({ scale: renderScale });
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = Math.max(1, Math.ceil(viewport.width));
    srcCanvas.height = Math.max(1, Math.ceil(viewport.height));
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    if (!srcCtx) {
        page.cleanup();
        throw new Error(`Failed to acquire 2D canvas context for slide page ${pageNumber}.`);
    }
    srcCtx.fillStyle = '#ffffff';
    srcCtx.fillRect(0, 0, srcCanvas.width, srcCanvas.height);
    const pageWarnings = [];
    try {
        await page.render({ canvasContext: srcCtx, viewport }).promise;
        let cropBox = {
            x: 0,
            y: 0,
            width: baseViewport.width,
            height: baseViewport.height,
            usedFallback: false,
            reason: 'Original proportions preserved.',
        };
        if (settings.fittingStrategy === 'smart-margin') {
            const imgData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
            cropBox = detectSafeMarginsFromPixels(imgData.data, srcCanvas.width, srcCanvas.height, baseViewport.width, baseViewport.height, renderScale, settings.displayProfile);
            if (cropBox.usedFallback) {
                pageWarnings.push(`Slide ${pageNumber}: ${cropBox.reason}`);
            }
        }
        const { scaleFactor } = computeSlideDestinationBox(cropBox, settings.displayProfile);
        const resCheck = await checkEmbeddedImageResolution(page, pageNumber, scaleFactor);
        pageWarnings.push(...resCheck.warnings);
        const sx = Math.max(0, Math.floor(cropBox.x * renderScale));
        const sy = Math.max(0, Math.floor(cropBox.y * renderScale));
        const sw = Math.max(1, Math.min(srcCanvas.width - sx, Math.ceil(cropBox.width * renderScale)));
        const sh = Math.max(1, Math.min(srcCanvas.height - sy, Math.ceil(cropBox.height * renderScale)));
        let finalDataUrl;
        const mime = settings.imageFormat === 'JPEG' ? 'image/jpeg' : 'image/png';
        if (sx === 0 && sy === 0 && sw === srcCanvas.width && sh === srcCanvas.height) {
            finalDataUrl = srcCanvas.toDataURL(mime, 0.95);
        }
        else {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = sw;
            cropCanvas.height = sh;
            const cropCtx = cropCanvas.getContext('2d');
            if (!cropCtx) {
                throw new Error(`Failed to create crop canvas for slide page ${pageNumber}.`);
            }
            cropCtx.fillStyle = '#ffffff';
            cropCtx.fillRect(0, 0, sw, sh);
            cropCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, sw, sh);
            finalDataUrl = cropCanvas.toDataURL(mime, 0.95);
            cropCanvas.width = 0;
            cropCanvas.height = 0;
        }
        return {
            image: {
                data: finalDataUrl,
                format: settings.imageFormat,
                pixelWidth: sw,
                pixelHeight: sh,
            },
            sourceWidthPt: baseViewport.width,
            sourceHeightPt: baseViewport.height,
            cropBoxPt: { x: cropBox.x, y: cropBox.y, width: cropBox.width, height: cropBox.height },
            usedFallbackMargins: cropBox.usedFallback,
            marginReason: cropBox.reason,
            lowResImageDetected: resCheck.lowResDetected,
            warnings: pageWarnings,
        };
    }
    finally {
        srcCanvas.width = 0;
        srcCanvas.height = 0;
        page.cleanup();
    }
}
/**
 * Execute Mode B (Slides / Image Enlargement):
 *   loadPDF -> detectSafeMargins -> renderSourcePages -> generateSlidePDF
 *
 * Produces strictly 1 output page per source page, scaled proportionally and
 * centered on the configured Kindle display profile.
 */
export async function convertSlidesToPDF(input, options = {}) {
    const { fileName = 'slides.pdf', pageRasterizer = defaultBrowserSlideRasterizer, onProgress, abortSignal, } = options;
    const settings = resolveSlideSettings(options.settings);
    onProgress?.({
        phase: 'validating',
        message: 'Validating slide PDF...',
        percent: 5,
    });
    const validation = await validatePDF(input, fileName);
    if (!validation.isValid) {
        const errMsg = validation.errors[0]?.message || 'Slide PDF validation failed.';
        onProgress?.({ phase: 'error', message: errMsg, percent: 100 });
        throw new Error(errMsg);
    }
    let bytes;
    if (input instanceof Uint8Array) {
        bytes = input;
    }
    else if (input instanceof ArrayBuffer) {
        bytes = new Uint8Array(input);
    }
    else {
        const buf = await input.arrayBuffer();
        bytes = new Uint8Array(buf);
    }
    onProgress?.({
        phase: 'loading',
        message: 'Loading slides into local PDF engine...',
        percent: 15,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfjs = await getLocalPDFJS();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pdfDocument = null;
    const warnings = [...validation.warnings];
    const errors = [];
    const slidePages = [];
    const { widthPt, heightPt } = settings.displayProfile;
    try {
        const loadingTask = pdfjs.getDocument({
            data: bytes.slice(),
            isEvalSupported: false,
            useSystemFonts: true,
        });
        pdfDocument = await loadingTask.promise;
        const totalPages = pdfDocument.numPages;
        const doc = new jsPDF({
            orientation: widthPt > heightPt ? 'landscape' : 'portrait',
            unit: 'pt',
            format: [widthPt, heightPt],
            compress: true,
        });
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            if (abortSignal?.aborted) {
                throw new Error('Slide conversion cancelled by user.');
            }
            onProgress?.({
                phase: 'rendering',
                currentPage: pageNum,
                totalPages,
                message: `Enlarging slide ${pageNum} of ${totalPages}...`,
                percent: Math.round(15 + (pageNum / totalPages) * 75),
            });
            if (pageNum > 1) {
                doc.addPage([widthPt, heightPt], widthPt > heightPt ? 'landscape' : 'portrait');
            }
            const rendered = await pageRasterizer(pdfDocument, pageNum, settings);
            const { destBox, scaleFactor } = computeSlideDestinationBox(rendered.cropBoxPt, settings.displayProfile);
            doc.addImage(rendered.image.data, rendered.image.format, destBox.x, destBox.y, destBox.width, destBox.height);
            warnings.push(...rendered.warnings);
            slidePages.push({
                sourcePageNumber: pageNum,
                outputPageNumber: pageNum,
                sourceWidthPt: rendered.sourceWidthPt,
                sourceHeightPt: rendered.sourceHeightPt,
                cropBoxPt: rendered.cropBoxPt,
                destBoxPt: destBox,
                scaleFactor,
                usedFallbackMargins: rendered.usedFallbackMargins,
                lowResImageDetected: rendered.lowResImageDetected,
                warnings: rendered.warnings,
            });
        }
        onProgress?.({
            phase: 'exporting',
            currentPage: totalPages,
            totalPages,
            message: 'Finalizing slide PDF...',
            percent: 96,
        });
        const pdfBytes = new Uint8Array(doc.output('arraybuffer'));
        onProgress?.({
            phase: 'completed',
            currentPage: totalPages,
            totalPages,
            message: `Slide conversion complete (${totalPages} pages).`,
            percent: 100,
        });
        return {
            mode: 'slides',
            fileName: buildOutputFileName(fileName, 'slides'),
            pdfBytes,
            pageCount: totalPages,
            warnings,
            errors,
            slidePages,
            createdAt: new Date().toISOString(),
        };
    }
    finally {
        if (pdfDocument) {
            try {
                await pdfDocument.destroy();
            }
            catch {
                // Ignore cleanup errors
            }
        }
    }
}

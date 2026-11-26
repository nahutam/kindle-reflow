/**
 * KindleFlow — Layout Validator
 * Prompt 4: Validate generated LayoutDocument pages and elements.
 *
 * Detects structural errors (overlaps, out-of-bounds, negative dimensions,
 * empty text, missing source refs) and quality warnings (empty pages,
 * suspiciously small regions, tight scaling) without silently hiding errors.
 */
// ─── Constants ────────────────────────────────────────────────────────────────
/** Tolerance (pt) for floating-point edge rounding */
const FLOAT_EPSILON_PT = 0.5;
/** Minimum preserved region size (pt) before flagging as suspiciously small */
const MIN_REGION_DIM_PT = 12;
// ─── Geometry Helpers ─────────────────────────────────────────────────────────
function hasValidPositiveBox(box) {
    return (Number.isFinite(box.x) &&
        Number.isFinite(box.y) &&
        Number.isFinite(box.width) &&
        Number.isFinite(box.height) &&
        box.width > 0 &&
        box.height > 0);
}
function overlapAmount(a, b) {
    const xOverlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const yOverlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return { x: xOverlap, y: yOverlap };
}
/**
 * Exempt intentionally co-located [preserved-region + caption] pairs that share
 * an explicit `groupId` unless they heavily collide (> 2pt vertical overlap).
 */
function isIntentionalCaptionGroup(a, b, yOverlap) {
    if (!a.groupId || a.groupId !== b.groupId)
        return false;
    const hasRegion = a.kind === 'preserved-region' || b.kind === 'preserved-region';
    const hasCaption = (a.kind === 'text' && a.role === 'caption') ||
        (b.kind === 'text' && b.role === 'caption');
    return hasRegion && hasCaption && yOverlap <= 2.0;
}
// ─── Page & Document Validation ───────────────────────────────────────────────
/**
 * Validate an array of LayoutPages and return a structured LayoutValidationReport.
 * Does not mutate any input objects.
 */
export function validateLayoutPages(pages) {
    const errors = [];
    const warnings = [];
    const pushIssue = (issue) => {
        if (issue.severity === 'error') {
            errors.push(issue);
        }
        else {
            warnings.push(issue);
        }
    };
    for (const page of pages) {
        // 1. Validate page & contentArea dimensions
        if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0) {
            pushIssue({
                code: 'INVALID_PAGE_DIMENSIONS',
                severity: 'error',
                message: `Layout page ${page.pageNumber} has invalid dimensions (${page.width}×${page.height}).`,
                pageNumber: page.pageNumber,
            });
            continue;
        }
        if (!hasValidPositiveBox(page.contentArea)) {
            pushIssue({
                code: 'INVALID_CONTENT_AREA',
                severity: 'error',
                message: `Layout page ${page.pageNumber} has non-positive content area (${page.contentArea.width}×${page.contentArea.height}).`,
                pageNumber: page.pageNumber,
            });
            continue;
        }
        // 2. Empty page check
        if (page.elements.length === 0) {
            pushIssue({
                code: 'EMPTY_LAYOUT_PAGE',
                severity: 'warning',
                message: `Layout page ${page.pageNumber} contains no elements.`,
                pageNumber: page.pageNumber,
            });
            continue;
        }
        // 3. Page space overflow check
        if (page.usedHeight > page.contentArea.height + FLOAT_EPSILON_PT) {
            pushIssue({
                code: 'PAGE_SPACE_EXCEEDED',
                severity: 'error',
                message: `Layout page ${page.pageNumber} usedHeight (${page.usedHeight.toFixed(1)}pt) exceeds contentArea height (${page.contentArea.height.toFixed(1)}pt).`,
                pageNumber: page.pageNumber,
            });
        }
        // 4. Per-element validation
        for (const el of page.elements) {
            if (!hasValidPositiveBox(el.box)) {
                pushIssue({
                    code: 'INVALID_ELEMENT_DIMENSIONS',
                    severity: 'error',
                    message: `Element ${el.id} on page ${page.pageNumber} has invalid/negative dimensions.`,
                    pageNumber: page.pageNumber,
                    elementId: el.id,
                    sourcePageNumber: el.sourcePageNumber,
                    sourceBlockId: el.sourceBlockId,
                });
                continue;
            }
            // Physical page boundary check
            const outsidePhysical = el.box.x < -FLOAT_EPSILON_PT ||
                el.box.y < -FLOAT_EPSILON_PT ||
                el.box.x + el.box.width > page.width + FLOAT_EPSILON_PT ||
                el.box.y + el.box.height > page.height + FLOAT_EPSILON_PT;
            if (outsidePhysical) {
                pushIssue({
                    code: 'ELEMENT_OUTSIDE_PAGE_BOUNDS',
                    severity: 'error',
                    message: `Element ${el.id} on page ${page.pageNumber} extends outside page bounds (${page.width}×${page.height}pt).`,
                    pageNumber: page.pageNumber,
                    elementId: el.id,
                    sourcePageNumber: el.sourcePageNumber,
                    sourceBlockId: el.sourceBlockId,
                });
            }
            else {
                // Content margin check
                const outsideMargins = el.box.x < page.contentArea.x - FLOAT_EPSILON_PT ||
                    el.box.y < page.contentArea.y - FLOAT_EPSILON_PT ||
                    el.box.x + el.box.width > page.contentArea.x + page.contentArea.width + FLOAT_EPSILON_PT ||
                    el.box.y + el.box.height > page.contentArea.y + page.contentArea.height + FLOAT_EPSILON_PT;
                if (outsideMargins) {
                    pushIssue({
                        code: 'ELEMENT_EXCEEDS_CONTENT_AREA',
                        severity: 'error',
                        message: `Element ${el.id} on page ${page.pageNumber} extends into page margins.`,
                        pageNumber: page.pageNumber,
                        elementId: el.id,
                        sourcePageNumber: el.sourcePageNumber,
                        sourceBlockId: el.sourceBlockId,
                    });
                }
            }
            if (el.kind === 'text') {
                if (el.text.trim().length === 0) {
                    pushIssue({
                        code: 'EMPTY_TEXT_ELEMENT',
                        severity: 'error',
                        message: `Text element ${el.id} on page ${page.pageNumber} is empty.`,
                        pageNumber: page.pageNumber,
                        elementId: el.id,
                        sourcePageNumber: el.sourcePageNumber,
                        sourceBlockId: el.sourceBlockId,
                    });
                }
                if (!Number.isFinite(el.font.size) || el.font.size <= 0 || !Number.isFinite(el.lineHeight) || el.lineHeight <= 0) {
                    pushIssue({
                        code: 'INVALID_TEXT_METRICS',
                        severity: 'error',
                        message: `Text element ${el.id} on page ${page.pageNumber} has invalid font size or lineHeight.`,
                        pageNumber: page.pageNumber,
                        elementId: el.id,
                    });
                }
            }
            else {
                // Preserved region checks
                if (!el.sourceBlockId || !Number.isFinite(el.sourcePageNumber) || el.sourcePageNumber <= 0 || !hasValidPositiveBox(el.sourceBox)) {
                    pushIssue({
                        code: 'MISSING_SOURCE_REFERENCE',
                        severity: 'error',
                        message: `Preserved region ${el.id} on page ${page.pageNumber} is missing valid source reference or sourceBox.`,
                        pageNumber: page.pageNumber,
                        elementId: el.id,
                        sourcePageNumber: el.sourcePageNumber,
                        sourceBlockId: el.sourceBlockId,
                    });
                }
                if (el.box.width < MIN_REGION_DIM_PT || el.box.height < MIN_REGION_DIM_PT) {
                    pushIssue({
                        code: 'SUSPICIOUSLY_SMALL_REGION',
                        severity: 'warning',
                        message: `Preserved region ${el.id} on page ${page.pageNumber} is very small (${el.box.width.toFixed(1)}×${el.box.height.toFixed(1)}pt).`,
                        pageNumber: page.pageNumber,
                        elementId: el.id,
                        sourcePageNumber: el.sourcePageNumber,
                        sourceBlockId: el.sourceBlockId,
                    });
                }
            }
        }
        // 5. Pairwise overlap check on this page
        for (let i = 0; i < page.elements.length; i++) {
            const a = page.elements[i];
            if (!hasValidPositiveBox(a.box))
                continue;
            for (let j = i + 1; j < page.elements.length; j++) {
                const b = page.elements[j];
                if (!hasValidPositiveBox(b.box))
                    continue;
                const ov = overlapAmount(a.box, b.box);
                if (ov.x > FLOAT_EPSILON_PT && ov.y > FLOAT_EPSILON_PT) {
                    if (isIntentionalCaptionGroup(a, b, ov.y))
                        continue;
                    pushIssue({
                        code: 'OVERLAPPING_ELEMENTS',
                        severity: 'error',
                        message: `Elements ${a.id} and ${b.id} overlap on page ${page.pageNumber} (${ov.x.toFixed(1)}×${ov.y.toFixed(1)}pt).`,
                        pageNumber: page.pageNumber,
                        elementId: a.id,
                    });
                }
            }
        }
    }
    return {
        isValid: errors.length === 0,
        errors,
        warnings,
    };
}
/**
 * Convenience validator accepting a full LayoutDocument.
 */
export function validateLayoutDocument(doc) {
    return validateLayoutPages(doc.pages);
}

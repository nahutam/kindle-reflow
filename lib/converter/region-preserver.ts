/**
 * KindleFlow — Region Preserver
 * Prompt 4: Decide preservation vs. reflow strategy for every DocumentBlock
 * and compute aspect-ratio-safe destination dimensions for complex regions.
 *
 * Complex regions keep explicit sourcePageNumber & sourceBox references so
 * the Prompt 5 PDF generator can render/crop them cleanly at high DPI.
 */

import type {
  BoundingBox,
  ConfidenceLevel,
  DocumentBlock,
  DocumentBlockType,
  LayoutSettings,
  LayoutWarning,
  PreservationReason,
  TextMeasurer,
} from './types'
import { reflowTextBlock, type ReflowedBlockPlan } from './text-reflower'

// ─── Spatial & Equation Complexity Constants ──────────────────────────────────

/** Symbols/notation that typically involve stacked layouts, arrows, chemical reactions, or special font glyphs */
const SPATIAL_MATH_PATTERN =
  /[∑∫∂∇√∮∯∰⊕⊗→←↔⇌⇒⇐⇔↑↓×·÷∓°‰−≈≠≤≥≡∝∞α-ωΑ-Ω]|_\{|\^\{|\^[A-Za-z0-9\+\-]+|[¹²³⁰⁴⁵⁶⁷⁸⁹⁺⁻⁼₍₎⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌]|\[\s*[A-Z][a-z]?[\+\-]?\s*\]/i

/** Gap between a preserved region and its paired caption (pt) */
export const REGION_CAPTION_GAP_PT = 6

// ─── Plan Types ───────────────────────────────────────────────────────────────

export interface PreservedRegionPlan {
  sourceBlockId: string
  sourcePageNumber: number
  sourceBox: BoundingBox
  regionType: DocumentBlockType
  preservationReason: PreservationReason
  confidence: ConfidenceLevel
  destWidth: number
  destHeight: number
  scaleFactor: number
  needsScaling: boolean
  needsDedicatedPage: boolean
  isOversized: boolean
  legibilityWarning?: string
  fallbackText?: string
  spacingBefore: number
  spacingAfter: number
  warnings: LayoutWarning[]
}

export type PlannedPageItem =
  | { kind: 'reflow-text'; plan: ReflowedBlockPlan }
  | { kind: 'preserved-region'; plan: PreservedRegionPlan }
  | {
      kind: 'grouped-region-with-caption'
      groupId: string
      regionFirst: boolean
      regionPlan: PreservedRegionPlan
      captionPlan: ReflowedBlockPlan
    }

// ─── Equation Reflow vs. Preservation Decision ────────────────────────────────

function hasSpatialEquationComplexity(block: DocumentBlock, settings: LayoutSettings): boolean {
  if (block.associatedPaths.length > 0 || block.associatedImages.length > 0) {
    return true
  }
  if (block.lines.length > 1) {
    return true
  }
  if (block.box.height > settings.bodyFontSize * 1.85) {
    return true
  }
  // Check for sub/superscript baseline offsets among raw items inside the line
  for (const line of block.lines) {
    for (const item of line.items) {
      if (Math.abs(item.box.y - line.baselineY) > 1.0) {
        return true
      }
    }
  }
  if (SPATIAL_MATH_PATTERN.test(block.text)) {
    return true
  }
  if (block.text.trim().length === 0 || block.confidence === 'low') {
    return true
  }
  return false
}

// ─── Region Sizing Helper ─────────────────────────────────────────────────────

/**
 * Compute uniform scale factor and destination dimensions for a complex region
 * within `maxWidth × maxHeight`, preserving aspect ratio.
 */
export function computeRegionFit(
  block: DocumentBlock,
  maxWidth: number,
  maxHeight: number,
  settings: LayoutSettings,
  preservationReason: PreservationReason,
): PreservedRegionPlan {
  const { box: sourceBox, pageNumber: sourcePageNumber } = block
  const warnings: LayoutWarning[] = []

  const scaleW = maxWidth / sourceBox.width
  const scaleH = maxHeight / sourceBox.height
  const scaleFactor = Math.min(1.0, scaleW, scaleH)

  const destWidth = sourceBox.width * scaleFactor
  const destHeight = sourceBox.height * scaleFactor

  const isOversized = sourceBox.width > maxWidth || sourceBox.height > maxHeight
  const needsScaling = scaleFactor < 0.999
  const belowMinScale = scaleFactor < settings.minScaleRatio
  const needsDedicatedPage = belowMinScale || destHeight > maxHeight * 0.72

  let legibilityWarning: string | undefined
  if (belowMinScale) {
    const pct = Math.round(scaleFactor * 100)
    legibilityWarning = `Complex ${block.type} (${Math.round(sourceBox.width)}×${Math.round(sourceBox.height)}pt) scaled to ${pct}% to fit dedicated Kindle page — may appear dense without landscape view.`
    warnings.push({
      code: 'REGION_BELOW_MIN_LEGIBLE_SCALE',
      severity: 'warning',
      message: legibilityWarning,
      sourcePageNumber,
      sourceBlockId: block.id,
    })
  } else if (isOversized && scaleFactor < 0.75) {
    const pct = Math.round(scaleFactor * 100)
    legibilityWarning = `Oversized ${block.type} scaled to ${pct}% to preserve layout coherence.`
    warnings.push({
      code: 'OVERSIZED_REGION_SCALED',
      severity: 'warning',
      message: legibilityWarning,
      sourcePageNumber,
      sourceBlockId: block.id,
    })
  }

  return {
    sourceBlockId: block.id,
    sourcePageNumber,
    sourceBox: { ...sourceBox },
    regionType: block.type,
    preservationReason: belowMinScale ? 'oversized-dedicated-page' : preservationReason,
    confidence: block.confidence,
    destWidth,
    destHeight,
    scaleFactor,
    needsScaling,
    needsDedicatedPage,
    isOversized,
    legibilityWarning,
    fallbackText: block.text.trim().length > 0 ? block.text.trim() : undefined,
    spacingBefore: Math.max(4, settings.paragraphSpacing * 0.75),
    spacingAfter: Math.max(6, settings.paragraphSpacing),
    warnings,
  }
}

// ─── Single Block Planning ────────────────────────────────────────────────────

function hasValidSourceBox(box: BoundingBox): boolean {
  return (
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 0 &&
    box.height > 0
  )
}

export function planSingleBlock(
  block: DocumentBlock,
  contentWidth: number,
  contentHeight: number,
  settings: LayoutSettings,
  measurer: TextMeasurer,
): PlannedPageItem | null {
  // Suppress running headers/footers/page-numbers unless explicitly included
  if (block.type === 'header' || block.type === 'footer' || block.type === 'page-number') {
    if (!settings.includeRunningHeaders) {
      return null
    }
    const plan = reflowTextBlock(block, { availableWidth: contentWidth, settings, measurer })
    return plan.lines.length > 0 ? { kind: 'reflow-text', plan } : null
  }

  // Determine whether this block should be preserved as a region
  let preserveReason: PreservationReason | null = null

  switch (block.type) {
    case 'figure':
      if (settings.preserveFigures || block.associatedImages.length > 0) {
        preserveReason = 'figure-image'
      }
      break

    case 'table':
      if (settings.preserveTables) {
        preserveReason = 'table-structure'
      }
      break

    case 'equation':
      if (settings.preserveEquations && hasSpatialEquationComplexity(block, settings)) {
        preserveReason = 'equation-spatial'
      }
      break

    case 'unknown-complex':
      if (block.preserveAsImage || block.associatedPaths.length > 0 || block.associatedImages.length > 0) {
        preserveReason = 'low-confidence-complex'
      }
      break

    case 'callout':
      // Callouts with embedded figures/complex vector drawings stay regions; text callouts reflow with border
      if (block.associatedImages.length > 0) {
        preserveReason = 'low-confidence-complex'
      }
      break

    default:
      if (block.preserveAsImage && (block.associatedImages.length > 0 || block.associatedPaths.length > 0)) {
        preserveReason = 'low-confidence-complex'
      }
      break
  }

  if (preserveReason !== null) {
    if (!hasValidSourceBox(block.box)) {
      // Fall back to text if available rather than emitting invalid 0-sized region
      if (block.text.trim().length > 0) {
        const fallbackPlan = reflowTextBlock(block, {
          availableWidth: contentWidth,
          settings,
          measurer,
          roleOverride: 'fallback-text',
        })
        fallbackPlan.warnings.push({
          code: 'INVALID_SOURCE_REGION_BOX',
          severity: 'warning',
          message: `Complex block ${block.id} had invalid source dimensions; fell back to text.`,
          sourcePageNumber: block.pageNumber,
          sourceBlockId: block.id,
        })
        return fallbackPlan.lines.length > 0 ? { kind: 'reflow-text', plan: fallbackPlan } : null
      }
      return null
    }

    const regionPlan = computeRegionFit(block, contentWidth, contentHeight, settings, preserveReason)
    return { kind: 'preserved-region', plan: regionPlan }
  }

  // Reflowable block path (paragraph, heading, subheading, list, caption, code-block, text callout, simple equation)
  const textPlan = reflowTextBlock(block, { availableWidth: contentWidth, settings, measurer })
  if (block.type === 'table' && !settings.preserveTables) {
    textPlan.warnings.push({
      code: 'TABLE_REFLOWED_BY_SETTING',
      severity: 'warning',
      message: `Table ${block.id} was reflowed as text because preserveTables is disabled; tabular alignment may be lost.`,
      sourcePageNumber: block.pageNumber,
      sourceBlockId: block.id,
    })
  }
  return textPlan.lines.length > 0 ? { kind: 'reflow-text', plan: textPlan } : null
}

// ─── Page-Level Planning (with Figure/Table Caption Grouping) ──────────────────

function isCaptionableRegion(block: DocumentBlock): boolean {
  return block.type === 'figure' || block.type === 'table' || block.type === 'unknown-complex'
}

/**
 * Convert an ordered array of DocumentBlocks from one source page into
 * PlannedPageItems, keeping figures/tables paired with adjacent captions.
 */
export function planPageContent(
  blocks: DocumentBlock[],
  contentWidth: number,
  contentHeight: number,
  settings: LayoutSettings,
  measurer: TextMeasurer,
): PlannedPageItem[] {
  const ordered = [...blocks].sort((a, b) => a.readingOrder - b.readingOrder)
  const planned: PlannedPageItem[] = []
  let groupCounter = 0

  let i = 0
  while (i < ordered.length) {
    const cur = ordered[i]
    const next = i + 1 < ordered.length ? ordered[i + 1] : undefined

    // Case 1: [Figure/Table] immediately followed by [Caption]
    if (next && isCaptionableRegion(cur) && next.type === 'caption') {
      const regionItem = planSingleBlock(cur, contentWidth, contentHeight, settings, measurer)
      const captionItem = planSingleBlock(next, contentWidth, contentHeight, settings, measurer)

      if (regionItem?.kind === 'preserved-region' && captionItem?.kind === 'reflow-text') {
        const captionHeight = captionItem.plan.lines.reduce((s, l) => s + l.lineHeight, 0)
        // Re-fit region cleanly within (contentHeight - captionHeight - gap) so pair fits on one page
        const maxPairedH = contentHeight - captionHeight - REGION_CAPTION_GAP_PT
        const adjustedRegion =
          maxPairedH > 40 && regionItem.plan.destHeight > maxPairedH
            ? computeRegionFit(cur, contentWidth, maxPairedH, settings, regionItem.plan.preservationReason)
            : regionItem.plan

        planned.push({
          kind: 'grouped-region-with-caption',
          groupId: `grp_p${cur.pageNumber}_${groupCounter++}`,
          regionFirst: true,
          regionPlan: adjustedRegion,
          captionPlan: captionItem.plan,
        })
        i += 2
        continue
      }
    }

    // Case 2: [Caption] (e.g., "Table 1: ...") immediately followed by [Table/Figure]
    if (next && cur.type === 'caption' && isCaptionableRegion(next)) {
      const captionItem = planSingleBlock(cur, contentWidth, contentHeight, settings, measurer)
      const regionItem = planSingleBlock(next, contentWidth, contentHeight, settings, measurer)

      if (captionItem?.kind === 'reflow-text' && regionItem?.kind === 'preserved-region') {
        const captionHeight = captionItem.plan.lines.reduce((s, l) => s + l.lineHeight, 0)
        const maxPairedH = contentHeight - captionHeight - REGION_CAPTION_GAP_PT
        const adjustedRegion =
          maxPairedH > 40 && regionItem.plan.destHeight > maxPairedH
            ? computeRegionFit(next, contentWidth, maxPairedH, settings, regionItem.plan.preservationReason)
            : regionItem.plan

        planned.push({
          kind: 'grouped-region-with-caption',
          groupId: `grp_p${next.pageNumber}_${groupCounter++}`,
          regionFirst: false,
          regionPlan: adjustedRegion,
          captionPlan: captionItem.plan,
        })
        i += 2
        continue
      }
    }

    const single = planSingleBlock(cur, contentWidth, contentHeight, settings, measurer)
    if (single !== null) {
      planned.push(single)
    }
    i += 1
  }

  return planned
}

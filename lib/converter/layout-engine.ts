/**
 * KindleFlow — Kindle Page Layout Engine
 * Prompt 4: Transform AnalyzedDocument into a validated single-column Kindle layout.
 *
 * Places reflowed text elements and preserved complex regions top-to-bottom
 * inside configurable Kindle page geometry with orphan/widow control, heading
 * keep-with-next rules, figure-caption grouping, and dedicated pages for
 * oversized complex regions.
 */

import type {
  AnalyzedDocument,
  AnalyzedPage,
  BoundingBox,
  ExtractionProgressCallback,
  LayoutDocument,
  LayoutElement,
  LayoutPage,
  LayoutPreservedRegion,
  LayoutSettings,
  LayoutTextElement,
  LayoutWarning,
  TextMeasurer,
} from './types'
import { createFallbackTextMeasurer, reflowTextBlock, type ReflowedBlockPlan } from './text-reflower'
import {
  planPageContent,
  REGION_CAPTION_GAP_PT,
  type PlannedPageItem,
  type PreservedRegionPlan,
} from './region-preserver'
import { validateLayoutPages } from './layout-validator'

// ─── Default Configuration ────────────────────────────────────────────────────

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  pageWidth: 432,
  pageHeight: 576,
  margins: {
    top: 28,
    right: 26,
    bottom: 32,
    left: 26,
  },
  bodyFontSize: 11.5,
  headingFontSize: 16,
  subheadingFontSize: 13.5,
  captionFontSize: 9.5,
  codeFontSize: 9.5,
  lineSpacing: 1.45,
  paragraphSpacing: 8,
  headingSpacingBefore: 14,
  headingSpacingAfter: 6,
  listIndent: 16,
  calloutIndent: 12,
  preserveEquations: true,
  preserveTables: true,
  preserveFigures: true,
  includeRunningHeaders: false,
  minScaleRatio: 0.45,
  orphanMinLines: 2,
  widowMinLines: 2,
}

export type PartialLayoutSettings = Partial<Omit<LayoutSettings, 'margins'>> & {
  margins?: Partial<LayoutSettings['margins']>
}

/**
 * Merge partial settings cleanly onto DEFAULT_LAYOUT_SETTINGS without mutating inputs.
 */
export function resolveLayoutSettings(partial?: PartialLayoutSettings): LayoutSettings {
  if (!partial) {
    return {
      ...DEFAULT_LAYOUT_SETTINGS,
      margins: { ...DEFAULT_LAYOUT_SETTINGS.margins },
    }
  }
  return {
    ...DEFAULT_LAYOUT_SETTINGS,
    ...partial,
    margins: {
      ...DEFAULT_LAYOUT_SETTINGS.margins,
      ...(partial.margins ?? {}),
    },
  }
}

// ─── Layout Engine Options ────────────────────────────────────────────────────

export interface LayoutDocumentOptions {
  settings?: PartialLayoutSettings
  measurer?: TextMeasurer
  onProgress?: ExtractionProgressCallback
  abortSignal?: AbortSignal
}

// ─── Page Builder State ───────────────────────────────────────────────────────

interface ActivePageState {
  pageNumber: number
  width: number
  height: number
  contentArea: BoundingBox
  elements: LayoutElement[]
  cursorY: number
  lastSpacingAfter: number
  isDedicatedPage: boolean
  sourcePageSet: Set<number>
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

/**
 * Generate a Kindle-sized LayoutDocument from an AnalyzedDocument.
 * Does NOT mutate the input AnalyzedDocument.
 */
export function generateKindleLayout(
  analyzed: AnalyzedDocument,
  options: LayoutDocumentOptions = {},
): LayoutDocument {
  const { onProgress, abortSignal } = options
  const settings = resolveLayoutSettings(options.settings)
  const measurer = options.measurer ?? createFallbackTextMeasurer()

  const contentArea: BoundingBox = {
    x: settings.margins.left,
    y: settings.margins.top,
    width: settings.pageWidth - settings.margins.left - settings.margins.right,
    height: settings.pageHeight - settings.margins.top - settings.margins.bottom,
  }

  const engineWarnings: LayoutWarning[] = []
  const pages: LayoutPage[] = []

  // Guard against unusable target geometry before entering layout loop
  if (
    !Number.isFinite(settings.pageWidth) ||
    !Number.isFinite(settings.pageHeight) ||
    settings.pageWidth <= 0 ||
    settings.pageHeight <= 0 ||
    contentArea.width <= 0 ||
    contentArea.height <= 0
  ) {
    engineWarnings.push({
      code: 'INVALID_TARGET_DIMENSIONS',
      severity: 'error',
      message: `Invalid Kindle target geometry (${settings.pageWidth}×${settings.pageHeight}pt, usable ${contentArea.width}×${contentArea.height}pt).`,
    })
    return {
      fileName: analyzed.fileName,
      settings,
      pageCount: 0,
      pages: [],
      warnings: engineWarnings,
      validation: { isValid: false, errors: [...engineWarnings], warnings: [] },
      sourcePageCount: analyzed.pageCount,
      stats: { totalElements: 0, reflowedTextElements: 0, preservedRegions: 0, dedicatedPages: 0 },
      createdAt: new Date().toISOString(),
    }
  }

  onProgress?.({
    phase: 'layout',
    currentPage: 0,
    totalPages: analyzed.pageCount,
    message: 'Starting Kindle page layout and text reflow...',
    percent: 0,
  })

  let elementCounter = 0
  let readingOrderCounter = 0
  let pendingDedicatedBreak = false
  let activePage: ActivePageState | null = null

  const createEmptyPage = (isDedicated: boolean): ActivePageState => ({
    pageNumber: pages.length + 1,
    width: settings.pageWidth,
    height: settings.pageHeight,
    contentArea: { ...contentArea },
    elements: [],
    cursorY: contentArea.y,
    lastSpacingAfter: 0,
    isDedicatedPage: isDedicated,
    sourcePageSet: new Set<number>(),
  })

  const finalizeActivePage = (): void => {
    if (!activePage || activePage.elements.length === 0) {
      activePage = null
      return
    }
    const usedHeight = Math.max(0, activePage.cursorY - contentArea.y)
    pages.push({
      pageNumber: activePage.pageNumber,
      width: activePage.width,
      height: activePage.height,
      contentArea: activePage.contentArea,
      elements: activePage.elements,
      usedHeight,
      remainingHeight: Math.max(0, contentArea.height - usedHeight),
      isDedicatedPage: activePage.isDedicatedPage,
      sourcePages: Array.from(activePage.sourcePageSet).sort((a, b) => a - b),
    })
    activePage = null
  }

  const ensurePage = (isDedicated = false): ActivePageState => {
    if (pendingDedicatedBreak) {
      finalizeActivePage()
      pendingDedicatedBreak = false
    }
    if (!activePage) {
      activePage = createEmptyPage(isDedicated)
    } else if (isDedicated && activePage.elements.length === 0) {
      activePage.isDedicatedPage = true
    } else if (isDedicated && activePage.elements.length > 0) {
      finalizeActivePage()
      activePage = createEmptyPage(true)
    }
    return activePage
  }

  const startNewNormalPage = (): ActivePageState => {
    finalizeActivePage()
    pendingDedicatedBreak = false
    activePage = createEmptyPage(false)
    return activePage
  }

  const bottomLimit = contentArea.y + contentArea.height

  const effectiveGapBefore = (page: ActivePageState, spacingBefore: number): number => {
    if (page.elements.length === 0) return 0
    return Math.max(page.lastSpacingAfter, spacingBefore)
  }

  const remainingOn = (page: ActivePageState): number => {
    return Math.max(0, bottomLimit - page.cursorY)
  }

  const placeTextPlan = (
    plan: ReflowedBlockPlan,
    groupId?: string,
    overrideTopGap?: number,
  ): void => {
    engineWarnings.push(...plan.warnings)
    if (plan.lines.length === 0) return

    let lineIdx = 0
    let isFirstChunkOfBlock = true

    while (lineIdx < plan.lines.length) {
      const page = ensurePage(false)
      const gapBefore = isFirstChunkOfBlock
        ? overrideTopGap !== undefined
          ? page.elements.length > 0
            ? overrideTopGap
            : 0
          : effectiveGapBefore(page, plan.spacingBefore)
        : 0

      const avail = remainingOn(page) - gapBefore
      const remainingLines = plan.lines.slice(lineIdx)

      // Count how many consecutive remaining lines fit inside avail
      let fitCount = 0
      let accH = 0
      for (let k = 0; k < remainingLines.length; k++) {
        const lh = remainingLines[k].lineHeight
        if (accH + lh <= avail + 0.01) {
          accH += lh
          fitCount++
        } else {
          break
        }
      }

      if (fitCount === 0) {
        if (page.elements.length > 0) {
          startNewNormalPage()
          continue
        }
        // Even on an empty page the line exceeds contentHeight — force 1 line & emit error
        fitCount = 1
        engineWarnings.push({
          code: 'LINE_EXCEEDS_PAGE_HEIGHT',
          severity: 'error',
          message: `Line height (${remainingLines[0].lineHeight.toFixed(1)}pt) exceeds usable page height (${contentArea.height.toFixed(1)}pt).`,
          pageNumber: page.pageNumber,
          sourcePageNumber: plan.sourcePageNumber,
          sourceBlockId: plan.sourceBlockId,
        })
      }

      // Split decision when only part of the block fits
      if (fitCount < remainingLines.length && page.elements.length > 0) {
        const remainingBlockHeight = remainingLines.reduce((s, l) => s + l.lineHeight, 0)

        // Keep entire short/atomic block together when it fits on a fresh page
        if (plan.keepTogether && remainingBlockHeight <= contentArea.height + 0.01) {
          startNewNormalPage()
          continue
        }

        // Orphan check: don't strand fewer than orphanMinLines at bottom if fresh page helps
        if (fitCount < settings.orphanMinLines && (remainingBlockHeight <= contentArea.height || remainingLines.length >= settings.orphanMinLines)) {
          startNewNormalPage()
          continue
        }

        // Widow check: avoid leaving a single orphan line on the next page
        const linesLeftNextPage = remainingLines.length - fitCount
        if (linesLeftNextPage < settings.widowMinLines) {
          const adjustedFit = remainingLines.length - settings.widowMinLines
          if (adjustedFit >= settings.orphanMinLines) {
            fitCount = adjustedFit
          } else if (remainingBlockHeight <= contentArea.height + 0.01) {
            startNewNormalPage()
            continue
          }
        }
      }

      let y = page.cursorY + gapBefore
      for (let k = 0; k < fitCount; k++) {
        const linePlan = remainingLines[k]
        const maxLineW = Math.max(1, contentArea.width - linePlan.indent)
        const lineW = Math.min(maxLineW, Math.max(1, linePlan.measuredWidth))
        const x =
          linePlan.align === 'center'
            ? contentArea.x + Math.max(0, (contentArea.width - lineW) / 2)
            : contentArea.x + linePlan.indent

        const el: LayoutTextElement = {
          id: `el_${++elementCounter}`,
          kind: 'text',
          pageNumber: page.pageNumber,
          box: {
            x,
            y,
            width: lineW,
            height: linePlan.lineHeight,
          },
          readingOrder: readingOrderCounter++,
          sourceBlockId: plan.sourceBlockId,
          sourcePageNumber: plan.sourcePageNumber,
          sourceBox: plan.sourceBox,
          groupId,
          role: linePlan.role,
          text: linePlan.text,
          font: linePlan.font,
          align: linePlan.align,
          lineHeight: linePlan.lineHeight,
          indent: linePlan.indent,
          preserveWhitespace: linePlan.preserveWhitespace,
          calloutBorder: linePlan.calloutBorder,
          spans: linePlan.spans,
        }

        page.elements.push(el)
        page.sourcePageSet.add(plan.sourcePageNumber)
        y += linePlan.lineHeight
      }

      page.cursorY = y
      lineIdx += fitCount
      isFirstChunkOfBlock = false

      if (lineIdx < plan.lines.length) {
        startNewNormalPage()
      } else {
        page.lastSpacingAfter = plan.spacingAfter
      }
    }
  }

  const placeRegionPlan = (
    plan: PreservedRegionPlan,
    options: {
      forceDedicated?: boolean
      groupId?: string
      centerVerticallyIfAlone?: boolean
    } = {},
  ): void => {
    engineWarnings.push(...plan.warnings)

    const useDedicated = options.forceDedicated ?? plan.needsDedicatedPage
    let page: ActivePageState
    let y: number

    if (useDedicated) {
      page = ensurePage(true)
      const spareV = Math.max(0, contentArea.height - plan.destHeight)
      y = options.centerVerticallyIfAlone !== false ? contentArea.y + spareV / 2 : contentArea.y
    } else {
      page = ensurePage(false)
      const gap = effectiveGapBefore(page, plan.spacingBefore)
      if (gap + plan.destHeight > remainingOn(page) && page.elements.length > 0) {
        page = startNewNormalPage()
      }
      y = page.cursorY + (page.elements.length > 0 ? effectiveGapBefore(page, plan.spacingBefore) : 0)
    }

    const x = contentArea.x + Math.max(0, (contentArea.width - plan.destWidth) / 2)
    const regionEl: LayoutPreservedRegion = {
      id: `el_${++elementCounter}`,
      kind: 'preserved-region',
      pageNumber: page.pageNumber,
      box: {
        x,
        y,
        width: plan.destWidth,
        height: plan.destHeight,
      },
      readingOrder: readingOrderCounter++,
      sourceBlockId: plan.sourceBlockId,
      sourcePageNumber: plan.sourcePageNumber,
      sourceBox: plan.sourceBox,
      groupId: options.groupId,
      regionType: plan.regionType,
      preservationReason: plan.preservationReason,
      confidence: plan.confidence,
      scaleFactor: plan.scaleFactor,
      needsScaling: plan.needsScaling,
      needsDedicatedPage: plan.needsDedicatedPage,
      isOversized: plan.isOversized,
      legibilityWarning: plan.legibilityWarning,
      fallbackText: plan.fallbackText,
    }

    page.elements.push(regionEl)
    page.sourcePageSet.add(plan.sourcePageNumber)
    page.cursorY = y + plan.destHeight
    page.lastSpacingAfter = plan.spacingAfter

    if (useDedicated && options.centerVerticallyIfAlone !== false) {
      pendingDedicatedBreak = true
    }
  }

  const estimateNextMinHeight = (item: PlannedPageItem | undefined): number => {
    if (!item) return 0
    if (item.kind === 'reflow-text') {
      if (item.plan.lines.length === 0) return 0
      const linesNeeded = Math.min(settings.orphanMinLines, item.plan.lines.length)
      return item.plan.lines.slice(0, linesNeeded).reduce((s, l) => s + l.lineHeight, 0)
    }
    if (item.kind === 'preserved-region') {
      if (item.plan.needsDedicatedPage) return 0
      return Math.min(item.plan.destHeight, contentArea.height * 0.45)
    }
    if (item.regionPlan.needsDedicatedPage) return 0
    const capH = item.captionPlan.lines.reduce((s, l) => s + l.lineHeight, 0)
    return Math.min(item.regionPlan.destHeight + REGION_CAPTION_GAP_PT + capH, contentArea.height * 0.5)
  }

  // ─── Flatten / Plan Source Pages In Order ─────────────────────────────────

  const allPlannedItems: PlannedPageItem[] = []

  for (let i = 0; i < analyzed.pages.length; i++) {
    if (abortSignal?.aborted) {
      throw new Error('Layout was cancelled by user.')
    }

    const srcPage: AnalyzedPage = analyzed.pages[i]
    onProgress?.({
      phase: 'layout',
      currentPage: srcPage.pageNumber,
      totalPages: analyzed.pageCount,
      message: `Laying out source page ${srcPage.pageNumber} of ${analyzed.pageCount}...`,
      percent: Math.round(((i + 1) / Math.max(1, analyzed.pageCount)) * 80),
    })

    try {
      const pageItems = planPageContent(
        srcPage.blocks,
        contentArea.width,
        contentArea.height,
        settings,
        measurer,
      )
      allPlannedItems.push(...pageItems)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      engineWarnings.push({
        code: 'PAGE_LAYOUT_FALLBACK',
        severity: 'error',
        message: `Layout error on source page ${srcPage.pageNumber}: ${msg}. Falling back to plain text blocks.`,
        sourcePageNumber: srcPage.pageNumber,
      })

      for (const block of srcPage.blocks) {
        if (block.text.trim().length > 0) {
          const fallbackPlan = reflowTextBlock(block, {
            availableWidth: contentArea.width,
            settings,
            measurer,
            roleOverride: 'fallback-text',
          })
          if (fallbackPlan.lines.length > 0) {
            allPlannedItems.push({ kind: 'reflow-text', plan: fallbackPlan })
          }
        }
      }
    }
  }

  // ─── Sequential Destination Placement ─────────────────────────────────────

  for (let idx = 0; idx < allPlannedItems.length; idx++) {
    if (abortSignal?.aborted) {
      throw new Error('Layout was cancelled by user.')
    }

    const item = allPlannedItems[idx]
    const nextItem = idx + 1 < allPlannedItems.length ? allPlannedItems[idx + 1] : undefined

    if (item.kind === 'reflow-text') {
      const { plan } = item

      // Heading keep-with-next look-ahead: avoid stranding a heading alone at bottom
      if (plan.keepWithNext && nextItem) {
        const page = ensurePage(false)
        if (page.elements.length > 0) {
          const headingH = plan.lines.reduce((s, l) => s + l.lineHeight, 0)
          const gapBefore = effectiveGapBefore(page, plan.spacingBefore)
          const nextMinH = estimateNextMinHeight(nextItem)
          const combinedNeeded = gapBefore + headingH + plan.spacingAfter + nextMinH
          const freshNeeded = headingH + plan.spacingAfter + nextMinH

          if (combinedNeeded > remainingOn(page) && freshNeeded <= contentArea.height + 0.01) {
            startNewNormalPage()
          }
        }
      }

      placeTextPlan(plan)
    } else if (item.kind === 'preserved-region') {
      placeRegionPlan(item.plan)
    } else {
      // Grouped region + caption: keep together on the same destination page
      const { groupId, regionFirst, regionPlan, captionPlan } = item
      const captionH = captionPlan.lines.reduce((s, l) => s + l.lineHeight, 0)
      const combinedH = regionPlan.destHeight + REGION_CAPTION_GAP_PT + captionH

      if (regionPlan.needsDedicatedPage) {
        if (combinedH <= contentArea.height + 0.01) {
          // Place both on one dedicated page together
          const page = ensurePage(true)
          const spareV = Math.max(0, contentArea.height - combinedH)
          // Center combined figure+caption vertically with modest upper bias
          page.cursorY = contentArea.y + Math.min(spareV * 0.35, 36)

          if (regionFirst) {
            placeRegionPlan(regionPlan, {
              forceDedicated: false, // already on dedicated page
              groupId,
              centerVerticallyIfAlone: false,
            })
            placeTextPlan(captionPlan, groupId, REGION_CAPTION_GAP_PT)
          } else {
            placeTextPlan(captionPlan, groupId, 0)
            // Adjust cursor slightly before region
            placeRegionPlan(
              { ...regionPlan, spacingBefore: REGION_CAPTION_GAP_PT },
              {
                forceDedicated: false,
                groupId,
                centerVerticallyIfAlone: false,
              },
            )
          }
          pendingDedicatedBreak = true
        } else {
          // Separate dedicated page for region, caption immediately follows
          if (regionFirst) {
            placeRegionPlan(regionPlan, { forceDedicated: true, groupId })
            placeTextPlan(captionPlan, groupId)
          } else {
            placeTextPlan(captionPlan, groupId)
            placeRegionPlan(regionPlan, { forceDedicated: true, groupId })
          }
        }
      } else {
        const page = ensurePage(false)
        const topGap = regionFirst
          ? effectiveGapBefore(page, regionPlan.spacingBefore)
          : effectiveGapBefore(page, captionPlan.spacingBefore)

        if (
          topGap + combinedH > remainingOn(page) &&
          combinedH <= contentArea.height + 0.01 &&
          page.elements.length > 0
        ) {
          startNewNormalPage()
        }

        if (regionFirst) {
          placeRegionPlan(regionPlan, { forceDedicated: false, groupId })
          placeTextPlan(captionPlan, groupId, REGION_CAPTION_GAP_PT)
        } else {
          placeTextPlan(captionPlan, groupId)
          placeRegionPlan(
            { ...regionPlan, spacingBefore: REGION_CAPTION_GAP_PT },
            { forceDedicated: false, groupId },
          )
        }
      }
    }
  }

  finalizeActivePage()

  // ─── Layout Validation ────────────────────────────────────────────────────

  onProgress?.({
    phase: 'layout',
    currentPage: analyzed.pageCount,
    totalPages: analyzed.pageCount,
    message: 'Validating Kindle page layout...',
    percent: 95,
  })

  const validation = validateLayoutPages(pages)

  // Merge non-duplicate warnings from engine + validator
  const combinedWarnings: LayoutWarning[] = [
    ...engineWarnings,
    ...validation.errors,
    ...validation.warnings,
  ]

  let reflowedTextElements = 0
  let preservedRegions = 0
  let dedicatedPages = 0

  for (const p of pages) {
    if (p.isDedicatedPage) dedicatedPages++
    for (const el of p.elements) {
      if (el.kind === 'text') reflowedTextElements++
      else preservedRegions++
    }
  }

  onProgress?.({
    phase: 'layout',
    currentPage: analyzed.pageCount,
    totalPages: analyzed.pageCount,
    message: `Layout complete: ${pages.length} Kindle pages generated.`,
    percent: 100,
  })

  return {
    fileName: analyzed.fileName,
    settings,
    pageCount: pages.length,
    pages,
    warnings: combinedWarnings,
    validation,
    sourcePageCount: analyzed.pageCount,
    stats: {
      totalElements: reflowedTextElements + preservedRegions,
      reflowedTextElements,
      preservedRegions,
      dedicatedPages,
    },
    createdAt: new Date().toISOString(),
  }
}

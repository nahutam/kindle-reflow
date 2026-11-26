/**
 * KindleFlow Converter — Pipeline Coordinator
 * Updated: Prompt 3 (Document Structure Analysis & Reading-Order Reconstruction)
 *
 * Coordinates validation, local PDF loading, geometric text extraction,
 * graphical evidence compilation, structural analysis, and resource cleanup.
 */

import { getLocalPDFJS } from './worker-loader'
import { validatePDF } from './validator'
import { extractPageData } from './extractor'
import { reconstructLines } from './line-reconstructor'
import { analyzePageStructure, detectRunningElements } from './structure-analyzer'
import { determineReadingOrder } from './reading-order'
import { reconstructParagraphs, estimateBodyFontSize } from './paragraph-reconstructor'
import { classifyBlocks } from './classifier'
import {
  generateKindleLayout,
  type LayoutDocumentOptions,
  type PartialLayoutSettings,
} from './layout-engine'
import {
  generateNotesPDF,
  createJsPDFTextMeasurer,
  buildOutputFileName,
  type GenerateNotesPDFOptions,
} from './pdf-generator'
import {
  convertSlidesToPDF,
  resolveSlideSettings,
  computeSlideDestinationBox,
  detectSafeMarginsFromPixels,
  KINDLE_SLIDE_DISPLAY_LANDSCAPE,
  KINDLE_SLIDE_DISPLAY_PORTRAIT,
  DEFAULT_SLIDE_SETTINGS,
  type ConvertSlidesOptions,
  type PartialSlideSettings,
  type SlidePageRasterizer,
} from './slide-converter'
import type {
  DocumentExtractionResult,
  ExtractedPage,
  ExtractionProgressCallback,
  ValidationResult,
  AnalyzedDocument,
  AnalyzedPage,
  DocumentBlock,
  TextLine,
  LayoutDocument,
  ConversionExportResult,
  ConversionMode,
} from './types'

export * from './types'
export { getLocalPDFJS } from './worker-loader'
export { validatePDF } from './validator'
export { extractPageData } from './extractor'
export { reconstructLines } from './line-reconstructor'
export { analyzePageStructure, detectRunningElements } from './structure-analyzer'
export { determineReadingOrder } from './reading-order'
export { reconstructParagraphs, estimateBodyFontSize } from './paragraph-reconstructor'
export { classifyBlocks } from './classifier'
export { createFallbackTextMeasurer, wrapTextToWidth, reflowTextBlock } from './text-reflower'
export { computeRegionFit, planPageContent, REGION_CAPTION_GAP_PT } from './region-preserver'
export { validateLayoutPages, validateLayoutDocument } from './layout-validator'
export {
  DEFAULT_LAYOUT_SETTINGS,
  resolveLayoutSettings,
  generateKindleLayout,
  type PartialLayoutSettings,
  type LayoutDocumentOptions,
} from './layout-engine'
export {
  generateNotesPDF,
  createJsPDFTextMeasurer,
  buildOutputFileName,
  type GenerateNotesPDFOptions,
} from './pdf-generator'
export {
  convertSlidesToPDF,
  resolveSlideSettings,
  computeSlideDestinationBox,
  detectSafeMarginsFromPixels,
  KINDLE_SLIDE_DISPLAY_LANDSCAPE,
  KINDLE_SLIDE_DISPLAY_PORTRAIT,
  DEFAULT_SLIDE_SETTINGS,
  type ConvertSlidesOptions,
  type PartialSlideSettings,
  type SlidePageRasterizer,
} from './slide-converter'

export interface ExtractDocumentOptions {
  fileName?: string
  onProgress?: ExtractionProgressCallback
  abortSignal?: AbortSignal
}

/**
 * Executes the complete validation and extraction pipeline on a PDF file.
 */
export async function extractDocument(
  input: Uint8Array | ArrayBuffer | File,
  options: ExtractDocumentOptions = {}
): Promise<DocumentExtractionResult> {
  const { fileName = 'document.pdf', onProgress, abortSignal } = options

  // Phase 1: Validation
  onProgress?.({
    phase: 'validating',
    message: 'Validating PDF integrity and structure...',
    percent: 10,
  })

  const validation: ValidationResult = await validatePDF(input, fileName)

  if (!validation.isValid) {
    const errorMsg = validation.errors[0]?.message || 'PDF validation failed.'
    onProgress?.({
      phase: 'error',
      message: errorMsg,
      percent: 100,
    })
    throw new Error(errorMsg)
  }

  if (abortSignal?.aborted) {
    throw new Error('Extraction was cancelled by user.')
  }

  // Phase 2: PDF Document Loading
  onProgress?.({
    phase: 'loading',
    message: 'Initializing local PDF engine...',
    percent: 25,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await getLocalPDFJS()

  let bytes: Uint8Array
  if (input instanceof Uint8Array) {
    bytes = input
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else if (typeof File !== 'undefined' && input instanceof File) {
    const buffer = await input.arrayBuffer()
    bytes = new Uint8Array(buffer)
  } else {
    const blob = input as Blob
    const buffer = await blob.arrayBuffer()
    bytes = new Uint8Array(buffer)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfDocument: any = null
  const pages: ExtractedPage[] = []
  const documentWarnings: string[] = [...validation.warnings]
  let totalTextItems = 0
  let totalCharacters = 0

  try {
    const loadingTask = pdfjs.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: true,
    })

    pdfDocument = await loadingTask.promise
    const totalPages = pdfDocument.numPages

    // Phase 3: Sequential Page Extraction
    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      if (abortSignal?.aborted) {
        throw new Error('Extraction was cancelled by user.')
      }

      const percent = Math.round(25 + ((pageNum - 1) / totalPages) * 70)
      onProgress?.({
        phase: 'extracting',
        currentPage: pageNum,
        totalPages,
        message: `Extracting text and graphics from page ${pageNum} of ${totalPages}...`,
        percent,
      })

      const page = await pdfDocument.getPage(pageNum)
      try {
        const extractedPage = await extractPageData(page, pageNum)
        pages.push(extractedPage)

        totalTextItems += extractedPage.metadata.textItemCount
        totalCharacters += extractedPage.metadata.characterCount

        if (extractedPage.warnings.length > 0) {
          documentWarnings.push(...extractedPage.warnings)
        }
      } finally {
        // Explicitly cleanup page resources
        page.cleanup()
      }
    }

    onProgress?.({
      phase: 'completed',
      message: `Extraction complete: processed ${totalPages} pages (${totalCharacters.toLocaleString()} characters).`,
      percent: 100,
    })

    return {
      fileName,
      fileSize: bytes.byteLength,
      pageCount: totalPages,
      validation,
      pages,
      totalTextItems,
      totalCharacters,
      warnings: documentWarnings,
      extractedAt: new Date().toISOString(),
    }
  } finally {
    // Phase 4: Document Resource Cleanup
    if (pdfDocument) {
      try {
        await pdfDocument.destroy()
      } catch {
        // Ignore destruction error
      }
    }
  }
}

// ─── Analysis Pipeline ────────────────────────────────────────────────────────

export interface AnalyzeDocumentOptions {
  onProgress?: ExtractionProgressCallback
  abortSignal?: AbortSignal
}

/**
 * Run the structural analysis pipeline on a DocumentExtractionResult.
 *
 * Transforms raw extraction data into an AnalyzedDocument with:
 *  - Column layout detection per page
 *  - Text line reconstruction
 *  - Reading order assignment
 *  - Paragraph and heading grouping
 *  - Equation, table, figure, callout classification
 *  - Cross-page running header/footer detection
 *
 * Does NOT modify the input DocumentExtractionResult.
 */
export async function analyzeDocument(
  extraction: DocumentExtractionResult,
  options: AnalyzeDocumentOptions = {},
): Promise<AnalyzedDocument> {
  const { onProgress, abortSignal } = options
  const totalPages = extraction.pages.length
  const documentWarnings: string[] = []

  onProgress?.({
    phase: 'analyzing',
    currentPage: 0,
    totalPages,
    message: 'Starting document structure analysis...',
    percent: 0,
  })

  // --- Step 1: Detect running headers/footers across all pages ---
  const runningElements = detectRunningElements(extraction)

  // --- Step 2: Per-page analysis ---

  // First pass: collect all lines to estimate document body font size
  const allLinesForFontEstimation: TextLine[] = []
  const perPageStructures: Array<ReturnType<typeof analyzePageStructure>> = []

  for (const extractedPage of extraction.pages) {
    const structure = analyzePageStructure(extractedPage)
    perPageStructures.push(structure)

    const lines = reconstructLines(extractedPage.textItems, {
      columns: structure.columnLayout.columns,
    })
    allLinesForFontEstimation.push(...lines)
  }

  const documentBodyFontSize = estimateBodyFontSize(allLinesForFontEstimation)

  // Second pass: full analysis per page
  const analyzedPages: AnalyzedPage[] = []

  for (let i = 0; i < extraction.pages.length; i++) {
    if (abortSignal?.aborted) {
      throw new Error('Analysis was cancelled by user.')
    }

    const extractedPage = extraction.pages[i]
    const structure = perPageStructures[i]
    const pageNumber = extractedPage.pageNumber
    const pageWarnings: string[] = []

    const percent = Math.round(((i + 1) / totalPages) * 100)
    onProgress?.({
      phase: 'analyzing',
      currentPage: pageNumber,
      totalPages,
      message: `Analyzing structure of page ${pageNumber} of ${totalPages}...`,
      percent,
    })

    let isFallback = false
    let blocks: DocumentBlock[] = []

    try {
      // 2a. Reconstruct text lines
      const rawLines = reconstructLines(extractedPage.textItems, {
        columns: structure.columnLayout.columns,
      })

      // 2b. Assign reading order
      const orderedLines = determineReadingOrder(rawLines, structure.columnLayout)

      // 2c. Reconstruct paragraphs / text blocks
      const textBlocks = reconstructParagraphs(orderedLines, {
        bodyFontSize: documentBodyFontSize,
        pageNumber,
        bodyLeft: structure.columnLayout.columns[0]?.left ?? 0,
      })

      // 2d. Classify blocks
      blocks = classifyBlocks(textBlocks, {
        bodyFontSize: documentBodyFontSize,
        pageNumber,
        pageWidth: extractedPage.metadata.width,
        pageHeight: extractedPage.metadata.height,
        paths: extractedPage.paths,
        images: extractedPage.images,
        bodyLeft: structure.columnLayout.columns[0]?.left ?? 0,
        headerFooterInfo: {
          headerPageNumbers: runningElements.headerPageNumbers,
          footerPageNumbers: runningElements.footerPageNumbers,
          runningHeader: runningElements.runningHeader,
          runningFooter: runningElements.runningFooter,
        },
      })

      if (blocks.length === 0 && extractedPage.textItems.length > 0) {
        pageWarnings.push('Page has text items but produced no classified blocks')
      }
    } catch (err) {
      isFallback = true
      const msg = err instanceof Error ? err.message : String(err)
      pageWarnings.push(`Structure analysis failed for page ${pageNumber}: ${msg}`)
      documentWarnings.push(`Page ${pageNumber} analysis error: ${msg}`)
    }

    analyzedPages.push({
      pageNumber,
      metadata: extractedPage.metadata,
      columnLayout: structure.columnLayout,
      blocks,
      warnings: pageWarnings,
      isFallback,
    })
  }

  // --- Step 3: Cross-page paragraph continuation stitching ---
  for (let i = 0; i < analyzedPages.length - 1; i++) {
    const currentPage = analyzedPages[i]
    const nextPage = analyzedPages[i + 1]

    const currentContentBlocks = currentPage.blocks.filter(
      b => b.type !== 'header' && b.type !== 'footer' && b.type !== 'page-number',
    )
    if (currentContentBlocks.length === 0) continue
    const lastBlock = currentContentBlocks[currentContentBlocks.length - 1]

    const nextContentBlocks = nextPage.blocks.filter(
      b => b.type !== 'header' && b.type !== 'footer' && b.type !== 'page-number',
    )
    if (nextContentBlocks.length === 0) continue
    const firstBlock = nextContentBlocks[0]

    // Only stitch reflowable paragraphs that continue across page boundary
    if (lastBlock.type !== 'paragraph' || firstBlock.type !== 'paragraph') continue
    if (lastBlock.preserveAsImage || firstBlock.preserveAsImage) continue

    const lastText = lastBlock.text.trimEnd()
    const endsWithTerminal = /[.!?:]["']?$/.test(lastText)
    if (endsWithTerminal) continue

    const firstText = firstBlock.text.trimStart()
    const startsWithLowercase = /^[a-z]/.test(firstText)
    if (!startsWithLowercase) continue

    const lastFontSize = lastBlock.lines[lastBlock.lines.length - 1]?.dominantFont.size ?? documentBodyFontSize
    const firstFontSize = firstBlock.lines[0]?.dominantFont.size ?? documentBodyFontSize
    if (Math.abs(lastFontSize - firstFontSize) > 1.5) continue

    // Merge continuation into lastBlock
    if (lastText.endsWith('-')) {
      lastBlock.text = `${lastText.slice(0, -1)}${firstText}`
    } else {
      lastBlock.text = `${lastText} ${firstText}`
    }
    lastBlock.lines.push(...firstBlock.lines)
    lastBlock.textItemIds.push(...firstBlock.textItemIds)
    lastBlock.box = {
      x: Math.min(lastBlock.box.x, firstBlock.box.x),
      y: lastBlock.box.y,
      width: Math.max(lastBlock.box.width, firstBlock.box.width),
      height: lastBlock.box.height + firstBlock.box.height,
    }

    // Remove firstBlock from nextPage and re-index reading orders
    nextPage.blocks = nextPage.blocks.filter(b => b.id !== firstBlock.id)
    nextPage.blocks.forEach((b, idx) => {
      b.readingOrder = idx
    })
  }

  onProgress?.({
    phase: 'analyzing',
    currentPage: totalPages,
    totalPages,
    message: 'Document structure analysis complete.',
    percent: 100,
  })

  return {
    fileName: extraction.fileName,
    pageCount: extraction.pageCount,
    pages: analyzedPages,
    bodyFontSize: documentBodyFontSize,
    runningHeader: runningElements.runningHeader,
    runningFooter: runningElements.runningFooter,
    warnings: documentWarnings,
    analyzedAt: new Date().toISOString(),
  }
}

// ─── Layout Pipeline ──────────────────────────────────────────────────────────

/**
 * Transform an AnalyzedDocument into a validated, Kindle-sized LayoutDocument.
 *
 * Completes the Prompt 4 pipeline:
 *   extractDocument -> analyzeDocument -> layoutDocument
 *
 * Does NOT modify the input AnalyzedDocument.
 */
export async function layoutDocument(
  analyzed: AnalyzedDocument,
  options: LayoutDocumentOptions = {},
): Promise<LayoutDocument> {
  return generateKindleLayout(analyzed, options)
}

// ─── Dual-Mode Conversion Coordinators (Prompt 5) ─────────────────────────────

export interface ConvertNotesDocumentOptions {
  fileName?: string
  layoutSettings?: PartialLayoutSettings
  targetDpi?: number
  regionRenderer?: import('./types').RegionCropRenderer
  onProgress?: ExtractionProgressCallback
  abortSignal?: AbortSignal
}

/**
 * Execute MODE A — NOTES:
 *   extractDocument -> analyzeDocument -> layoutDocument -> generateNotesPDF
 *
 * Reflows ordinary text and preserves complex regions (equations, tables, figures).
 */
export async function convertNotesDocument(
  input: Uint8Array | ArrayBuffer | File,
  options: ConvertNotesDocumentOptions = {},
): Promise<ConversionExportResult> {
  const { fileName = 'notes.pdf', layoutSettings, targetDpi, regionRenderer, onProgress, abortSignal } =
    options

  let bytes: Uint8Array
  if (input instanceof Uint8Array) {
    bytes = input
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input)
  } else {
    const buf = await (input as File).arrayBuffer()
    bytes = new Uint8Array(buf)
  }

  // Phase 1: Extraction & Validation
  const extraction = await extractDocument(bytes, {
    fileName,
    onProgress,
    abortSignal,
  })

  // Phase 2: Structural Analysis
  const analyzed = await analyzeDocument(extraction, {
    onProgress,
    abortSignal,
  })

  // Phase 3: Layout Generation with live jsPDF measurement
  const measurer = createJsPDFTextMeasurer()
  const layout = await layoutDocument(analyzed, {
    settings: layoutSettings,
    measurer,
    onProgress,
    abortSignal,
  })

  // Phase 4: Final Selectable-Text PDF Generation
  return generateNotesPDF(layout, {
    sourcePdfBytes: bytes,
    targetDpi,
    regionRenderer,
    onProgress,
    abortSignal,
  })
}

export interface ConvertDocumentOptions {
  mode: ConversionMode
  fileName?: string
  notesSettings?: PartialLayoutSettings
  slideSettings?: PartialSlideSettings
  targetDpi?: number
  regionRenderer?: import('./types').RegionCropRenderer
  slideRasterizer?: SlidePageRasterizer
  onProgress?: ExtractionProgressCallback
  abortSignal?: AbortSignal
}

/**
 * Master dual-mode dispatcher:
 *   Calls either Mode A (Notes) or Mode B (Slides) based on user selection.
 */
export async function convertDocument(
  input: Uint8Array | ArrayBuffer | File,
  options: ConvertDocumentOptions,
): Promise<ConversionExportResult> {
  if (options.mode === 'slides') {
    return convertSlidesToPDF(input, {
      fileName: options.fileName,
      settings: options.slideSettings,
      pageRasterizer: options.slideRasterizer,
      onProgress: options.onProgress,
      abortSignal: options.abortSignal,
    })
  }

  return convertNotesDocument(input, {
    fileName: options.fileName,
    layoutSettings: options.notesSettings,
    targetDpi: options.targetDpi,
    regionRenderer: options.regionRenderer,
    onProgress: options.onProgress,
    abortSignal: options.abortSignal,
  })
}

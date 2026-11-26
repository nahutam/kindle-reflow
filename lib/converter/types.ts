/**
 * KindleFlow Converter — Core Types & Data Structures
 * Updated: Prompt 3 (Document Structure Analysis & Reading-Order Reconstruction)
 * Extends Prompt 2 types with structural analysis models.
 */

// ─── Extraction Layer Types (from Prompt 2 — unchanged) ───────────────────────

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FontInfo {
  name: string
  family: string
  size: number
  isBold: boolean
  isItalic: boolean
  isSerif?: boolean
  isMonospace?: boolean
}

export interface ExtractedTextItem {
  id: string
  pageNumber: number
  str: string
  dir: 'ltr' | 'rtl' | 'ttb' | 'btt'
  box: BoundingBox
  font: FontInfo
  transform: [number, number, number, number, number, number]
  hasEOL: boolean
  markedContent?: { tag?: string; id?: number }
}

export interface VectorPathEvidence {
  type: 'line' | 'rect' | 'curve' | 'path'
  box: BoundingBox
  lineWidth?: number
  strokeColor?: string
  fillColor?: string
  segmentCount: number
}

export interface ImageEvidence {
  id: string
  box: BoundingBox
  pixelWidth?: number
  pixelHeight?: number
  isInline: boolean
}

export interface PageGraphicsSummary {
  pathOperationsCount: number
  lineCount: number
  rectCount: number
  imageCount: number
  hasVectorGraphics: boolean
  hasImages: boolean
  limitations: string[]
}

export type PageContentClassification =
  | 'text-rich'
  | 'mixed'
  | 'low-text'
  | 'potentially-scanned'

export interface PageMetadata {
  pageNumber: number
  width: number
  height: number
  rotation: number
  textItemCount: number
  characterCount: number
  textDensity: number
  classification: PageContentClassification
  hasExtractableText: boolean
}

export interface ExtractedPage {
  pageNumber: number
  metadata: PageMetadata
  textItems: ExtractedTextItem[]
  paths: VectorPathEvidence[]
  images: ImageEvidence[]
  graphicsSummary: PageGraphicsSummary
  warnings: string[]
}

export interface ValidationError {
  code:
    | 'FILE_EMPTY'
    | 'FILE_TOO_LARGE'
    | 'INVALID_HEADER'
    | 'PASSWORD_PROTECTED'
    | 'CORRUPT_DOCUMENT'
    | 'PAGE_LOAD_ERROR'
    | 'WORKER_INIT_ERROR'
    | 'UNSUPPORTED_FORMAT'
  message: string
  details?: string
}

export interface ValidationResult {
  isValid: boolean
  fileSize: number
  fileName: string
  pageCount: number
  isEncrypted: boolean
  isScannedOnly: boolean
  errors: ValidationError[]
  warnings: string[]
  pageClassifications: { pageNumber: number; classification: PageContentClassification }[]
}

export interface DocumentExtractionResult {
  fileName: string
  fileSize: number
  pageCount: number
  validation: ValidationResult
  pages: ExtractedPage[]
  totalTextItems: number
  totalCharacters: number
  warnings: string[]
  extractedAt: string
}

export interface ExtractionProgress {
  phase:
    | 'validating'
    | 'loading'
    | 'extracting'
    | 'analyzing'
    | 'layout'
    | 'rendering'
    | 'exporting'
    | 'completed'
    | 'error'
  currentPage?: number
  totalPages?: number
  message: string
  percent: number
}

export type ExtractionProgressCallback = (progress: ExtractionProgress) => void

// ─── Structural Analysis Types (Prompt 3) ─────────────────────────────────────

/**
 * Confidence in a structural classification.
 * Reflects actual supporting evidence — not an arbitrary score.
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low'

/**
 * A reconstructed text line assembled from adjacent text items.
 */
export interface TextLine {
  /** Source text items in reading order */
  items: ExtractedTextItem[]
  /** Assembled text string (spaces preserved) */
  text: string
  /** Bounding box enclosing all items */
  box: BoundingBox
  /**
   * Baseline Y position in normalized top-left space.
   * Items on the same baseline share this value (within tolerance).
   */
  baselineY: number
  /** Dominant font on this line */
  dominantFont: FontInfo
  /** Whether the line ends with a hyphen that is likely a continuation break */
  endsWithSoftHyphen: boolean
  /** Reading order index within the column/page */
  readingOrder: number
  /** Column index this line belongs to (0-based; 0 for single-column or full-width) */
  columnIndex: number
}

/**
 * A logical paragraph or heading assembled from one or more TextLines.
 */
export interface TextBlock {
  /** Unique block ID within the page (e.g. "p1_b3") */
  id: string
  /** Assembled paragraph text with hyphenation resolved */
  text: string
  /** Individual lines in reading order */
  lines: TextLine[]
  /** Bounding box enclosing all lines */
  box: BoundingBox
  /** Dominant font statistics */
  dominantFont: FontInfo
  /** Average line height within the block */
  avgLineHeight: number
  /** Approximate spacing above this block from previous block */
  spacingBefore: number
  /**
   * Block type classification.
   * 'paragraph' | 'heading' | 'subheading' | 'list-item' | 'unknown'
   */
  blockType: 'paragraph' | 'heading' | 'subheading' | 'list-item' | 'unknown'
  /** Reading order index within the page */
  readingOrder: number
  /** Column index (0-based) */
  columnIndex: number
  /** Classification confidence */
  confidence: ConfidenceLevel
}

/**
 * Semantic type of a document region.
 */
export type DocumentBlockType =
  | 'paragraph'
  | 'heading'
  | 'subheading'
  | 'list'
  | 'equation'
  | 'table'
  | 'figure'
  | 'caption'
  | 'callout'
  | 'header'
  | 'footer'
  | 'page-number'
  | 'code-block'
  | 'unknown-complex'

/**
 * A unified document content block ready for the reflow/preservation engine.
 * This is the primary output of the structural analysis stage.
 */
export interface DocumentBlock {
  /** Unique block ID across document (e.g. "doc_p2_b7") */
  id: string
  /** 1-based page number */
  pageNumber: number
  /** Semantic content type */
  type: DocumentBlockType
  /** Bounding box in page coordinates */
  box: BoundingBox
  /**
   * Extracted, cleaned text content.
   * Present for text-based blocks; empty for pure-image figures.
   */
  text: string
  /**
   * Individual text lines for text-based blocks.
   * Retained for precise layout reconstruction.
   */
  lines: TextLine[]
  /** Source text items (references, not copies) */
  textItemIds: string[]
  /** Associated vector path evidence */
  associatedPaths: VectorPathEvidence[]
  /** Associated image evidence */
  associatedImages: ImageEvidence[]
  /** Reading order within the page */
  readingOrder: number
  /** Classification confidence */
  confidence: ConfidenceLevel
  /**
   * Whether this block should be preserved as an image region
   * rather than reflowed as text. Set to true for equations, figures,
   * and low-confidence complex regions.
   */
  preserveAsImage: boolean
  /**
   * Structured table model if this block is a table with identified grid/cells.
   */
  tableData?: StructuredTable
  /** Non-fatal structural warnings */
  warnings: string[]
}

/**
 * Structured cell representation within a table.
 */
export interface TableCell {
  rowIndex: number
  columnIndex: number
  text: string
  box?: BoundingBox
  isHeader?: boolean
}

/**
 * Structured table metadata preserving rows, columns, and cell associations.
 */
export interface StructuredTable {
  rowCount: number
  columnCount: number
  headers: string[]
  rows: string[][]
  cells: TableCell[]
  gridBox: BoundingBox
}

/**
 * Detected column layout for a page.
 */
export interface PageColumnLayout {
  /** Number of columns detected */
  columnCount: 1 | 2 | 3
  /**
   * Column regions — each has an x-range [left, right] in page points.
   * Full-width content spans the entire page width.
   */
  columns: Array<{ left: number; right: number }>
  /** Approximate gutter width between columns if multi-column */
  gutterWidth?: number
  /** Confidence in the column detection */
  confidence: ConfidenceLevel
  /** Evidence used for detection */
  evidence: string
}

/**
 * Fully analyzed representation of a single page.
 */
export interface AnalyzedPage {
  /** 1-based page number */
  pageNumber: number
  /** Original page metadata from extraction */
  metadata: PageMetadata
  /** Column layout detected for this page */
  columnLayout: PageColumnLayout
  /** Ordered document blocks in final reading order */
  blocks: DocumentBlock[]
  /** Structural analysis warnings */
  warnings: string[]
  /** Whether the page could not be reliably analyzed */
  isFallback: boolean
}

/**
 * Fully analyzed document ready for the reflow engine.
 */
export interface AnalyzedDocument {
  /** File name */
  fileName: string
  /** Total pages */
  pageCount: number
  /** Analyzed pages in order */
  pages: AnalyzedPage[]
  /**
   * Document-wide body font size (median across all text blocks).
   * Used to calibrate heading detection.
   */
  bodyFontSize: number
  /**
   * Detected running header text, if any (consistent across pages).
   */
  runningHeader?: string
  /**
   * Detected running footer pattern, if any.
   */
  runningFooter?: string
  /** Document-wide warnings */
  warnings: string[]
  /** Analysis timestamp (ISO 8601) */
  analyzedAt: string
}

// ─── Hybrid Reflow & Kindle Layout Types (Prompt 4) ───────────────────────────

/**
 * Font style descriptor used across reflow measurement and layout elements.
 * Decoupled from PDF.js and jsPDF font internals.
 */
export interface FontStyleSpec {
  family: 'sans' | 'serif' | 'mono'
  size: number
  weight: 'normal' | 'bold'
  style: 'normal' | 'italic'
}

/**
 * Text-width measurement abstraction.
 * Allows deterministic fallback measurement in tests and exact font metrics
 * from jsPDF/canvas to be injected during PDF generation.
 */
export interface TextMeasurer {
  measureWidth(text: string, font: FontStyleSpec): number
  measureLineHeight?(font: FontStyleSpec, lineSpacing: number): number
}

/**
 * Configurable settings controlling Kindle target geometry and reflow behavior.
 */
export interface LayoutSettings {
  pageWidth: number
  pageHeight: number
  margins: {
    top: number
    right: number
    bottom: number
    left: number
  }
  bodyFontSize: number
  headingFontSize: number
  subheadingFontSize: number
  captionFontSize: number
  codeFontSize: number
  /** Line-height multiplier relative to font size (e.g., 1.45) */
  lineSpacing: number
  paragraphSpacing: number
  headingSpacingBefore: number
  headingSpacingAfter: number
  listIndent: number
  calloutIndent: number
  preserveEquations: boolean
  preserveTables: boolean
  preserveFigures: boolean
  /** Whether running headers/footers/page numbers should be emitted (default false) */
  includeRunningHeaders: boolean
  /**
   * Minimum comfortable scale ratio (destinationWidth / sourceWidth) before
   * allocating a dedicated page / emitting a legibility warning.
   */
  minScaleRatio: number
  /** Minimum trailing lines of a paragraph/heading group before a page break */
  orphanMinLines: number
  /** Minimum leading lines on the next page when splitting a paragraph */
  widowMinLines: number
}

/**
 * Common fields shared by all placed destination elements.
 */
export interface LayoutElementBase {
  id: string
  kind: 'text' | 'preserved-region'
  /** 1-based destination page number */
  pageNumber: number
  /** Destination rectangle in page points (top-left origin) */
  box: BoundingBox
  readingOrder: number
  sourceBlockId: string
  sourcePageNumber: number
  sourceBox?: BoundingBox
  /**
   * Optional grouping ID linking intentionally co-located elements
   * (e.g., a figure or table paired with its caption).
   */
  groupId?: string
}

export type LayoutTextRole =
  | 'paragraph'
  | 'heading'
  | 'subheading'
  | 'list-item'
  | 'caption'
  | 'callout'
  | 'code-line'
  | 'equation-text'
  | 'fallback-text'

/**
 * A formatted sub-segment of a text line (for mixed bold/italic emphasis).
 */
export interface TextSpan {
  text: string
  font: FontStyleSpec
}

/**
 * A single reflowed text line positioned on a destination page.
 */
export interface LayoutTextElement extends LayoutElementBase {
  kind: 'text'
  role: LayoutTextRole
  text: string
  font: FontStyleSpec
  align: 'left' | 'center' | 'right'
  lineHeight: number
  indent: number
  preserveWhitespace?: boolean
  calloutBorder?: boolean
  spans?: TextSpan[]
}

export type PreservationReason =
  | 'equation-spatial'
  | 'table-structure'
  | 'figure-image'
  | 'user-setting'
  | 'low-confidence-complex'
  | 'oversized-dedicated-page'

/**
 * A complex document region (equation, table, figure, etc.) preserved
 * with explicit source geometry for later high-DPI cropping & placement.
 */
export interface LayoutPreservedRegion extends LayoutElementBase {
  kind: 'preserved-region'
  sourcePageNumber: number
  sourceBox: BoundingBox
  regionType: DocumentBlockType
  preservationReason: PreservationReason
  confidence: ConfidenceLevel
  /** Applied uniform scale factor (destWidth / sourceBox.width) */
  scaleFactor: number
  needsScaling: boolean
  needsDedicatedPage: boolean
  isOversized: boolean
  legibilityWarning?: string
  /** Optional text preserved from source block for accessibility or fallback */
  fallbackText?: string
}

export type LayoutElement = LayoutTextElement | LayoutPreservedRegion

/**
 * Structural validation or legibility issue detected during layout or validation.
 */
export interface LayoutWarning {
  code: string
  severity: 'error' | 'warning'
  message: string
  pageNumber?: number
  elementId?: string
  sourcePageNumber?: number
  sourceBlockId?: string
}

/**
 * A single destination page in the Kindle layout.
 */
export interface LayoutPage {
  /** 1-based destination page number */
  pageNumber: number
  width: number
  height: number
  /** Usable area inside margins */
  contentArea: BoundingBox
  elements: LayoutElement[]
  usedHeight: number
  remainingHeight: number
  isDedicatedPage: boolean
  /** Distinct 1-based source page numbers contributing to this destination page */
  sourcePages: number[]
}

export interface LayoutValidationReport {
  isValid: boolean
  errors: LayoutWarning[]
  warnings: LayoutWarning[]
}

/**
 * Complete destination layout produced by layoutDocument(), ready for PDF rendering.
 */
export interface LayoutDocument {
  fileName: string
  settings: LayoutSettings
  pageCount: number
  pages: LayoutPage[]
  warnings: LayoutWarning[]
  validation: LayoutValidationReport
  sourcePageCount: number
  stats: {
    totalElements: number
    reflowedTextElements: number
    preservedRegions: number
    dedicatedPages: number
  }
  createdAt: string
}

// ─── Dual-Mode PDF Generation & Export Types (Prompt 5) ───────────────────────

/**
 * User-selected conversion pipeline mode.
 *  - 'notes'  : Hybrid text reflow + complex region preservation
 *  - 'slides' : High-resolution slide / diagram enlargement without text reflow
 */
export type ConversionMode = 'notes' | 'slides'

/**
 * Fitting strategy for Slides / Image Enlargement mode.
 *  - 'original-proportions' : Scale & center entire original page (zero cropping)
 *  - 'smart-margin'         : Trim confirmed empty outer margins, then scale & center
 */
export type SlideFittingStrategy = 'original-proportions' | 'smart-margin'

export type SlideOrientation = 'landscape' | 'portrait'

export interface SlideDisplayProfile {
  name: string
  /** Target width in points (landscape 4:3 default: 576 pt) */
  widthPt: number
  /** Target height in points (landscape 4:3 default: 432 pt) */
  heightPt: number
  /** Outer safety padding in points */
  paddingPt: number
}

export interface SlideConverterSettings {
  fittingStrategy: SlideFittingStrategy
  orientation: SlideOrientation
  displayProfile: SlideDisplayProfile
  /** Target rendering DPI for slide vector/bitmap rasterization (200–400) */
  targetDpi: number
  /** Image encoding passed to jsPDF (PNG recommended for sharp diagrams/text) */
  imageFormat: 'PNG' | 'JPEG'
}

export interface SafeMarginCropBox {
  /** Crop box in source page points (top-left origin) */
  x: number
  y: number
  width: number
  height: number
  /** True if margin detection was uncertain and fell back to full page bounds */
  usedFallback: boolean
  reason: string
}

export interface SlidePageResult {
  sourcePageNumber: number
  outputPageNumber: number
  sourceWidthPt: number
  sourceHeightPt: number
  cropBoxPt: BoundingBox
  destBoxPt: BoundingBox
  scaleFactor: number
  usedFallbackMargins: boolean
  lowResImageDetected: boolean
  warnings: string[]
}

/**
 * Rendered image payload for a cropped region or slide page.
 */
export interface RasterImagePayload {
  /** Data URL or base64/binary PNG/JPEG payload accepted by jsPDF.addImage */
  data: string | Uint8Array
  format: 'PNG' | 'JPEG'
  pixelWidth: number
  pixelHeight: number
}

/**
 * Injectable region crop renderer for Notes mode (browser Canvas by default;
 * injectable for Node automated testing).
 */
export type RegionCropRenderer = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfDocument: any,
  sourcePageNumber: number,
  sourceBox: BoundingBox,
  targetDpi: number,
) => Promise<RasterImagePayload>

/**
 * Unified output returned by both Notes and Slides conversion pipelines.
 */
export interface ConversionExportResult {
  mode: ConversionMode
  fileName: string
  pdfBytes: Uint8Array
  pageCount: number
  warnings: string[]
  errors: string[]
  layoutDocument?: LayoutDocument
  slidePages?: SlidePageResult[]
  createdAt: string
}

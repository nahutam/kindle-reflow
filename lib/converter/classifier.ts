/**
 * KindleFlow — Block Classifier
 * Prompt 3: Classify TextBlocks and document regions as specific content types.
 *
 * Uses heuristic evidence from:
 *  - Text content and font characteristics (equations, code, callouts)
 *  - Vector path evidence (table borders, fraction bars, rectangles)
 *  - Image evidence (figures, diagrams)
 *  - Spatial relationships (captions near figures, equation numbering)
 *
 * All classifications include a ConfidenceLevel to reflect evidence quality.
 * Low-confidence complex regions are marked preserveAsImage = true.
 */

import type {
  TextBlock,
  DocumentBlock,
  DocumentBlockType,
  VectorPathEvidence,
  ImageEvidence,
  ConfidenceLevel,
  BoundingBox,
  TextLine,
} from './types'

// ─── Constants ────────────────────────────────────────────────────────────────

/** Math symbol patterns that suggest equation or reaction content */
const MATH_SYMBOLS =
  /[∑∫∂∇√±≤≥≠≈≡∝∮∯∰∱∲∳⊂⊃⊆⊇⊄⊅∪∩⊕⊗⊘→←↔⇒⇐⇔⇌⇄⇆↑↓×·÷∓°‰−⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼₍₎⁽⁾ⁿⁱ₀₁₂₃₄₅₆₇₈₉₊₋₌]/
const MATH_OPERATORS = /[+\-*/=<>^_|\\]{3,}/

/** Equation number pattern: (1), (1.2), (A.3) at end of line */
const EQUATION_NUMBER_PATTERN = /\(\s*[A-Za-z]?\d+(\.\d+)?\s*\)$/

/** Caption patterns */
const CAPTION_PATTERN = /^(Figure|Fig\.|Table|Chart|Diagram|Listing|Algorithm)\s*\d+/i

/** Code block indicators */
const CODE_INDICATORS = /^(\s{4}|\t)|`{1,3}|```/

/** Callout / note patterns (Notion exports) */
const CALLOUT_PATTERNS = /^(Note|Warning|Tip|Info|Important|Caution|Danger|Example|Definition):/i

// ─── Spatial helpers ─────────────────────────────────────────────────────────

function boxesOverlapVertically(a: BoundingBox, b: BoundingBox, margin = 0): boolean {
  return a.y - margin <= b.y + b.height && a.y + a.height + margin >= b.y
}

function verticalDistanceBetween(a: BoundingBox, b: BoundingBox): number {
  if (a.y + a.height <= b.y) return b.y - (a.y + a.height)
  if (b.y + b.height <= a.y) return a.y - (b.y + b.height)
  return 0 // overlapping
}

function horizontalCenter(box: BoundingBox): number {
  return box.x + box.width / 2
}

// ─── Equation detection ───────────────────────────────────────────────────────

interface EquationEvidence {
  hasMathSymbols: boolean
  hasDenseMathOps: boolean
  isShortCentered: boolean
  hasEquationNumber: boolean
  hasNearbyFractionBar: boolean
  score: number
}

function detectEquationEvidence(
  block: TextBlock,
  bodyFontSize: number,
  paths: VectorPathEvidence[],
  pageWidth: number,
  gridRegions: TableGridRegion[] = [],
): EquationEvidence {
  const { text, lines, box, blockType } = block
  const colCenter = pageWidth / 2
  const lineCount = lines.length

  // Headings and subheadings are not equations unless they contain reaction arrows or mathematical formulas
  if (blockType === 'heading' || blockType === 'subheading') {
    if (!/[→⇌]/.test(text) && !MATH_SYMBOLS.test(text)) {
      return {
        hasMathSymbols: false,
        hasDenseMathOps: false,
        isShortCentered: false,
        hasEquationNumber: false,
        hasNearbyFractionBar: false,
        score: 0,
      }
    }
  }

  // Prose text check: Blocks that are predominantly ordinary sentences (e.g. definitions, explanations, list items)
  // are reflowable text paragraphs, not standalone display equations.
  const words = text.trim().split(/\s+/).filter(w => /^[a-zA-Z]{2,}$/.test(w))
  const isPredominantlyProse = words.length >= 8 && !/[→⇌]/.test(text) && !/\\(?:int|sum|prod|frac|sqrt)\b/.test(text)
  const isExplicitProseHeader = /^(?:Defn:|Note:|Cond:|Theorem:|Lemma:|Corollary:|\d+\.\s+[A-Z])/.test(text.trim())

  if (isPredominantlyProse || (isExplicitProseHeader && !/[→⇌]/.test(text))) {
    return {
      hasMathSymbols: false,
      hasDenseMathOps: false,
      isShortCentered: false,
      hasEquationNumber: false,
      hasNearbyFractionBar: false,
      score: 0,
    }
  }

  const hasMathSymbols = MATH_SYMBOLS.test(text)
  const hasDenseMathOps = MATH_OPERATORS.test(text)
  const hasChemicalReaction =
    /[A-Z][a-z]?\d*.*[→⇌]|⇌|->|-->/.test(text) &&
    /\b(?:aq|s|l|g)\b|[A-Z][a-z]?\d+|[+\-=]/.test(text)
  const hasMathExponentOrCharges =
    /\b\d+\^[-+]?\d+|\b10\^|\[\s*[A-Z][a-z]?[\+\-]?\s*\]|\b[A-Z][a-z]?\d*[\+\-]\b/.test(text)
  const hasMathTokens = hasMathSymbols || hasDenseMathOps || hasChemicalReaction || hasMathExponentOrCharges || /[\d+\-=*/<>^_~]/.test(text)

  // Check for fraction bars (horizontal lines near the block, narrower than the block)
  // Must contain actual math tokens, and must not be part of a detected table grid
  const hasNearbyFractionBar =
    hasMathTokens &&
    paths.some(
      p =>
        p.type === 'line' &&
        p.box.height < 3 && // near-horizontal
        p.box.width > 10 &&
        p.box.width < box.width * 0.9 && // not spanning the full block width (table row)
        boxesOverlapVertically(p.box, box, box.height * 0.5) &&
        !gridRegions.some(
          g => p.box.y >= g.box.y - 2 && p.box.y <= g.box.y + g.box.height + 2,
        ),
    )

  // A block MUST have direct mathematical evidence (symbols, operators, reactions, or fraction bars)
  // to be considered an equation. English titles or centered headings must never match.
  if (!hasMathSymbols && !hasDenseMathOps && !hasChemicalReaction && !hasMathExponentOrCharges && !hasNearbyFractionBar) {
    return {
      hasMathSymbols: false,
      hasDenseMathOps: false,
      isShortCentered: false,
      hasEquationNumber: false,
      hasNearbyFractionBar: false,
      score: 0,
    }
  }

  // Center-aligned: left margin significantly larger than body margin
  const bodyMargin = pageWidth * 0.08
  const isShortCentered =
    lineCount <= 4 &&
    box.x > bodyMargin * 1.5 &&
    Math.abs(horizontalCenter(box) - colCenter) < pageWidth * 0.2

  const hasEquationNumber = EQUATION_NUMBER_PATTERN.test(text.trimEnd())

  let score = 0
  if (hasMathSymbols) score += 3
  if (hasChemicalReaction) score += 3
  if (hasMathExponentOrCharges) score += 2
  if (hasDenseMathOps) score += 2
  if (isShortCentered) score += 2
  if (hasEquationNumber) score += 2
  if (hasNearbyFractionBar) score += 3

  return {
    hasMathSymbols,
    hasDenseMathOps,
    isShortCentered,
    hasEquationNumber,
    hasNearbyFractionBar,
    score,
  }
}

function equationConfidence(score: number): ConfidenceLevel | null {
  if (score >= 5) return 'high'
  if (score >= 3) return 'medium'
  return null
}

// ─── Table detection ──────────────────────────────────────────────────────────

interface TableEvidence {
  hasHorizontalLines: boolean
  hasVerticalLines: boolean
  hasAlignedColumns: boolean
  lineCount: number
  score: number
}

function detectTableEvidence(
  block: TextBlock,
  paths: VectorPathEvidence[],
): TableEvidence {
  const { box, lines, blockType } = block

  // Headings and subheadings are never tables
  if (blockType === 'heading' || blockType === 'subheading') {
    return {
      hasHorizontalLines: false,
      hasVerticalLines: false,
      hasAlignedColumns: false,
      lineCount: 0,
      score: 0,
    }
  }

  // Count horizontal lines within the block's vertical range
  const margin = box.height * 0.1 + 5
  const hLines = paths.filter(
    p =>
      p.type === 'line' &&
      p.box.height < 4 &&
      p.box.width > box.width * 0.3 &&
      p.box.y >= box.y - margin &&
      p.box.y <= box.y + box.height + margin,
  )

  const vLines = paths.filter(
    p =>
      p.type === 'line' &&
      p.box.width < 4 &&
      p.box.height > box.height * 0.2 &&
      p.box.x >= box.x - margin &&
      p.box.x <= box.x + box.width + margin,
  )

  // Check for genuine multi-column tabular layout in borderless blocks:
  // Must have multiple items on the SAME line sharing different distinct column X offsets
  let multiColRows = 0
  for (const line of lines) {
    if (line.items.length >= 2) {
      for (let j = 1; j < line.items.length; j++) {
        const gap = line.items[j].box.x - (line.items[j - 1].box.x + line.items[j - 1].box.width)
        if (gap >= 25) {
          multiColRows++
          break
        }
      }
    }
  }
  const hasAlignedColumns = multiColRows >= 3 && lines.length >= 3

  let score = 0
  if (hLines.length >= 2) score += 4
  if (hLines.length >= 4) score += 2
  if (vLines.length >= 2) score += 2
  if (hasAlignedColumns) score += 3

  return {
    hasHorizontalLines: hLines.length >= 2,
    hasVerticalLines: vLines.length >= 2,
    hasAlignedColumns,
    lineCount: hLines.length,
    score,
  }
}

function tableConfidence(evidence: TableEvidence): ConfidenceLevel | null {
  if (evidence.hasHorizontalLines) {
    if (evidence.score >= 5) return 'high'
    if (evidence.score >= 3) return 'medium'
    return 'low'
  }
  // Borderless tables without gridlines are classified with low confidence
  if (evidence.hasAlignedColumns) return 'low'
  return null
}

// ─── Figure detection ─────────────────────────────────────────────────────────

function detectFigureRegion(
  image: ImageEvidence,
  pageArea: number,
): { isSignificant: boolean; confidence: ConfidenceLevel } {
  const imageArea = image.box.width * image.box.height
  const fraction = imageArea / pageArea

  if (fraction >= 0.10) return { isSignificant: true, confidence: 'high' }
  if (fraction >= 0.04) return { isSignificant: true, confidence: 'medium' }
  return { isSignificant: false, confidence: 'low' }
}

// ─── Callout detection ────────────────────────────────────────────────────────

function detectCallout(
  block: TextBlock,
  paths: VectorPathEvidence[],
  pageWidth = 612,
  pageHeight = 792,
): boolean {
  // Check for surrounding rectangle: MUST be a local box, NOT the entire page background
  const surroundingRect = paths.some(
    p =>
      (p.type === 'rect' || p.type === 'path') &&
      // Reject full-page background rects or huge containers
      p.box.width < pageWidth * 0.92 &&
      p.box.height < pageHeight * 0.70 &&
      p.box.width <= block.box.width + 40 &&
      p.box.height <= block.box.height + 40 &&
      p.box.x <= block.box.x + 8 &&
      p.box.y <= block.box.y + 8 &&
      p.box.x + p.box.width >= block.box.x + block.box.width - 8 &&
      p.box.y + p.box.height >= block.box.y + block.box.height - 8,
  )
  if (surroundingRect) return true

  // Text-based callout detection (Alert banners only: Warning, Caution, Danger, Tip, Important)
  // Ordinary "Definition:" or "Defn:" or "Note:" are academic notes/definitions, not orange callout bars!
  const CALLOUT_ALERT_PATTERNS = /^(Warning|Caution|Danger|Important|Tip):/i
  return CALLOUT_ALERT_PATTERNS.test(block.text.trimStart())
}

// ─── Code block detection ─────────────────────────────────────────────────────

function detectCodeBlock(block: TextBlock): boolean {
  // Monospace font
  if (block.dominantFont.isMonospace) return true
  // Code indentation patterns
  return CODE_INDICATORS.test(block.lines[0]?.text ?? '')
}

// ─── Header / footer classification ──────────────────────────────────────────

export interface HeaderFooterInfo {
  headerPageNumbers: Set<number>
  footerPageNumbers: Set<number>
  runningHeader?: string
  runningFooter?: string
}

function isHeaderOrFooter(
  block: TextBlock,
  pageNumber: number,
  pageHeight: number,
  headerFooterInfo?: HeaderFooterInfo,
): DocumentBlockType | null {
  const blockBottomY = block.box.y + block.box.height
  const headerLimit = pageHeight * 0.08
  const footerLimit = pageHeight * 0.92

  // Spatial zone classification
  if (blockBottomY <= headerLimit) {
    // Check for page number
    if (/^\d+$/.test(block.text.trim())) return 'page-number'
    return 'header'
  }
  if (block.box.y >= footerLimit) {
    if (/^\d+$/.test(block.text.trim())) return 'page-number'
    return 'footer'
  }

  // Cross-page running element confirmation
  if (headerFooterInfo) {
    if (headerFooterInfo.headerPageNumbers.has(pageNumber)) {
      if (block.box.y < pageHeight * 0.12) return 'header'
    }
    if (headerFooterInfo.footerPageNumbers.has(pageNumber)) {
      if (block.box.y > pageHeight * 0.88) return 'footer'
    }
  }

  return null
}

// ─── Main classifier ──────────────────────────────────────────────────────────

export interface ClassifierOptions {
  bodyFontSize: number
  pageNumber: number
  pageWidth: number
  pageHeight: number
  paths: VectorPathEvidence[]
  images: ImageEvidence[]
  headerFooterInfo?: HeaderFooterInfo
  bodyLeft?: number
}

const LIST_PREFIX_REGEX = /^(([•\-\*\u2022\u2023\u25CF\u25E6\u2043])|(\d+[.)])|([a-zA-Z][.)]))\s+/

function hasVectorBulletNearby(
  blockBox: BoundingBox,
  firstLineBox: BoundingBox,
  paths: VectorPathEvidence[],
): boolean {
  return paths.some(p => {
    // Vector bullet: small dimension (1.5 to 8 pt)
    const isSmall = p.box.width >= 1.5 && p.box.width <= 8 && p.box.height >= 1.5 && p.box.height <= 8
    if (!isSmall) return false
    // Situated in the left gutter of the block (within 35 pt to the left of the text)
    const isInGutter = p.box.x < blockBox.x && p.box.x >= blockBox.x - 35
    // Vertically aligned with the first line of the block (within 8 pt of the line's vertical center)
    const lineCenterY = firstLineBox.y + firstLineBox.height / 2
    const bulletCenterY = p.box.y + p.box.height / 2
    return isInGutter && Math.abs(lineCenterY - bulletCenterY) <= 8
  })
}

/**
 * Classify TextBlocks into full DocumentBlocks.
 *
 * Also creates synthetic DocumentBlocks for significant image regions
 * that have no associated text block (pure figures).
 */
function mapInitialBlockType(blockType: TextBlock['blockType']): DocumentBlockType {
  switch (blockType) {
    case 'list-item':
      return 'list'
    case 'unknown':
      return 'unknown-complex'
    default:
      return blockType
  }
}

interface TableGridRegion {
  box: BoundingBox
  lines: VectorPathEvidence[]
  rowYs: number[]
  colXs: number[]
}

function findTableGridRegions(
  paths: VectorPathEvidence[],
  pageWidth: number,
  pageHeight: number,
): TableGridRegion[] {
  // 1. Filter out page-level borders or full-page backgrounds
  const nonPagePaths = paths.filter(
    p => p.box.width < pageWidth * 0.92 && p.box.height < pageHeight * 0.70,
  )

  // 2. Identify grid lines (horizontal and vertical lines)
  const gridLines = nonPagePaths.filter(p => {
    const isH = (p.type === 'line' || p.box.height <= 3.5) && p.box.width >= 35
    const isV = (p.type === 'line' || p.box.width <= 3.5) && p.box.height >= 15
    return isH || isV
  })

  // 3. Cluster lines into table candidate regions
  const clusters: Array<{ box: BoundingBox; lines: VectorPathEvidence[] }> = []
  for (const line of gridLines) {
    let merged = false
    for (const c of clusters) {
      if (
        line.box.x <= c.box.x + c.box.width + 12 &&
        line.box.x + line.box.width >= c.box.x - 12 &&
        line.box.y <= c.box.y + c.box.height + 12 &&
        line.box.y + line.box.height >= c.box.y - 12
      ) {
        const minX = Math.min(c.box.x, line.box.x)
        const minY = Math.min(c.box.y, line.box.y)
        const maxX = Math.max(c.box.x + c.box.width, line.box.x + line.box.width)
        const maxY = Math.max(c.box.y + c.box.height, line.box.y + line.box.height)
        c.box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
        c.lines.push(line)
        merged = true
        break
      }
    }
    if (!merged) {
      clusters.push({ box: { ...line.box }, lines: [line] })
    }
  }

  // Merge overlapping or adjacent clusters
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const c1 = clusters[i]
        const c2 = clusters[j]
        if (
          c1.box.x <= c2.box.x + c2.box.width + 8 &&
          c1.box.x + c1.box.width >= c2.box.x - 8 &&
          c1.box.y <= c2.box.y + c2.box.height + 8 &&
          c1.box.y + c1.box.height >= c2.box.y - 8
        ) {
          const minX = Math.min(c1.box.x, c2.box.x)
          const minY = Math.min(c1.box.y, c2.box.y)
          const maxX = Math.max(c1.box.x + c1.box.width, c2.box.x + c2.box.width)
          const maxY = Math.max(c1.box.y + c1.box.height, c2.box.y + c2.box.height)
          c1.box = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
          c1.lines.push(...c2.lines)
          clusters.splice(j, 1)
          changed = true
          break
        }
      }
      if (changed) break
    }
  }

  function clusterCoords(coords: number[]): number[] {
    const sorted = [...coords].sort((a, b) => a - b)
    const res: number[] = []
    for (const val of sorted) {
      if (res.length === 0 || val - res[res.length - 1] > 4) {
        res.push(val)
      } else {
        res[res.length - 1] = (res[res.length - 1] + val) / 2
      }
    }
    return res
  }

  // Filter candidates that have at least 2 horizontal grid dividers
  const results: TableGridRegion[] = []
  for (const c of clusters) {
    const hLines = c.lines.filter(l => (l.type === 'line' || l.box.height <= 3.5) && l.box.width >= 35)
    const vLines = c.lines.filter(l => (l.type === 'line' || l.box.width <= 3.5) && l.box.height >= 15)
    if (hLines.length >= 2) {
      const rowYs = clusterCoords(hLines.map(l => l.box.y))
      const colXs = clusterCoords(vLines.map(l => l.box.x))
      results.push({
        box: c.box,
        lines: c.lines,
        rowYs,
        colXs,
      })
    }
  }

  return results
}

export function classifyBlocks(
  textBlocks: TextBlock[],
  options: ClassifierOptions,
): DocumentBlock[] {
  const { bodyFontSize, pageNumber, pageWidth, pageHeight, paths, images, headerFooterInfo } = options
  const pageArea = pageWidth * pageHeight

  const result: DocumentBlock[] = []
  let readingOrder = 0

  // Pre-pass: Detect any structured table grid regions on this page
  const gridRegions = findTableGridRegions(paths, pageWidth, pageHeight)
  const consumedBlockIds = new Set<string>()

  for (let gIdx = 0; gIdx < gridRegions.length; gIdx++) {
    const grid = gridRegions[gIdx]
    // Find all text blocks that fall inside this table grid box
    const intersectingBlocks = textBlocks.filter(b => {
      // Must not be a major document-level heading (e.g. Chapter or Section title)
      // Check if it's distinctly outside the table box
      const midX = b.box.x + b.box.width / 2
      const midY = b.box.y + b.box.height / 2
      const isInside =
        midX >= grid.box.x - 8 &&
        midX <= grid.box.x + grid.box.width + 8 &&
        midY >= grid.box.y - 8 &&
        midY <= grid.box.y + grid.box.height + 8
      if (!isInside) return false

      // If it's a heading or caption, only exclude if it spans much wider than a table cell
      // or is at the very top/outside
      if (b.blockType === 'heading' && b.box.width > grid.box.width * 0.7) {
        return false
      }
      return true
    })

    if (intersectingBlocks.length > 0) {
      // Extract structured rows and columns
      const numRows = grid.rowYs.length > 1 ? grid.rowYs.length - 1 : 1
      const numCols = grid.colXs.length > 1 ? grid.colXs.length - 1 : 1
      const cells: import('./types').TableCell[] = []
      const rows: string[][] = Array.from({ length: numRows }, () =>
        Array.from({ length: numCols }, () => ''),
      )

      // Collect all text items from intersecting blocks
      const allItems = intersectingBlocks.flatMap(b => b.lines.flatMap(l => l.items))

      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const cellBox = {
            x: grid.colXs[c],
            y: grid.rowYs[r],
            width: (grid.colXs[c + 1] ?? grid.box.x + grid.box.width) - grid.colXs[c],
            height: (grid.rowYs[r + 1] ?? grid.box.y + grid.box.height) - grid.rowYs[r],
          }

          const inCell = allItems.filter(it => {
            if (!it.str.trim()) return false
            const midX = it.box.x + it.box.width / 2
            const midY = it.box.y + it.box.height / 2
            return (
              midX >= cellBox.x - 3 &&
              midX <= cellBox.x + cellBox.width + 3 &&
              midY >= cellBox.y - 3 &&
              midY <= cellBox.y + cellBox.height + 3
            )
          })

          inCell.sort((a, b) => {
            const dy = a.box.y - b.box.y
            if (Math.abs(dy) > 3) return dy
            return a.box.x - b.box.x
          })

          const cellText = inCell.map(it => it.str.trim()).join(' ')
          rows[r][c] = cellText
          cells.push({
            rowIndex: r,
            columnIndex: c,
            text: cellText,
            box: cellBox,
            isHeader: r === 0,
          })
        }
      }

      const headers = rows[0] || []
      const combinedText = rows.map(r => r.join(' | ')).join('\n')
      const allLines = intersectingBlocks.flatMap(b => b.lines)

      // Compute unified bounding box (union of grid box and text boxes)
      let tableBox = { ...grid.box }
      for (const b of intersectingBlocks) {
        const minX = Math.min(tableBox.x, b.box.x)
        const minY = Math.min(tableBox.y, b.box.y)
        const maxX = Math.max(tableBox.x + tableBox.width, b.box.x + b.box.width)
        const maxY = Math.max(tableBox.y + tableBox.height, b.box.y + b.box.height)
        tableBox = { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      }

      // Assign reading order based on where the table fits in the original reading flow
      const tableOrder =
        intersectingBlocks.length > 0
          ? Math.min(...intersectingBlocks.map(b => b.readingOrder))
          : (() => {
              const preceding = textBlocks
                .filter(b => b.box.y + b.box.height <= grid.box.y + 5)
                .sort((a, b) => (b.box.y + b.box.height) - (a.box.y + a.box.height))[0]
              return preceding ? preceding.readingOrder + 0.5 : 0
            })()

      const tableBlock: DocumentBlock = {
        id: `doc_p${pageNumber}_tbl_${gIdx + 1}`,
        pageNumber,
        type: 'table',
        box: tableBox,
        text: combinedText,
        lines: allLines,
        textItemIds: allItems.map(it => it.id),
        associatedPaths: grid.lines,
        associatedImages: [],
        readingOrder: tableOrder,
        confidence: 'high',
        preserveAsImage: true,
        tableData: {
          rowCount: numRows,
          columnCount: numCols,
          headers,
          rows: rows.slice(1),
          cells,
          gridBox: grid.box,
        },
        warnings: [],
      }

      result.push(tableBlock)
      for (const b of intersectingBlocks) {
        consumedBlockIds.add(b.id)
      }
    }
  }

  // First pass: classify remaining text blocks
  let prevSubstantiveBlock: TextBlock | null = null

  for (const block of textBlocks) {
    if (consumedBlockIds.has(block.id)) {
      continue
    }

    const hasVectorBullet =
      block.lines.length > 0 && hasVectorBulletNearby(block.box, block.lines[0].box, paths)

    // Indented block immediately following a colon or list header:
    const isIndentedAfterColon =
      prevSubstantiveBlock !== null &&
      prevSubstantiveBlock.text.trimEnd().endsWith(':') &&
      verticalDistanceBetween(prevSubstantiveBlock.box, block.box) <= 35 &&
      block.box.x > prevSubstantiveBlock.box.x + 8 &&
      block.lines.length <= 4 &&
      block.blockType !== 'heading' &&
      block.blockType !== 'subheading'

    const isListItem =
      block.blockType === 'list-item' || hasVectorBullet || isIndentedAfterColon

    let initialType = mapInitialBlockType(block.blockType)
    let blockText = block.text

    if (isListItem) {
      initialType = 'list'
      if (!LIST_PREFIX_REGEX.test(blockText.trim())) {
        blockText = `• ${blockText.trimStart()}`
        if (block.lines.length > 0 && !LIST_PREFIX_REGEX.test(block.lines[0].text.trim())) {
          block.lines[0].text = `• ${block.lines[0].text.trimStart()}`
        }
      }
    }

    const docBlock: DocumentBlock = {
      id: `doc_p${pageNumber}_${block.id}`,
      pageNumber,
      type: initialType,
      box: block.box,
      text: blockText,
      lines: block.lines,
      textItemIds: block.lines.flatMap(l => l.items.map(it => it.id)),
      associatedPaths: [],
      associatedImages: [],
      readingOrder: block.readingOrder,
      confidence: block.confidence,
      preserveAsImage: false,
      warnings: [],
    }

    // Keep track of substantive blocks for colon-preceded list detection
    if (block.blockType !== 'unknown') {
      prevSubstantiveBlock = block
    }

    // --- Header / footer ---
    const headerFooterType = isHeaderOrFooter(block, pageNumber, pageHeight, headerFooterInfo)
    if (headerFooterType !== null) {
      docBlock.type = headerFooterType
      docBlock.confidence = 'high'
      result.push(docBlock)
      continue
    }

    // --- Table detection (checked BEFORE equation: table borders look like fraction bars) ---
    const tableEvidence = detectTableEvidence(block, paths)
    const tableConf = tableConfidence(tableEvidence)
    if (tableConf !== null) {
      docBlock.type = 'table'
      docBlock.confidence = tableConf
      docBlock.preserveAsImage = true
      docBlock.associatedPaths = findNearbyPaths(block.box, paths)
      if (!tableEvidence.hasHorizontalLines) {
        docBlock.warnings.push('Borderless table detected — confidence is low')
      }
      result.push(docBlock)
      continue
    }

    // --- Equation detection ---
    const eqEvidence = detectEquationEvidence(block, bodyFontSize, paths, pageWidth, gridRegions)
    const eqConf = equationConfidence(eqEvidence.score)
    if (eqConf !== null) {
      docBlock.type = 'equation'
      docBlock.confidence = eqConf
      docBlock.preserveAsImage = true
      docBlock.associatedPaths = findNearbyPaths(block.box, paths)
      result.push(docBlock)
      continue
    }

    // --- Callout detection ---
    if (detectCallout(block, paths, pageWidth, pageHeight)) {
      docBlock.type = 'callout'
      docBlock.confidence = 'medium'
      docBlock.associatedPaths = findNearbyPaths(block.box, paths)
      result.push(docBlock)
      continue
    }

    // --- Code block detection ---
    if (detectCodeBlock(block)) {
      docBlock.type = 'code-block'
      docBlock.confidence = 'medium'
      docBlock.associatedPaths = findNearbyPaths(block.box, paths)
      result.push(docBlock)
      continue
    }

    // --- Caption detection ---
    if (CAPTION_PATTERN.test(block.text.trimStart())) {
      docBlock.type = 'caption'
      docBlock.confidence = 'high'
      result.push(docBlock)
      continue
    }

    // Preserve heading/subheading/list-item type from TextBlock classification
    // (paragraph, heading, subheading, list-item → already in block.blockType)
    result.push(docBlock)
  }

  // Second pass: create DocumentBlocks for significant images not already covered
  for (const image of images) {
    const { isSignificant, confidence } = detectFigureRegion(image, pageArea)
    if (!isSignificant) continue

    // Check if image is already covered by an existing block
    const alreadyCovered = result.some(
      b =>
        b.box.x <= image.box.x + image.box.width * 0.5 &&
        b.box.x + b.box.width >= image.box.x + image.box.width * 0.5 &&
        b.box.y <= image.box.y + image.box.height * 0.5 &&
        b.box.y + b.box.height >= image.box.y + image.box.height * 0.5,
    )
    if (alreadyCovered) continue

    // Find associated caption (text block within 20pt below the image)
    const captionBlock = result.find(
      b =>
        b.type === 'caption' &&
        verticalDistanceBetween(image.box, b.box) <= 25 &&
        b.box.y >= image.box.y + image.box.height - 5,
    )

    const figureOrder = captionBlock
      ? captionBlock.readingOrder - 0.5
      : (() => {
          const preceding = textBlocks
            .filter(b => b.box.y + b.box.height <= image.box.y + 5)
            .sort((a, b) => (b.box.y + b.box.height) - (a.box.y + a.box.height))[0]
          return preceding ? preceding.readingOrder + 0.5 : textBlocks.length + 0.5
        })()

    result.push({
      id: `doc_p${pageNumber}_img_${image.id}`,
      pageNumber,
      type: 'figure',
      box: image.box,
      text: '',
      lines: [],
      textItemIds: [],
      associatedPaths: [],
      associatedImages: [image],
      readingOrder: figureOrder,
      confidence,
      preserveAsImage: true,
      warnings: [],
    })
  }

  // Re-sort by reading order
  result.sort((a, b) => a.readingOrder - b.readingOrder)

  // Re-assign integer reading orders
  result.forEach((b, i) => {
    b.readingOrder = i
  })

  return result
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function findNearbyPaths(box: BoundingBox, paths: VectorPathEvidence[]): VectorPathEvidence[] {
  const margin = Math.max(box.height, 20)
  return paths.filter(
    p =>
      p.box.x < box.x + box.width + margin &&
      p.box.x + p.box.width > box.x - margin &&
      p.box.y < box.y + box.height + margin &&
      p.box.y + p.box.height > box.y - margin,
  )
}

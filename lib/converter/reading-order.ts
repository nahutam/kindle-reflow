/**
 * KindleFlow — Reading Order
 * Prompt 3: Assign logical reading order to text lines across columns.
 *
 * Uses XY-Cut decomposition:
 *  - Full-width items (spanning the page) come before / after column blocks
 *  - Within each column, items are ordered top-to-bottom
 *  - Columns are ordered left-to-right
 */

import type { TextLine, PageColumnLayout } from './types'

/** X margin (pt) for classifying an item as "full-width" */
const FULL_WIDTH_MARGIN_PT = 15

/**
 * Assign reading order indices to an array of TextLines.
 *
 * Returns a NEW array of TextLine objects with updated `readingOrder`
 * and `columnIndex` fields. The original TextLine objects are not mutated.
 *
 * Order rules:
 * 1. Full-width lines above the topmost column content → sorted by Y, first
 * 2. Column content → column 0 top-to-bottom, then column 1 top-to-bottom, etc.
 * 3. Full-width lines below the bottommost column content → sorted by Y, last
 *
 * "Full-width" = line.box.x < columns[0].left + MARGIN and
 *                line.box.x + line.box.width > columns[-1].right - MARGIN
 */
export function determineReadingOrder(
  lines: TextLine[],
  columnLayout: PageColumnLayout,
): TextLine[] {
  if (lines.length === 0) return []

  const cols = columnLayout.columns

  // Classify each line
  type ClassifiedLine = {
    line: TextLine
    columnIndex: number
    isFullWidth: boolean
  }

  const classified: ClassifiedLine[] = lines.map(line => {
    const fullWidth = isFullWidth(line, cols)
    const colIdx = fullWidth ? 0 : resolveColumnIndex(line, cols)
    return { line, columnIndex: colIdx, isFullWidth: fullWidth }
  })

  // Find the Y range of non-full-width content (column body)
  const colLines = classified.filter(cl => !cl.isFullWidth)
  const colTopY = colLines.length > 0 ? Math.min(...colLines.map(cl => cl.line.box.y)) : Infinity
  const colBottomY =
    colLines.length > 0
      ? Math.max(...colLines.map(cl => cl.line.box.y + cl.line.box.height))
      : -Infinity

  // Split full-width lines into "above" and "below" column body
  const fullWidthAbove = classified
    .filter(cl => cl.isFullWidth && cl.line.box.y + cl.line.box.height <= colTopY + 2)
    .sort(byY)
  const fullWidthBelow = classified
    .filter(cl => cl.isFullWidth && cl.line.box.y >= colBottomY - 2)
    .sort(byY)
  const fullWidthMid = classified
    .filter(
      cl =>
        cl.isFullWidth &&
        cl.line.box.y + cl.line.box.height > colTopY + 2 &&
        cl.line.box.y < colBottomY - 2,
    )
    .sort(byY)

  // Sort each column's lines by Y
  const colGroups: ClassifiedLine[][] = Array.from({ length: cols.length }, () => [])
  for (const cl of colLines) {
    const idx = Math.min(cl.columnIndex, cols.length - 1)
    colGroups[idx].push(cl)
  }
  for (const group of colGroups) {
    group.sort(byY)
  }

  // Interleave full-width-mid lines with column content by Y position
  // For simplicity: insert full-width-mid immediately before the column line they precede
  // Build the full ordered sequence
  const ordered: ClassifiedLine[] = [
    ...fullWidthAbove,
    ...interleaveFullWidthMid(colGroups, fullWidthMid, cols),
    ...fullWidthBelow,
  ]

  // Assign sequential readingOrder values
  return ordered.map((cl, i) => ({
    ...cl.line,
    readingOrder: i,
    columnIndex: cl.isFullWidth ? 0 : cl.columnIndex,
  }))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function byY(a: { line: TextLine }, b: { line: TextLine }): number {
  return a.line.box.y - b.line.box.y
}

function isFullWidth(
  line: TextLine,
  cols: Array<{ left: number; right: number }>,
): boolean {
  if (cols.length <= 1) return false
  const pageLeft = cols[0].left
  const pageRight = cols[cols.length - 1].right
  return (
    line.box.x <= pageLeft + FULL_WIDTH_MARGIN_PT &&
    line.box.x + line.box.width >= pageRight - FULL_WIDTH_MARGIN_PT
  )
}

function resolveColumnIndex(
  line: TextLine,
  cols: Array<{ left: number; right: number }>,
): number {
  if (cols.length <= 1) return 0
  const centerX = line.box.x + line.box.width / 2
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < cols.length; i++) {
    const colCenter = (cols[i].left + cols[i].right) / 2
    const dist = Math.abs(centerX - colCenter)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

type ClassifiedLine = { line: TextLine; columnIndex: number; isFullWidth: boolean }

/**
 * Interleave full-width lines that appear BETWEEN column blocks.
 * Strategy: insert them in Y order relative to column lines.
 */
function interleaveFullWidthMid(
  colGroups: ClassifiedLine[][],
  fullWidthMid: ClassifiedLine[],
  cols: Array<{ left: number; right: number }>,
): ClassifiedLine[] {
  if (fullWidthMid.length === 0 && cols.length <= 1) {
    return colGroups[0] ?? []
  }

  // Merge all column lines and full-width-mid lines into a single Y-sorted sequence
  const all: ClassifiedLine[] = []
  for (let c = 0; c < colGroups.length; c++) {
    for (const cl of colGroups[c]) {
      all.push({ ...cl, columnIndex: c })
    }
  }
  all.push(...fullWidthMid)
  all.sort(byY)

  // Re-apply column ordering: collect into "sweeps"
  // A sweep is a vertical band; within each band, columns go left-to-right
  // For simplicity with 2-column layout, use the standard XY-cut approach:
  // Find the Y range where both columns have content; order col0 entirely before col1

  if (cols.length === 1) {
    return all
  }

  // For multi-column: order col0 all items before col1 all items,
  // but interleave full-width items by their Y position
  const result: ClassifiedLine[] = []

  // Find the max Y of column content
  for (let c = 0; c < colGroups.length; c++) {
    // Insert full-width-mid items that appear before this column's start
    const colStartY =
      colGroups[c].length > 0 ? colGroups[c][0].line.box.y : Infinity

    if (c === 0) {
      // Insert full-width items before first column
      const beforeCol = fullWidthMid.filter(fw => fw.line.box.y < colStartY)
      result.push(...beforeCol.sort(byY))
    }

    result.push(...colGroups[c])
  }

  // Insert remaining full-width-mid items at end
  const colEndY = colGroups.flatMap(g => g).reduce((m, cl) => Math.max(m, cl.line.box.y), 0)
  const afterCols = fullWidthMid.filter(fw => fw.line.box.y >= colEndY)
  result.push(...afterCols.sort(byY))

  return result
}

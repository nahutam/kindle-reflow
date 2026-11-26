/**
 * KindleFlow Converter — Batch Conversion Coordinator
 * Handles multi-file queuing, sequential single-file pipeline execution,
 * error isolation, deduplicated output naming, and local ZIP archiving.
 */

import JSZip from 'jszip'
import { validatePDF } from './validator'
import { convertDocument, type ConvertDocumentOptions } from './index'
import type {
  ConversionExportResult,
  ConversionMode,
  ExtractionProgress,
  ValidationResult,
} from './types'

export type BatchItemStatus =
  | 'idle'
  | 'validating'
  | 'queued'
  | 'converting'
  | 'completed'
  | 'failed'

export interface BatchItem {
  id: string
  file: File | { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
  name: string
  size: number
  status: BatchItemStatus
  validationResult?: ValidationResult
  error?: string
  progress?: ExtractionProgress
  result?: ConversionExportResult
}

export interface BatchProgressCallbackData {
  currentIndex: number
  totalItems: number
  currentItem: BatchItem
  overallPercent: number
  completedCount: number
  failedCount: number
}

export type BatchProgressCallback = (data: BatchProgressCallbackData) => void

export interface RunBatchOptions {
  mode: ConversionMode
  notesSettings?: ConvertDocumentOptions['notesSettings']
  slideSettings?: ConvertDocumentOptions['slideSettings']
  targetDpi?: number
  slideRasterizer?: ConvertDocumentOptions['slideRasterizer']
  regionRenderer?: ConvertDocumentOptions['regionRenderer']
  onItemProgress?: (item: BatchItem, progress: ExtractionProgress) => void
  onBatchProgress?: BatchProgressCallback
  abortSignal?: AbortSignal
}

export interface BatchSummary {
  mode: ConversionMode
  total: number
  completed: number
  failed: number
  items: BatchItem[]
  successfulResults: ConversionExportResult[]
}

/**
 * Ensures unique filenames within a batch download/ZIP archive.
 * Appends ' (1)', ' (2)', etc. when duplicate names occur.
 */
export function deduplicateOutputNames<T extends { fileName: string }>(results: T[]): T[] {
  const seen = new Map<string, number>()
  return results.map((item) => {
    const rawName = item.fileName
    const count = seen.get(rawName) ?? 0
    seen.set(rawName, count + 1)
    if (count === 0) {
      return item
    }
    const lastDot = rawName.lastIndexOf('.')
    const base = lastDot !== -1 ? rawName.slice(0, lastDot) : rawName
    const ext = lastDot !== -1 ? rawName.slice(lastDot) : ''
    return {
      ...item,
      fileName: `${base} (${count})${ext}`,
    }
  })
}

/**
 * Builds a clean, recognizable ZIP archive name.
 */
export function buildBatchZipName(mode: ConversionMode, successCount: number): string {
  const modeTag = mode === 'slides' ? 'slides' : 'notes'
  return `kindleflow-${modeTag}-batch-${successCount}files.zip`
}

/**
 * Packages all successfully converted Kindle PDFs into a single ZIP archive.
 * Excludes failed, incomplete, or corrupted outputs.
 */
export async function createBatchZip(
  results: Array<{ fileName: string; pdfBytes: Uint8Array }>,
): Promise<Uint8Array> {
  if (results.length === 0) {
    throw new Error('No successfully converted files available to package into ZIP.')
  }

  const zip = new JSZip()
  const deduplicated = deduplicateOutputNames(results)

  for (const item of deduplicated) {
    zip.file(item.fileName, item.pdfBytes)
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
}

/**
 * Sequentially converts a queue of PDF files one at a time.
 * - Reuses the exact single-file convertDocument pipeline.
 * - Isolates errors so one failure does not abort remaining valid files.
 * - Enforces uniform conversion mode for the entire batch.
 */
export async function runBatchConversion(
  items: BatchItem[],
  options: RunBatchOptions,
): Promise<BatchSummary> {
  const total = items.length
  let completedCount = 0
  let failedCount = 0
  const successfulResults: ConversionExportResult[] = []

  for (let i = 0; i < total; i++) {
    if (options.abortSignal?.aborted) {
      break
    }

    const currentItem = items[i]
    currentItem.status = 'converting'
    currentItem.error = undefined

    // Notify batch start for current item
    const overallPercentBefore = Math.round((i / total) * 100)
    options.onBatchProgress?.({
      currentIndex: i,
      totalItems: total,
      currentItem,
      overallPercent: overallPercentBefore,
      completedCount,
      failedCount,
    })

    try {
      // 1. Run validation if not pre-validated
      if (!currentItem.validationResult) {
        currentItem.status = 'validating'
        const valRes = await validatePDF(currentItem.file as any, currentItem.name)
        currentItem.validationResult = valRes
        if (!valRes.isValid && valRes.errors.length > 0) {
          throw new Error(valRes.errors[0].message)
        }
      } else if (!currentItem.validationResult.isValid) {
        throw new Error(currentItem.validationResult.errors[0]?.message || 'Invalid PDF file.')
      }

      // 2. Execute conversion via master dual-mode dispatcher
      currentItem.status = 'converting'
      const result = await convertDocument(currentItem.file as any, {
        mode: options.mode,
        fileName: currentItem.name,
        targetDpi: options.targetDpi ?? 300,
        notesSettings: options.notesSettings,
        slideSettings: options.slideSettings,
        slideRasterizer: options.slideRasterizer,
        regionRenderer: options.regionRenderer,
        onProgress: (p) => {
          currentItem.progress = p
          options.onItemProgress?.(currentItem, p)
          const itemContribution = (p.percent / 100) * (1 / total)
          const baseContribution = i / total
          const currentOverallPercent = Math.min(
            99,
            Math.round((baseContribution + itemContribution) * 100),
          )
          options.onBatchProgress?.({
            currentIndex: i,
            totalItems: total,
            currentItem,
            overallPercent: currentOverallPercent,
            completedCount,
            failedCount,
          })
        },
        abortSignal: options.abortSignal,
      })

      currentItem.status = 'completed'
      currentItem.result = result
      successfulResults.push(result)
      completedCount++
    } catch (err) {
      currentItem.status = 'failed'
      currentItem.error = err instanceof Error ? err.message : String(err)
      failedCount++
    }

    // Report item finish
    const overallPercentAfter = Math.round(((i + 1) / total) * 100)
    options.onBatchProgress?.({
      currentIndex: i,
      totalItems: total,
      currentItem,
      overallPercent: overallPercentAfter,
      completedCount,
      failedCount,
    })
  }

  return {
    mode: options.mode,
    total,
    completed: completedCount,
    failed: failedCount,
    items,
    successfulResults,
  }
}

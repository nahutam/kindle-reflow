'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Archive,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  FileText,
  FolderOpen,
  HelpCircle,
  Info,
  Layers,
  LayoutTemplate,
  Loader2,
  LockKeyhole,
  Maximize2,
  Play,
  Power,
  Presentation,
  RotateCcw,
  Send,
  Settings,
  Settings2,
  Sliders,
  Trash2,
  Upload,
  UploadCloud,
  X,
  XCircle,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  validatePDF,
  type ConversionMode,
  type SlideFittingStrategy,
  type SlideOrientation,
  getLocalPDFJS,
} from '@/lib/converter'
import {
  runBatchConversion,
  createBatchZip,
  buildBatchZipName,
  type BatchItem,
  type BatchSummary,
  type BatchProgressCallbackData,
} from '@/lib/converter/batch-converter'

export function ConverterWorkspace() {
  // Batch Queue & State
  const [queue, setQueue] = useState<BatchItem[]>([])
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null)
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null)
  const [batchProgress, setBatchProgress] = useState<BatchProgressCallbackData | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Mode Selection State (Uniform across the entire batch)
  const [mode, setMode] = useState<ConversionMode>('notes')

  // Notes Mode Settings
  const [margins, setMargins] = useState<'Standard' | 'Narrow' | 'Wide'>('Standard')
  const [scale, setScale] = useState<'90%' | '100%' | '110%' | '120%'>('100%')
  const [resolution, setResolution] = useState<'150 DPI' | '300 DPI' | '600 DPI'>('300 DPI')
  const [preserveEquations, setPreserveEquations] = useState(true)
  const [preserveTables, setPreserveTables] = useState(true)
  const [autoStripHeaders, setAutoStripHeaders] = useState(false)

  // Slides Mode Settings
  const [slideFitting, setSlideFitting] = useState<SlideFittingStrategy>('original-proportions')
  const [slideOrientation, setSlideOrientation] = useState<SlideOrientation>('landscape')

  // Advanced & Modals State
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showGuidesModal, setShowGuidesModal] = useState(false)
  const [showComparisonModal, setShowComparisonModal] = useState(false)
  const [previewZoom, setPreviewZoom] = useState(100)
  const [isShutDown, setIsShutDown] = useState(false)

  // Output Directory & Native Integration State
  const [outputDir, setOutputDir] = useState<string | null>(null)
  const [isNativeApp, setIsNativeApp] = useState(false)
  const [isSelectingDir, setIsSelectingDir] = useState(false)
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.outputDirectory) {
          setOutputDir(data.outputDirectory)
          setIsNativeApp(Boolean(data.isNative))
        }
      })
      .catch(() => {
        // Pure web browser mode without local controller
      })
  }, [])

  const handleBrowseOutputDir = async () => {
    if (isSelectingDir) return
    setIsSelectingDir(true)
    try {
      const res = await fetch('/api/browse-directory', { method: 'POST' })
      const data = await res.json()
      if (data && data.outputDirectory) {
        setOutputDir(data.outputDirectory)
      }
    } catch (err) {
      console.error('Error selecting directory:', err)
    } finally {
      setIsSelectingDir(false)
    }
  }

  const saveFileToNativeDir = async (fileName: string, pdfBytes: Uint8Array): Promise<string | null> => {
    if (!isNativeApp) return null
    try {
      let binary = ''
      const len = pdfBytes.byteLength
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(pdfBytes[i])
      }
      const fileBase64 = btoa(binary)
      const res = await fetch('/api/save-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, fileBase64 }),
      })
      const data = await res.json()
      if (data.status === 'ok') {
        return data.savedPath
      }
    } catch (err) {
      console.error('Failed to auto-save to native directory:', err)
    }
    return null
  }

  // Interactive Preview State
  const [previewTab, setPreviewTab] = useState<'original' | 'converted'>('original')
  const [previewPageNum, setPreviewPageNum] = useState(1)
  const [previewTotalPages, setPreviewTotalPages] = useState(1)
  const [originalCanvasUrl, setOriginalCanvasUrl] = useState<string | null>(null)
  const [convertedCanvasUrl, setConvertedCanvasUrl] = useState<string | null>(null)
  const [isRenderingPreview, setIsRenderingPreview] = useState(false)
  const [lastRenderTime, setLastRenderTime] = useState<string>('0.42s')

  const inputRef = useRef<HTMLInputElement>(null)

  // Currently previewed item
  const activePreviewItem = queue.find((q) => q.id === selectedPreviewId) || queue[0] || null

  const addFiles = async (files?: FileList | File[] | null) => {
    if (!files || files.length === 0) return

    const incoming = Array.from(files).filter(
      (f) => f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf',
    )

    if (incoming.length === 0) {
      setErrorMessage('Please select valid PDF documents (.pdf).')
      return
    }

    setErrorMessage(null)

    // Filter out duplicates (same name and size already present in queue)
    const newItems: BatchItem[] = []
    for (const file of incoming) {
      const isDuplicate = queue.some(
        (existing) => existing.name === file.name && existing.size === file.size,
      )
      if (isDuplicate) continue

      newItems.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        size: file.size,
        status: 'validating',
      })
    }

    if (newItems.length === 0) return

    const updatedQueue = [...queue, ...newItems]
    setQueue(updatedQueue)

    // Set first item as active preview if none selected
    if (!selectedPreviewId && newItems.length > 0) {
      setSelectedPreviewId(newItems[0].id)
    }

    // Validate incoming files asynchronously
    for (const item of newItems) {
      try {
        const valRes = await validatePDF(item.file as File, item.name)
        setQueue((prev) =>
          prev.map((q) => {
            if (q.id !== item.id) return q
            const isInvalid = !valRes.isValid && valRes.errors.length > 0
            return {
              ...q,
              status: isInvalid ? 'failed' : 'queued',
              validationResult: valRes,
              error: isInvalid ? valRes.errors[0].message : undefined,
            }
          }),
        )

        // Render source preview if this is the active preview item
        if (valRes.isValid && (!selectedPreviewId || selectedPreviewId === item.id)) {
          setPreviewTotalPages(valRes.pageCount)
          renderSourcePreviewPage(item.file as File, 1)
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id ? { ...q, status: 'failed', error: `Validation error: ${msg}` } : q,
          ),
        )
      }
    }
  }

  const removeFile = (id: string) => {
    if (isProcessing) return
    const nextQueue = queue.filter((item) => item.id !== id)
    setQueue(nextQueue)
    if (selectedPreviewId === id) {
      const nextSelected = nextQueue.length > 0 ? nextQueue[0].id : null
      setSelectedPreviewId(nextSelected)
      if (nextSelected) {
        const nextItem = nextQueue.find((x) => x.id === nextSelected)
        if (nextItem && nextItem.file instanceof File) {
          renderSourcePreviewPage(nextItem.file, 1)
        }
      } else {
        setOriginalCanvasUrl(null)
        setConvertedCanvasUrl(null)
      }
    }
  }

  const clearQueue = () => {
    if (isProcessing) return
    setQueue([])
    setSelectedPreviewId(null)
    setBatchSummary(null)
    setBatchProgress(null)
    setErrorMessage(null)
    setOriginalCanvasUrl(null)
    setConvertedCanvasUrl(null)
    setPreviewPageNum(1)
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }

  const handleSelectPreviewItem = (item: BatchItem) => {
    setSelectedPreviewId(item.id)
    setPreviewPageNum(1)
    if (item.file instanceof File) {
      renderSourcePreviewPage(item.file, 1)
    }
    if (item.result) {
      renderConvertedPreviewPage(item.result.pdfBytes, 1)
    } else {
      setConvertedCanvasUrl(null)
      setPreviewTab('original')
    }
  }

  const handlePageNavigation = (delta: number) => {
    const newPage = Math.max(1, Math.min(previewTotalPages, previewPageNum + delta))
    if (newPage === previewPageNum) return
    setPreviewPageNum(newPage)

    if (previewTab === 'original' && activePreviewItem?.file instanceof File) {
      renderSourcePreviewPage(activePreviewItem.file, newPage)
    } else if (previewTab === 'converted' && activePreviewItem?.result) {
      renderConvertedPreviewPage(activePreviewItem.result.pdfBytes, newPage)
    }
  }

  const handleCyclePreview = () => {
    if (queue.length === 0) return
    const currentIndex = queue.findIndex((item) => item.id === selectedPreviewId)
    const nextIndex = (currentIndex + 1) % queue.length
    handleSelectPreviewItem(queue[nextIndex])
  }

  const renderSourcePreviewPage = async (file: File, pageNum: number) => {
    try {
      const startT = performance.now()
      const pdfjs = await getLocalPDFJS()
      const buffer = await file.arrayBuffer()
      const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer) })
      const pdf = await loadingTask.promise
      setPreviewTotalPages(pdf.numPages)
      const clamped = Math.max(1, Math.min(pdf.numPages, pageNum))
      const page = await pdf.getPage(clamped)
      const viewport = page.getViewport({ scale: 1.2 })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport }).promise
        setOriginalCanvasUrl(canvas.toDataURL('image/png'))
      }
      page.cleanup()
      pdf.destroy()
      const elapsed = ((performance.now() - startT) / 1000).toFixed(2)
      setLastRenderTime(`${elapsed}s`)
    } catch {
      // Non-fatal preview rendering
    }
  }

  const renderConvertedPreviewPage = async (pdfBytes: Uint8Array, pageNum: number) => {
    try {
      setIsRenderingPreview(true)
      const startT = performance.now()
      const pdfjs = await getLocalPDFJS()
      const loadingTask = pdfjs.getDocument({ data: pdfBytes.slice() })
      const pdf = await loadingTask.promise
      const total = pdf.numPages
      setPreviewTotalPages(total)
      const clamped = Math.max(1, Math.min(total, pageNum))
      const page = await pdf.getPage(clamped)
      const viewport = page.getViewport({ scale: 1.4 })

      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport }).promise
        setConvertedCanvasUrl(canvas.toDataURL('image/png'))
      }
      page.cleanup()
      pdf.destroy()
      const elapsed = ((performance.now() - startT) / 1000).toFixed(2)
      setLastRenderTime(`${elapsed}s`)
    } catch {
      // Non-fatal preview rendering
    } finally {
      setIsRenderingPreview(false)
    }
  }

  const handleStartConversion = async () => {
    if (queue.length === 0) {
      inputRef.current?.click()
      return
    }

    if (isProcessing) return

    setIsProcessing(true)
    setErrorMessage(null)
    setBatchSummary(null)
    setBatchProgress(null)

    const dpi = parseInt(resolution, 10) || 300
    const marginPresets = {
      Standard: { top: 28, right: 26, bottom: 32, left: 26 },
      Narrow: { top: 16, right: 16, bottom: 20, left: 16 },
      Wide: { top: 38, right: 36, bottom: 42, left: 36 },
    }

    const scaleFactors = {
      '90%': 10.5,
      '100%': 11.5,
      '110%': 12.6,
      '120%': 13.8,
    }

    try {
      const summary = await runBatchConversion(queue, {
        mode,
        targetDpi: dpi,
        notesSettings: {
          margins: marginPresets[margins],
          bodyFontSize: scaleFactors[scale],
          preserveEquations,
          preserveTables,
        },
        slideSettings: {
          fittingStrategy: slideFitting,
          orientation: slideOrientation,
          targetDpi: dpi,
        },
        onItemProgress: (item, p) => {
          setQueue((prev) =>
            prev.map((q) => (q.id === item.id ? { ...q, progress: p, status: 'converting' } : q)),
          )
        },
        onBatchProgress: (bp) => {
          setBatchProgress(bp)
          setQueue((prev) =>
            prev.map((q) => {
              if (q.id === bp.currentItem.id) {
                return {
                  ...q,
                  status: bp.currentItem.status,
                  error: bp.currentItem.error,
                  result: bp.currentItem.result,
                }
              }
              return q
            }),
          )
        },
      })

      setBatchSummary(summary)

      // Automatically render converted preview for the first completed file
      const firstSuccess = summary.items.find((item) => item.status === 'completed' && item.result)
      if (firstSuccess && firstSuccess.result) {
        setSelectedPreviewId(firstSuccess.id)
        setPreviewTab('converted')
        setPreviewPageNum(1)
        renderConvertedPreviewPage(firstSuccess.result.pdfBytes, 1)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(`Batch conversion error: ${msg}`)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleDownloadSingle = async (item: BatchItem) => {
    if (!item.result) return
    if (isNativeApp && outputDir) {
      const savedPath = await saveFileToNativeDir(item.result.fileName, item.result.pdfBytes)
      if (savedPath) {
        setLastSavedMessage(`Saved: ${savedPath}`)
        setTimeout(() => setLastSavedMessage(null), 4000)
      }
    }
    const blob = new Blob([item.result.pdfBytes as BlobPart], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = item.result.fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDownloadZip = async () => {
    if (!batchSummary || batchSummary.successfulResults.length === 0) return
    try {
      const zipBytes = await createBatchZip(batchSummary.successfulResults)
      const zipName = buildBatchZipName(batchSummary.mode, batchSummary.successfulResults.length)
      if (isNativeApp && outputDir) {
        const savedPath = await saveFileToNativeDir(zipName, zipBytes)
        if (savedPath) {
          setLastSavedMessage(`Saved batch archive: ${savedPath}`)
          setTimeout(() => setLastSavedMessage(null), 4000)
        }
      }
      const zipBlob = new Blob([zipBytes as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = zipName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setErrorMessage(`ZIP creation error: ${msg}`)
    }
  }

  const handleShutdown = async () => {
    if (isProcessing) {
      const proceed = window.confirm(
        'A conversion is currently in progress. Are you sure you want to stop KindleFlow and exit?'
      )
      if (!proceed) return
    } else {
      const proceed = window.confirm('Exit KindleFlow and stop the local server?')
      if (!proceed) return
    }

    try {
      await fetch('/api/shutdown', { method: 'POST' })
    } catch {
      // Server may terminate socket before HTTP response completes
    }
    setIsShutDown(true)
  }

  const completedCount = queue.filter((q) => q.status === 'completed').length
  const failedCount = queue.filter((q) => q.status === 'failed').length
  const totalCount = queue.length
  const totalSizeMb = queue.reduce((acc, f) => acc + f.size, 0) / (1024 * 1024)

  if (isShutDown) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center p-6 text-slate-800">
        <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Power size={26} className="text-slate-700" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">KindleFlow Stopped</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            The local application server has shut down gracefully and freed network port 38281.
          </p>
          <div className="mt-5 rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-500">
            You can now safely close this browser window or tab.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800">
      {/* 1. COMPACT TOP HEADER */}
      <header className="sticky top-0 z-30 h-16 border-b border-slate-200 bg-white/95 px-4 backdrop-blur-sm sm:px-6">
        <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4">
          {/* Identity */}
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white shadow-xs">
              <FileText size={18} strokeWidth={2.4} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold tracking-tight text-slate-900">Doc2Kindle</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                  v2.4
                </span>
              </div>
              <p className="text-[10px] text-slate-500 hidden sm:block">
                Academic Papers, Notes &amp; Lecture Slides Reflower for E-Ink
              </p>
            </div>
          </div>

          {/* Privacy Indicator Badge (Center) */}
          <div className="hidden md:flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 shadow-2xs">
            <CheckCircle2 size={13} className="text-emerald-600" />
            <span>Processed 100% locally (offline &amp; private)</span>
          </div>

          {/* Guides & Exit Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowGuidesModal(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <BookOpen size={14} className="text-slate-500" />
              <span>Guides</span>
            </button>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center justify-center h-7 w-7 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Settings"
            >
              <Settings size={15} />
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <button
              onClick={handleShutdown}
              className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition-colors cursor-pointer shadow-2xs"
              title="Exit KindleFlow and stop the local server"
            >
              <Power size={13} className="text-rose-600" />
              <span>Exit KindleFlow</span>
            </button>
          </div>
        </div>
      </header>

      {/* 2. TWO-COLUMN WORKSPACE LAYOUT */}
      <main className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_480px] xl:grid-cols-[minmax(0,1.05fr)_520px] gap-6 items-start">
          
          {/* LEFT COLUMN: PRIMARY WORKFLOW */}
          <div className="space-y-4">
            
            {/* SECTION 1: SELECT PDF DOCUMENTS */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-amber-50 text-amber-700">
                    <Upload size={13} />
                  </span>
                  <h2 className="text-[13px] font-bold text-slate-900">1. Select PDF Documents</h2>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                  <CheckCircle2 size={12} className="text-slate-400" />
                  <span>Multi-file batch enabled</span>
                </div>
              </div>

              {/* Compact Drag & Drop Zone */}
              <div
                className={`flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-all ${
                  isDragging
                    ? 'border-sky-500 bg-sky-50/50'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-300'
                }`}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (!isProcessing) setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (!isProcessing) addFiles(e.dataTransfer.files)
                }}
              >
                <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-2xs text-slate-500">
                  <UploadCloud size={17} />
                </div>
                <p className="text-xs font-semibold text-slate-800">
                  Drop one or multiple PDF documents here
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  Add as many PDFs as needed before starting conversion (Double-column papers, lecture slides, books)
                </p>
                <div className="mt-3">
                  <Button
                    onClick={() => inputRef.current?.click()}
                    disabled={isProcessing}
                    variant="outline"
                    className="h-7.5 rounded-lg border-slate-200 bg-white px-3.5 text-xs font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
                  >
                    <FolderOpen size={13} className="mr-1.5 text-slate-500" /> Browse PDF Files
                  </Button>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </div>

              {/* Error Alert */}
              {errorMessage && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800">
                  <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-600" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Queued Files Section */}
              {queue.length > 0 && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between pb-2 text-[10px] font-bold tracking-wider text-slate-400 uppercase">
                    <span>
                      QUEUED FILES ({queue.length} {queue.length === 1 ? 'ITEM' : 'ITEMS'} · {totalSizeMb.toFixed(1)} MB)
                    </span>
                    {!isProcessing && (
                      <button
                        onClick={clearQueue}
                        className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 hover:underline cursor-pointer"
                      >
                        Clear All
                      </button>
                    )}
                  </div>

                  <div className="max-h-[260px] overflow-y-auto space-y-1.5 pr-1">
                    {queue.map((item) => {
                      const isSelected = item.id === selectedPreviewId
                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectPreviewItem(item)}
                          className={`group flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition-colors cursor-pointer ${
                            isSelected
                              ? 'border-sky-300 bg-sky-50/60'
                              : 'border-slate-100 bg-slate-50/60 hover:bg-slate-100/70 hover:border-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[9px] font-bold text-rose-600 border border-rose-200 shrink-0">
                              PDF
                            </span>
                            <span
                              className={`truncate font-semibold ${
                                isSelected ? 'text-sky-900' : 'text-slate-800'
                              }`}
                              title={item.name}
                            >
                              {item.name}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400">
                              {item.validationResult
                                ? `${item.validationResult.pageCount} ${mode === 'slides' ? 'slides' : 'pages'}`
                                : ''}
                              {' · '}
                              {(item.size / (1024 * 1024)).toFixed(1)} MB
                            </span>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Status Badge */}
                            {item.status === 'validating' && (
                              <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                <Loader2 size={10} className="animate-spin" /> Validating
                              </span>
                            )}
                            {item.status === 'queued' && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                                Ready
                              </span>
                            )}
                            {item.status === 'converting' && (
                              <span className="flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                                <Loader2 size={10} className="animate-spin" />
                                {item.progress?.percent || 0}%
                              </span>
                            )}
                            {item.status === 'completed' && (
                              <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                                <Check size={10} strokeWidth={2.5} /> Done
                              </span>
                            )}
                            {item.status === 'failed' && (
                              <span
                                className="flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 border border-rose-200"
                                title={item.error || 'Conversion failed'}
                              >
                                Failed
                              </span>
                            )}

                            {/* Active preview indicator */}
                            {isSelected && item.status !== 'completed' && item.status !== 'failed' && item.status !== 'converting' && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200">
                                Previewing
                              </span>
                            )}

                            {/* Download button for completed item */}
                            {item.result && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleDownloadSingle(item)
                                }}
                                className="flex h-6 items-center gap-1 rounded bg-emerald-600 px-2 text-[10px] font-semibold text-white hover:bg-emerald-700 shadow-2xs"
                                title={`Download ${item.result.fileName}`}
                              >
                                <Download size={10} /> PDF
                              </button>
                            )}

                            {/* Remove button */}
                            {!isProcessing && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  removeFile(item.id)
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                                title="Remove file"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* SECTION 2: CHOOSE CONVERSION MODE & SETTINGS */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-700">
                    <LayoutTemplate size={13} />
                  </span>
                  <h2 className="text-[13px] font-bold text-slate-900">
                    2. Choose Conversion Mode &amp; Settings
                  </h2>
                </div>
                <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold text-sky-700">
                  Uniform Batch Mode
                </span>
              </div>
              <p className="mb-3 text-[11px] text-slate-500">
                Every file in the batch will be processed using this selected conversion pipeline.
              </p>

              {/* Mode Selection Cards */}
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Mode A: Notes Reflow */}
                <div
                  onClick={() => !isProcessing && setMode('notes')}
                  className={`relative flex flex-col justify-between rounded-xl border p-3.5 transition-all ${
                    isProcessing ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    mode === 'notes'
                      ? 'border-slate-900 bg-slate-50/50 shadow-xs ring-1 ring-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                        <BookOpen size={15} />
                      </div>
                      {mode === 'notes' ? (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase">
                          Active Mode
                        </span>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-slate-500 uppercase">
                          Alternative
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Mode A — Notes Reflow</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Reflows ordinary text into fluid single-column Kindle pages while preserving equations, tables,
                      and diagrams intact as high-DPI regions.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 text-[10px] font-medium text-slate-600">
                    Best for: Textbooks, research papers, Notion academic notes
                  </div>
                </div>

                {/* Mode B: Slides / Enlargement */}
                <div
                  onClick={() => !isProcessing && setMode('slides')}
                  className={`relative flex flex-col justify-between rounded-xl border p-3.5 transition-all ${
                    isProcessing ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer'
                  } ${
                    mode === 'slides'
                      ? 'border-slate-900 bg-slate-50/50 shadow-xs ring-1 ring-slate-900'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                        <Presentation size={15} />
                      </div>
                      {mode === 'slides' ? (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[9px] font-bold tracking-wider text-white uppercase">
                          Active Mode
                        </span>
                      ) : (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-slate-500 uppercase">
                          Alternative
                        </span>
                      )}
                    </div>
                    <h3 className="text-xs font-bold text-slate-900">Mode B — Slides / Enlargement</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                      Never reflows text. High-resolution rasterization, conservative margin safeguards, and proportional
                      enlargement for a landscape Kindle screen.
                    </p>
                  </div>
                  <div className="mt-3 pt-2 border-t border-slate-100 text-[10px] font-medium text-slate-600">
                    Best for: Presentation decks, lecture slides, diagrams
                  </div>
                </div>
              </div>

              {/* Parameters Panel */}
              <div className="mt-3.5 rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                <p className="mb-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  {mode === 'notes' ? 'Notes Reflow Parameters' : 'Slide Enlargement Parameters'}
                </p>

                {mode === 'notes' ? (
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <SettingDropdown
                        label="Kindle Margins"
                        value={margins}
                        options={['Standard', 'Narrow', 'Wide']}
                        onChange={(v) => setMargins(v as any)}
                      />
                      <SettingDropdown
                        label="Body Font Size"
                        value={scale}
                        options={['90%', '100%', '110%', '120%']}
                        onChange={(v) => setScale(v as any)}
                      />
                      <SettingDropdown
                        label="Cropped Region DPI"
                        value={resolution}
                        options={['150 DPI', '300 DPI', '600 DPI']}
                        onChange={(v) => setResolution(v as any)}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-5 pt-1 text-xs">
                      <CheckboxToggle
                        label="Preserve equations"
                        checked={preserveEquations}
                        onChange={setPreserveEquations}
                      />
                      <CheckboxToggle
                        label="Preserve tables"
                        checked={preserveTables}
                        onChange={setPreserveTables}
                      />
                      <CheckboxToggle
                        label="Auto-strip running headers & footers"
                        checked={autoStripHeaders}
                        onChange={setAutoStripHeaders}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <SettingDropdown
                      label="Fitting Strategy"
                      value={
                        slideFitting === 'original-proportions'
                          ? 'Original Proportions (No Crop)'
                          : 'Smart Margin (Trim Borders)'
                      }
                      options={['Original Proportions (No Crop)', 'Smart Margin (Trim Borders)']}
                      onChange={(v) =>
                        setSlideFitting(v.startsWith('Original') ? 'original-proportions' : 'smart-margin')
                      }
                    />
                    <SettingDropdown
                      label="Display Orientation"
                      value={slideOrientation === 'landscape' ? 'Landscape (4:3)' : 'Portrait (3:4)'}
                      options={['Landscape (4:3)', 'Portrait (3:4)']}
                      onChange={(v) =>
                        setSlideOrientation(v.startsWith('Landscape') ? 'landscape' : 'portrait')
                      }
                    />
                    <SettingDropdown
                      label="Render Resolution"
                      value={resolution}
                      options={['150 DPI', '300 DPI', '600 DPI']}
                      onChange={(v) => setResolution(v as any)}
                    />
                  </div>
                )}
              </div>

              {/* Output Directory Bar */}
              <div className="mt-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <FolderOpen size={15} className="shrink-0 text-sky-600" />
                  <div className="truncate">
                    <span className="font-semibold text-slate-700">Output Folder: </span>
                    <span className="font-mono text-[11px] text-slate-600" title={outputDir || 'Browser Downloads'}>
                      {outputDir || 'Browser Downloads (Default)'}
                    </span>
                  </div>
                </div>
                <Button
                  onClick={handleBrowseOutputDir}
                  disabled={isSelectingDir}
                  variant="outline"
                  className="h-7 shrink-0 rounded-lg border-slate-200 bg-white px-3 text-[11px] font-medium text-slate-700 shadow-2xs hover:bg-slate-50"
                >
                  <FolderOpen size={12} className="mr-1 text-slate-500" />
                  {isSelectingDir ? 'Selecting...' : 'Change Folder'}
                </Button>
              </div>

              {lastSavedMessage && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                  <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                  <span className="truncate">{lastSavedMessage}</span>
                </div>
              )}

              {/* Collapsible Advanced Reflow & Delivery Settings */}
              <div className="mt-3 rounded-xl border border-slate-100 bg-white">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex w-full items-center justify-between px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Sliders size={13} className="text-slate-500" />
                    <span>Advanced Reflow &amp; Kindle Delivery Settings</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-500">
                      Optional
                    </span>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
                    {showAdvanced ? 'Hide ^' : 'Show v'}
                  </span>
                </button>

                {showAdvanced && (
                  <div className="border-t border-slate-100 p-4 text-xs">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          FORMULAS &amp; IMAGE EXTRACTION
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          Equations and diagrams are extracted in high resolution (300+ DPI) with anti-aliasing to guarantee razor-sharp contrast on E-Ink Pearl and Carta displays.
                        </p>
                        <div className="mt-2 text-[11px] text-slate-500">
                          - Formula sharpening filter: Enabled
                          <br />
                          - Table column alignment: Strict cell preservation
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                          DIRECT KINDLE DELIVERY
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          KindleFlow operates 100% locally and never transmits files over remote servers. To transfer your converted PDFs:
                        </p>
                        <ul className="mt-2 space-y-1 text-[11px] text-slate-500">
                          <li>• <strong>Web:</strong> Drop downloaded PDFs into <em>amazon.com/sendtokindle</em></li>
                          <li>• <strong>Email:</strong> Attach to an email sent from your approved address to your <code>@kindle.com</code> account</li>
                          <li>• <strong>USB:</strong> Copy directly to your Kindle&apos;s <code>documents/</code> directory</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* RESULTS BANNER (When Batch Complete) */}
            {batchSummary && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} className="text-emerald-600" />
                      <h4 className="text-xs font-bold text-emerald-900">Batch Conversion Finished</h4>
                    </div>
                    <p className="mt-0.5 text-[11px] text-emerald-700">
                      {batchSummary.completed} of {batchSummary.total} files converted successfully.
                      {batchSummary.failed > 0 && ` (${batchSummary.failed} failed and excluded from ZIP)`}
                    </p>
                  </div>
                  {batchSummary.successfulResults.length > 0 && (
                    <Button
                      onClick={handleDownloadZip}
                      className="h-8 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-700"
                    >
                      <Archive size={13} className="mr-1.5" /> Download All Converted PDFs (.ZIP)
                    </Button>
                  )}
                </div>
              </div>
            )}

            {/* SECTION 3: BOTTOM ACTION BAR */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600">
                  <Zap size={18} className="fill-sky-600" />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900">
                    {isProcessing
                      ? 'Converting Queue...'
                      : batchSummary
                        ? 'Batch Conversion Complete'
                        : 'Ready to Reflow'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {queue.length} {queue.length === 1 ? 'PDF' : 'PDFs'} in queue · Mode{' '}
                    {mode === 'notes' ? 'A (Notes Reflow)' : 'B (Slides / Enlargement)'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <Button
                  onClick={handleCyclePreview}
                  disabled={queue.length === 0}
                  variant="outline"
                  className="h-9 rounded-lg border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                >
                  <Eye size={13} className="mr-1.5 text-slate-500" /> Preview All
                </Button>

                <Button
                  onClick={handleStartConversion}
                  disabled={isProcessing || queue.length === 0}
                  className="h-9 rounded-lg bg-sky-600 px-4 text-xs font-bold text-white shadow-xs hover:bg-sky-700"
                >
                  {isProcessing ? (
                    <>
                      <RotateCcw size={13} className="mr-1.5 animate-spin" />
                      Converting ({batchProgress ? `${batchProgress.currentIndex + 1}/${batchProgress.totalItems}` : '...'})
                    </>
                  ) : (
                    <>
                      <Send size={13} className="mr-1.5" />
                      {queue.length === 0
                        ? 'Convert to Kindle'
                        : queue.length === 1
                          ? 'Convert to Kindle (1 File)'
                          : `Convert to Kindle (${queue.length} Files)`}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Overall Conversion Progress Bar during processing */}
            {isProcessing && batchProgress && (
              <div className="rounded-xl border border-sky-100 bg-sky-50/50 p-3.5">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>
                    Converting {batchProgress.currentIndex + 1} of {batchProgress.totalItems}:{' '}
                    <span className="font-normal text-slate-500">{batchProgress.currentItem.name}</span>
                  </span>
                  <span>{batchProgress.overallPercent}%</span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-sky-600 transition-all duration-300"
                    style={{ width: `${batchProgress.overallPercent}%` }}
                  />
                </div>
                {batchProgress.currentItem.progress && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    Step: {batchProgress.currentItem.progress.message}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* RIGHT COLUMN: VISUAL PREVIEW & KINDLE DEVICE SIMULATOR */}
          <aside className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden lg:sticky lg:top-18">
            {/* Preview Header */}
            <div className="border-b border-slate-100 px-4 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 pr-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded text-slate-500">
                    <Eye size={14} />
                  </span>
                  <span className="truncate text-xs font-bold text-slate-900">
                    Visual Preview{' '}
                    {activePreviewItem && (
                      <span className="font-normal text-slate-500">
                        ({activePreviewItem.name.replace(/\.pdf$/i, '').slice(0, 22)}...)
                      </span>
                    )}
                  </span>
                </div>

                {/* Segmented Control: Original vs Kindle */}
                <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-[11px] font-semibold">
                  <button
                    onClick={() => setPreviewTab('original')}
                    className={`rounded-md px-2.5 py-1 transition-all ${
                      previewTab === 'original'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Original
                  </button>
                  <button
                    onClick={() => {
                      setPreviewTab('converted')
                      if (activePreviewItem?.result) {
                        renderConvertedPreviewPage(activePreviewItem.result.pdfBytes, previewPageNum)
                      }
                    }}
                    className={`rounded-md px-2.5 py-1 transition-all ${
                      previewTab === 'converted'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    Kindle
                  </button>
                </div>
              </div>
            </div>

            {/* Sub-toolbar: Page Navigation, Simulator Tag, Zoom */}
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-2 text-xs">
              {/* Page Controls */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handlePageNavigation(-1)}
                  disabled={previewPageNum <= 1}
                  className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  title="Previous page"
                >
                  <ChevronLeft size={13} />
                </button>
                <span className="px-1 text-[11px] font-medium text-slate-600">
                  Page <strong className="font-bold text-slate-900">{previewPageNum}</strong> of{' '}
                  {previewTotalPages || 1}
                </span>
                <button
                  onClick={() => handlePageNavigation(1)}
                  disabled={previewPageNum >= previewTotalPages}
                  className="flex h-6 w-6 items-center justify-center rounded border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  title="Next page"
                >
                  <ChevronRight size={13} />
                </button>
              </div>

              {/* Screen Sim Badge */}
              <div className="hidden sm:block rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-2xs">
                Paperwhite 6.8&quot; Screen Sim
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                <button
                  onClick={() => setPreviewZoom((z) => Math.max(80, z - 10))}
                  className="hover:text-slate-800 px-0.5"
                  title="Zoom out"
                >
                  -
                </button>
                <span className="font-semibold text-slate-700">{previewZoom}%</span>
                <button
                  onClick={() => setPreviewZoom((z) => Math.min(130, z + 10))}
                  className="hover:text-slate-800 px-0.5"
                  title="Zoom in"
                >
                  +
                </button>
              </div>
            </div>

            {/* REALISTIC KINDLE BEZEL CONTAINER */}
            <div className="p-4 sm:p-5 bg-slate-50 flex items-center justify-center">
              <div className="w-full max-w-[390px] rounded-[36px] bg-[#111827] p-4 sm:p-5 shadow-2xl border-4 border-slate-800/60 flex flex-col items-center justify-between">
                
                {/* White Kindle E-Ink Screen Area */}
                <div
                  className="relative w-full overflow-hidden rounded-md border border-slate-300/60 bg-white shadow-inner flex flex-col justify-between"
                  style={{
                    minHeight: '440px',
                    aspectRatio: mode === 'slides' && slideOrientation === 'landscape' ? '4/3' : '3/4',
                  }}
                >
                  {previewTab === 'original' ? (
                    originalCanvasUrl ? (
                      <div className="flex h-full w-full items-center justify-center overflow-auto p-1 bg-white">
                        <img
                          src={originalCanvasUrl}
                          alt="Original document page"
                          className="max-h-[460px] w-auto object-contain transition-transform"
                          style={{ transform: `scale(${previewZoom / 100})` }}
                        />
                      </div>
                    ) : (
                      <div className="flex h-[440px] flex-col items-center justify-center p-6 text-center text-slate-400">
                        <FileText size={32} className="mb-2 stroke-1 text-slate-300" />
                        <p className="text-xs font-semibold text-slate-500">No Document Selected</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          Add a PDF to the queue to inspect original source pages.
                        </p>
                      </div>
                    )
                  ) : convertedCanvasUrl ? (
                    <div className="flex h-full w-full items-center justify-center overflow-auto p-1 bg-white">
                      <img
                        src={convertedCanvasUrl}
                        alt="Converted Kindle page"
                        className="max-h-[460px] w-auto object-contain transition-transform"
                        style={{ transform: `scale(${previewZoom / 100})` }}
                      />
                    </div>
                  ) : isRenderingPreview ? (
                    <div className="flex h-[440px] flex-col items-center justify-center p-6 text-center">
                      <Loader2 size={24} className="mb-2 animate-spin text-sky-600" />
                      <p className="text-xs font-semibold text-slate-600">Rendering Kindle Preview...</p>
                    </div>
                  ) : activePreviewItem?.result ? (
                    <div className="flex h-[440px] flex-col items-center justify-center p-6 text-center">
                      <Button
                        onClick={() =>
                          renderConvertedPreviewPage(activePreviewItem.result!.pdfBytes, previewPageNum)
                        }
                        className="h-8 bg-sky-600 text-xs text-white"
                      >
                        Click to render Kindle page
                      </Button>
                    </div>
                  ) : (
                    /* Mock Preview representation matching the wireframe before conversion */
                    <div className="flex h-full flex-col justify-between p-4 text-left select-none text-slate-800 bg-[#fdfefe]">
                      <div>
                        <div className="flex justify-between border-b border-slate-200 pb-1 text-[8px] font-bold tracking-wider text-slate-400 uppercase">
                          <span>3.2 SCALED DOT-PRODUCT ATTENTION</span>
                          <span>REFLOWED PAGE {previewPageNum}</span>
                        </div>
                        <p className="mt-2 text-[10px] leading-relaxed text-slate-700">
                          We call our particular attention <strong>Scaled Dot-Product Attention</strong>. The input
                          consists of queries and keys of dimension <em>d_k</em>, and values of dimension <em>d_v</em>.
                        </p>
                        <div className="my-2.5 rounded border border-dashed border-sky-300 bg-sky-50/50 p-2 text-center">
                          <span className="text-[8px] font-bold text-sky-700 uppercase">
                            [PRESERVED HIGH-DPI FORMULA REGION · 300 DPI]
                          </span>
                          <p className="mt-1 font-serif text-xs font-bold text-slate-900 tracking-wide">
                            Attention(Q, K, V) = softmax(Q Kᵀ / √d_k) V
                          </p>
                        </div>
                        <p className="text-[10px] leading-relaxed text-slate-700">
                          In practice, we compute the attention function on a set of queries simultaneously, packed
                          together into a matrix <em>Q</em>. The keys and values are also packed together into matrices{' '}
                          <em>K</em> and <em>V</em>.
                        </p>
                        <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-1.5 text-center text-[9px] text-slate-500 font-medium">
                          Figure 2: Scaled Dot-Product Diagram
                          <br />
                          <span className="text-[8px] text-slate-400">Cropped Vector Graphic (High DPI)</span>
                        </div>
                      </div>

                      <div className="flex justify-between pt-2 border-t border-slate-100 text-[8px] font-medium text-slate-400">
                        <span>Loc 412 of 1850</span>
                        <span>24% · 8 mins left in chapter</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Kindle Logo Chin */}
                <div className="pt-3 pb-0.5 text-center">
                  <span className="font-sans text-[11px] font-semibold text-slate-400 tracking-[0.25em] select-none opacity-70">
                    kindle
                  </span>
                </div>
              </div>
            </div>

            {/* Preview Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-white px-4 py-2.5 text-xs">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>
                  Reflow Engine: <strong>Ready</strong> ({lastRenderTime} render)
                </span>
              </div>
              <button
                onClick={() => setShowComparisonModal(true)}
                className="text-[11px] font-semibold text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1"
              >
                <span>Open Fullscreen Comparison</span>
                <ChevronRight size={12} />
              </button>
            </div>
          </aside>
        </div>
      </main>

      {/* FULLSCREEN COMPARISON MODAL */}
      {showComparisonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4 backdrop-blur-xs">
          <div className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Maximize2 size={16} className="text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  Side-by-Side Comparison:{' '}
                  <span className="font-normal text-slate-500">
                    {activePreviewItem?.name || 'Document'} (Page {previewPageNum})
                  </span>
                </h3>
              </div>
              <button
                onClick={() => setShowComparisonModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-5 overflow-auto bg-slate-50">
              {/* Left: Original */}
              <div className="flex flex-col items-center">
                <span className="mb-2 text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Original Source Document
                </span>
                <div className="flex min-h-[460px] w-full items-center justify-center rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                  {originalCanvasUrl ? (
                    <img
                      src={originalCanvasUrl}
                      alt="Original Document Page"
                      className="max-h-[520px] w-auto object-contain"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">Original page not rendered</span>
                  )}
                </div>
              </div>

              {/* Right: Kindle */}
              <div className="flex flex-col items-center">
                <span className="mb-2 text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Kindle Reflow Output (E-Ink Layout)
                </span>
                <div className="flex min-h-[460px] w-full items-center justify-center rounded-xl border border-slate-900 bg-white p-3 shadow-md">
                  {convertedCanvasUrl ? (
                    <img
                      src={convertedCanvasUrl}
                      alt="Converted Kindle Page"
                      className="max-h-[520px] w-auto object-contain"
                    />
                  ) : (
                    <div className="text-center p-6 text-xs text-slate-500">
                      Convert the document first to view full side-by-side comparison.
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-100 px-5 py-3 bg-white">
              <Button
                onClick={() => setShowComparisonModal(false)}
                className="h-8 rounded-lg bg-slate-900 text-xs text-white"
              >
                Close Comparison
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* GUIDES MODAL */}
      {showGuidesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="text-sky-600" />
                <h3 className="text-sm font-bold text-slate-900">KindleFlow User Guide</h3>
              </div>
              <button
                onClick={() => setShowGuidesModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 p-5 text-xs text-slate-600 overflow-auto">
              <div>
                <h4 className="font-bold text-slate-900">Mode A — Notes Reflow</h4>
                <p className="mt-1 leading-relaxed">
                  Converts multi-column academic PDFs and textbooks into single-column Kindle pages. Body text is fluidly wrapped at readable sizes, while complex regions like math equations, tables, and figures are preserved as high-DPI raster crops.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-900">Mode B — Slides / Enlargement</h4>
                <p className="mt-1 leading-relaxed">
                  Best for lecture slides, PowerPoint decks, and widescreen diagrams. Keeps exact 1:1 slide visuals, enlarges the canvas to fit a Kindle screen in landscape or portrait, and applies conservative margin safeguards.
                </p>
              </div>

              <div>
                <h4 className="font-bold text-slate-900">Transferring Converted PDFs to Kindle</h4>
                <ul className="mt-1 list-disc pl-4 space-y-1">
                  <li>
                    <strong>USB Transfer:</strong> Connect Kindle to your PC, copy downloaded PDFs to the <code>documents</code> folder.
                  </li>
                  <li>
                    <strong>Amazon Send-to-Kindle:</strong> Visit <em>amazon.com/sendtokindle</em> or email the PDF to your Kindle email address.
                  </li>
                </ul>
              </div>

              <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-emerald-800">
                <span className="font-bold">Offline &amp; Private:</span> All extraction, analysis, and generation happen 100% inside your local browser. No data ever leaves your computer.
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-100 px-5 py-3 bg-white">
              <Button
                onClick={() => setShowGuidesModal(false)}
                className="h-8 rounded-lg bg-sky-600 text-xs text-white"
              >
                Got It
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-medium text-slate-600">
      <span>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-800 outline-none focus:border-sky-500 shadow-2xs"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function CheckboxToggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 select-none text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-slate-300 text-sky-600 accent-sky-600 focus:ring-sky-500"
      />
      <span className="text-[11px] font-medium">{label}</span>
    </label>
  )
}

import * as fs from 'fs'
import * as path from 'path'
import { convertPdfToKindleNotes } from './convert_pdf.mjs'

async function main() {
  const inputPdf = 'regression-data/unit_3.pdf'
  const outputPdf = 'regression-data/unit_3-kindle-notes-fixed.pdf'

  console.log(`Starting conversion of ${inputPdf}...`)
  const startTime = Date.now()

  const { layout, result, analyzed } = await convertPdfToKindleNotes(inputPdf, outputPdf)

  const duration = ((Date.now() - startTime) / 1000).toFixed(2)
  console.log(`Conversion completed in ${duration}s.`)
  console.log(`Generated ${outputPdf}: ${result.pdfBytes.byteLength} bytes, ${result.pageCount} pages.`)
  console.log(`Layout pages: ${layout.pages.length}, Analyzed pages: ${analyzed.pages.length}`)
}

main().catch(err => {
  console.error('Conversion failed:', err)
  process.exit(1)
})

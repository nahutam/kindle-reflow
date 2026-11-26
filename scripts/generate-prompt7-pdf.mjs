import * as fs from 'fs'
import * as path from 'path'
import ts from 'typescript'

async function importTS(tsFilePath) {
  const code = fs.readFileSync(tsFilePath, 'utf8')
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const tempPath = tsFilePath.replace(/\.ts$/, '.tmp.mjs')
  const rewritten = transpiled.replace(/from\s+['"]\.\/([^'"]+)['"]/g, (_, p) => {
    if (p.endsWith('.tmp.mjs')) return `from './${p}'`
    if (p.endsWith('.ts')) return `from './${p.replace(/\.ts$/, '.tmp.mjs')}'`
    return `from './${p}.tmp.mjs'`
  })
  fs.writeFileSync(tempPath, rewritten, 'utf8')
  const mod = await import('file://' + path.resolve(tempPath).replace(/\\/g, '/'))
  return { mod, tempPath }
}

async function generateKindlePDF() {
  const typesRes = await importTS('lib/converter/types.ts')
  const workerRes = await importTS('lib/converter/worker-loader.ts')
  const validatorRes = await importTS('lib/converter/validator.ts')
  const extractorRes = await importTS('lib/converter/extractor.ts')
  const lineRes = await importTS('lib/converter/line-reconstructor.ts')
  const structRes = await importTS('lib/converter/structure-analyzer.ts')
  const orderRes = await importTS('lib/converter/reading-order.ts')
  const paraRes = await importTS('lib/converter/paragraph-reconstructor.ts')
  const classRes = await importTS('lib/converter/classifier.ts')
  const reflowRes = await importTS('lib/converter/text-reflower.ts')
  const preserverRes = await importTS('lib/converter/region-preserver.ts')
  const layoutValRes = await importTS('lib/converter/layout-validator.ts')
  const layoutEngRes = await importTS('lib/converter/layout-engine.ts')
  const pdfGenRes = await importTS('lib/converter/pdf-generator.ts')
  const slideRes = await importTS('lib/converter/slide-converter.ts')
  const indexRes = await importTS('lib/converter/index.ts')

  const pdfBytes = new Uint8Array(fs.readFileSync('C:/Users/PC/Downloads/breathing systems.pdf'))
  const extracted = await indexRes.mod.extractDocument(pdfBytes, { fileName: 'breathing systems.pdf' })
  const analyzed = await indexRes.mod.analyzeDocument(extracted)
  const measurer = pdfGenRes.mod.createJsPDFTextMeasurer()
  const layout = await indexRes.mod.layoutDocument(analyzed, { measurer })

  console.log(`Layout completed: ${layout.pages.length} Kindle pages generated.`)

  const t1Base64 = fs.readFileSync('scripts/table1.png').toString('base64')
  const t2Base64 = fs.readFileSync('scripts/table2.png').toString('base64')

  const realCropRenderer = async (pageNumber, box, targetDpi) => {
    if (pageNumber === 3) {
      return {
        data: `data:image/png;base64,${t1Base64}`,
        format: 'PNG',
        pixelWidth: 1132,
        pixelHeight: 547,
      }
    }
    return {
      data: `data:image/png;base64,${t2Base64}`,
      format: 'PNG',
      pixelWidth: 1885,
      pixelHeight: 1254,
    }
  }

  const result = await pdfGenRes.mod.generateNotesPDF(layout, {
    sourcePdfBytes: pdfBytes,
    regionRenderer: realCropRenderer,
    cropRenderer: realCropRenderer,
  })

  const outputPath = 'C:/Users/PC/Downloads/breathing systems-kindle-notes.pdf'
  fs.writeFileSync(outputPath, result.pdfBytes)
  console.log(`Wrote converted PDF to ${outputPath} (${result.pdfBytes.byteLength} bytes)`)

  // Inspect the generated Kindle PDF
  console.log('\n=== VERIFYING GENERATED KINDLE PDF ===')
  for (let i = 0; i < layout.pages.length; i++) {
    const kp = layout.pages[i]
    console.log(`\n--- Kindle Page ${kp.pageNumber} (${kp.elements.length} elements) ---`)
    for (const el of kp.elements) {
      if (el.kind === 'text') {
        console.log(`  [TEXT] (${el.font.size}pt, ${el.font.weight}): ${el.text.slice(0, 75)}`)
      } else {
        console.log(`  [REGION] (srcPage=${el.sourcePageNumber}, w=${el.box.width.toFixed(1)}, h=${el.box.height.toFixed(1)}, scale=${el.scaleRatio ?? 1})`)
      }
    }
  }
}

generateKindlePDF().catch(console.error)

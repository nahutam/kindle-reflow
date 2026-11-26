import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
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

async function renderCropsWithPython(pdfPath, crops) {
  return new Promise((resolve, reject) => {
    const python = spawn('python', ['scripts/crop_regions.py'])
    let stdout = ''
    let stderr = ''
    python.stdout.on('data', (d) => { stdout += d.toString() })
    python.stderr.on('data', (d) => { stderr += d.toString() })
    python.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`crop_regions.py exited with code ${code}: ${stderr}`))
      }
      try {
        const parsed = JSON.parse(stdout)
        resolve(parsed)
      } catch (err) {
        reject(err)
      }
    })
    python.stdin.write(JSON.stringify({ pdfPath, crops, dpi: 300 }))
    python.stdin.end()
  })
}

export async function convertPdfToKindleNotes(inputPdfPath, outputPdfPath) {
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

  const pdfBytes = new Uint8Array(fs.readFileSync(inputPdfPath))
  const extracted = await indexRes.mod.extractDocument(pdfBytes, { fileName: path.basename(inputPdfPath) })
  const analyzed = await indexRes.mod.analyzeDocument(extracted)
  const measurer = pdfGenRes.mod.createJsPDFTextMeasurer()
  const layout = await indexRes.mod.layoutDocument(analyzed, { measurer })

  // Find all preserved regions in layout
  const cropsToRender = []
  for (const page of layout.pages) {
    for (const el of page.elements) {
      if (el.kind === 'preserved-region') {
        cropsToRender.push({
          id: el.id,
          page: el.sourcePageNumber,
          box: [el.sourceBox.x, el.sourceBox.y, el.sourceBox.x + el.sourceBox.width, el.sourceBox.y + el.sourceBox.height]
        })
      }
    }
  }

  let cropMap = {}
  if (cropsToRender.length > 0) {
    cropMap = await renderCropsWithPython(inputPdfPath, cropsToRender)
  }

  const universalCropRenderer = async (pdfDoc, pageNumber, box, targetDpi) => {
    // Render on the fly using python crop_regions
    const res = await renderCropsWithPython(inputPdfPath, [{
      id: 'adhoc',
      page: pageNumber,
      box: [box.x, box.y, box.x + box.width, box.y + box.height]
    }])
    return res['adhoc']
  }

  const result = await pdfGenRes.mod.generateNotesPDF(layout, {
    sourcePdfBytes: pdfBytes,
    regionRenderer: universalCropRenderer,
    cropRenderer: universalCropRenderer,
  })

  fs.mkdirSync(path.dirname(outputPdfPath), { recursive: true })
  fs.writeFileSync(outputPdfPath, result.pdfBytes)
  console.log(`Converted ${inputPdfPath} -> ${outputPdfPath} (${result.pdfBytes.byteLength} bytes, ${layout.pages.length} pages)`)

  return { layout, result, analyzed, extracted }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/convert_pdf.mjs')) {
  const [,, input, output] = process.argv
  if (!input || !output) {
    console.error('Usage: node scripts/convert_pdf.mjs <input.pdf> <output.pdf>')
    process.exit(1)
  }
  convertPdfToKindleNotes(input, output).catch((err) => {
    console.error(err)
    process.exit(1)
  })
}

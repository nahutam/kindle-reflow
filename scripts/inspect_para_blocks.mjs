import * as fs from 'fs'
import ts from 'typescript'
import path from 'path'

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

async function main() {
  const indexRes = await importTS('lib/converter/index.ts')
  const pdfBytes = new Uint8Array(fs.readFileSync('regression-data/unit_3.pdf'))
  const extracted = await indexRes.mod.extractDocument(pdfBytes, { fileName: 'unit_3.pdf' })
  const structure = indexRes.mod.analyzePageStructure(extracted.pages[0])
  const lines = indexRes.mod.reconstructLines(extracted.pages[0].textItems, { columns: structure.columnLayout.columns })
  const ordered = indexRes.mod.determineReadingOrder(lines, structure.columnLayout)
  const textBlocks = indexRes.mod.reconstructParagraphs(ordered, { bodyFontSize: 12, pageNumber: 1 })

  const docBlocks = indexRes.mod.classifyBlocks(textBlocks, {
    bodyFontSize: 12,
    pageNumber: 1,
    pageWidth: extracted.pages[0].metadata.width,
    pageHeight: extracted.pages[0].metadata.height,
    paths: extracted.pages[0].paths,
    images: extracted.pages[0].images,
    bodyLeft: structure.columnLayout.columns[0]?.left ?? 0,
    headerFooterInfo: {
      headerPageNumbers: new Set(),
      footerPageNumbers: new Set(),
      runningHeader: null,
      runningFooter: null,
    },
  })

  for (const b of docBlocks) {
    if (b.text.includes('Element') || b.text.includes('CO') || b.text.includes('→')) {
      console.log(`DocumentBlock [${b.id}] type=${b.type} preserveAsImage=${b.preserveAsImage}: text=${JSON.stringify(b.text)}`)
    }
  }
}

main().catch(console.error)

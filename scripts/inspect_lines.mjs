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
  const lineRes = await importTS('lib/converter/line-reconstructor.ts')
  const structRes = await importTS('lib/converter/structure-analyzer.ts')
  const orderRes = await importTS('lib/converter/reading-order.ts')

  const pdfBytes = new Uint8Array(fs.readFileSync('regression-data/unit_3.pdf'))
  const extracted = await indexRes.mod.extractDocument(pdfBytes, { fileName: 'unit_3.pdf' })
  
  for (let pIdx = 0; pIdx < Math.min(2, extracted.pages.length); pIdx++) {
    const page = extracted.pages[pIdx]
    const structure = structRes.mod.analyzePageStructure(page)
    const lines = lineRes.mod.reconstructLines(page.textItems, {
      columns: structure.columnLayout.columns,
    })
    console.log(`\n=== PAGE ${pIdx + 1} RECONSTRUCTED LINES ===`)
    for (const l of lines) {
      if (l.text.includes('carbides') || l.text.includes('oxides') || l.text.includes('2 3') || l.text.includes('CO') || l.text.includes('Basic')) {
        console.log(`Line [y=${l.box.y.toFixed(1)}]: ${JSON.stringify(l.text)}`)
      }
    }
  }
}

main().catch(console.error)

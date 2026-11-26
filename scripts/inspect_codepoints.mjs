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

  for (const item of extracted.pages[0].textItems) {
    if (item.str.includes('Element') || item.str.includes('Oxide') || item.str.includes('→')) {
      const cps = item.str.split('').map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`).join(' ')
      console.log(`Text item: ${JSON.stringify(item.str)} | font=${item.font.name} ${item.font.size}pt bold=${item.font.isBold}`)
      console.log(`  Code points: ${cps}`)
    }
  }
}

main().catch(console.error)

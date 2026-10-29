import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = fileURLToPath(new URL('../src/', import.meta.url))
const modules = new Map()
export function sourceModuleUrl(relative) {
  let filename = path.resolve(root, relative)
  if (!path.extname(filename)) filename = existsSync(`${filename}.ts`) ? `${filename}.ts` : path.join(filename, 'index.ts')
  if (modules.has(filename)) return modules.get(filename)
  const { outputText } = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  })
  const code = outputText.replace(/import ['"]\.[^'"]+\.css['"];?/g, '').replace(/from ['"](\.[^'"]+)['"]/g,
    (_, dependency) => `from '${sourceModuleUrl(path.relative(root, path.resolve(path.dirname(filename), dependency)))}'`)
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  modules.set(filename, url)
  return url
}

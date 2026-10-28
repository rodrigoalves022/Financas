import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { handleAiRequest } from './server/src/aiCli.ts'

const FATURAS_DIR = 'public/faturas'
const MANIFEST_NAME = 'manifest.json'
const MANIFEST_URL = `/faturas/${MANIFEST_NAME}`

function listFaturaFiles(root: string): string[] {
  const dir = path.join(root, FATURAS_DIR)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter(name => /\.(csv|ofx)$/i.test(name))
    .sort()
}

// public/faturas/manifest.json era uma lista mantida à mão e já quebrou duas vezes só
// nesta sessão: uma entrada esquecida (fatura nova que não importava) e o arquivo inteiro
// apagado numa limpeza manual (import passou a falhar com erro genérico). Este plugin gera
// a lista a partir do que realmente está na pasta — no dev, ao vivo a cada requisição; no
// build, grava o arquivo antes da cópia de public/ para o dist. Não existe mais lista pra
// esquecer de atualizar nem arquivo fixo pra sumir sem querer.
function faturasManifestPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'faturas-manifest',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== MANIFEST_URL) return next()
        const files = listFaturaFiles(root)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        res.end(JSON.stringify(files))
      })
    },
    buildStart() {
      const dir = path.join(root, FATURAS_DIR)
      if (!fs.existsSync(dir)) return
      const files = listFaturaFiles(root)
      fs.writeFileSync(path.join(dir, MANIFEST_NAME), `${JSON.stringify(files, null, 2)}\n`)
    },
  }
}

const readJsonBody = (req: IncomingMessage) => new Promise<unknown>((resolve, reject) => {
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', chunk => {
    raw += chunk
    if (raw.length > 1_000_000) {
      reject(new Error('Corpo da requisição grande demais'))
      req.destroy()
    }
  })
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}) } catch (error) { reject(error) }
  })
  req.on('error', reject)
})

// Modo IA no desenvolvimento: expõe /api/ai/* chamando os CLIs da própria máquina
// (Claude Code e Antigravity, assinatura logada, sem chave de API). Só existe no
// `npm run dev` — o build estático/APK não tem como executar processos, e aí o app usa
// o servidor configurado.
function aiCliPlugin(): Plugin {
  return {
    name: 'ai-cli',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        if (!url.startsWith('/api/ai/')) return next()
        try {
          const body = req.method === 'POST' ? await readJsonBody(req) : undefined
          const result = await handleAiRequest(req.method || 'GET', url.slice('/api/ai'.length), body)
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.statusCode = result?.status || 404
          res.end(JSON.stringify(result?.body ?? { error: 'Rota de IA desconhecida' }))
        } catch (error) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}

// Caixa de entrada local: pacotes de dados (JSON) deixados em inbox/ — por exemplo pelo
// Claude Code, que não alcança o IndexedDB do navegador — e que o app aplica uma vez,
// pelas próprias ferramentas, movendo o arquivo para inbox/aplicados. Só no `npm run dev`
// e fora de public/: nada disso vai para o build publicado.
// FINANCE_INBOX_DIR troca a pasta (testes automatizados não podem tocar a de verdade).
const INBOX_DIR = process.env.FINANCE_INBOX_DIR || 'inbox'

function localInboxPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'local-inbox',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        if (url !== '/api/inbox' && url !== '/api/inbox/ack') return next()
        const dir = path.resolve(root, INBOX_DIR)
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        try {
          if (req.method === 'GET' && url === '/api/inbox') {
            const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => /\.json$/i.test(name)).sort() : []
            const packages = names.map(name => {
              try {
                return { name, data: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8').replace(/^\uFEFF/, '')) }
              } catch (error) {
                return { name, error: error instanceof Error ? error.message : String(error) }
              }
            })
            res.end(JSON.stringify({ packages }))
            return
          }
          if (req.method === 'POST' && url === '/api/inbox/ack') {
            const body = await readJsonBody(req) as { name?: unknown }
            const name = typeof body.name === 'string' ? body.name : ''
            // Só nome de arquivo simples: nada de "../" saindo da pasta.
            if (!/^[\w.-]+\.json$/i.test(name) || !fs.existsSync(path.join(dir, name))) {
              res.statusCode = 400
              res.end(JSON.stringify({ error: 'Arquivo inválido' }))
              return
            }
            fs.mkdirSync(path.join(dir, 'aplicados'), { recursive: true })
            fs.renameSync(path.join(dir, name), path.join(dir, 'aplicados', name))
            res.end(JSON.stringify({ ok: true }))
            return
          }
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Método não suportado' }))
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), faturasManifestPlugin(), aiCliPlugin(), localInboxPlugin()],
})

import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const defaultDatabasePath = fileURLToPath(
  new URL('./data/reports.sqlite', import.meta.url),
)

export function createApi({ databasePath = defaultDatabasePath } = {}) {
  const priorities = ['Low', 'Medium', 'High']

  mkdirSync(dirname(databasePath), { recursive: true })

  const database = new DatabaseSync(databasePath)

  database.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY NOT NULL,
      site_name TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK (priority IN ('Low', 'Medium', 'High'))
    ) STRICT
  `)

  const getReports = database.prepare(`
    SELECT id, site_name AS siteName, description, priority
    FROM reports
    ORDER BY rowid DESC
  `)

  const addReport = database.prepare(`
    INSERT INTO reports (id, site_name, description, priority)
    VALUES (?, ?, ?, ?)
  `)

  const getReport = database.prepare(`
    SELECT id, site_name AS siteName, description, priority
    FROM reports WHERE id = ?
  `)

  const removeReport = database.prepare('DELETE FROM reports WHERE id = ?')

  function sendJson(response, status, data) {
    response.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    response.end(JSON.stringify(data))
  }

  const server = createServer(async (request, response) => {
    const path = request.url?.split('?')[0]

    try {
      if (request.method === 'GET' && path === '/api/health') {
        sendJson(response, 200, {
          status: 'ok',
          message: 'Site Report Tracker API is running',
        })
        return
      }

      if (request.method === 'GET' && path === '/api/reports') {
        sendJson(response, 200, { reports: getReports.all() })
        return
      }

      if (request.method === 'POST' && path === '/api/reports') {
        const contentType = request.headers['content-type']?.split(';')[0].trim().toLowerCase()

        if (contentType !== 'application/json') {
          request.resume()
          sendJson(response, 415, {
            error: 'Send report data as application/json.',
          })
          return
        }

        const chunks = []
        let size = 0

        for await (const chunk of request.iterator({ destroyOnReturn: false })) {
          size += chunk.length

          if (size > 64 * 1024) {
            request.resume()
            sendJson(response, 413, { error: 'Report data is too large.' })
            return
          }

          chunks.push(chunk)
        }

        let data

        try {
          data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          sendJson(response, 400, { error: 'Send valid JSON.' })
          return
        }

        const siteName = typeof data?.siteName === 'string' ? data.siteName.trim() : ''
        const description = typeof data?.description === 'string' ? data.description.trim() : ''
        const priority = data?.priority

        if (!siteName || !description || !priorities.includes(priority)) {
          sendJson(response, 400, {
            error: 'Enter a site name, description and a priority of Low, Medium or High.',
          })
          return
        }

        const id = data.id === undefined ? randomUUID() : data.id

        if (typeof id !== 'string' || !id.trim() || id.length > 200) {
          sendJson(response, 400, {
            error: 'Report ID must be a nonempty string of up to 200 characters.',
          })
          return
        }

        const existing = getReport.get(id)

        if (existing) {
          if (
            existing.siteName !== siteName ||
            existing.description !== description ||
            existing.priority !== priority
          ) {
            sendJson(response, 409, {
              error: 'A report with this ID already exists with different details.',
            })
            return
          }

          sendJson(response, 200, { report: existing })
          return
        }

        const report = { id, siteName, description, priority }

        addReport.run(report.id, report.siteName, report.description, report.priority)
        sendJson(response, 201, { report })
        return
      }

      const deleteMatch = path?.match(/^\/api\/reports\/([^/]+)$/)

      if (request.method === 'DELETE' && deleteMatch) {
        let id

        try {
          id = decodeURIComponent(deleteMatch[1])
        } catch {
          sendJson(response, 400, { error: 'Invalid report ID.' })
          return
        }

        removeReport.run(id)
        sendJson(response, 200, { deletedId: id })
        return
      }

      sendJson(response, 404, { error: 'Route not found' })
    } catch (error) {
      console.error('Request failed:', error)
      sendJson(response, 500, {
        error: 'Unable to complete the request',
      })
    }
  })

  server.once('close', () => database.close())
  return server
}
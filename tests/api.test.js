import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from '../server/app.js'

const validReport = {
  siteName: 'Melbourne Site',
  description: 'Check safety gate',
  priority: 'High',
}

async function createFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'site-report-tests-'))
  const databasePath = join(directory, 'reports.sqlite')
  let server

  const api = {
    url: '',
    async restart() {
      await stop()
      await start()
    },
  }

  async function start() {
    server = createApi({ databasePath })

    const listening = once(server, 'listening')
    server.listen(0, '127.0.0.1')
    await listening

    api.url = `http://127.0.0.1:${server.address().port}`
  }

  async function stop() {
    if (!server) return

    const current = server
    server = undefined

    await new Promise((resolve, reject) => {
      current.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(error)
        } else {
          resolve()
        }
      })

      current.closeAllConnections()
    })
  }

  t.after(async () => {
    try {
      await stop()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  await start()
  return api
}

async function request(api, path = '/api/reports', options = {}) {
  const response = await fetch(`${api.url}${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  })

  assert.match(
    response.headers.get('content-type') ?? '',
    /application\/json/,
  )

  return {
    status: response.status,
    data: await response.json(),
  }
}

function post(data) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }
}

test('health succeeds and unknown routes return 404', async (t) => {
  const api = await createFixture(t)

  const health = await request(api, '/api/health')
  assert.equal(health.status, 200)
  assert.equal(health.data.status, 'ok')

  const missing = await request(api, '/api/missing')
  assert.equal(missing.status, 404)
  assert.equal(typeof missing.data.error, 'string')
})

test('a new database starts with no reports', async (t) => {
  const api = await createFixture(t)

  assert.deepEqual(await request(api), {
    status: 200,
    data: { reports: [] },
  })
})

test('saving trims fields, preserves Unicode and generates an ID', async (t) => {
  const api = await createFixture(t)

  const saved = await request(api, '/api/reports', post({
    ...validReport,
    siteName: '  Melbourne Site  ',
    description: "  Check the café's access gate 🛠️  ",
  }))

  assert.equal(saved.status, 201)

  const report = saved.data.report

  assert.match(
    report.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  )

  assert.deepEqual(report, {
    id: report.id,
    siteName: 'Melbourne Site',
    description: "Check the café's access gate 🛠️",
    priority: 'High',
  })

  assert.deepEqual((await request(api)).data.reports, [report])
})

test('reports are listed newest first', async (t) => {
  const api = await createFixture(t)

  const first = await request(api, '/api/reports', post({
    ...validReport,
    priority: 'Low',
  }))

  const second = await request(api, '/api/reports', post({
    ...validReport,
    priority: 'Medium',
  }))

  assert.equal(first.status, 201)
  assert.equal(second.status, 201)

  assert.deepEqual(
    (await request(api)).data.reports,
    [second.data.report, first.data.report],
  )
})

test('invalid reports are rejected without saving anything', async (t) => {
  const api = await createFixture(t)

  const invalidReports = [
    null,
    [],
    'text',
    {},
    { ...validReport, siteName: '   ' },
    { ...validReport, siteName: 42 },
    { ...validReport, description: '' },
    { ...validReport, description: '   ' },
    { ...validReport, priority: 'Urgent' },
    { ...validReport, id: null },
    { ...validReport, id: 'x'.repeat(201) },
  ]

  for (const report of invalidReports) {
    const result = await request(api, '/api/reports', post(report))

    assert.equal(result.status, 400, JSON.stringify(report))
    assert.equal(typeof result.data.error, 'string')
  }

  assert.deepEqual((await request(api)).data.reports, [])
})

test('malformed JSON, wrong content types and oversized bodies are rejected', async (t) => {
  const api = await createFixture(t)

  const malformed = await request(api, '/api/reports', {
    ...post({}),
    body: '{bad',
  })
  assert.equal(malformed.status, 400)

  const wrongType = await request(api, '/api/reports', {
    ...post(validReport),
    headers: { 'Content-Type': 'text/plain' },
  })
  assert.equal(wrongType.status, 415)

  const oversized = await request(api, '/api/reports', post({
    ...validReport,
    description: 'x'.repeat(70000),
  }))
  assert.equal(oversized.status, 413)

  assert.deepEqual((await request(api)).data.reports, [])
})

test('retries avoid duplicates and conflicting IDs cannot overwrite reports', async (t) => {
  const api = await createFixture(t)
  const report = { ...validReport, id: 'retry-test' }

  const saved = await request(api, '/api/reports', post(report))
  assert.equal(saved.status, 201)

  const repeated = await request(api, '/api/reports', post(report))
  assert.equal(repeated.status, 200)
  assert.deepEqual(repeated.data.report, saved.data.report)

  const conflict = await request(api, '/api/reports', post({
    ...report,
    description: 'Changed issue',
  }))
  assert.equal(conflict.status, 409)

  assert.deepEqual(
    (await request(api)).data.reports,
    [saved.data.report],
  )
})

test('saved reports survive an API restart', async (t) => {
  const api = await createFixture(t)

  const saved = await request(api, '/api/reports', post(validReport))
  assert.equal(saved.status, 201)

  await api.restart()

  assert.deepEqual(
    (await request(api)).data.reports,
    [saved.data.report],
  )
})

test('deletion accepts encoded IDs, can be retried and survives restart', async (t) => {
  const api = await createFixture(t)
  const report = { ...validReport, id: 'legacy/site report?one' }

  const saved = await request(api, '/api/reports', post(report))
  assert.equal(saved.status, 201)

  const path = `/api/reports/${encodeURIComponent(report.id)}`
  const removed = await request(api, path, { method: 'DELETE' })

  assert.equal(removed.status, 200)
  assert.deepEqual(removed.data, { deletedId: report.id })

  const repeated = await request(api, path, { method: 'DELETE' })
  assert.equal(repeated.status, 200)

  await api.restart()

  assert.deepEqual((await request(api)).data.reports, [])
})

test('invalid encoded deletion IDs leave saved reports unchanged', async (t) => {
  const api = await createFixture(t)

  const saved = await request(api, '/api/reports', post(validReport))
  assert.equal(saved.status, 201)

  const result = await request(
    api,
    '/api/reports/%E0%A4%A',
    { method: 'DELETE' },
  )
  assert.equal(result.status, 400)

  assert.deepEqual(
    (await request(api)).data.reports,
    [saved.data.report],
  )
})
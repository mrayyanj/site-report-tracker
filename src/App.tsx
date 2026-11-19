import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'

const priorities = ['Low', 'Medium', 'High'] as const
const storageKey = 'site-report-tracker.reports.v1'
const importedKey = `${storageKey}.imported`

type Report = {
  id: string
  siteName: string
  description: string
  priority: (typeof priorities)[number]
}

type BrowserBackup = {
  raw: string
  reports: Report[]
  error: string
}

const emptyBackup: BrowserBackup = {
  raw: '',
  reports: [],
  error: '',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isReport(value: unknown): value is Report {
  return isRecord(value) &&
    typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.siteName === 'string' && value.siteName.trim().length > 0 &&
    typeof value.description === 'string' && value.description.trim().length > 0 &&
    priorities.some((priority) => priority === value.priority)
}

function readBrowserBackup(): BrowserBackup {
  try {
    const raw = localStorage.getItem(storageKey)

    if (!raw || raw === localStorage.getItem(importedKey)) {
      return emptyBackup
    }

    const reports: unknown = JSON.parse(raw)

    if (!Array.isArray(reports) || !reports.every(isReport)) {
      throw new Error('Invalid browser backup')
    }

    return { raw, reports, error: '' }
  } catch {
    return {
      ...emptyBackup,
      error: 'Earlier browser reports could not be read. The saved browser data has been kept.',
    }
  }
}

async function requestApi(path: string, options: RequestInit = {}) {
  let response: Response

  try {
    response = await fetch(path, options)
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw new Error('Cannot reach the API. Keep the backend running, then retry.')
  }

  const data: unknown = await response.json().catch(() => null)

  if (!isRecord(data)) {
    throw new Error('The API returned an unreadable response. Check the backend terminal.')
  }

  if (!response.ok) {
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : 'The request failed. Please retry.',
    )
  }

  return data
}

function reportList(data: Record<string, unknown>): Report[] {
  if (!Array.isArray(data.reports) || !data.reports.every(isReport)) {
    throw new Error('The API returned an invalid report list.')
  }

  return data.reports
}

async function saveReport(report: Report): Promise<Report> {
  const data = await requestApi('/api/reports', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  })

  if (!isReport(data.report)) {
    throw new Error('The API returned an invalid report.')
  }

  return data.report
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: '0.4rem',
}

const inputStyle: CSSProperties = {
  font: 'inherit',
  padding: '0.5rem',
}

const buttonStyle: CSSProperties = {
  ...inputStyle,
  paddingInline: '1rem',
  border: '1px solid #aaa',
  borderRadius: '0.375rem',
  cursor: 'pointer',
}

function App() {
  const [reports, setReports] = useState<Report[]>([])
  const [backup, setBackup] = useState(readBrowserBackup)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const busyRef = useRef(false)
  const pendingReport = useRef<Report | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    requestApi('/api/reports', { signal: controller.signal })
      .then((data) => {
        if (controller.signal.aborted) return
        setReports(reportList(data))
        setReady(true)
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            failure instanceof Error
              ? failure.message
              : 'Reports could not be loaded.',
          )
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [reload])

  function reloadReports() {
    if (busyRef.current || loading) return

    setLoading(true)
    setReady(false)
    setError('')
    setMessage('')
    setReload((value) => value + 1)
  }

  async function runAction(action: () => Promise<void>) {
    if (busyRef.current || loading || !ready) return

    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')

    try {
      await action()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The action failed. Please retry.',
      )
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busyRef.current || loading || !ready) return

    const form = event.currentTarget
    const fields = new FormData(form)

    const siteName = String(fields.get('siteName') ?? '').trim()
    const description = String(fields.get('description') ?? '').trim()
    const priority = priorities.find(
      (value) => value === fields.get('priority'),
    )

    if (!siteName || !description || !priority) {
      setError('Enter a site name and description, then choose a priority.')
      return
    }

    const pending = pendingReport.current

    const report: Report =
      pending &&
      pending.siteName === siteName &&
      pending.description === description &&
      pending.priority === priority
        ? pending
        : { id: crypto.randomUUID(), siteName, description, priority }

    pendingReport.current = report

    void runAction(async () => {
      const saved = await saveReport(report)

      setReports((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ])

      pendingReport.current = null
      form.reset()
      setMessage('Report saved to the database.')
    })
  }

  function deleteReport(report: Report) {
    if (busyRef.current || loading || !ready) return

    if (!window.confirm(`Delete the report for "${report.siteName}"?`)) {
      return
    }

    void runAction(async () => {
      const data = await requestApi(
        `/api/reports/${encodeURIComponent(report.id)}`,
        { method: 'DELETE' },
      )

      if (data.deletedId !== report.id) {
        throw new Error('The API did not confirm the deletion.')
      }

      setReports((current) => current.filter(
        (item) => item.id !== report.id,
      ))

      setMessage('Report deleted from the database.')
    })
  }

  function importBrowserReports() {
    if (busyRef.current || loading || !ready) return

    const currentBackup = readBrowserBackup()
    setBackup(currentBackup)

    if (currentBackup.error) {
      setError(currentBackup.error)
      return
    }

    if (!currentBackup.reports.length) return

    void runAction(async () => {
      for (const report of [...currentBackup.reports].reverse()) {
        await saveReport(report)
      }

      setReports(reportList(await requestApi('/api/reports')))

      try {
        localStorage.setItem(importedKey, currentBackup.raw)
      } catch {
        setMessage(
          'Reports copied. The browser could not remember the import; retrying is safe.',
        )
        setBackup(emptyBackup)
        return
      }

      setBackup(emptyBackup)
      setMessage(
        'Browser reports copied to the database. The original browser data is kept as a backup.',
      )
    })
  }

  const disabled = loading || busy || !ready

  return (
    <main
      style={{
        width: 'min(100%, 40rem)',
        boxSizing: 'border-box',
        margin: '0 auto',
        padding: '1.5rem',
        textAlign: 'left',
      }}
    >
      <h1>Site Report Tracker</h1>
      <p>Create site reports and save them to a local database.</p>

      {error && <p role="alert">{error}</p>}
      <p role="status" style={{ minHeight: '1.5rem' }}>{message}</p>

      {backup.error && <p role="alert">{backup.error}</p>}

      {backup.reports.length > 0 && (
        <section
          aria-label="Earlier browser reports"
          style={{ marginBottom: '1.5rem' }}
        >
          <p>
            {backup.reports.length} earlier browser report(s) are available to copy.
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={importBrowserReports}
            style={buttonStyle}
          >
            Import browser reports
          </button>
        </section>
      )}

      <form onSubmit={handleSubmit}>
        <fieldset
          disabled={disabled}
          style={{
            display: 'grid',
            gap: '1rem',
            border: 0,
            padding: 0,
            margin: 0,
            minWidth: 0,
          }}
        >
          <label style={fieldStyle}>
            Site name
            <input name="siteName" style={inputStyle} required />
          </label>

          <label style={fieldStyle}>
            Issue description
            <textarea
              name="description"
              rows={4}
              style={inputStyle}
              required
            />
          </label>

          <label style={fieldStyle}>
            Priority
            <select name="priority" defaultValue="" style={inputStyle} required>
              <option value="" disabled>Choose a priority</option>
              {priorities.map((priority) => (
                <option key={priority} value={priority}>{priority}</option>
              ))}
            </select>
          </label>

          <button
            type="submit"
            style={{
              ...buttonStyle,
              justifySelf: 'start',
              background: '#174f46',
              color: '#fff',
            }}
          >
            {busy ? 'Working...' : 'Submit report'}
          </button>
        </fieldset>
      </form>

      <section
        aria-labelledby="saved-reports"
        aria-busy={loading || busy}
        style={{ marginTop: '2rem' }}
      >
        <h2 id="saved-reports">Saved reports</h2>

        <button
          type="button"
          disabled={loading || busy}
          onClick={reloadReports}
          style={buttonStyle}
        >
          Reload reports
        </button>

        {loading && <p>Loading reports...</p>}

        {ready && !loading && reports.length === 0 && (
          <p>Submit a report to start your history.</p>
        )}

        {reports.map((report) => (
          <article
            key={report.id}
            aria-label={`Report for ${report.siteName}`}
            style={{
              marginTop: '1rem',
              padding: '1rem',
              border: '1px solid #aaa',
              borderRadius: '0.5rem',
              overflowWrap: 'anywhere',
            }}
          >
            <h3 style={{ marginTop: 0 }}>{report.siteName}</h3>
            <p>Priority: {report.priority}</p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{report.description}</p>

            <button
              type="button"
              disabled={disabled}
              onClick={() => deleteReport(report)}
              aria-label={`Delete report for ${report.siteName}`}
              style={{
                ...buttonStyle,
                background: '#b42318',
                color: '#fff',
              }}
            >
              Delete report
            </button>
          </article>
        ))}
      </section>
    </main>
  )
}

export default App
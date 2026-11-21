import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

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

const iconPaths = {
  report: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 0v6h6M8 13h8M8 17h5',
  plus: 'M12 5v14M5 12h14',
  trash: 'M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6',
  close: 'm6 6 12 12M18 6 6 18',
}

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={iconPaths[name]} />
    </svg>
  )
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
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const deleteDialogRef = useRef<HTMLDialogElement>(null)
  const cancelDeleteRef = useRef<HTMLButtonElement>(null)
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const reportsHeadingRef = useRef<HTMLHeadingElement>(null)
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

  useEffect(() => {
    const dialog = deleteDialogRef.current
    if (!dialog) return

    if (deleteTarget) {
      if (!dialog.open) dialog.showModal()
      cancelDeleteRef.current?.focus()

      const previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'

      return () => {
        document.body.style.overflow = previousOverflow
      }
    }

    if (dialog.open) {
      dialog.close()

      if (deleteTriggerRef.current?.isConnected) {
        deleteTriggerRef.current.focus()
      } else {
        reportsHeadingRef.current?.focus()
      }
    }
  }, [deleteTarget])

  function reloadReports() {
    if (busyRef.current || loading) return

    setLoading(true)
    setReady(false)
    setError('')
    setMessage('')
    setReload((value) => value + 1)
  }

  async function runAction(
    action: () => Promise<void>,
    onFailure: (message: string) => void = setError,
  ) {
    if (busyRef.current || loading || !ready) return

    busyRef.current = true
    setBusy(true)
    setError('')
    setMessage('')

    try {
      await action()
    } catch (failure) {
      onFailure(
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
      setMessage('Report saved successfully.')
    })
  }

  function requestDelete(report: Report, trigger: HTMLButtonElement) {
    if (busyRef.current || loading || !ready) return

    deleteTriggerRef.current = trigger
    setDeleteError('')
    setDeleteTarget(report)
  }

  function cancelDelete() {
    if (!busyRef.current) setDeleteTarget(null)
  }

  function confirmDelete() {
    const report = deleteTarget
    if (!report || busyRef.current) return

    setDeleteError('')

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

      setDeleteTarget(null)
      setMessage('Report deleted.')
    }, setDeleteError)
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

  const highPriorityCount = reports.filter(
    (report) => report.priority === 'High',
  ).length

  const siteCount = new Set(
    reports.map((report) => report.siteName.trim().toLowerCase()),
  ).size

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to reports</a>

      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Icon name="report" /></span>
            <span>Site Report Tracker</span>
          </div>
          <span className="workspace-label">Report workspace</span>
        </div>
      </header>

      <main id="main-content" className="app-shell" tabIndex={-1}>
        <div className="page-heading">
          <div>
            <p className="eyebrow">SITE OPERATIONS</p>
            <h1>Site reports</h1>
            <p className="page-description">
              Capture issues, set priorities and keep your site records organised.
            </p>
          </div>
          <a className="button button-primary" href="#new-report">
            <Icon name="plus" />New report
          </a>
        </div>

        <section className="stats" aria-label="Report overview">
          <div className="stat">
            <span>Saved reports</span>
            <strong>{ready ? reports.length : '—'}</strong>
          </div>
          <div className="stat">
            <span>High priority</span>
            <strong className="stat-alert">
              {ready ? highPriorityCount : '—'}
            </strong>
          </div>
          <div className="stat">
            <span>Sites reported</span>
            <strong>{ready ? siteCount : '—'}</strong>
          </div>
        </section>

        {error && <p className="notice notice-error" role="alert">{error}</p>}

        <p className={message ? 'notice notice-success' : 'sr-only'} role="status">
          {message}
        </p>

        {backup.error && (
          <p className="notice notice-error" role="alert">{backup.error}</p>
        )}

        {backup.reports.length > 0 && (
          <section className="import-notice" aria-label="Earlier browser reports">
            <div>
              <strong>Bring your earlier reports with you</strong>
              <p>
                {backup.reports.length} browser report(s) are ready to copy.
                Your original browser data will be kept.
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              disabled={disabled}
              onClick={importBrowserReports}
            >
              Import browser reports
            </button>
          </section>
        )}

        <div className="workspace-grid">
          <section className="form-panel" aria-labelledby="new-report">
            <div className="panel-heading">
              <p className="eyebrow">NEW REPORT</p>
              <h2 id="new-report" tabIndex={-1}>Report an issue</h2>
              <p>Add the details so the right issue gets attention.</p>
            </div>

            <form onSubmit={handleSubmit}>
              <fieldset disabled={disabled}>
                <label className="field">
                  Site name
                  <input
                    name="siteName"
                    placeholder="e.g. Docklands, north entrance"
                    autoComplete="off"
                    required
                  />
                </label>

                <label className="field">
                  Issue description
                  <textarea
                    name="description"
                    rows={5}
                    placeholder="Describe the issue and where it is located..."
                    aria-describedby="description-help"
                    required
                  />
                </label>

                <p className="field-help" id="description-help">
                  Include the location and what needs attention.
                </p>

                <label className="field">
                  Priority
                  <select name="priority" defaultValue="" required>
                    <option value="" disabled>Choose a priority</option>
                    {priorities.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                </label>

                <button
                  className="button button-primary save-button"
                  type="submit"
                >
                  <Icon name="plus" />
                  {busy ? 'Working...' : 'Save report'}
                </button>

                <p className="form-note">All fields are required.</p>
              </fieldset>
            </form>
          </section>

          <section
            className="history-panel"
            aria-labelledby="saved-reports"
            aria-busy={loading || busy}
          >
            <div className="history-heading">
              <div>
                <h2 id="saved-reports" ref={reportsHeadingRef} tabIndex={-1}>
                  Report history
                </h2>
                <p>Your saved reports, newest first.</p>
              </div>

              <button
                className="button button-secondary"
                type="button"
                disabled={loading || busy}
                onClick={reloadReports}
              >
                Reload reports
              </button>
            </div>

            {loading && (
              <div className="empty-state" role="status">
                <span className="empty-icon"><Icon name="report" /></span>
                <h3>Loading your reports...</h3>
                <p>Getting the latest saved history.</p>
              </div>
            )}

            {!loading && !ready && reports.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon"><Icon name="report" /></span>
                <h3>Reports are unavailable</h3>
                <p>Use Reload reports to try again.</p>
              </div>
            )}

            {ready && !loading && reports.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon"><Icon name="report" /></span>
                <h3>No reports yet</h3>
                <p>Create your first report using the form.</p>
              </div>
            )}

            <div className="report-list">
              {reports.map((report) => (
                <article
                  className="report-card"
                  key={report.id}
                  aria-label={`Report for ${report.siteName}`}
                >
                  <div className="report-card-heading">
                    <h3>{report.siteName}</h3>
                    <span className={`priority priority-${report.priority.toLowerCase()}`}>
                      {report.priority} priority
                    </span>
                  </div>

                  <p className="report-description">{report.description}</p>

                  <div className="report-card-footer">
                    <button
                      className="button button-delete"
                      type="button"
                      disabled={disabled}
                      onClick={(event) => requestDelete(report, event.currentTarget)}
                      aria-label={`Delete report for ${report.siteName}`}
                    >
                      <Icon name="trash" />Delete report
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <dialog
          ref={deleteDialogRef}
          className="delete-dialog"
          aria-labelledby="delete-title"
          aria-describedby="delete-description delete-report-name"
          onCancel={(event) => {
            event.preventDefault()
            cancelDelete()
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return

            const bounds = event.currentTarget.getBoundingClientRect()

            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            ) {
              cancelDelete()
            }
          }}
        >
          <button
            className="dialog-close"
            type="button"
            aria-label="Close delete confirmation"
            disabled={busy}
            onClick={cancelDelete}
          >
            <Icon name="close" />
          </button>

          <span className="dialog-icon"><Icon name="trash" /></span>
          <h2 id="delete-title">Delete this report?</h2>

          <p className="dialog-description" id="delete-description">
            This will remove the report from your saved history.
          </p>

          <div className="dialog-report">
            <strong id="delete-report-name">{deleteTarget?.siteName}</strong>
            {deleteTarget && (
              <span className={`priority priority-${deleteTarget.priority.toLowerCase()}`}>
                {deleteTarget.priority} priority
              </span>
            )}
          </div>

          {deleteError && (
            <p className="notice notice-error dialog-error" role="alert">
              {deleteError}
            </p>
          )}

          <div className="dialog-actions">
            <button
              ref={cancelDeleteRef}
              className="button button-secondary"
              type="button"
              disabled={busy}
              onClick={cancelDelete}
            >
              Cancel
            </button>

            <button
              className="button button-danger"
              type="button"
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? 'Deleting...' : 'Delete report'}
            </button>
          </div>
        </dialog>
      </main>
    </>
  )
}

export default App
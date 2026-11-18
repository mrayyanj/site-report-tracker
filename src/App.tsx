import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'

const priorities = ['Low', 'Medium', 'High'] as const
const storageKey = 'site-report-tracker.reports.v1'

type Report = {
  id: string
  siteName: string
  description: string
  priority: (typeof priorities)[number]
}

type ReportState = {
  reports: Report[]
  error: string
}

function isReport(value: unknown): value is Report {
  if (typeof value !== 'object' || value === null) return false

  const report = value as Partial<Report>
  return (
    typeof report.id === 'string' && report.id.length > 0 &&
    typeof report.siteName === 'string' && report.siteName.trim().length > 0 &&
    typeof report.description === 'string' && report.description.trim().length > 0 &&
    priorities.some((priority) => priority === report.priority)
  )
}

function loadReports(): ReportState {
  try {
    const saved = localStorage.getItem(storageKey)
    const reports: unknown = saved === null ? [] : JSON.parse(saved)

    if (!Array.isArray(reports) || !reports.every(isReport)) {
      return { reports: [], error: 'Saved reports contain unreadable data. Check this site’s browser storage.' }
    }

    return { reports, error: '' }
  } catch {
    return { reports: [], error: 'Saved reports could not be loaded. Check this site’s browser storage.' }
  }
}

const fieldStyle: CSSProperties = { display: 'grid', gap: '0.4rem' }
const inputStyle: CSSProperties = { font: 'inherit', padding: '0.5rem' }

function App() {
  const [{ reports, error }, setReportState] = useState(loadReports)

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const siteName = String(fields.get('siteName') ?? '').trim()
    const description = String(fields.get('description') ?? '').trim()
    const priority = priorities.find((option) => option === fields.get('priority'))

    if (!siteName || !description || !priority) {
      setReportState((current) => ({
        ...current,
        error: 'Enter a site name and issue description, then choose a priority.',
      }))
      return
    }

    const saved = loadReports()
    if (saved.error) {
      setReportState((current) => ({ ...current, error: saved.error }))
      return
    }

    try {
      const report: Report = {
        id: crypto.randomUUID(),
        siteName,
        description,
        priority,
      }
      const updatedReports = [report, ...saved.reports]
      localStorage.setItem(storageKey, JSON.stringify(updatedReports))
      setReportState({ reports: updatedReports, error: '' })
      form.reset()
    } catch {
      setReportState((current) => ({
        ...current,
        error: 'This report could not be saved. Check your browser’s storage settings and try again.',
      }))
    }
  }

  return (
    <main
      style={{
        width: 'min(100%, 36rem)',
        boxSizing: 'border-box',
        margin: '0 auto',
        padding: '1.5rem',
        textAlign: 'left',
      }}
    >
      <h1>Site Report Tracker</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '1rem' }}>
        <label style={fieldStyle}>
          Site name
          <input name="siteName" style={inputStyle} required />
        </label>

        <label style={fieldStyle}>
          Issue description
          <textarea name="description" rows={4} style={inputStyle} required />
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

        {error && <p role="alert">{error}</p>}

        <button
          type="submit"
          style={{
            ...inputStyle,
            justifySelf: 'start',
            paddingInline: '1rem',
            background: '#174f46',
            color: '#fff',
            border: 0,
            borderRadius: '0.375rem',
            cursor: 'pointer',
          }}
        >
          Submit report
        </button>
      </form>

      <section aria-labelledby="saved-reports" style={{ marginTop: '1.5rem' }}>
        <h2 id="saved-reports">Saved reports</h2>
        {reports.length === 0 && <p>Submit a report to start your history.</p>}
        {reports.map((report) => (
          <article
            key={report.id}
            aria-label={`Report for ${report.siteName}`}
            style={{
              marginTop: '1rem',
              padding: '1rem',
              border: '1px solid var(--border, #aaa)',
              borderRadius: '0.5rem',
              overflowWrap: 'anywhere',
            }}
          >
            <h3 style={{ margin: '0 0 0.5rem' }}>{report.siteName}</h3>
            <p>Priority: {report.priority}</p>
            <p style={{ marginTop: '0.4rem', whiteSpace: 'pre-wrap' }}>
              {report.description}
            </p>
          </article>
        ))}
      </section>
    </main>
  )
}

export default App

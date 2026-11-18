import { useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'

const priorities = ['Low', 'Medium', 'High'] as const

type Report = {
  siteName: string
  description: string
  priority: (typeof priorities)[number]
}

const fieldStyle: CSSProperties = { display: 'grid', gap: '0.4rem' }
const inputStyle: CSSProperties = { font: 'inherit', padding: '0.5rem' }

function App() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    const siteName = String(fields.get('siteName') ?? '').trim()
    const description = String(fields.get('description') ?? '').trim()
    const priority = priorities.find((option) => option === fields.get('priority'))

    if (!siteName || !description || !priority) {
      setError('Enter a site name and issue description, then choose a priority.')
      return
    }

    setReport({ siteName, description, priority })
    setError('')
    form.reset()
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

      <div role="status">
        {report && (
          <section
            aria-labelledby="latest-report"
            style={{
              marginTop: '1.5rem',
              padding: '1rem',
              border: '1px solid var(--border, #aaa)',
              borderRadius: '0.5rem',
              overflowWrap: 'anywhere',
            }}
          >
            <h2 id="latest-report">Latest report</h2>
            <p><strong>{report.siteName}</strong> · {report.priority}</p>
            <p style={{ marginTop: '0.4rem', whiteSpace: 'pre-wrap' }}>
              {report.description}
            </p>
          </section>
        )}
      </div>
    </main>
  )
}

export default App

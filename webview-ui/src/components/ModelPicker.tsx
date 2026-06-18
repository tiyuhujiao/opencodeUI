import { useMemo, useState } from 'react'
import type { ModelSummary } from '../../../src/shared/protocol'

type ModelPickerProps = {
  models: ModelSummary[]
  selectedModel: string
  onSelect: (name: string) => void
  loading: boolean
  error: string | null
}

const ROW_HEIGHT = 32
const VIEWPORT_HEIGHT = 192

export function ModelPicker({ models, selectedModel, onSelect, loading, error }: ModelPickerProps) {
  const [query, setQuery] = useState('')
  const [scrollTop, setScrollTop] = useState(0)

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) {
      return models
    }

    return models.filter((model) => model.name.toLowerCase().includes(normalized))
  }, [models, query])

  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ROW_HEIGHT) + 4
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 2)
  const endIndex = Math.min(filtered.length, startIndex + visibleCount)
  const visible = filtered.slice(startIndex, endIndex)

  return (
    <section className="picker" aria-label="model picker">
      <header className="picker__header">
        <h3>Model</h3>
        {loading ? <span>Loading…</span> : null}
      </header>

      <input
        className="picker__search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="搜索 model"
      />

      {error ? <p className="error-line">{error}</p> : null}

      <div
        className="picker__viewport"
        style={{ height: `${String(VIEWPORT_HEIGHT)}px` }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop)
        }}
      >
        <div style={{ height: `${String(filtered.length * ROW_HEIGHT)}px`, position: 'relative' }}>
          {visible.map((model, index) => {
            const actualIndex = startIndex + index
            return (
              <button
                key={model.name}
                type="button"
                className={`picker__item ${selectedModel === model.name ? 'is-selected' : ''}`}
                style={{ top: `${String(actualIndex * ROW_HEIGHT)}px`, height: `${String(ROW_HEIGHT)}px` }}
                onClick={() => onSelect(model.name)}
              >
                {model.name}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

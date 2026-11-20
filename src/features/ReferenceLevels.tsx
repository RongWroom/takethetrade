import { useId, useState } from 'react'
import { PERIOD_LABEL, PERIODS, type LevelPeriod, type MarketLevel } from '../domain/levels'
import type { ReferenceLevels as LevelsModel } from './useReferenceLevels'

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })
const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })

export function LevelTag({ level }: { level: MarketLevel }) {
  return <span className={`level-tag level-${level.period ?? 'vwap'}`}>
    {level.label}{level.kind === 'manual' ? ' · Manual' : level.kind === 'boundary' ? ' · Candidate' : ''}
  </span>
}

export function ReferenceLevels({ model, profile = false }: { model: LevelsModel; profile?: boolean }) {
  const formId = useId()
  const [showForm, setShowForm] = useState(false)
  const [price, setPrice] = useState('')
  const [period, setPeriod] = useState<LevelPeriod>('daily')
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState<'all' | LevelPeriod>('all')
  const [showRevisited, setShowRevisited] = useState(false)
  const { latestPrice } = model

  const groups = new Map<number, MarketLevel[]>()
  for (const level of model.levels) {
    if ((!showRevisited && level.revisited) || (filter !== 'all' && level.period !== filter)) continue
    const group = groups.get(level.price)
    if (group) group.push(level)
    else groups.set(level.price, [level])
  }
  const rows = [...groups.entries()].map(([levelPrice, entries]) => ({ price: levelPrice, entries, current: false }))
  if (latestPrice !== null) {
    const exact = rows.find(row => row.price === latestPrice)
    if (exact) exact.current = true
    else rows.push({ price: latestPrice, entries: [], current: true })
  }
  rows.sort((a, b) => b.price - a.price)

  return <section className={`levels-panel${profile ? ' levels-panel-profile' : ''}`} aria-label="Reference levels">
    <div className="levels-heading">
      <div>
        <h2>{profile ? 'Reference levels' : 'Levels'}</h2>
        <p className="muted">Bitcoin perpetual · UTC periods</p>
      </div>
      <button type="button" className="secondary" aria-expanded={showForm} aria-controls={formId}
        onClick={() => setShowForm(value => !value)}>{showForm ? 'Close form' : 'Add level'}</button>
    </div>
    <form id={formId} className="level-form" hidden={!showForm} onSubmit={event => {
      event.preventDefault()
      model.add(Number(price), period, note)
      setPrice('')
      setNote('')
      setFilter('all')
      setShowForm(false)
    }}>
      <label>Price (USDT)<input type="number" min="0.00000001" step="any" required value={price} onChange={event => setPrice(event.target.value)} /></label>
      <label>Period<select value={period} onChange={event => setPeriod(event.target.value as LevelPeriod)}>
        {PERIODS.map(option => <option key={option} value={option}>{PERIOD_LABEL[option]}</option>)}
      </select></label>
      <label>Note (optional)<input value={note} onChange={event => setNote(event.target.value)} maxLength={160} /></label>
      <button type="submit" className="secondary">Save level</button>
    </form>
    {model.storageError && <p role="status">Browser storage is unavailable. Manual levels will last for this session only.</p>}
    <details className="levels-disclosure" open={profile ? undefined : true}>
      <summary>{profile ? 'Show reference levels' : 'Filter and inspect levels'}</summary>
    <div className="levels-controls">
      <div role="group" aria-label="Filter by period">
        {(['all', ...PERIODS] as const).map(option => (
          <button className={`secondary level-${option}`} type="button" key={option} aria-pressed={filter === option}
            onClick={() => setFilter(option)}>{option === 'all' ? 'All' : PERIOD_LABEL[option]}</button>
        ))}
      </div>
      {model.levels.some(level => level.revisited) && (
        <label><input type="checkbox" checked={showRevisited} onChange={event => setShowRevisited(event.target.checked)} /> Show revisited</label>
      )}
    </div>
    {model.historyState !== 'ready' && <p className="muted">
      {model.historyState === 'loading' ? 'Loading OKX daily history.' : 'OKX daily history unavailable. You can still add manual levels.'}
    </p>}
    {!groups.size && <p className="muted">No reference levels to show for this selection.</p>}
    <ol className="level-map">
      {rows.map(row => <li key={row.price} className={row.current ? 'level-row-current' : undefined}>
        <div className="level-map-price">
          <strong>{usd.format(row.price)}</strong>
          {row.current ? <small>Current price</small> : latestPrice !== null && <small>
            {usd.format(Math.abs(row.price - latestPrice))} {row.price > latestPrice ? 'above' : 'below'}
          </small>}
        </div>
        <div className="level-map-details">
          {row.entries.map(level => <details key={level.id}>
            <summary><LevelTag level={level} />{level.revisited && ' · Revisited'}</summary>
            {level.date !== undefined && <p>{level.kind === 'npoc' ? 'Period opened' : 'Eligible from'} {date.format(level.date)} UTC</p>}
            {level.note && <p>{level.note}</p>}
            {level.kind === 'manual' && <div className="levels-controls">
              <button type="button" className="secondary" onClick={() => model.toggle(level.id)}>
                {level.revisited ? 'Mark active' : 'Mark revisited'}
              </button>
              <button type="button" className="secondary" onClick={() => model.remove(level.id)}>Remove level</button>
            </div>}
          </details>)}
        </div>
      </li>)}
    </ol>
    </details>
    <details className="levels-help">
      <summary>How levels are calculated</summary>
      <p>A close/open level can appear in the third period. The second period must open at the first period’s closing price and close away from it. A later touch removes the candidate. The opening interval can include a return that candle data cannot verify.</p>
      <p>NPOC Magnets are estimated points of control from completed daily, weekly or monthly profiles. They remain on the list while subsequent candles stay outside their price band. Weeks start on Monday UTC. Blue is daily, yellow is weekly and purple is monthly.</p>
      <p>Manual levels stay in this browser and can be marked revisited here.</p>
    </details>
  </section>
}

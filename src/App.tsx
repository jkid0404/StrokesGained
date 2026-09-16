import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import './App.css'
import {
  BENCHMARK_VERSION,
  LIE_LABELS,
  benchmarkRange,
  buildCourseTemplates,
  buildHoleSequence,
  buildPersonalBaseline,
  calculateCumulativeMetrics,
  calculateRound,
  calculateShot,
  courseKey,
  createId,
  defaultClub,
  defaultDistanceEntry,
  defaultFinishLie,
  excludeDeletedCourseTemplates,
  formatMetric,
  mergeCourseTemplates,
  type CourseTemplate,
  type Hole,
  type Lie,
  type Position,
  type Round,
  type Shot,
  type ShotCategory,
} from './domain'
import {
  loadCourses,
  loadClubs,
  loadDeletedCourseKeys,
  loadRounds,
  saveClubs,
  saveCourses,
  saveDeletedCourseKeys,
  saveRounds,
} from './storage'
import type { LocalState } from './cloudState'
import { useCloudSync } from './useCloudSync'
import { usePwaUpdate } from './usePwaUpdate'
import { Trends } from './Trends'
import { updateShotInHole } from './shotEditing'
import { calculateTraditionalStats } from './traditionalStats'
import { TraditionalStatsPanel } from './TraditionalStatsPanel'

type View =
  | 'home'
  | 'setup'
  | 'entry'
  | 'review'
  | 'results'
  | 'trends'
  | 'courses'
  | 'course-edit'
  | 'bag'

const CATEGORY_LABELS: Record<ShotCategory, string> = {
  'off-the-tee': 'Off the tee',
  approach: 'Approach',
  'around-the-green': 'Around green',
  putting: 'Putting',
}

const PLAYABLE_LIES: Lie[] = ['fairway', 'rough', 'sand', 'green', 'holed']

function calculateHoleStrokesGained(hole: Hole): number | null {
  if (hole.shots.at(-1)?.finish.lie !== 'holed') return null

  const results = hole.shots.map((shot, index) => calculateShot(shot, index, hole.par))
  if (results.some((result) => result.strokesGained === null)) return null

  return results.reduce((sum, result) => sum + (result.strokesGained ?? 0), 0)
}

function availableDefaultClub(
  start: Position,
  clubs: string[],
  mostRecentTeeClub: string,
  mostRecentOtherClub: string,
): string {
  const preferred = defaultClub(start, mostRecentTeeClub, mostRecentOtherClub)
  if (clubs.includes(preferred)) return preferred
  if (start.lie === 'tee') {
    return clubs.find((club) => club !== 'Putter') ?? clubs[0] ?? ''
  }
  return ''
}

function App() {
  const [rounds, setRounds] = useState<Round[]>(loadRounds)
  const [courses, setCourses] = useState<CourseTemplate[]>(() =>
    excludeDeletedCourseTemplates(
      mergeCourseTemplates(buildCourseTemplates(loadRounds()), loadCourses()),
      loadDeletedCourseKeys(),
    ),
  )
  const [deletedCourseKeys, setDeletedCourseKeys] = useState<string[]>(loadDeletedCourseKeys)
  const [clubs, setClubs] = useState<string[]>(loadClubs)
  const [view, setView] = useState<View>('home')
  const [activeRoundId, setActiveRoundId] = useState<string | null>(null)
  const [activeHoleIndex, setActiveHoleIndex] = useState(0)
  const [activeCourseKey, setActiveCourseKey] = useState<string | null>(null)

  useEffect(() => saveRounds(rounds), [rounds])
  useEffect(() => saveCourses(courses), [courses])
  useEffect(() => saveDeletedCourseKeys(deletedCourseKeys), [deletedCourseKeys])
  useEffect(() => saveClubs(clubs), [clubs])

  const applyCloudState = useCallback((state: LocalState) => {
    setRounds(state.rounds)
    setCourses(state.courses)
    setDeletedCourseKeys(state.deletedCourseKeys)
    setClubs(state.clubs)
    setActiveRoundId(null)
    setActiveCourseKey(null)
    setView('home')
  }, [])

  const cloud = useCloudSync({
    localState: { rounds, courses, deletedCourseKeys, clubs },
    applyState: applyCloudState,
  })
  const pwa = usePwaUpdate()
  const roundSyncPending =
    view === 'entry' &&
    ['saving', 'offline', 'error'].includes(cloud.syncStatus)

  const activeRound = rounds.find((round) => round.id === activeRoundId) ?? null
  const roundsSelected =
    view === 'home' || view === 'entry' || view === 'review' || view === 'results'
  const trendsSelected = view === 'trends'
  const coursesSelected = view === 'courses' || view === 'course-edit'

  function upsertRound(round: Round) {
    setRounds((current) => {
      const exists = current.some((item) => item.id === round.id)
      return exists
        ? current.map((item) => (item.id === round.id ? round : item))
        : [round, ...current]
    })
  }

  function startRound(round: Round) {
    upsertRound(round)
    const teeName = round.teeName?.trim() || 'Unspecified tees'
    const key = courseKey(round.courseName, teeName)
    setDeletedCourseKeys((keys) => keys.filter((deletedKey) => deletedKey !== key))
    setCourses((current) => {
      return current.some((course) => course.key === key)
        ? current
        : [...current, { key, name: round.courseName, teeName, holes: {} }].sort(
            (a, b) => a.name.localeCompare(b.name),
          )
    })
    setActiveRoundId(round.id)
    const firstIncomplete = round.holes.findIndex(
      (hole) => hole.shots.at(-1)?.finish.lie !== 'holed',
    )
    setActiveHoleIndex(firstIncomplete === -1 ? round.holes.length - 1 : firstIncomplete)
    setView('entry')
  }

  function updateCourseHole(courseName: string, teeName: string, hole: Hole) {
    const key = courseKey(courseName, teeName)
    setDeletedCourseKeys((keys) => keys.filter((deletedKey) => deletedKey !== key))
    setCourses((current) => {
      const existing = current.find((course) => course.key === key)
      const updated: CourseTemplate = {
        key,
        name: existing?.name ?? courseName,
        teeName: existing?.teeName ?? teeName,
        holes: {
          ...(existing?.holes ?? {}),
          [hole.number]: { par: hole.par, yardage: hole.yardage },
        },
      }
      return [...current.filter((course) => course.key !== key), updated].sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    })
  }

  function saveCourse(course: CourseTemplate, originalKey: string) {
    setCourses((current) =>
      [...current.filter((item) => item.key !== originalKey && item.key !== course.key), course].sort(
        (a, b) => a.name.localeCompare(b.name),
      ),
    )
    setDeletedCourseKeys((keys) => [
      ...keys.filter((key) => key !== course.key && key !== originalKey),
      ...(course.key === originalKey ? [] : [originalKey]),
    ])
    setActiveCourseKey(course.key)
    setView('courses')
  }

  function deleteCourse(course: CourseTemplate) {
    const confirmed = window.confirm(
      `Delete ${course.name} — ${course.teeName}? Historical rounds will not be changed.`,
    )
    if (!confirmed) return

    setCourses((current) => current.filter((item) => item.key !== course.key))
    setDeletedCourseKeys((keys) =>
      keys.includes(course.key) ? keys : [...keys, course.key],
    )
    if (activeCourseKey === course.key) setActiveCourseKey(null)
  }

  if (!cloud.canUseApp) {
    return (
      <div className="app-shell">
        <header className="app-header">
          <div className="brand" aria-label="Strokes Gained">
            <span className="brand-mark">SG</span>
            <span>
              <strong>Strokes Gained</strong>
            </span>
          </div>
        </header>
        <main>
          <AuthGate
            authMode={cloud.authMode}
            userDetails={cloud.principal?.userDetails ?? null}
          />
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <button className="brand" onClick={() => setView('home')} type="button">
          <span className="brand-mark">SG</span>
          <span>
            <strong>Strokes Gained</strong>
          </span>
        </button>
        <div className="header-controls">
          <nav aria-label="Primary navigation">
            <button
              className={`nav-button ${roundsSelected ? 'active' : ''}`}
              type="button"
              onClick={() => setView('home')}
            >
              Rounds
            </button>
            <button
              className={`nav-button ${trendsSelected ? 'active' : ''}`}
              type="button"
              onClick={() => setView('trends')}
            >
              Trends
            </button>
            <button
              className={`nav-button ${coursesSelected ? 'active' : ''}`}
              type="button"
              onClick={() => setView('courses')}
            >
              Courses
            </button>
            <button
              className={`nav-button new-round ${view === 'setup' ? 'active' : ''}`}
              type="button"
              onClick={() => setView('setup')}
            >
              New round
            </button>
          </nav>
          <CloudStatus
            authMode={cloud.authMode}
            status={cloud.syncStatus}
            message={cloud.syncMessage}
            userDetails={cloud.principal?.userDetails ?? null}
          />
        </div>
      </header>

      <main>
        {pwa.updateAvailable && (
          <div className="app-update-banner" role="status">
            <div>
              <strong>App update available</strong>
              <span>Reload when you are ready to use the latest version.</span>
            </div>
            <div className="app-update-actions">
              <button className="text-button" type="button" onClick={pwa.dismissUpdate}>
                Later
              </button>
              <button className="primary compact" type="button" onClick={pwa.applyUpdate}>
                Update now
              </button>
            </div>
          </div>
        )}
        {cloud.syncStatus === 'conflict' && (
          <div className="sync-conflict" role="alert">
            <div>
              <strong>Cloud data changed on another device.</strong>
              <span>Your local changes were not uploaded.</span>
            </div>
            <button className="secondary compact" type="button" onClick={cloud.reloadCloudData}>
              Reload cloud data
            </button>
          </div>
        )}
        {roundSyncPending && (
          <DelayedRoundSyncBanner
            message={cloud.syncMessage}
            status={cloud.syncStatus}
          />
        )}
        {view === 'home' && (
          <Home
            clubCount={clubs.length}
            rounds={rounds}
            onManageBag={() => setView('bag')}
            onNew={() => setView('setup')}
            onOpen={(round) => {
              const firstIncomplete = round.holes.findIndex(
                (hole) => hole.shots.at(-1)?.finish.lie !== 'holed',
              )
              setActiveRoundId(round.id)
              setActiveHoleIndex(firstIncomplete === -1 ? 0 : firstIncomplete)
              setView(round.status === 'complete' ? 'results' : 'entry')
            }}
          />
        )}
        {view === 'setup' && (
          <RoundSetup
            courses={courses}
            onStart={startRound}
            onCancel={() => setView('home')}
          />
        )}
        {view === 'trends' && <Trends clubs={clubs} rounds={rounds} />}
        {view === 'entry' && activeRound && (
          <RoundEntry
            key={activeRound.id}
            round={activeRound}
            clubs={clubs}
            activeHoleIndex={Math.max(0, activeHoleIndex)}
            isCloudSynced={
              cloud.syncStatus === 'saved' && cloud.pendingChanges === 0
            }
            onHoleChange={setActiveHoleIndex}
            onChange={upsertRound}
            onHoleDetailsChange={updateCourseHole}
            onReview={() => setView('review')}
          />
        )}
        {view === 'review' && activeRound && (
          <RoundReview
            round={activeRound}
            onBack={() => setView('entry')}
            onEditHole={(index) => {
              setActiveHoleIndex(index)
              setView('entry')
            }}
            onFinish={() => {
              upsertRound({ ...activeRound, status: 'complete' })
              setView('results')
            }}
          />
        )}
        {view === 'results' && activeRound && (
          <Results
            round={activeRound}
            allRounds={rounds}
            onBack={() => setView('home')}
            onEdit={() => {
              setActiveHoleIndex(0)
              setView('entry')
            }}
          />
        )}
        {view === 'courses' && (
          <CourseLibrary
            courses={courses}
            onBack={() => setView('home')}
            onDelete={deleteCourse}
            onEdit={(course) => {
              setActiveCourseKey(course.key)
              setView('course-edit')
            }}
          />
        )}
        {view === 'bag' && (
          <BagManager
            clubs={clubs}
            onBack={() => setView('home')}
            onChange={setClubs}
          />
        )}
        {view === 'course-edit' && activeCourseKey && (
          <CourseEditor
            course={courses.find((course) => course.key === activeCourseKey)}
            onCancel={() => setView('courses')}
            onSave={(course) => saveCourse(course, activeCourseKey)}
          />
        )}
      </main>
    </div>
  )
}

function AuthGate({
  authMode,
  userDetails,
}: {
  authMode: 'checking' | 'local' | 'signed-out' | 'signed-in' | 'denied'
  userDetails: string | null
}) {
  const loading = authMode === 'checking' || authMode === 'signed-in'

  return (
    <section className="auth-page">
      <div className="auth-card">
        <span className="brand-mark large">SG</span>
        {loading ? (
          <>
            <span className="eyebrow">Secure cloud storage</span>
            <h1>Loading your golf data…</h1>
            <p>Checking Microsoft sign-in and synchronizing this device.</p>
          </>
        ) : authMode === 'denied' ? (
          <>
            <span className="eyebrow">Access restricted</span>
            <h1>This Microsoft account is not allowed.</h1>
            <p>
              {userDetails
                ? `${userDetails} is signed in, but it does not match the configured allowlist.`
                : 'The signed-in account does not match the configured allowlist.'}
            </p>
            <a className="secondary auth-link" href="/.auth/logout?post_logout_redirect_uri=/">
              Sign out
            </a>
          </>
        ) : (
          <>
            <span className="eyebrow">Private cross-device sync</span>
            <h1>Sign in to see your rounds.</h1>
            <p>
              Microsoft authentication protects your cloud data. Existing data on this device
              will be uploaded after your first sign-in if the cloud is empty.
            </p>
            <a className="primary auth-link" href="/.auth/login/aad?post_login_redirect_uri=/">
              Sign in with Microsoft
            </a>
          </>
        )}
      </div>
    </section>
  )
}

function CloudStatus({
  authMode,
  status,
  message,
  userDetails,
}: {
  authMode: 'checking' | 'local' | 'signed-out' | 'signed-in' | 'denied'
  status: string
  message: string
  userDetails: string | null
}) {
  if (authMode === 'local') {
    return (
      <div className="cloud-status local" title="Static Web Apps authentication is unavailable">
        <span className="status-dot" />
        <span>Local only</span>
      </div>
    )
  }

  return (
    <div className="cloud-account">
      <div className={`cloud-status ${status}`} title={userDetails ?? message}>
        <span className="status-dot" />
        <span>{message}</span>
      </div>
      <a
        className="text-button sign-out-link"
        href="/.auth/logout?post_logout_redirect_uri=/"
      >
        Sign out
      </a>
    </div>
  )
}

function DelayedRoundSyncBanner({
  message,
  status,
}: {
  message: string
  status: string
}) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className={`round-sync-banner ${status}`} role="status">
      {status === 'offline' ? message : 'Sync pending'}
    </div>
  )
}

function Home({
  clubCount,
  rounds,
  onManageBag,
  onNew,
  onOpen,
}: {
  clubCount: number
  rounds: Round[]
  onManageBag: () => void
  onNew: () => void
  onOpen: (round: Round) => void
}) {
  const cumulative = calculateCumulativeMetrics(rounds)

  return (
    <section className="page">
      <div className="hero-card">
        <div className="hero-overview">
          <span className="eyebrow">All completed rounds</span>
          <h1>Cumulative strokes gained</h1>
          <p>
            A running view of your performance against the PGA tour and your own
            established form.
          </p>
        </div>
        <div className="hero-metric-grid">
          <HeroMetric
            label="Vs PGA Tour average"
            value={cumulative.versusPgaTour}
            detail={`${cumulative.pgaRoundCount} completed round${
              cumulative.pgaRoundCount === 1 ? '' : 's'
            }`}
          />
          <HeroMetric
            label="Vs your average"
            value={cumulative.versusPersonalAverage}
            detail={
              cumulative.personalRoundCount
                ? `${cumulative.personalRoundCount} round${
                    cumulative.personalRoundCount === 1 ? '' : 's'
                  } with a prior baseline`
                : 'Available after 5 prior eligible rounds'
            }
          />
        </div>
      </div>

      <div className="home-management-card card">
        <div>
          <span className="eyebrow">Club presets</span>
          <h2>My Bag</h2>
          <p>
            {clubCount} club{clubCount === 1 ? '' : 's'} available during shot
            entry.
          </p>
        </div>
        <button className="secondary" type="button" onClick={onManageBag}>
          Manage clubs
        </button>
      </div>

      <div className="section-heading">
        <div>
          <span className="eyebrow">Round history</span>
          <h2>Your rounds</h2>
        </div>
        <span className="pill">{rounds.length} saved</span>
      </div>

      {rounds.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⛳</div>
          <h3>No rounds yet</h3>
          <p>Create a round, enter each finishing position, and the app will build the shot chain.</p>
          <button className="primary" type="button" onClick={onNew}>
            Create first round
          </button>
        </div>
      ) : (
        <div className="round-list">
          {rounds.map((round) => {
            const metrics = calculateRound(round)
            return (
              <button className="round-row" key={round.id} type="button" onClick={() => onOpen(round)}>
                <span>
                  <strong>{round.courseName}</strong>
                  <small>
                    {round.playedOn} · {metrics.completedHoles}/{round.holes.length} holes
                  </small>
                </span>
                <span className="round-score">
                  <strong
                    className={
                      metrics.strokesGainedPer18 === null
                        ? 'neutral-metric'
                        : metrics.strokesGainedPer18 >= 0
                          ? 'positive'
                          : 'negative'
                    }
                  >
                    {formatMetric(metrics.strokesGainedPer18)}
                  </strong>
                  <small>{round.status === 'draft' ? 'Draft' : 'SG / 18'}</small>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}

function HeroMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: number | null
  detail: string
}) {
  const tone = value === null ? 'neutral' : value >= 0 ? 'gain' : 'loss'
  return (
    <div className="hero-stat">
      <span>{label}</span>
      <strong className={tone}>{value === null ? '—' : formatMetric(value)}</strong>
      <small>{detail}</small>
    </div>
  )
}

function RoundSetup({
  courses,
  onStart,
  onCancel,
}: {
  courses: CourseTemplate[]
  onStart: (round: Round) => void
  onCancel: () => void
}) {
  const [selectedCourseKey, setSelectedCourseKey] = useState('')
  const [courseName, setCourseName] = useState('')
  const [teeName, setTeeName] = useState('')
  const [playedOn, setPlayedOn] = useState(new Date().toISOString().slice(0, 10))
  const [holeCount, setHoleCount] = useState<9 | 18>(18)
  const [startingHole, setStartingHole] = useState(1)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const selectedTemplate = courses.find(
      (template) => template.key === selectedCourseKey,
    )
    const holes = buildHoleSequence(holeCount, startingHole).map((hole) => {
      const savedHole = selectedTemplate?.holes[hole.number]
      return savedHole ? { ...hole, ...savedHole } : hole
    })

    onStart({
      id: createId('round'),
      courseName: courseName.trim() || 'Unnamed course',
      teeName: teeName.trim() || 'Unspecified tees',
      playedOn,
      createdAt: new Date().toISOString(),
      status: 'draft',
      holes,
      benchmarkVersion: BENCHMARK_VERSION,
    })
  }

  return (
    <section className="page narrow">
      <button className="text-button" type="button" onClick={onCancel}>
        ← Back to rounds
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Round setup</span>
          <h1 className="page-title">Start your round</h1>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="card form-grid">
          <label>
            Course
            <select
              value={selectedCourseKey}
              onChange={(event) => {
                const key = event.target.value
                const template = courses.find((item) => item.key === key)
                setSelectedCourseKey(key)
                setCourseName(template?.name ?? '')
                setTeeName(template?.teeName ?? '')
              }}
            >
              <option value="">New course</option>
              {courses.map((template) => (
                <option value={template.key} key={template.key}>
                  {template.name} — {template.teeName}
                </option>
              ))}
            </select>
          </label>
          {selectedCourseKey === '' && (
            <>
              <label>
                New course name
                <input
                  value={courseName}
                  onChange={(event) => setCourseName(event.target.value)}
                  placeholder="e.g. Green Valley Golf Club"
                />
              </label>
              <label>
                Tees
                <input
                  value={teeName}
                  onChange={(event) => setTeeName(event.target.value)}
                  placeholder="e.g. Blue"
                />
              </label>
            </>
          )}
          <label>
            Date played
            <input type="date" value={playedOn} onChange={(event) => setPlayedOn(event.target.value)} />
          </label>
          <label>
            Starting hole
            <select
              value={startingHole}
              onChange={(event) => setStartingHole(Number(event.target.value))}
            >
              {Array.from({ length: 18 }, (_, index) => index + 1).map((number) => (
                <option value={number} key={number}>
                  Hole {number}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="hole-count-field">
            <legend>Round length</legend>
            <div className="segmented">
              {[9, 18].map((count) => (
                <button
                  className={holeCount === count ? 'active' : ''}
                  key={count}
                  type="button"
                  onClick={() => setHoleCount(count as 9 | 18)}
                >
                  {count} holes
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="setup-explainer">
          <strong>
            {selectedCourseKey
              ? 'Saved hole details will be reused.'
              : 'No scorecard entry required.'}
          </strong>
          <span>
            {selectedCourseKey
              ? 'Any missing holes will be requested when you reach them.'
              : "You will enter each hole's par and yardage as you play it."}
          </span>
        </div>
        <div className="actions">
          <button className="secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Begin shot entry
          </button>
        </div>
      </form>
    </section>
  )
}

function RoundEntry({
  round,
  clubs,
  activeHoleIndex,
  isCloudSynced,
  onHoleChange,
  onChange,
  onHoleDetailsChange,
  onReview,
}: {
  round: Round
  clubs: string[]
  activeHoleIndex: number
  isCloudSynced: boolean
  onHoleChange: (index: number) => void
  onChange: (round: Round) => void
  onHoleDetailsChange: (courseName: string, teeName: string, hole: Hole) => void
  onReview: () => void
}) {
  const hole = round.holes[activeHoleIndex]
  const needsHoleSetup = hole.par < 3 || hole.yardage <= 0
  const isHoleComplete = hole.shots.at(-1)?.finish.lie === 'holed'
  const start: Position =
    hole.shots.at(-1)?.finish ?? { lie: 'tee', distance: hole.yardage, unit: 'yards' }
  const startLie = start.lie
  const startDistance = start.distance
  const startUnit = start.unit
  const mostRecentFinishLie = useRef<Lie>('fairway')
  const mostRecentTeeClub = useRef(clubs.includes('Driver') ? 'Driver' : '')
  const mostRecentOtherClub = useRef('')
  const initialFinishLie = defaultFinishLie(
    hole.par,
    hole.shots.length,
    start,
    'fairway',
  )
  const [finishLie, setFinishLie] = useState<Lie>(initialFinishLie)
  const [distance, setDistance] = useState(
    String(defaultDistanceEntry(start, initialFinishLie)),
  )
  const [penaltyStrokes, setPenaltyStrokes] = useState(0)
  const [club, setClub] = useState(() =>
    availableDefaultClub(
      start,
      clubs,
      clubs.includes('Driver') ? 'Driver' : '',
      '',
    ),
  )
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [editingHoleDetails, setEditingHoleDetails] = useState(false)
  const [editingShotIndex, setEditingShotIndex] = useState<number | null>(null)
  const shotCardRef = useRef<HTMLDivElement>(null)
  const holeTabsRef = useRef<HTMLDivElement>(null)
  const metrics = calculateRound(round)
  const liveStrokesGained =
    metrics.totalShots === 0 ? 0 : metrics.totalStrokesGained
  const holeShotResults = hole.shots.map((shot, index) =>
    calculateShot(shot, index, hole.par),
  )
  const holeStrokesGained = calculateHoleStrokesGained(hole)

  useEffect(() => {
    const nextFinishLie = defaultFinishLie(
      hole.par,
      hole.shots.length,
      { lie: startLie, distance: startDistance, unit: startUnit },
      mostRecentFinishLie.current,
    )
    setFinishLie(nextFinishLie)
    setDistance(
      String(
        defaultDistanceEntry(
          { lie: startLie, distance: startDistance, unit: startUnit },
          nextFinishLie,
        ),
      ),
    )
    setPenaltyStrokes(0)
    setClub(
      availableDefaultClub(
        { lie: startLie, distance: startDistance, unit: startUnit },
        clubs,
        mostRecentTeeClub.current,
        mostRecentOtherClub.current,
      ),
    )
    setNote('')
    setFormError('')
    setEditingHoleDetails(false)
    setEditingShotIndex(null)
  }, [
    activeHoleIndex,
    clubs,
    hole.par,
    hole.shots.length,
    startDistance,
    startLie,
    startUnit,
  ])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const container = holeTabsRef.current
      const activeTab = container?.querySelector<HTMLElement>(
        '[data-active-hole="true"]',
      )
      if (!container || !activeTab || container.scrollWidth <= container.clientWidth) {
        return
      }

      const containerRect = container.getBoundingClientRect()
      const tabRect = activeTab.getBoundingClientRect()
      const centeredLeft =
        container.scrollLeft +
        tabRect.left -
        containerRect.left -
        (container.clientWidth - tabRect.width) / 2
      const maximumLeft = container.scrollWidth - container.clientWidth
      const left = Math.min(maximumLeft, Math.max(0, centeredLeft))
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)',
      ).matches

      container.scrollTo({
        left,
        behavior: reduceMotion ? 'auto' : 'smooth',
      })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activeHoleIndex])

  useEffect(() => {
    if (hole.shots.length === 0 || needsHoleSetup) return
    if (!window.matchMedia('(max-width: 800px)').matches) return

    const timer = window.setTimeout(() => {
      shotCardRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 180)
    return () => window.clearTimeout(timer)
  }, [hole.shots.length, needsHoleSetup])

  function addShot(event: React.FormEvent) {
    event.preventDefault()
    const parsedDistance = Number(distance)
    if (finishLie !== 'holed' && (!Number.isFinite(parsedDistance) || parsedDistance <= 0)) {
      setFormError('Enter a distance greater than zero.')
      return
    }

    const finish: Position =
      finishLie === 'holed'
        ? { lie: 'holed', distance: 0, unit: 'feet' }
        : {
            lie: finishLie,
            distance: parsedDistance,
            unit: finishLie === 'green' ? 'feet' : 'yards',
          }

    const trimmedClub = club.trim()
    const trimmedNote = note.trim()
    const shot: Shot = {
      id: createId('shot'),
      start,
      finish,
      penaltyStrokes,
      ...(trimmedClub ? { club: trimmedClub } : {}),
      ...(trimmedNote ? { note: trimmedNote } : {}),
    }
    const result = calculateShot(shot, hole.shots.length, hole.par)
    if (result.error) {
      setFormError(result.error)
      return
    }

    const updatedHoles = round.holes.map((item, index) =>
      index === activeHoleIndex ? { ...item, shots: [...item.shots, shot] } : item,
    )
    onChange({ ...round, holes: updatedHoles })
  }

  function truncateShots(index: number) {
    const updatedHoles = round.holes.map((item, holeIndex) =>
      holeIndex === activeHoleIndex ? { ...item, shots: item.shots.slice(0, index) } : item,
    )
    onChange({ ...round, holes: updatedHoles })
  }

  function saveEditedShot(index: number, shot: Shot) {
    const updatedHoles = round.holes.map((item, holeIndex) =>
      holeIndex === activeHoleIndex ? updateShotInHole(item, index, shot) : item,
    )
    onChange({ ...round, holes: updatedHoles })
    setEditingShotIndex(null)
  }

  function goNext() {
    if (activeHoleIndex < round.holes.length - 1) onHoleChange(activeHoleIndex + 1)
  }

  function saveHoleDetails(par: number, yardage: number) {
    const updatedHoles = round.holes.map((item, index) =>
      index === activeHoleIndex
        ? {
            ...item,
            par,
            yardage,
            shots: item.shots.map((shot, shotIndex) =>
              shotIndex === 0 && shot.start.lie === 'tee'
                ? {
                    ...shot,
                    start: { ...shot.start, distance: yardage, unit: 'yards' as const },
                  }
                : shot,
            ),
          }
        : item,
    )
    onChange({ ...round, holes: updatedHoles })
    onHoleDetailsChange(round.courseName, round.teeName ?? 'Unspecified tees', {
      ...hole,
      par,
      yardage,
    })
    setEditingHoleDetails(false)
  }

  const allComplete = metrics.completedHoles === round.holes.length
  const clubIsCustom =
    club !== '' && !clubs.some((option) => option === club)

  return (
    <section className="entry-page">
      <div className="entry-topbar">
        <div>
          <span className="eyebrow">{round.courseName}</span>
          <span className="round-tee-name">{round.teeName ?? 'Unspecified tees'}</span>
          <h1 className="page-title">Hole {hole.number}</h1>
        </div>
        <div className="live-score-summary">
          <div className="score-chip">
            <strong>{metrics.totalStrokes}</strong>
            <small>Total strokes</small>
          </div>
          <div className="score-chip strokes-gained-chip">
            <strong
              className={
                liveStrokesGained !== null && liveStrokesGained >= 0
                  ? 'positive'
                  : 'negative'
              }
            >
              {formatMetric(liveStrokesGained)}
            </strong>
            <small>Cumulative SG</small>
          </div>
        </div>
      </div>

      <div className="hole-tabs" aria-label="Select hole" ref={holeTabsRef}>
        {round.holes.map((item, index) => {
          const isComplete = item.shots.at(-1)?.finish.lie === 'holed'
          const strokesGained = calculateHoleStrokesGained(item)
          return (
            <div
              className="hole-tab"
              data-active-hole={index === activeHoleIndex}
              key={item.number}
            >
              {isComplete && (
                <span
                  className={`hole-tab-sg ${
                    strokesGained === null
                      ? 'unsupported'
                      : strokesGained >= 0
                        ? 'positive'
                        : 'negative'
                  }`}
                >
                  {formatMetric(strokesGained)}
                </span>
              )}
              <button
                aria-label={
                  isComplete
                    ? `Hole ${item.number}, strokes gained ${formatMetric(
                        strokesGained,
                      )}, ${isCloudSynced ? 'synced to Azure' : 'sync pending'}`
                    : `Hole ${item.number}`
                }
                className={`${index === activeHoleIndex ? 'active' : ''} ${
                  isComplete ? 'complete' : ''
                } ${isComplete && isCloudSynced ? 'synced' : ''}`}
                type="button"
                onClick={() => onHoleChange(index)}
              >
                {item.number}
              </button>
            </div>
          )
        })}
      </div>

      <div className="live-category-grid" aria-label="Live strokes gained by category">
        {(Object.keys(metrics.categories) as ShotCategory[]).map((category) => {
          const metric = metrics.categories[category]
          return (
            <div className="live-category" key={category}>
              <span>{CATEGORY_LABELS[category]}</span>
              <strong className={metric.total >= 0 ? 'positive' : 'negative'}>
                {formatMetric(metric.total)}
              </strong>
              <small>
                {metric.shots} shot{metric.shots === 1 ? '' : 's'}
              </small>
            </div>
          )
        })}
      </div>

      {metrics.supportedShots !== metrics.totalShots && (
        <div className="live-coverage-warning">
          Cumulative SG is unavailable because one or more shots are outside the benchmark
          range. Category values include supported shots only.
        </div>
      )}

      {needsHoleSetup || editingHoleDetails ? (
        <HoleSetup
          hole={hole}
          onCancel={needsHoleSetup ? undefined : () => setEditingHoleDetails(false)}
          onSave={saveHoleDetails}
        />
      ) : (
      <div className="entry-layout">
        <div>
          <div className="hole-summary card">
            <span>Par {hole.par}</span>
            <strong>{hole.yardage} yd</strong>
            <span>{hole.shots.length} shot{hole.shots.length === 1 ? '' : 's'} entered</span>
            <button
              className="edit-hole-button"
              type="button"
              onClick={() => setEditingHoleDetails(true)}
            >
              Edit hole
            </button>
          </div>

          {hole.shots.length > 0 && (
            <div className="shot-timeline card">
              <h2>Shot history</h2>
              {hole.shots.map((shot, index) => {
                const result = holeShotResults[index]
                return (
                  <Fragment key={shot.id}>
                    <div className="shot-row">
                      <span className="shot-number">{index + 1}</span>
                      <span className="shot-description">
                        <strong>
                          {LIE_LABELS[shot.start.lie]} {shot.start.distance}
                          {shot.start.unit === 'feet' ? ' ft' : ' yd'}
                        </strong>
                        <small>
                          to {LIE_LABELS[shot.finish.lie]}
                          {shot.finish.lie !== 'holed'
                            ? ` ${shot.finish.distance}${shot.finish.unit === 'feet' ? ' ft' : ' yd'}`
                            : ''}
                          {shot.penaltyStrokes ? ` · +${shot.penaltyStrokes} penalty` : ''}
                        </small>
                        {(shot.club || shot.note) && (
                          <small className="shot-metadata">
                            {[shot.club, shot.note].filter(Boolean).join(' · ')}
                          </small>
                        )}
                      </span>
                      <strong
                        className={
                          result.strokesGained !== null && result.strokesGained >= 0
                            ? 'positive'
                            : 'negative'
                        }
                      >
                        {formatMetric(result.strokesGained)}
                      </strong>
                      <span className="shot-row-actions">
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() =>
                            setEditingShotIndex(
                              editingShotIndex === index ? null : index,
                            )
                          }
                        >
                          {editingShotIndex === index ? 'Cancel' : 'Edit'}
                        </button>
                        <button
                          className="icon-button"
                          type="button"
                          onClick={() => truncateShots(index)}
                        >
                          Undo
                        </button>
                      </span>
                    </div>
                    {editingShotIndex === index && (
                      <ShotEditor
                        clubs={clubs}
                        isLast={index === hole.shots.length - 1}
                        onCancel={() => setEditingShotIndex(null)}
                        onSave={(updatedShot) => saveEditedShot(index, updatedShot)}
                        par={hole.par}
                        shot={shot}
                        shotIndex={index}
                      />
                    )}
                  </Fragment>
                )
              })}
              {isHoleComplete && (
                <div className="hole-sg-total">
                  <span>Hole strokes gained</span>
                  <strong
                    className={
                      holeStrokesGained === null
                        ? 'unsupported'
                        : holeStrokesGained >= 0
                          ? 'positive'
                          : 'negative'
                    }
                  >
                    {formatMetric(holeStrokesGained)}
                  </strong>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card shot-form-card" ref={shotCardRef}>
          {isHoleComplete ? (
            <div className="complete-panel">
              <span className="complete-check">✓</span>
              <h2>Hole complete</h2>
              <p>
                Score: {hole.shots.reduce((sum, shot) => sum + 1 + shot.penaltyStrokes, 0)}
              </p>
              {activeHoleIndex < round.holes.length - 1 && (
                <button className="primary" type="button" onClick={goNext}>
                  Continue to hole {round.holes[activeHoleIndex + 1].number}
                </button>
              )}
              {allComplete && (
                <button className="primary" type="button" onClick={onReview}>
                  Review round
                </button>
              )}
              <button className="secondary" type="button" onClick={() => truncateShots(hole.shots.length - 1)}>
                Undo last shot
              </button>
            </div>
          ) : (
            <form onSubmit={addShot}>
              <span className="eyebrow">Shot {hole.shots.length + 1}</span>
              <h2>
                From {LIE_LABELS[start.lie]}, {start.distance}
                {start.unit === 'feet' ? ' ft' : ' yd'}
              </h2>
              <p className="muted">Where did the ball finish?</p>

              <div className="lie-buttons">
                {PLAYABLE_LIES.map((lie) => (
                  <button
                    className={finishLie === lie ? 'active' : ''}
                    type="button"
                    key={lie}
                    onClick={() => {
                      mostRecentFinishLie.current = lie
                      setFinishLie(lie)
                    }}
                  >
                    {LIE_LABELS[lie]}
                  </button>
                ))}
              </div>

              {finishLie !== 'holed' && (
                <label>
                  Distance remaining ({finishLie === 'green' ? 'feet' : 'yards'})
                  <input
                    inputMode="decimal"
                    min="0.1"
                    required
                    step="0.1"
                    type="number"
                    value={distance}
                    onChange={(event) => setDistance(event.target.value)}
                  />
                  <small>Supported range: {benchmarkRange(finishLie)}</small>
                </label>
              )}

              <label>
                Penalty strokes on this shot
                <select
                  value={penaltyStrokes}
                  onChange={(event) => setPenaltyStrokes(Number(event.target.value))}
                >
                  <option value="0">None</option>
                  <option value="1">1 stroke</option>
                  <option value="2">2 strokes</option>
                </select>
              </label>

              <details className="shot-optional-details" open>
                <summary>
                  {club ? `Club: ${club}` : 'Add club'}
                  {note ? ' · Note added' : ' · Add note'}
                </summary>
                <div className="shot-optional-fields">
                  <label>
                    Club
                    <select
                      value={club}
                      onChange={(event) => {
                        const nextClub = event.target.value
                        setClub(nextClub)
                        if (start.lie === 'tee') {
                          mostRecentTeeClub.current = nextClub
                        } else if (nextClub !== 'Putter') {
                          mostRecentOtherClub.current = nextClub
                        }
                      }}
                    >
                      <option value="">No club recorded</option>
                      {clubIsCustom && <option value={club}>{club}</option>}
                      {clubs.map((option) => (
                        <option value={option} key={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Shot note
                    <textarea
                      maxLength={300}
                      placeholder="Optional, e.g. into wind or pulled left"
                      rows={3}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                    <small>{note.length}/300</small>
                  </label>
                </div>
              </details>

              {formError && <div className="error-message">{formError}</div>}
              <button
                autoFocus={finishLie === 'holed'}
                className="primary full-width"
                type="submit"
              >
                Save shot
              </button>
            </form>
          )}
        </div>
      </div>
      )}
    </section>
  )
}

function CourseLibrary({
  courses,
  onBack,
  onDelete,
  onEdit,
}: {
  courses: CourseTemplate[]
  onBack: () => void
  onDelete: (course: CourseTemplate) => void
  onEdit: (course: CourseTemplate) => void
}) {
  return (
    <section className="page narrow">
      <button className="text-button" type="button" onClick={onBack}>
        ← Back to rounds
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Saved scorecards</span>
          <h1 className="page-title">Courses</h1>
        </div>
        <span className="pill">{courses.length} saved</span>
      </div>
      {courses.length === 0 ? (
        <div className="empty-state">
          <h3>No courses yet</h3>
          <p>Courses appear here after you start entering hole details in a round.</p>
        </div>
      ) : (
        <div className="course-list">
          {courses.map((course) => (
            <div className="course-row card" key={course.key}>
              <span>
                <strong>{course.name}</strong>
                <small>
                  {course.teeName} · {Object.keys(course.holes).length} holes configured
                </small>
              </span>
              <div className="course-row-actions">
                <button className="danger-button" type="button" onClick={() => onDelete(course)}>
                  Delete
                </button>
                <button className="secondary" type="button" onClick={() => onEdit(course)}>
                  Edit course
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function BagManager({
  clubs,
  onBack,
  onChange,
}: {
  clubs: string[]
  onBack: () => void
  onChange: (clubs: string[]) => void
}) {
  const [newClub, setNewClub] = useState('')
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState('')

  function validateName(name: string, ignoredIndex: number | null = null): string | null {
    const trimmed = name.trim()
    if (!trimmed) return 'Enter a club name.'
    if (trimmed.length > 40) return 'Club names must be 40 characters or fewer.'
    if (ignoredIndex === null && clubs.length >= 100) {
      return 'Your bag can contain at most 100 clubs.'
    }
    const duplicate = clubs.some(
      (club, index) =>
        index !== ignoredIndex && club.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    )
    return duplicate ? 'That club is already in your bag.' : null
  }

  function addClub(event: React.FormEvent) {
    event.preventDefault()
    const validationError = validateName(newClub)
    if (validationError) {
      setError(validationError)
      return
    }
    onChange([...clubs, newClub.trim()])
    setNewClub('')
    setError('')
  }

  function startRename(index: number) {
    setEditingIndex(index)
    setEditingName(clubs[index])
    setError('')
  }

  function renameClub(event: React.FormEvent) {
    event.preventDefault()
    if (editingIndex === null) return
    const validationError = validateName(editingName, editingIndex)
    if (validationError) {
      setError(validationError)
      return
    }
    onChange(
      clubs.map((club, index) => (index === editingIndex ? editingName.trim() : club)),
    )
    setEditingIndex(null)
    setEditingName('')
    setError('')
  }

  function deleteClub(index: number) {
    const club = clubs[index]
    const confirmed = window.confirm(
      `Delete ${club} from your bag? Historical shots will keep their recorded club.`,
    )
    if (!confirmed) return
    onChange(clubs.filter((_, clubIndex) => clubIndex !== index))
    if (editingIndex === index) {
      setEditingIndex(null)
      setEditingName('')
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1)
    }
    setError('')
  }

  return (
    <section className="page narrow">
      <button className="text-button" type="button" onClick={onBack}>
        ← Back to rounds
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Club presets</span>
          <h1 className="page-title">Manage My Bag</h1>
        </div>
        <span className="pill">{clubs.length} clubs</span>
      </div>
      <p className="muted bag-description">
        These clubs appear during shot entry. Renaming or deleting one does not change
        historical shots.
      </p>

      <form className="card bag-add-form" onSubmit={addClub}>
        <label>
          Add a club
          <input
            maxLength={40}
            placeholder="e.g. 5 hybrid"
            value={newClub}
            onChange={(event) => {
              setNewClub(event.target.value)
              setError('')
            }}
          />
        </label>
        <button className="primary" type="submit">
          Add club
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      {clubs.length === 0 ? (
        <div className="empty-state">
          <h3>Your bag is empty</h3>
          <p>Add a club above to make it available during shot entry.</p>
        </div>
      ) : (
        <div className="course-list">
          {clubs.map((club, index) => (
            <div className="course-row card bag-row" key={`${club}-${index}`}>
              {editingIndex === index ? (
                <form className="bag-rename-form" onSubmit={renameClub}>
                  <input
                    aria-label={`Rename ${club}`}
                    autoFocus
                    maxLength={40}
                    value={editingName}
                    onChange={(event) => {
                      setEditingName(event.target.value)
                      setError('')
                    }}
                  />
                  <button
                    className="secondary compact"
                    type="button"
                    onClick={() => {
                      setEditingIndex(null)
                      setEditingName('')
                      setError('')
                    }}
                  >
                    Cancel
                  </button>
                  <button className="primary compact" type="submit">
                    Save
                  </button>
                </form>
              ) : (
                <>
                  <strong>{club}</strong>
                  <div className="course-row-actions">
                    <button
                      className="danger-button"
                      type="button"
                      onClick={() => deleteClub(index)}
                    >
                      Delete
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => startRename(index)}
                    >
                      Rename
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ShotEditor({
  shot,
  clubs,
  shotIndex,
  par,
  isLast,
  onSave,
  onCancel,
}: {
  shot: Shot
  clubs: string[]
  shotIndex: number
  par: number
  isLast: boolean
  onSave: (shot: Shot) => void
  onCancel: () => void
}) {
  const [finishLie, setFinishLie] = useState<Lie>(shot.finish.lie)
  const [distance, setDistance] = useState(
    shot.finish.lie === 'holed' ? '' : String(shot.finish.distance),
  )
  const [penaltyStrokes, setPenaltyStrokes] = useState(shot.penaltyStrokes)
  const [club, setClub] = useState(shot.club ?? '')
  const [note, setNote] = useState(shot.note ?? '')
  const [error, setError] = useState('')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (finishLie === 'holed' && !isLast) {
      setError('Only the final shot on a hole can finish as holed.')
      return
    }

    const parsedDistance = Number(distance)
    if (finishLie !== 'holed' && (!Number.isFinite(parsedDistance) || parsedDistance <= 0)) {
      setError('Enter a distance greater than zero.')
      return
    }

    const finish: Position =
      finishLie === 'holed'
        ? { lie: 'holed', distance: 0, unit: 'feet' }
        : {
            lie: finishLie,
            distance: parsedDistance,
            unit: finishLie === 'green' ? 'feet' : 'yards',
          }
    const updatedShot: Shot = {
      ...shot,
      finish,
      penaltyStrokes,
      ...(club.trim() ? { club: club.trim() } : { club: undefined }),
      ...(note.trim() ? { note: note.trim() } : { note: undefined }),
    }
    const result = calculateShot(updatedShot, shotIndex, par)
    if (result.error) {
      setError(result.error)
      return
    }
    onSave(updatedShot)
  }

  return (
    <form className="shot-editor" onSubmit={submit}>
      <span className="eyebrow">Edit shot {shotIndex + 1}</span>
      <div className="shot-editor-grid">
        <label>
          Finishing lie
          <select
            value={finishLie}
            onChange={(event) => {
              const lie = event.target.value as Lie
              setFinishLie(lie)
              if (lie !== 'holed' && distance === '') {
                setDistance(String(defaultDistanceEntry(shot.start, lie)))
              }
            }}
          >
            {PLAYABLE_LIES.filter((lie) => isLast || lie !== 'holed').map((lie) => (
              <option value={lie} key={lie}>
                {LIE_LABELS[lie]}
              </option>
            ))}
          </select>
        </label>
        {finishLie !== 'holed' && (
          <label>
            Distance ({finishLie === 'green' ? 'feet' : 'yards'})
            <input
              inputMode="decimal"
              min="0.1"
              required
              step="0.1"
              type="number"
              value={distance}
              onChange={(event) => setDistance(event.target.value)}
            />
          </label>
        )}
        <label>
          Penalty strokes
          <select
            value={penaltyStrokes}
            onChange={(event) => setPenaltyStrokes(Number(event.target.value))}
          >
            <option value="0">None</option>
            <option value="1">1 stroke</option>
            <option value="2">2 strokes</option>
          </select>
        </label>
        <label>
          Club
          <select value={club} onChange={(event) => setClub(event.target.value)}>
            <option value="">No club recorded</option>
            {club && !clubs.some((option) => option === club) && (
              <option value={club}>{club}</option>
            )}
            {clubs.map((option) => (
              <option value={option} key={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Shot note
        <textarea
          maxLength={300}
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      {error && <div className="error-message">{error}</div>}
      <div className="shot-editor-actions">
        <button className="secondary compact" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary compact" type="submit">
          Save shot
        </button>
      </div>
    </form>
  )
}

function CourseEditor({
  course,
  onCancel,
  onSave,
}: {
  course?: CourseTemplate
  onCancel: () => void
  onSave: (course: CourseTemplate) => void
}) {
  const originalName = course?.name ?? ''
  const originalTeeName = course?.teeName ?? 'Unspecified tees'
  const [name, setName] = useState(originalName)
  const [teeName, setTeeName] = useState(originalTeeName)
  const [holes, setHoles] = useState(() =>
    Array.from({ length: 18 }, (_, index) => {
      const saved = course?.holes[index + 1]
      return {
        number: index + 1,
        par: saved ? String(saved.par) : '',
        yardage: saved ? String(saved.yardage) : '',
      }
    }),
  )

  if (!course) {
    return (
      <section className="page narrow">
        <div className="empty-state">
          <h3>Course not found</h3>
          <button className="primary" type="button" onClick={onCancel}>
            Back to courses
          </button>
        </div>
      </section>
    )
  }

  function updateHole(index: number, field: 'par' | 'yardage', value: string) {
    setHoles((current) =>
      current.map((hole, holeIndex) =>
        holeIndex === index ? { ...hole, [field]: value } : hole,
      ),
    )
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const savedHoles: CourseTemplate['holes'] = {}
    for (const hole of holes) {
      const par = Number(hole.par)
      const yardage = Number(hole.yardage)
      if (par >= 3 && par <= 5 && yardage > 0) {
        savedHoles[hole.number] = { par, yardage }
      }
    }
    const trimmedName = name.trim() || originalName
    const trimmedTeeName = teeName.trim() || 'Unspecified tees'
    onSave({
      key: courseKey(trimmedName, trimmedTeeName),
      name: trimmedName,
      teeName: trimmedTeeName,
      holes: savedHoles,
    })
  }

  return (
    <section className="page narrow">
      <button className="text-button" type="button" onClick={onCancel}>
        ← Back to courses
      </button>
      <div className="section-heading">
        <div>
          <span className="eyebrow">Course editor</span>
          <h1 className="page-title">{course.name}</h1>
        </div>
      </div>
      <form onSubmit={submit}>
        <div className="card course-name-field">
          <div className="course-identity-grid">
            <label>
              Course name
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Tees
              <input
                value={teeName}
                onChange={(event) => setTeeName(event.target.value)}
                placeholder="e.g. Blue"
              />
            </label>
          </div>
        </div>
        <div className="card hole-grid-card">
          <div className="hole-grid editor-header">
            <span>Hole</span>
            <span>Par</span>
            <span>Yards</span>
            <span>Status</span>
          </div>
          {holes.map((hole, index) => (
            <div className="hole-grid" key={hole.number}>
              <strong>{hole.number}</strong>
              <select
                aria-label={`Hole ${hole.number} par`}
                value={hole.par}
                onChange={(event) => updateHole(index, 'par', event.target.value)}
              >
                <option value="">—</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
              </select>
              <input
                aria-label={`Hole ${hole.number} yardage`}
                inputMode="numeric"
                min="1"
                type="number"
                value={hole.yardage}
                onChange={(event) => updateHole(index, 'yardage', event.target.value)}
              />
              <small className={hole.par && hole.yardage ? 'supported' : 'unsupported'}>
                {hole.par && hole.yardage ? 'Ready' : 'Not configured'}
              </small>
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary" type="submit">
            Save course
          </button>
        </div>
      </form>
    </section>
  )
}

function HoleSetup({
  hole,
  onCancel,
  onSave,
}: {
  hole: Hole
  onCancel?: () => void
  onSave: (par: number, yardage: number) => void
}) {
  const [par, setPar] = useState(hole.par >= 3 ? hole.par : 4)
  const [yardage, setYardage] = useState(hole.yardage > 0 ? String(hole.yardage) : '400')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const parsedYardage = Number(yardage)
    if (Number.isFinite(parsedYardage) && parsedYardage > 0) {
      onSave(par, parsedYardage)
    }
  }

  return (
    <div className="card per-hole-setup">
      <span className="eyebrow">Hole {hole.number}</span>
      <form onSubmit={submit}>
        <label>
          Par
          <select value={par} onChange={(event) => setPar(Number(event.target.value))}>
            <option value="3">Par 3</option>
            <option value="4">Par 4</option>
            <option value="5">Par 5</option>
          </select>
        </label>
        <label>
          Yardage
          <input
            autoFocus
            inputMode="numeric"
            min="1"
            required
            type="number"
            value={yardage}
            onChange={(event) => setYardage(event.target.value)}
          />
        </label>
        <div className="hole-setup-actions">
          {onCancel && (
            <button className="secondary" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="primary" type="submit">
            {onCancel ? 'Save hole details' : `Start hole ${hole.number}`}
          </button>
        </div>
      </form>
    </div>
  )
}

function RoundReview({
  round,
  onBack,
  onEditHole,
  onFinish,
}: {
  round: Round
  onBack: () => void
  onEditHole: (index: number) => void
  onFinish: () => void
}) {
  const metrics = calculateRound(round)
  const totalPar = round.holes.reduce((sum, hole) => sum + hole.par, 0)
  const totalToPar = metrics.totalStrokes - totalPar
  const warnings: string[] = []
  if (metrics.completedHoles !== round.holes.length) {
    warnings.push(`${round.holes.length - metrics.completedHoles} holes are not complete.`)
  }
  if (metrics.totalStrokesGained === null) {
    warnings.push('One or more shots are outside the active benchmark range.')
  }
  if (metrics.penaltyStrokes > 0) {
    warnings.push(
      `${metrics.penaltyStrokes} penalty stroke${
        metrics.penaltyStrokes === 1 ? '' : 's'
      } recorded.`,
    )
  }

  return (
    <section className="page">
      <div className="results-heading">
        <div>
          <button className="text-button" type="button" onClick={onBack}>
            ← Back to shot entry
          </button>
          <span className="eyebrow">Final check</span>
          <h1 className="page-title">Review your round</h1>
        </div>
        <button
          className="primary"
          disabled={metrics.completedHoles !== round.holes.length}
          type="button"
          onClick={onFinish}
        >
          Finish round
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard
          label="Total strokes"
          value={String(metrics.totalStrokes)}
          detail={`${totalPar} total par`}
        />
        <MetricCard
          label="Score to par"
          value={formatToPar(totalToPar)}
          detail={`${round.holes.length} holes`}
        />
        <MetricCard
          label="Strokes gained"
          value={formatMetric(metrics.strokesGainedPer18)}
          detail="SG per 18"
        />
      </div>

      {warnings.length > 0 && (
        <div className="review-warnings">
          {warnings.map((warning) => (
            <span key={warning}>{warning}</span>
          ))}
        </div>
      )}

      <div className="card round-review-card">
        <div className="round-review-row table-header">
          <span>Hole</span>
          <span>Par</span>
          <span>Score</span>
          <span>To par</span>
          <span>SG</span>
          <span />
        </div>
        {round.holes.map((hole, index) => {
          const score = hole.shots.reduce(
            (sum, shot) => sum + 1 + shot.penaltyStrokes,
            0,
          )
          const isComplete = hole.shots.at(-1)?.finish.lie === 'holed'
          const strokesGained = calculateHoleStrokesGained(hole)
          return (
            <div className="round-review-row" key={hole.number}>
              <strong>{hole.number}</strong>
              <span>{hole.par || '—'}</span>
              <span>{score || '—'}</span>
              <strong
                className={
                  !isComplete
                    ? 'unsupported'
                    : score - hole.par <= 0
                      ? 'positive'
                      : 'negative'
                }
              >
                {isComplete ? formatToPar(score - hole.par) : 'Incomplete'}
              </strong>
              <strong
                className={
                  strokesGained === null
                    ? 'unsupported'
                    : strokesGained >= 0
                      ? 'positive'
                      : 'negative'
                }
              >
                {formatMetric(strokesGained)}
              </strong>
              <button
                className="text-button"
                type="button"
                onClick={() => onEditHole(index)}
              >
                Edit
              </button>
            </div>
          )
        })}
      </div>

      <div className="review-actions">
        <button className="secondary" type="button" onClick={onBack}>
          Back to entry
        </button>
        <button
          className="primary"
          disabled={metrics.completedHoles !== round.holes.length}
          type="button"
          onClick={onFinish}
        >
          Confirm and finish
        </button>
      </div>
    </section>
  )
}

function Results({
  round,
  allRounds,
  onBack,
  onEdit,
}: {
  round: Round
  allRounds: Round[]
  onBack: () => void
  onEdit: () => void
}) {
  const metrics = calculateRound(round)
  const traditionalStats = calculateTraditionalStats([round])
  const baseline = buildPersonalBaseline(allRounds, round)
  const personalDifference =
    metrics.strokesGainedPer18 !== null && baseline.averageSgPer18 !== null
      ? metrics.strokesGainedPer18 - baseline.averageSgPer18
      : null

  return (
    <section className="page">
      <div className="results-heading">
        <div>
          <button className="text-button" type="button" onClick={onBack}>
            ← All rounds
          </button>
          <span className="eyebrow">{round.playedOn}</span>
          <h1 className="page-title">{round.courseName}</h1>
        </div>
        <button className="secondary" type="button" onClick={onEdit}>
          Edit shots
        </button>
      </div>

      <div className="metric-grid">
        <MetricCard label="Total strokes" value={String(metrics.totalStrokes)} detail={`${metrics.completedHoles} holes`} />
        <MetricCard
          label="Vs PGA Tour average"
          value={formatMetric(metrics.strokesGainedPer18)}
          detail="SG per 18"
        />
        <MetricCard
          label="Vs your average"
          value={formatMetric(personalDifference)}
          detail={
            baseline.averageSgPer18 === null
              ? `${Math.max(0, 5 - baseline.includedRounds)} more prior rounds needed`
              : `${baseline.status} · ${baseline.includedRounds} rounds`
          }
        />
      </div>

      <TraditionalStatsPanel
        context="Round summary"
        stats={traditionalStats}
      />

      <div className="card">
        <div className="section-heading compact-heading">
          <div>
            <span className="eyebrow">Performance breakdown</span>
          </div>
        </div>
        <div className="category-table">
          <div className="category-row table-header">
            <span>Category</span>
            <span>Vs PGA Tour average</span>
            <span>Vs your average</span>
          </div>
          {(Object.keys(metrics.categories) as ShotCategory[]).map((category) => {
            const metric = metrics.categories[category]
            const personal = baseline.categoryPerShot[category]
            return (
              <div className="category-row" key={category}>
                <strong>{CATEGORY_LABELS[category]}</strong>
                <span className={metric.total >= 0 ? 'positive' : 'negative'}>
                  {formatMetric(metric.total)}
                </span>
                <span>
                  {personal === undefined || !metric.shots
                    ? 'N/A'
                    : formatMetric(metric.perShot - personal)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {metrics.totalStrokesGained === null && (
        <div className="warning-message">
          Some shots fall outside the Kaggle benchmark ranges, so the round SG total is
          intentionally unavailable rather than estimated.
        </div>
      )}
    </section>
  )
}

function formatToPar(value: number): string {
  if (value === 0) return 'E'
  return value > 0 ? `+${value}` : String(value)
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

export default App

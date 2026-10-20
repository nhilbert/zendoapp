import type { CalendarEvent, InboxItem, Locale, PlanBlock, Project, Review, Task } from './types.ts'
import { addDaysISO, startOfWeekISO, todayISO } from './dates.ts'

/**
 * FICTIONAL sample data so the prototype can be explored immediately.
 * Nothing in here refers to real clients, people or engagements.
 */
const uid = () => crypto.randomUUID()
const iso = () => new Date().toISOString()

/** Names of the sample projects in both languages – used to recognise an untouched sample store. */
export const SAMPLE_PROJECT_NAMES = new Set([
  'Strategy workshop Northwind', 'Strategieworkshop Nordwind',
  'Team development Musterstadt utilities', 'Teamentwicklung Stadtwerke Musterstadt',
  'Leadership programme concept', 'Konzept Führungskräfteprogramm',
  'Website relaunch', 'Website-Relaunch',
  'Keynote at the November conference', 'Keynote auf der November-Konferenz',
  'Offsite 2025 (done)', 'Offsite 2025 (erledigt)',
  'Clear out the garage', 'Garage ausmisten',
])

/** True when every project is one of the sample projects (so the store holds nothing the user created). */
export function looksLikeSample(projects: { name: string }[]): boolean {
  return projects.length > 0 && projects.every((p) => SAMPLE_PROJECT_NAMES.has(p.name))
}

export function buildSampleData(locale: Locale) {
  const de = locale === 'de'
  const today = todayISO()
  const mon = startOfWeekISO(today)
  const d = (offset: number) => addDaysISO(mon, offset)
  const t = (en: string, deStr: string) => (de ? deStr : en)

  const projects: Project[] = [
    {
      id: uid(),
      name: t('Strategy workshop Northwind', 'Strategieworkshop Nordwind'),
      goals: [
        { id: uid(), text: t('Three strategic priorities agreed and written down', 'Drei strategische Prioritäten vereinbart und festgehalten') },
        { id: uid(), text: t('Each priority has an owner and a first milestone', 'Jede Priorität hat eine verantwortliche Person und einen ersten Meilenstein') },
        { id: uid(), text: t('Leadership team rates the two days 8/10 or better', 'Führungsteam bewertet die zwei Tage mit 8/10 oder besser') },
      ],
      status: 'active',
      color: 'sage',
      dueDate: d(11),
      createdAt: iso(),
      updatedAt: iso(),
    },
    {
      id: uid(),
      name: t('Team development Musterstadt utilities', 'Teamentwicklung Stadtwerke Musterstadt'),
      goals: [{ id: uid(), text: t('Three workshops delivered, team charter signed off by all members.', 'Drei Workshops durchgeführt, Team-Charta von allen unterschrieben.') }],
      status: 'active',
      color: 'slate',
      createdAt: iso(),
      updatedAt: iso(),
    },
    {
      id: uid(),
      name: t('Leadership programme concept', 'Konzept Führungskräfteprogramm'),
      goals: [{ id: uid(), text: t('Concept document (12 pages) accepted by the HR director.', 'Konzeptpapier (12 Seiten) von der Personalleitung angenommen.') }],
      status: 'active',
      color: 'clay',
      dueDate: d(18),
      createdAt: iso(),
      updatedAt: iso(),
    },
    {
      id: uid(),
      name: t('Website relaunch', 'Website-Relaunch'),
      goals: [{ id: uid(), text: t('New site live with updated offer pages.', 'Neue Seite live mit aktualisierten Angebotsseiten.') }],
      status: 'someday',
      color: 'dusk',
      createdAt: iso(),
      updatedAt: iso(),
    },
  ]
  projects.push(
    {
      id: uid(),
      name: t('Keynote at the November conference', 'Keynote auf der November-Konferenz'),
      goals: [{ id: uid(), text: t('45-minute keynote delivered, slides handed over.', '45-minütige Keynote gehalten, Folien übergeben.') }],
      status: 'planned',
      color: 'plum',
      dueDate: d(32),
      createdAt: iso(),
      updatedAt: iso(),
    },
    {
      id: uid(),
      name: t('Offsite 2025 (done)', 'Offsite 2025 (erledigt)'),
      goals: [{ id: uid(), text: t('Two-day offsite facilitated.', 'Zweitägiges Offsite moderiert.') }],
      status: 'archived',
      color: 'moss',
      createdAt: iso(),
      updatedAt: iso(),
    },
  )
  projects.push({
    id: uid(),
    name: t('Clear out the garage', 'Garage ausmisten'),
    goals: [{ id: uid(), text: t('Garage empty enough to park the car again.', 'Garage so leer, dass das Auto wieder reinpasst.') }],
    status: 'active',
    color: 'sand',
    private: true,
    createdAt: iso(),
    updatedAt: iso(),
  })
  const [pStrategy, pTeam, pConcept, , pKeynote, pOffsite, pGarage] = projects

  const mkTask = (p: Partial<Task> & { title: string }): Task => ({
    id: uid(),
    projectId: null,
    status: 'todo',
    priority: 'normal',
    notes: [],
    order: Date.now() + Math.random(),
    createdAt: iso(),
    updatedAt: iso(),
    ...p,
  })

  const tasks: Task[] = [
    // Strategy workshop
    mkTask({ title: t('Draft agenda for day 1 and day 2', 'Agenda für Tag 1 und Tag 2 entwerfen'), projectId: pStrategy.id, status: 'next', estimateMinutes: 120, plannedDate: today, plannedStart: '11:00', priority: 'high' }),
    mkTask({ title: t('Send pre-read survey to participants', 'Vorab-Umfrage an Teilnehmende senden'), projectId: pStrategy.id, estimateMinutes: 45, dueDate: d(4) }),
    mkTask({ title: t('Book room and catering', 'Raum und Catering buchen'), projectId: pStrategy.id, status: 'waiting', waitingFor: t('Office manager (asked Mon)', 'Office-Managerin (Mo angefragt)'), estimateMinutes: 15 }),
    mkTask({ title: t('Prepare strategy canvas templates', 'Strategie-Canvas-Vorlagen vorbereiten'), projectId: pStrategy.id, estimateMinutes: 90 }),
    mkTask({ title: t('Kick-off call with sponsor', 'Kick-off-Call mit Auftraggeberin'), projectId: pStrategy.id, status: 'done', estimateMinutes: 60, completedAt: iso() }),
    // Team development
    mkTask({
      title: t('Write debrief of workshop 1', 'Debrief zu Workshop 1 schreiben'),
      projectId: pTeam.id,
      status: 'next',
      estimateMinutes: 60,
      plannedDate: today,
      notes: [{ id: uid(), text: t('Client asked for a one-page summary on top.', 'Kunde wünscht zusätzlich eine einseitige Zusammenfassung.'), createdAt: iso() }],
    }),
    mkTask({ title: t('Design exercises for conflict session', 'Übungen für die Konflikt-Session gestalten'), projectId: pTeam.id, estimateMinutes: 120 }),
    mkTask({ title: t('Clarify invoicing with the client', 'Rechnungsstellung mit dem Kunden klären'), projectId: pTeam.id, status: 'waiting', waitingFor: t('Reply from purchasing', 'Antwort vom Einkauf'), estimateMinutes: 15 }),
    // Concept
    mkTask({ title: t('Outline chapters of the concept', 'Kapitel des Konzepts gliedern'), projectId: pConcept.id, status: 'next', estimateMinutes: 90, priority: 'high', plannedDate: d(3) }),
    mkTask({ title: t('Collect three reference programmes', 'Drei Referenzprogramme zusammentragen'), projectId: pConcept.id, estimateMinutes: 60 }),
    mkTask({ title: t('Interview two line managers', 'Zwei Führungskräfte interviewen'), projectId: pConcept.id, estimateMinutes: 90, status: 'someday' }),
    // Chores
    mkTask({ title: t('Create monthly invoices', 'Monatsrechnungen erstellen'), estimateMinutes: 45, status: 'next', dueDate: d(4), plannedDate: today, recurrence: 'monthly' }),
    mkTask({ title: t('Renew video conferencing licence', 'Videokonferenz-Lizenz verlängern'), estimateMinutes: 15, status: 'next', dueDate: d(-1) }),
    mkTask({ title: t('Call tax advisor about Q3', 'Steuerberater wegen Q3 anrufen'), estimateMinutes: 20, status: 'todo' }),
    mkTask({ title: t('Order flipchart paper', 'Flipchart-Papier bestellen'), estimateMinutes: 10, status: 'todo', priority: 'low' }),
    // planned project: has a deadline but is not planned per week yet
    mkTask({ title: t('Send abstract to the organisers', 'Abstract an die Veranstalter senden'), projectId: pKeynote.id, status: 'next', estimateMinutes: 30, dueDate: d(18) }),
    // archived project: history only
    mkTask({ title: t('Write offsite documentation', 'Offsite-Dokumentation schreiben'), projectId: pOffsite.id, status: 'done', estimateMinutes: 120, completedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }),
    // private
    mkTask({ title: t('Sort the boxes on the left shelf', 'Kisten im linken Regal sortieren'), projectId: pGarage.id, status: 'next', estimateMinutes: 60 }),
    mkTask({ title: t('Book dentist appointment', 'Zahnarzttermin vereinbaren'), estimateMinutes: 10, status: 'next', private: true }),
  ]

  const inbox: InboxItem[] = [
    t('Idea: offer a short "retro facilitation" package', 'Idee: kurzes Paket „Retro-Moderation“ anbieten'),
    t('Ask Jana about the coaching follow-up in November', 'Jana wegen Coaching-Follow-up im November fragen'),
    t('Book: "Thinking in Systems" – read chapter 4 again', 'Buch: „Thinking in Systems“ – Kapitel 4 nochmal lesen'),
    t('Slides from the leadership talk → template for future keynotes', 'Folien vom Führungs-Vortrag → Vorlage für künftige Keynotes'),
    t('Check whether the room at the office needs a second screen', 'Prüfen, ob der Raum im Büro einen zweiten Bildschirm braucht'),
  ].map((text, i) => ({ id: uid(), text, createdAt: new Date(Date.now() - (5 - i) * 3_600_000).toISOString() }))

  const events: CalendarEvent[] = [
    { id: uid(), title: t('Weekly sync Northwind', 'Wöchentlicher Sync Nordwind'), date: d(0), start: '10:00', end: '10:30', kind: 'online', projectId: pStrategy.id, source: 'manual' },
    { id: uid(), title: t('Coaching session (office)', 'Coaching-Sitzung (Büro)'), date: d(1), start: '14:00', end: '15:30', kind: 'coaching', location: t('Office', 'Büro'), source: 'manual' },
    { id: uid(), title: t('Workshop 2: team charter', 'Workshop 2: Team-Charta'), date: d(2), start: '09:00', end: '13:00', kind: 'workshop', location: 'Musterstadt', projectId: pTeam.id, source: 'manual' },
    { id: uid(), title: t('Network lunch', 'Netzwerk-Mittagessen'), date: d(3), start: '12:30', end: '14:00', kind: 'in_person', source: 'manual' },
    { id: uid(), title: t('Online meeting: HR director', 'Online-Termin: Personalleitung'), date: d(4), start: '11:00', end: '12:00', kind: 'online', projectId: pConcept.id, source: 'manual' },
    { id: uid(), title: t('Strategy workshop day 1', 'Strategieworkshop Tag 1'), date: d(10), start: '09:00', end: '17:00', kind: 'workshop', location: t('Client site', 'Beim Kunden'), projectId: pStrategy.id, source: 'manual' },
    { id: uid(), title: t('Strategy workshop day 2', 'Strategieworkshop Tag 2'), date: d(11), start: '09:00', end: '16:00', kind: 'workshop', location: t('Client site', 'Beim Kunden'), projectId: pStrategy.id, source: 'manual' },
    { id: uid(), title: t('Coaching session (online)', 'Coaching-Sitzung (online)'), date: d(8), start: '16:00', end: '17:00', kind: 'coaching', source: 'manual' },
    { id: uid(), title: t('Alex on holiday', 'Alex im Urlaub'), date: d(2), start: '00:00', end: '23:59', allDay: true, kind: 'other', availability: 'free', source: 'manual' },
    { id: uid(), title: t('Dinner with Sam', 'Abendessen mit Sam'), date: d(1), start: '19:30', end: '22:00', kind: 'in_person', private: true, source: 'manual' },
    { id: uid(), title: t('Dentist', 'Zahnarzt'), date: d(3), start: '08:00', end: '08:45', kind: 'in_person', private: true, location: t('Dr. Example', 'Dr. Beispiel'), source: 'manual' },
    { id: uid(), title: t('Reminder: submit expense report', 'Erinnerung: Spesen einreichen'), date: d(3), start: '09:00', end: '09:30', kind: 'other', availability: 'free', source: 'manual' },
  ]

  const rawBlocks: PlanBlock[] = [
    { id: uid(), date: today, projectId: pStrategy.id, size: 0.5 },
    { id: uid(), date: d(0), projectId: pStrategy.id, size: 0.5 },
    { id: uid(), date: d(1), projectId: pStrategy.id, size: 0.5 },
    { id: uid(), date: d(3), projectId: pConcept.id, size: 0.5 },
    { id: uid(), date: d(4), projectId: null, size: 0.25 },
    { id: uid(), date: d(7), projectId: pStrategy.id, size: 1 },
    { id: uid(), date: d(8), projectId: pConcept.id, size: 0.5 },
    { id: uid(), date: d(9), projectId: pTeam.id, size: 0.5 },
  ]
  const seen = new Set<string>()
  const blocks = rawBlocks.filter((b) => {
    const key = `${b.date}:${b.projectId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  const reviews: Review[] = []

  return { inbox, projects, tasks, events, blocks, reviews }
}

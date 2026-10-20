import { Hono } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import type { Repo } from './repo.ts'
import { BadRequest } from './repo.ts'
import { Ops, type OpsOptions } from './ops.ts'
import type { OAuthServer } from './oauth.ts'
import { PROJECT_COLORS, PROJECT_STATUSES, RECURRENCES, TASK_STATUSES } from '../src/domain/types.ts'

/**
 * MCP server: lets an AI agent (Claude Desktop, Claude Code, …) capture into the inbox, query and
 * adapt the plan, and manage tasks, projects and review notes. Tools are thin wrappers around Ops.
 * Served over Streamable HTTP at /mcp (bearer token, see mcpRoutes) and over stdio (server/mcp-stdio.ts).
 */

const INSTRUCTIONS = `Zendo is a GTD-style planner for one person.
- Inbox: raw captures, not yet clarified. When extracting from meeting notes or e-mails, add one inbox item per actionable point, phrased as a short, self-contained sentence that names who/what and the source ("Mail Jana 20.10.: send offer for workshop"). Use inbox_add for anything the user has not decided on; use task_create only when project and intent are clear.
- Projects: outcomes that need more than one action. Every active project should have exactly ONE task with status "next" (its next action); setting a task to "next" demotes the previous one to "todo".
- Tasks without a project are chores. Status: next | todo | waiting | someday | done. dueDate = deadline, plannedDate = the day the user intends to work on it (plannedStart optional HH:mm).
- Plan: the week is planned in blocks (¼, ½, ¾ or 1 day) per active project against the calendar; the day plan is the tasks with plannedDate = that day. Read plan_day / plan_week before proposing changes, and keep days from being overplanned.
- Projects may be given by id or by name. Dates are YYYY-MM-DD in the user's local time. Prefer small, reversible changes and report what you changed.`

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm')
const status = z.enum(TASK_STATUSES as [string, ...string[]])
const projectStatus = z.enum(PROJECT_STATUSES as [string, ...string[]])
const blockSize = z.union([z.literal(0.25), z.literal(0.5), z.literal(0.75), z.literal(1)])
const projectRef = z.string().describe('Project id or name')

const taskFields = {
  description: z.string().nullable().optional().describe('Longer text; null clears'),
  project: projectRef.nullable().optional().describe('Project id or name; null = chore without project'),
  status: status.optional(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
  estimateMinutes: z.number().int().positive().nullable().optional(),
  dueDate: date.nullable().optional().describe('Deadline; null clears'),
  plannedDate: date.nullable().optional().describe('Day to work on it; null takes it off the plan'),
  plannedStart: time.nullable().optional().describe('Time on plannedDate'),
  waitingFor: z.string().nullable().optional().describe('Who it waits for (status waiting)'),
  recurrence: z.enum(RECURRENCES as [string, ...string[]]).nullable().optional().describe('Repeats on completion'),
  private: z.boolean().optional(),
}

type Input = Record<string, unknown>

function result(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] }
}

/** Runs a tool body; validation errors go back to the agent as a tool error instead of failing the call. */
function run(fn: () => unknown) {
  try {
    return result(fn())
  } catch (err) {
    if (err instanceof BadRequest) return { ...result({ error: err.message }), isError: true }
    throw err
  }
}

export function createMcpServer(repo: Repo, options: OpsOptions = {}): McpServer {
  const ops = new Ops(repo, options)
  const server = new McpServer({ name: 'zendo', version: '0.1.0' }, { instructions: INSTRUCTIONS })
  const tool = (name: string, description: string, inputSchema: z.ZodRawShape, fn: (a: Input) => unknown, readOnly = false) =>
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: false } }, (a: Input) => run(() => fn(a)))

  // ---------- inbox ----------
  tool('inbox_list', 'List the unprocessed inbox items, oldest first.', {}, () => ops.inboxList(), true)
  tool(
    'inbox_add',
    'Capture one or more items into the inbox, e.g. the action points of meeting notes or an e-mail. One item per actionable point.',
    { items: z.array(z.string().min(1)).min(1).describe('Item texts') },
    (a) => ops.inboxAdd(a.items as string[]),
  )
  tool('inbox_update', 'Rewrite the text of an inbox item.', { id: z.string(), text: z.string().min(1) }, (a) => ops.inboxUpdate(a.id as string, a.text as string))
  tool(
    'inbox_clarify',
    'Clarify an inbox item: turn it into a task or a project (the item text is the default title/name), or delete it.',
    {
      id: z.string(),
      into: z.enum(['task', 'project', 'delete']),
      task: z.object({ title: z.string().optional(), ...taskFields }).optional().describe('For into=task'),
      project: z
        .object({ name: z.string().optional(), status: projectStatus.optional(), notes: z.string().optional(), goals: z.array(z.string()).optional(), dueDate: date.optional(), nextAction: z.string().optional() })
        .optional()
        .describe('For into=project'),
    },
    (a) => ops.inboxClarify(a.id as string, a.into as 'task', { task: a.task as never, project: a.project as never }),
  )

  // ---------- tasks ----------
  tool(
    'task_list',
    'Find tasks. Without filters: all open tasks. Returns at most `limit` (default 100) plus the total.',
    {
      project: projectRef.nullable().optional().describe('Project id or name; null = chores only'),
      status: z.array(status).optional(),
      query: z.string().optional().describe('Text in title or description'),
      dueBefore: date.optional().describe('Deadline on or before'),
      plannedOn: date.optional(),
      includeDone: z.boolean().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
    (a) => ops.taskList(a as never),
    true,
  )
  tool('task_get', 'One task with description and notes.', { id: z.string() }, (a) => ops.taskGet(a.id as string), true)
  tool(
    'task_create',
    'Create a task. Give a project for project work; status "next" makes it the project\'s next action.',
    { title: z.string().min(1), ...taskFields },
    (a) => ops.taskCreate(a as never),
  )
  tool(
    'task_create_many',
    'Create several tasks at once, e.g. the agreed action items of a meeting.',
    { tasks: z.array(z.object({ title: z.string().min(1), ...taskFields })).min(1) },
    (a) => ops.taskCreateMany(a.tasks as never),
  )
  tool(
    'task_update',
    'Change a task. Only given fields change; null clears a field. status "done" completes it (recurring tasks spawn the next occurrence).',
    { id: z.string(), title: z.string().optional(), ...taskFields },
    (a) => ops.taskUpdate(a.id as string, a as never),
  )
  tool('task_complete', 'Mark a task done (done=false reopens it).', { id: z.string(), done: z.boolean().optional() }, (a) => ops.taskComplete(a.id as string, (a.done as boolean | undefined) ?? true))
  tool('task_add_note', 'Append a dated note to a task (progress, outcome of a call).', { id: z.string(), text: z.string().min(1) }, (a) => ops.taskAddNote(a.id as string, a.text as string))
  tool(
    'task_schedule',
    'Plan tasks for a day (date null takes them off the plan). A start time applies when scheduling a single task.',
    { ids: z.array(z.string()).min(1), date: date.nullable(), start: time.optional() },
    (a) => ops.taskSchedule(a.ids as string[], a.date as string | null, a.start as string | undefined),
  )
  server.registerTool(
    'task_delete',
    { description: 'Delete a task for good. Prefer task_complete or status "someday" unless the user asks to delete.', inputSchema: { id: z.string() }, annotations: { destructiveHint: true } },
    (a) => run(() => ops.taskDelete(a.id)),
  )

  // ---------- projects ----------
  tool(
    'project_list',
    'List projects with goal, next action, open task count and next meeting. Default: active and planned.',
    { status: z.array(projectStatus).optional() },
    (a) => ops.projectList(a.status as never),
    true,
  )
  tool('project_get', 'Everything about one project: goals, notes, open tasks, recently done, upcoming meetings, planned blocks.', { project: projectRef }, (a) => ops.projectGet(a.project as string), true)
  tool(
    'project_create',
    'Set up a project. Give a nextAction (becomes the "next" task) and optionally further tasks.',
    {
      name: z.string().min(1),
      status: projectStatus.optional().describe('Default active'),
      goals: z.array(z.string()).optional().describe('High-level goals; the first is the headline'),
      notes: z.string().optional().describe('Agreements, context, commitments'),
      dueDate: date.optional(),
      color: z.enum(PROJECT_COLORS).optional(),
      private: z.boolean().optional(),
      nextAction: z.string().optional(),
      tasks: z.array(z.string()).optional().describe('Further task titles (status todo)'),
    },
    (a) => ops.projectCreate(a as never),
  )
  tool(
    'project_update',
    'Change project information. goals replaces the list; appendNotes adds a paragraph to the notes, notes replaces them (null clears). Status archived/someday/planned/active.',
    {
      project: projectRef,
      name: z.string().optional(),
      status: projectStatus.optional(),
      goals: z.array(z.string()).optional(),
      notes: z.string().nullable().optional(),
      appendNotes: z.string().optional(),
      dueDate: date.nullable().optional(),
      color: z.enum(PROJECT_COLORS).optional(),
      private: z.boolean().optional(),
    },
    (a) => ops.projectUpdate(a.project as string, a as never),
  )

  // ---------- plan ----------
  tool(
    'plan_day',
    'The plan of one day (default today): calendar, blocks, planned tasks, due/overdue, left-overs, suggestions, capacity.',
    { date: date.optional() },
    (a) => ops.day(a.date as string | undefined),
    true,
  )
  tool(
    'plan_week',
    'The rolling plan from a start day (default today) for N days (default 7): meetings, blocks, planned tasks, free time, deadlines.',
    { start: date.optional(), days: z.number().int().min(1).max(28).optional() },
    (a) => ops.week(a.start as string | undefined, a.days as number | undefined),
    true,
  )
  tool(
    'plan_add_block',
    'Reserve part of a day for an active project (size in days: 0.25, 0.5, 0.75, 1). project null = chores/admin time.',
    { date, project: projectRef.nullable(), size: blockSize.optional(), note: z.string().optional() },
    (a) => ops.blockAdd(a.date as string, a.project as string | null, a.size as never, a.note as string | undefined),
  )
  tool(
    'plan_update_block',
    'Move, resize or reassign a plan block.',
    { id: z.string(), date: date.optional(), project: projectRef.nullable().optional(), size: blockSize.optional(), note: z.string().nullable().optional() },
    (a) => ops.blockUpdate(a.id as string, a as never),
  )
  tool('plan_remove_block', 'Remove a plan block.', { id: z.string() }, (a) => ops.blockRemove(a.id as string))

  // ---------- review notes ----------
  const kind = z.enum(['daily', 'weekly'])
  tool(
    'review_get',
    'Notes of the daily review (a day) or weekly review (the week containing the date). Default today / this week.',
    { kind, date: date.optional() },
    (a) => ops.reviewGet(a.kind as 'daily', a.date as string | undefined),
    true,
  )
  tool(
    'review_save',
    'Write daily or weekly review notes. append=true adds a paragraph instead of replacing.',
    { kind, notes: z.string(), date: date.optional(), append: z.boolean().optional() },
    (a) => ops.reviewSave(a.kind as 'daily', a.notes as string, { date: a.date as string | undefined, append: a.append as boolean | undefined }),
  )
  return server
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export interface McpAuth {
  /** Static bearer token (ZENDO_MCP_TOKEN), for clients configured by hand. */
  token?: string
  /** OAuth (server/oauth.ts), for Claude's connectors: access tokens it issued are accepted. */
  oauth?: OAuthServer
}

/**
 * Streamable HTTP endpoint, stateless: a fresh server and transport per request (the tools keep no
 * session state). Every request needs `Authorization: Bearer` with the static token or an OAuth access
 * token; without either configured the route is not mounted at all (see index.ts). The 401 points
 * OAuth clients to the protected resource metadata, which starts their sign-in.
 */
export function mcpRoutes(repo: Repo, auth: McpAuth, options: OpsOptions = {}): Hono {
  const app = new Hono()
  app.all('/', async (c) => {
    const header = c.req.header('authorization') ?? ''
    const given = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const ok = !!given && ((auth.token !== undefined && sameToken(given, auth.token)) || auth.oauth?.verifyAccess(given) != null)
    if (!ok) {
      const challenge = auth.oauth ? `Bearer resource_metadata="${auth.oauth.resourceMetadataUrl}", scope="zendo"` : 'Bearer'
      return c.json({ error: 'unauthorized' }, 401, { 'WWW-Authenticate': challenge })
    }
    const server = createMcpServer(repo, options)
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    await server.connect(transport)
    try {
      return await transport.handleRequest(c.req.raw)
    } finally {
      void server.close()
    }
  })
  return app
}

// Overnight batches ("make 10 variations of this idea, three takes each, while I sleep"): the chat's agent writes the
// variations and start_batch queues them on this PC (H3, free) in one project; the app keeps the PC awake while it
// runs, ranks each run's takes as they finish (ranking.js), and once every run is done it leaves a morning report in
// the chat that started it: what finished, what failed, and the best takes linked. batches/<id>.json in the data
// folder.
import fs from 'node:fs'
import path from 'node:path'

export const MAX_BATCH = 12
const DONE = ['success', 'error', 'cancelled']

export class Batches {
  constructor({ dir }) {
    this.dir = dir
  }
  file = (id) => path.join(this.dir, `${id}.json`)
  create({ name, chatId = null, projectId = null, takes, jobs }, now = new Date()) {
    fs.mkdirSync(this.dir, { recursive: true })
    const b = { id: `b${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 5)}`, name: String(name || 'Overnight batch').slice(0, 80), chatId, projectId, takes, jobs, status: 'running', createdAt: now.toISOString(), reportedAt: null }
    return this.save(b)
  }
  save(b) {
    fs.writeFileSync(`${this.file(b.id)}.tmp`, JSON.stringify(b, null, 1))
    fs.renameSync(`${this.file(b.id)}.tmp`, this.file(b.id))
    return b
  }
  get(id) {
    if (!/^[a-z0-9]+$/i.test(String(id || ''))) throw new Error('No such batch.')
    try {
      return JSON.parse(fs.readFileSync(this.file(id), 'utf8'))
    } catch {
      throw new Error('No such batch.')
    }
  }
  list() {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((n) => n.endsWith('.json'))
        .map((n) => {
          try {
            return JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8'))
          } catch {
            return null
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    } catch {
      return []
    }
  }
  running() {
    return this.list().filter((b) => b.status === 'running')
  }
}

// Where a batch stands, from its jobs ({ [jobId]: job or null }): { done, finished, failed, waiting, ranked }
export function batchState(batch, jobs) {
  const list = batch.jobs.map((j) => jobs[j.jobId])
  const finished = list.filter((j) => j?.status === 'success').length
  const failed = list.filter((j) => !j || ['error', 'cancelled'].includes(j.status)).length
  const ranked = list.filter((j) => j?.status === 'success' && j.ranking).length
  const waiting = list.length - finished - failed
  return { done: waiting === 0, finished, failed, waiting, ranked, total: list.length }
}

const short = (s, n = 70) => {
  const t = String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
// A run's best take: the ranking's clear winner, else its highest score, else take 1.
export function bestTake(job) {
  const takes = job?.ranking?.takes || []
  const pick = takes.find((t) => t.best) || [...takes].filter((t) => t.score != null).sort((a, b) => b.score - a.score)[0]
  if (pick) return { candidate: pick.candidate, score: pick.score, reasons: pick.reasons || [], clear: !!pick.best }
  const first = (job?.outputs || []).find((o) => o.kind === 'preview')
  return first ? { candidate: first.candidate || 1, score: null, reasons: [], clear: false } : null
}

// The morning report: { title, text, picks: [{ jobId, projectId, candidate, label, score }] }, best first (at most 3)
export function batchReport(batch, jobs) {
  const s = batchState(batch, jobs)
  const rows = batch.jobs
    .map((j, i) => ({ i: i + 1, j, job: jobs[j.jobId], best: jobs[j.jobId]?.status === 'success' ? bestTake(jobs[j.jobId]) : null }))
    .filter((r) => r.best)
  const top = [...rows].sort((a, b) => (b.best.score ?? -1) - (a.best.score ?? -1)).slice(0, 3)
  const picks = top.map((r) => ({ jobId: r.j.jobId, projectId: r.job?.projectId || batch.projectId || null, candidate: r.best.candidate, score: r.best.score, label: `Shot ${r.i}, take ${r.best.candidate}: ${short(r.j.label || r.j.prompt, 60)}` }))
  const takes = s.finished * (batch.takes || 1)
  const head = `Your overnight batch “${batch.name}” is done: ${s.finished} of ${s.total} shot${s.total === 1 ? '' : 's'} rendered (${takes} take${takes === 1 ? '' : 's'})${s.failed ? `, ${s.failed} didn’t` : ''}.`
  const best = top.length
    ? ` The best: ${top.map((r, k) => `${k + 1}) shot ${r.i}, take ${r.best.candidate}${r.best.score != null ? ` (${Math.round(r.best.score * 100)})` : ''}${r.best.reasons[0] ? `, ${r.best.reasons[0]}` : ''}`).join('; ')}.`
    : ''
  const failed = batch.jobs
    .map((j, i) => ({ i: i + 1, job: jobs[j.jobId] }))
    .filter((r) => !r.job || ['error', 'cancelled'].includes(r.job.status))
    .map((r) => `shot ${r.i}${r.job?.error ? ` (${short(r.job.error, 80)})` : ''}`)
  const tail = failed.length ? ` Didn’t render: ${failed.join(', ')}.` : ''
  return { title: batch.name, text: `${head}${best}${tail}`, picks, state: s }
}

export const isDone = (job) => !job || DONE.includes(job.status)

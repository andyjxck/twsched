import { useMemo, useState } from 'react'
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, useDraggable, useDroppable } from '@dnd-kit/core'
import { api, v } from '../api.js'
import { useLoad, Loader, Modal, Field, useAction, useApp, fmtDate, addDays, mondayOf, todayISO, money, r1 } from '../ui.jsx'

export default function Rota() {
  const { toast } = useApp()
  const [week, setWeek] = useState(() => mondayOf(todayISO()))
  const state = useLoad(() => api.get(v(`/rota?week=${week}`)), [week])
  const [edit, setEdit] = useState(null) // { shift } or { new: {membership_id, shift_date} }
  const [busy, run] = useAction()

  const showWarnings = (r, okText) => { if (r?.warnings?.length) toast('Saved, but: ' + r.warnings.map((w) => w.text).join('; '), 'warn'); else if (okText) toast(okText) }
  const publish = () => run(async () => { const r = await api.post(v('/rota/publish'), { week }); state.reload(); return r }).then((r) => r && toast(`Published. ${r.notified} people notified.`))
  const unpublish = () => run(async () => { await api.post(v('/rota/unpublish'), { week }); state.reload() }, 'Back to draft. Staff can\'t see this week now.')
  const copyLast = () => run(async () => { const r = await api.post(v('/rota/copy'), { from_week: addDays(week, -7), to_week: week }); state.reload(); return r }).then((r) => r && toast(`Copied ${r.copied} shifts from last week.`))

  return (
    <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <div className="row" style={{ gap: 4 }}>
          <button className="btn secondary sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">‹</button>
          <button className="btn ghost sm" onClick={() => setWeek(mondayOf(todayISO()))}>This week</button>
          <button className="btn secondary sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">›</button>
        </div>
        <b>{fmtDate(week, { day: 'numeric', month: 'short' })} – {fmtDate(addDays(week, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</b>
      </div>
      <Loader state={state}>{(d) => (
        <>
          <div className="row between" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 6 }}>
              {d.status === 'published' ? <span className="pill green">Published</span> : <span className="pill amber">Draft, staff can't see it</span>}
              {d.costs && <span className="pill">Labour {money(d.costs.total)}</span>}
            </div>
            {d.canEdit && (
              <div className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" disabled={busy} onClick={copyLast}>Copy last week</button>
                {d.status === 'published' ? <button className="btn secondary sm" disabled={busy} onClick={unpublish}>Unpublish</button> : null}
                <button className="btn sm" disabled={busy} onClick={publish}>{d.status === 'published' ? 'Re-publish & notify' : 'Publish'}</button>
              </div>
            )}
          </div>
          <Grid d={d} week={week} onEdit={setEdit} onChanged={(r, msg) => { showWarnings(r, msg); state.reload() }} />
          {d.canEdit && <p className="tiny muted">Drag a shift to move it to another person or day. Drag a template from the top into a cell to add a shift. Tap a shift to edit it. On a phone, press and hold a shift for a moment before dragging.</p>}
          <Legend />
        </>
      )}</Loader>
      {edit && state.data && <ShiftModal d={state.data} edit={edit} onClose={() => setEdit(null)} onSaved={(r, msg) => { setEdit(null); showWarnings(r, msg); state.reload() }} />}
    </>
  )
}

function Legend() {
  return <p className="tiny muted" style={{ marginTop: 8 }}><span className="pill" style={{ background: '#fdf3e0' }}>Off</span> holiday booked   <span className="pill" style={{ background: '#f1f1f1' }}>N/A</span> marked unavailable   <span className="pill amber">gold</span> open shift   yellow edge = changed after publishing</p>
}

function Grid({ d, week, onEdit, onChanged }) {
  const { toast } = useApp()
  const days = [...Array(7)].map((_, i) => addDays(week, i))
  const today = todayISO()
  const [active, setActive] = useState(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const rows = [{ id: null, full_name: 'Open shifts', position: 'Anyone can be given these' }, ...d.people]
  const byCell = useMemo(() => {
    const m = {}
    for (const s of d.shifts) (m[`${s.membership_id ?? 'open'}|${s.shift_date}`] ||= []).push(s)
    return m
  }, [d.shifts])
  const weekHours = useMemo(() => { const m = {}; for (const s of d.shifts) if (s.membership_id) m[s.membership_id] = (m[s.membership_id] || 0) + Number(s.hours); return m }, [d.shifts])
  const flags = (mid, date) => {
    if (!mid) return {}
    const off = d.timeOff.find((t) => t.membership_id === mid && date >= t.start_date && date <= t.end_date)
    const iso = ((new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1
    const un = d.unavailable.find((u) => u.membership_id === mid && date >= u.start_date && date <= u.end_date && (!u.weekday || u.weekday === iso))
    return { off, un }
  }

  const onDragEnd = async ({ active: a, over }) => {
    setActive(null)
    if (!over || !d.canEdit) return
    const [mid, date] = over.id.split('|')
    const membership_id = mid === 'open' ? null : Number(mid)
    try {
      if (a.data.current.type === 'shift') {
        const s = a.data.current.shift
        if ((s.membership_id ?? null) === membership_id && s.shift_date === date) return
        const r = await api.patch(v(`/rota/shifts/${s.id}`), { membership_id, shift_date: date })
        onChanged(r, 'Shift moved.')
      } else {
        const t = a.data.current.tpl
        const r = await api.post(v('/rota/shifts'), { membership_id, shift_date: date, start_time: t.start_time, end_time: t.end_time, break_minutes: t.break_minutes, position: t.position })
        onChanged(r, 'Shift added.')
      }
    } catch (e) { toast(e.message, 'warn') }
  }

  const body = (
    <>
      {d.canEdit && d.templates.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <span className="tiny muted" style={{ marginRight: 6 }}>Templates:</span>
          {d.templates.map((t) => <TemplateChip key={t.id} t={t} />)}
        </div>
      )}
      <div className="rota-wrap">
        <table className="rota">
          <thead><tr><th className="person">Team</th>{days.map((day) => <th key={day} className={day === today ? 'today' : ''}>{fmtDate(day)}{d.blackouts.some((b) => day >= b.start_date && day <= b.end_date) && <div className="cellflag">Blackout</div>}</th>)}</tr></thead>
          <tbody>
            {rows.map((p) => {
              const hrs = p.id ? weekHours[p.id] || 0 : null
              const over = p.id && (hrs > d.weeklyHoursLimit || (p.contracted_hours && hrs > p.contracted_hours))
              return (
                <tr key={p.id ?? 'open'}>
                  <td className="person">
                    <b>{p.full_name}</b>
                    <div className="tiny muted">{p.position || (p.role !== 'staff' ? p.role : '')}</div>
                    {p.id && <div className={`hrs ${over ? 'over' : ''}`}>{r1(hrs)}h{p.contracted_hours ? ` / ${r1(p.contracted_hours)}` : ''}{over ? ' over' : ''}</div>}
                  </td>
                  {days.map((day) => {
                    const f = flags(p.id, day)
                    return (
                      <Cell key={day} id={`${p.id ?? 'open'}|${day}`} className={f.off ? 'off' : f.un ? 'unav' : ''} canEdit={d.canEdit} onAdd={() => onEdit({ new: { membership_id: p.id, shift_date: day } })}>
                        {f.off && <div className="cellflag">{f.off.status === 'pending' ? 'Off? (pending)' : 'Off'}</div>}
                        {!f.off && f.un && <div className="cellflag" style={{ color: 'var(--muted)' }}>N/A{f.un.note ? ': ' + f.un.note : ''}</div>}
                        {(byCell[`${p.id ?? 'open'}|${day}`] || []).map((s) => <ShiftChip key={s.id} s={s} canEdit={d.canEdit} onClick={() => onEdit({ shift: s })} />)}
                      </Cell>
                    )
                  })}
                </tr>
              )
            })}
            {d.costs && (
              <tr><td className="person"><b>Labour cost</b><div className="tiny muted">rostered hours × pay rate</div></td>{days.map((day) => <td key={day} className="small">{money(d.costs.byDay[day] || 0)}</td>)}</tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
  if (!d.canEdit) return body
  return (
    <DndContext sensors={sensors} onDragStart={({ active: a }) => setActive(a.data.current)} onDragCancel={() => setActive(null)} onDragEnd={onDragEnd}>
      {body}
      <DragOverlay dropAnimation={null}>{active ? <div className="chip overlay">{active.type === 'shift' ? `${active.shift.start_time}–${active.shift.end_time}` : `${active.tpl.name} ${active.tpl.start_time}–${active.tpl.end_time}`}</div> : null}</DragOverlay>
    </DndContext>
  )
}

function Cell({ id, className, children, canEdit, onAdd }) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !canEdit })
  return (
    <td ref={canEdit ? setNodeRef : undefined} className={`cell ${className} ${isOver ? 'over' : ''}`}>
      {children}
      {canEdit && <button className="addbtn" onClick={onAdd} aria-label="Add shift">+</button>}
    </td>
  )
}

function ShiftChip({ s, canEdit, onClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `shift-${s.id}`, data: { type: 'shift', shift: s }, disabled: !canEdit })
  return (
    <div ref={setNodeRef} {...(canEdit ? listeners : {})} {...(canEdit ? attributes : {})} onClick={onClick}
      className={`chip ${s.membership_id ? '' : 'open'} ${s.edited_after_publish ? 'edited' : ''} ${s.confirmed_at ? 'confirmed' : ''} ${isDragging ? 'dragging' : ''}`}
      title={s.notes || ''}>
      <b>{s.start_time}–{s.end_time}</b>
      <div>{s.position || ''}{s.confirmed_at ? ' ✓' : ''}</div>
    </div>
  )
}

function TemplateChip({ t }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `tpl-${t.id}`, data: { type: 'tpl', tpl: t } })
  return <span ref={setNodeRef} {...listeners} {...attributes} className={`chip tpl ${isDragging ? 'dragging' : ''}`}>{t.name} {t.start_time}–{t.end_time}</span>
}

function ShiftModal({ d, edit, onClose, onSaved }) {
  const { toast } = useApp()
  const s = edit.shift
  const [f, setF] = useState(s ? { ...s, membership_id: s.membership_id ?? '' } : { membership_id: edit.new.membership_id ?? '', shift_date: edit.new.shift_date, start_time: '17:00', end_time: '23:00', break_minutes: 30, position: d.people.find((p) => p.id === edit.new.membership_id)?.position || '', notes: '' })
  const [act, setAct] = useState({ actual_start: s?.actual_start || s?.start_time || '', actual_end: s?.actual_end || s?.end_time || '', actual_break_minutes: s?.actual_break_minutes ?? s?.break_minutes ?? 0 })
  const [busy, run] = useAction()
  const body = { membership_id: f.membership_id === '' ? null : Number(f.membership_id), shift_date: f.shift_date, start_time: f.start_time, end_time: f.end_time, break_minutes: Number(f.break_minutes) || 0, position: f.position || null, notes: f.notes || null }
  const save = () => run(async () => onSaved(s ? await api.patch(v(`/rota/shifts/${s.id}`), body) : await api.post(v('/rota/shifts'), body), s ? 'Shift updated.' : 'Shift added.'))
  const del = () => { if (confirm('Delete this shift?')) run(async () => { await api.del(v(`/rota/shifts/${s.id}`)); onSaved(null, 'Shift deleted.') }) }
  const confirmActual = () => run(async () => { await api.post(v(`/rota/shifts/${s.id}/confirm`), { ...act, actual_break_minutes: Number(act.actual_break_minutes) || 0 }); onSaved(null, 'Hours confirmed.') })
  const applyTpl = (id) => { const t = d.templates.find((x) => String(x.id) === id); if (t) setF({ ...f, start_time: t.start_time, end_time: t.end_time, break_minutes: t.break_minutes, position: t.position || f.position }) }
  if (!d.canEdit) {
    return <Modal title="Shift" onClose={onClose}><p>{fmtDate(s.shift_date)} {s.start_time}–{s.end_time} {s.position}</p>{s.notes && <p className="small">{s.notes}</p>}</Modal>
  }
  return (
    <Modal title={s ? 'Edit shift' : 'Add shift'} onClose={onClose}>
      <div className="stack">
        {!s && d.templates.length > 0 && <Field label="Start from a template"><select defaultValue="" onChange={(e) => applyTpl(e.target.value)}><option value="">Choose…</option>{d.templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.start_time}–{t.end_time})</option>)}</select></Field>}
        <Field label="Who"><select value={f.membership_id} onChange={(e) => setF({ ...f, membership_id: e.target.value })}><option value="">Open shift (nobody yet)</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
        <Field label="Date"><input type="date" value={f.shift_date} onChange={(e) => setF({ ...f, shift_date: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Start"><input type="time" value={f.start_time} onChange={(e) => setF({ ...f, start_time: e.target.value })} /></Field>
          <Field label="End" hint={f.end_time && f.start_time && f.end_time <= f.start_time ? 'Finishes after midnight' : ''}><input type="time" value={f.end_time} onChange={(e) => setF({ ...f, end_time: e.target.value })} /></Field>
        </div>
        <div className="grid2">
          <Field label="Break (minutes)"><input type="number" inputMode="numeric" min="0" max="240" value={f.break_minutes} onChange={(e) => setF({ ...f, break_minutes: e.target.value })} /></Field>
          <Field label="Role"><select value={f.position || ''} onChange={(e) => setF({ ...f, position: e.target.value })}><option value="">–</option>{d.positions.map((p) => <option key={p}>{p}</option>)}</select></Field>
        </div>
        <Field label="Note (the person on the shift sees it)"><input value={f.notes || ''} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <div className="row">
          <button className="btn grow" disabled={busy} onClick={save}>{s ? 'Save changes' : 'Add shift'}</button>
          {s && <button className="btn danger" disabled={busy} onClick={del}>Delete</button>}
        </div>
        {s && s.membership_id && s.shift_date <= todayISO() && (
          <div className="card" style={{ background: '#f4efe3' }}>
            <h3>Confirm actual hours {s.confirmed_at && <span className="pill green">Confirmed</span>}</h3>
            <p className="tiny muted">Confirmed hours count towards holiday (irregular hours staff), labour cost and the payroll export.</p>
            <div className="grid2">
              <Field label="Actual start"><input type="time" value={act.actual_start} onChange={(e) => setAct({ ...act, actual_start: e.target.value })} /></Field>
              <Field label="Actual end"><input type="time" value={act.actual_end} onChange={(e) => setAct({ ...act, actual_end: e.target.value })} /></Field>
            </div>
            <Field label="Break taken (minutes)"><input type="number" min="0" max="240" value={act.actual_break_minutes} onChange={(e) => setAct({ ...act, actual_break_minutes: e.target.value })} /></Field>
            <button className="btn secondary block" style={{ marginTop: 8 }} disabled={busy} onClick={confirmActual}>Confirm hours</button>
          </div>
        )}
      </div>
    </Modal>
  )
}

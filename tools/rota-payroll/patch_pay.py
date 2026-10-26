#!/usr/bin/env python3
"""Rota-approval payroll patch for the TWS payroll module (prettier-formatted source).
Usage: patch_pay.py in.pretty.js out.js
Works on the live module with or without the Team pay settings patch (patch_teamset.py).
- Payroll hours = published rota shifts on approved days. A day counts as approved when its day tick is
  on (days/{date}) or its week has been approved (weeks/{monday}) - Approve week = every day ticked.
- No separate Hours sign-off tab any more.
- Export: blocked with "The week of X hasn't been approved" until every day of the period is approved.
  Once all approved the CSV downloads; the file name says NOT-FINAL until the period is locked.
- Lock period (owner only, on Export): snapshots each person's hours into payPeriods/{start}/hours and
  locks the period in one batch, so later rota edits can't change a locked period. Reopen: owner only.
"""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
assert 'TwDayOk' not in s, 'already patched'

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:160])
    s = s.replace(old, new)

# 0. Helpers (top-level, before qt).
rep('''function qt({
  person: e,''', '''function TwMon(u) {
  let o = new Date(`${u}T12:00:00Z`);
  return (
    o.setUTCDate(o.getUTCDate() - ((o.getUTCDay() + 6) % 7)),
    o.toISOString().slice(0, 10)
  );
}
function TwDayOk(t, d) {
  let w = TwMon(d);
  return !!(
    (t.days && t.days[d] && t.days[d].status === "approved") ||
    (t.weeks && t.weeks[w] && t.weeks[w].status === "approved")
  );
}
function TwPendingWeeks(e, t) {
  let o = [],
    m = {};
  for (let d = e.start; d <= e.end; d = C.addDays(d, 1))
    if (!TwDayOk(t, d)) {
      let w = TwMon(d);
      m[w] || ((m[w] = { week: w, days: [] }), o.push(m[w]));
      m[w].days.push(d);
    }
  return o;
}
function TwWeekText(w) {
  return `The week of ${F(w.week, { day: "numeric", month: "short" })} hasn\\u2019t been approved`;
}
function qt({
  person: e,''')

# 1. qt: count only shifts on approved days as payroll hours (optional dayOk; Team panel estimates pass none).
rep('''  requests: l,
  contract: i,
  history: o,
}) {
  let d = n.filter(''', '''  requests: l,
  contract: i,
  history: o,
  dayOk: TwOk,
}) {
  let d = n.filter(''')
rep('''  return {
    staffId: e.id,
    name: e.name,
    rostered: M(f),
    shifts: p.length,''', '''  let TwA = TwOk ? p.filter((m) => TwOk(m.date)) : p,
    TwAH = TwA.reduce((m, b) => m + ge(b), 0);
  return {
    staffId: e.id,
    name: e.name,
    rostered: M(f),
    approvedHours: M(TwAH),
    pendingHours: M(f - TwAH),
    pendingShifts: p.length - TwA.length,
    shifts: p.length,''')

# 2. tt: open period -> approved rota hours; locked period -> the snapshot taken when it was locked.
rep('''  let l = t.shifts.filter((i) => i.date < e.start);
  return n.map((i) => {
    let o = qt({
        person: i,
        period: e,
        shifts: t.shifts,
        timeOff: t.timeOff,
        requests: t.requests,
        contract: t.contracts[i.id],
        history: l,
      }),
      d = t.hours[i.id],
      p = d ? d.actualHours : o.rostered;
    return {
      ...o,
      person: i,
      saved: d || null,
      actual: p,
      overtime:
        d && typeof d.overtimeHours == "number"
          ? d.overtimeHours
          : Se(p, o.contracted),
      holidayFinal:
        d && typeof d.holidayHours == "number" ? d.holidayHours : o.holiday,
      approved: !!(d && d.approved),
    };
  });''', '''  let l = t.shifts.filter((i) => i.date < e.start),
    TwL = !!(t.pperiod && t.pperiod.status === "locked");
  return n.map((i) => {
    let o = qt({
        person: i,
        period: e,
        shifts: t.shifts,
        timeOff: t.timeOff,
        requests: t.requests,
        contract: t.contracts[i.id],
        history: l,
        dayOk: (k) => TwDayOk(t, k),
      }),
      d = TwL ? t.hours[i.id] : null,
      p = TwL ? (d ? Number(d.actualHours) || 0 : 0) : o.approvedHours,
      TwHol = TwL
        ? d && typeof d.holidayHours == "number"
          ? d.holidayHours
          : 0
        : o.holiday;
    return {
      ...o,
      person: i,
      saved: d || null,
      actual: p,
      overtime:
        d && typeof d.overtimeHours == "number"
          ? d.overtimeHours
          : TwL
            ? 0
            : Se(p, o.contracted),
      holiday: TwHol,
      holidayFinal: TwHol,
      approved: TwL ? !!d : o.pendingShifts === 0,
    };
  });''')

# 3. No Hours sign-off tab (state defaults to Overview, so nothing can land on it).
rep('''    {
      id: "signoff",
      label: "Hours sign-off",
      roles: ["owner", "manager", "payroll"],
    },
''', '')
rep('''          c === "signoff" && r(Nr, { settings: o, period: d, setPeriod: p }),
''', '')

# 4. Overview: weeks not approved replace "hours not signed off"; hours on unapproved days don't count yet.
rep('''  let _ = n.filter((u) => !u.approved && (u.shifts || u.holidayDays));
  (_.length &&
    i.push({
      level: "warn",
      title: `${_.length} ${_.length === 1 ? "person\\u2019s" : "people\\u2019s"} hours not signed off`,
      detail: _.map((u) => u.name).join(", "),
    }),
    (!t.pperiod || t.pperiod.status !== "locked") &&
      i.push({ level: "info", title: "Period not locked yet" }));''', '''  let TwLk = !!(t.pperiod && t.pperiod.status === "locked"),
    TwPW = TwLk ? [] : TwPendingWeeks(e, t);
  for (let u of TwPW)
    i.push({
      level: "warn",
      title: TwWeekText(u),
      detail:
        u.days.length === 7
          ? "Approve week on the rota, or tick each day."
          : `Days not approved: ${u.days.map((k) => F(k)).join(", ")}`,
    });
  !TwLk &&
    !TwPW.length &&
    i.push({ level: "info", title: "Period not locked yet" });''')
rep('''      title: `${f.length} worked shift${f.length === 1 ? " is" : "s are"} on days nobody has approved`,''',
    '''      title: `${f.length} worked shift${f.length === 1 ? " is" : "s are"} on days nobody has approved, so ${f.length === 1 ? "it doesn\\u2019t" : "they don\\u2019t"} count for payroll yet`,''')

# 5. Export rows: locked -> the snapshot only; open -> everyone with shifts or holiday.
rep('''  return tt(e, t)
    .filter((o) => o.shifts || o.holidayDays || o.saved)
    .map((o) => {''', '''  return tt(e, t)
    .filter((o) => (i ? o.saved : o.shifts || o.holidayDays))
    .map((o) => {''')

# 6. Export tab: approval gate; Lock/Reopen here (owner only); NOT-FINAL kept while unlocked.
rep('''function Tr({ settings: e, period: t, setPeriod: n }) {
  let a = et(t),
    l = zt() || {};''', '''function Tr({ settings: e, period: t, setPeriod: n }) {
  let a = et(t),
    l = zt() || {},
    [TwBusy, TwSetBusy] = N(!1),
    [TwMsg, TwSetMsg] = N(null);
  Ne(() => TwSetMsg(null), [t.start]);''')
rep('''  let i = a.pperiod && a.pperiod.status === "locked",
    o = Ke(e),
    d = Sr(t, a, l, e);
  function p() {''', '''  let i = a.pperiod && a.pperiod.status === "locked",
    o = Ke(e),
    d = Sr(t, a, l, e),
    TwPW = i ? [] : TwPendingWeeks(t, a),
    TwOwn = $r.includes(X()),
    TwMe = ee();
  async function TwLock(twOn) {
    if (
      twOn &&
      !window.confirm(
        `Lock ${we(t.start, t.end)}?\\n\\nThe hours from the approved rota are saved as the final hours. Rota changes after this won\\u2019t change them unless an owner reopens the period.`,
      )
    )
      return;
    (TwSetBusy(!0), TwSetMsg(null));
    try {
      let twB = x().writeBatch(x().db),
        twBase = {
          start: t.start,
          end: t.end,
          updatedAt: x().serverTimestamp(),
          updatedBy: TwMe.uid,
        };
      if (twOn) {
        let twRows = tt(t, a).filter((k) => k.shifts || k.holidayDays),
          twIds = new Set(twRows.map((k) => k.staffId)),
          twCap = (k) => M(Math.min(500, Math.max(0, Number(k) || 0)));
        for (let k of twRows) {
          let twA = twCap(k.approvedHours);
          twB.set(q("payPeriods", t.start, "hours", k.staffId), {
            staffId: k.staffId,
            staffName: String(k.name || "").slice(0, 80),
            rosteredHours: twCap(k.rostered),
            actualHours: twA,
            breakMins: Math.min(30000, Math.max(0, k.breakMins || 0)),
            overtimeHours: twCap(Se(twA, k.contracted)),
            holidayHours: twCap(k.holiday),
            shifts: Math.min(200, k.shifts || 0),
            swaps: Math.min(200, k.swaps || 0),
            note: "From the approved rota",
            approved: !0,
            approvedBy: TwMe.uid,
            approvedByName: String(TwMe.name || "").slice(0, 80),
            approvedAt: x().serverTimestamp(),
            updatedAt: x().serverTimestamp(),
            updatedBy: TwMe.uid,
          });
        }
        for (let k of Object.keys(a.hours || {}))
          twIds.has(k) || twB.delete(q("payPeriods", t.start, "hours", k));
        twB.set(q("payPeriods", t.start), {
          ...twBase,
          status: "locked",
          lockedAt: x().serverTimestamp(),
          lockedBy: TwMe.uid,
          lockedByName: String(TwMe.name || "").slice(0, 80),
        });
      } else twB.set(q("payPeriods", t.start), { ...twBase, status: "open" });
      (await twB.commit(),
        TwSetMsg({
          ok: !0,
          text: twOn
            ? "Locked. These are now the final hours."
            : "Reopened. Hours follow the approved rota again.",
        }));
    } catch (k) {
      TwSetMsg({ ok: !1, text: Y(k) });
    }
    TwSetBusy(!1);
  }
  function p() {
    if (!i && TwPW.length) return;''')
rep('''          i
            ? r("p", {
                class: "okbox",
                children: "Locked: these are the final, signed-off hours.",
              })
            : r("p", {
                class: "warn",
                children:
                  "Not locked yet, so these are rostered or draft numbers and could still change. The file name says NOT-FINAL.",
              }),
          r("div", {
            class: "actions",
            children: r("button", {
              class: "btn",
              onClick: p,
              disabled: !d.length,
              children: [
                "Download CSV (",
                d.length,
                " ",
                d.length === 1 ? "person" : "people",
                ")",
              ],
            }),
          }),''', '''          i
            ? r("p", {
                class: "okbox",
                "data-testid": "export-locked",
                children: [
                  "Locked",
                  a.pperiod.lockedByName ? ` by ${a.pperiod.lockedByName}` : "",
                  ": these are the final hours from the approved rota.",
                ],
              })
            : TwPW.length
              ? r("div", {
                  class: "warn",
                  role: "status",
                  "data-testid": "export-unapproved",
                  children: TwPW.map((w) =>
                    r("div", {
                      children: [
                        TwWeekText(w),
                        w.days.length < 7
                          ? ` (${w.days.map((k) => F(k)).join(", ")})`
                          : "",
                        ".",
                      ],
                    }),
                  ),
                })
              : r("p", {
                  class: "warn",
                  "data-testid": "export-notlocked",
                  children: TwOwn
                    ? "All weeks have been approved, so you can download the CSV. Until you lock the period, the file name says NOT-FINAL."
                    : "All weeks have been approved, so you can download the CSV. Until an owner locks the period, the file name says NOT-FINAL.",
                }),
          TwMsg
            ? r("p", {
                class: TwMsg.ok ? "okbox" : "err",
                role: "status",
                children: TwMsg.text,
              })
            : null,
          r("div", {
            class: "actions",
            children: [
              r("button", {
                class: "btn",
                onClick: p,
                "data-testid": "export-download",
                disabled: !d.length || (!i && TwPW.length > 0),
                children: [
                  "Download CSV (",
                  d.length,
                  " ",
                  d.length === 1 ? "person" : "people",
                  ")",
                ],
              }),
              TwOwn && !i
                ? r("button", {
                    class: "btn secondary",
                    "data-testid": "export-lock",
                    disabled: TwBusy || TwPW.length > 0,
                    title: TwPW.length ? "Approve every week on the rota first" : "",
                    onClick: () => TwLock(!0),
                    children: "Lock period",
                  })
                : null,
              TwOwn && i
                ? r("button", {
                    class: "btn secondary",
                    "data-testid": "export-reopen",
                    disabled: TwBusy,
                    onClick: () => TwLock(!1),
                    children: "Reopen period",
                  })
                : null,
            ],
          }),''')

open(dst, 'w', encoding='utf-8').write(s)
print('ok')

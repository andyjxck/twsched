#!/usr/bin/env python3
"""Team pay settings patch for the TWS payroll module (prettier-formatted source).
Usage: patch_teamset.py in.pretty.js out.js
- Moves per-person pay settings (payroll ID, hourly rate, contracted hours, holiday basis, carried over)
  into the Team tap-open panel (Fr), owners/payroll only. Removes the People section from Payroll > Settings.
- Drops days a week, entitlement hours a year and hours a holiday day counts as (UI and calculations).
- Team list: one person open at a time, open panel spans the full width, buttons don't stretch.
"""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
assert 'TwPaySet' not in s, 'already patched'

def rep(old, new, count=1):
    global s
    n = s.count(old)
    assert n == count, (n, old[:120])
    s = s.replace(old, new)

# 1. Holiday day = contracted hours / 5, else average rota day. No more holidayDayHours / daysPerWeek.
rep('''  return typeof t.holidayDayHours == "number" && t.holidayDayHours > 0
    ? t.holidayDayHours
    : typeof t.contractHours == "number" && t.contractHours > 0
      ? t.contractHours / (t.daysPerWeek || 5)
      : null;''',
    '''  return typeof t.contractHours == "number" && t.contractHours > 0
    ? t.contractHours / 5
    : null;''')
# 2. Contracted entitlement is always 5.6 x weekly hours (no entitlementHours override).
rep('''    ? (u =
        typeof f.entitlementHours == "number"
          ? f.entitlementHours
          : f.contractHours
            ? 5.6 * f.contractHours
            : 0)''',
    '''    ? (u = f.contractHours ? 5.6 * f.contractHours : 0)''')
# 3. "Guess" now means no day length at all (no contract and no rota history), not "average day".
rep('''    ((w = Rt((s || []).filter((m) => m.staffId === e.id && m.published)) || 0),
    (u = !0));''',
    '''    ((w = Rt((s || []).filter((m) => m.staffId === e.id && m.published)) || 0),
    (u = !w));''')
rep('''    dayHoursGuess: m,
    takenDays: g,''', '''    dayHoursGuess: !v,
    takenDays: g,''')
rep('''        title: "Holiday day length not set",
        detail: `${w.map((u) => u.name).join(", ")}: using their average day for now. Set it in Payroll > Settings.`,''',
    '''        title: "Holiday counted as 0h",
        detail: `${w.map((u) => u.name).join(", ")}: no contracted hours and no rota history yet. Add contracted hours in Team.`,''')
rep('p.dayHoursGuess ? ", average day" : "",', 'p.dayHoursGuess ? ", counted as 0h" : "",')
rep('h.dayHoursGuess ? " (your average day so far)" : "",', '"",')
# Holiday tab: no "(average, not set)" note and no "Use Xh as their holiday day" button.
rep('''                                children: " (average, not set)",''', '''                                children: " (no contract or rota yet)",''')
rep('o.dayHoursGuess && a && o.dayHours > 0', '!1')

# 4. Payroll > Settings: per-person People section removed.
rep('      r(Mr, {}),\n', '      null,\n')

# 5. Team panel: settings form for owners (and payroll, who can't reach Team anyway).
rep('''            : r("p", { class: "muted", children: "Can\\u2019t see this" }),
        ],
      }),
    ],
  });
}
function jr() {''', '''            : r("p", { class: "muted", children: "Can\\u2019t see this" }),
        ],
      }),
      fe.includes(ne())
        ? r(TwPaySet, {
            staffId: e,
            pay: a.payInfo.doc || null,
            contract: a.contract.doc || null,
          })
        : null,
    ],
  });
}
function TwPaySet({ staffId: e, pay: t, contract: n }) {
  let a = () => ({
      payrollId: (t && t.payrollId) || "",
      hourlyRate: t && t.hourlyRate != null ? t.hourlyRate : "",
      contractHours: n && n.contractHours != null ? n.contractHours : "",
      holidayBasis: (n && n.holidayBasis) || "",
      carryOverHours: n && n.carryOverHours != null ? n.carryOverHours : "",
    }),
    [i, l] = B(a),
    [s, d] = B(null),
    [h, f] = B(!1),
    c = (w) => (u) => (l((o) => ({ ...o, [w]: u.target.value })), d(null)),
    _ = (w) =>
      w === "" || w == null || Number.isNaN(Number(w)) ? null : Number(w);
  async function b() {
    (f(!0), d(null));
    try {
      let w = { updatedAt: D().serverTimestamp(), updatedBy: ae().uid },
        u = { ...Wt(t) };
      (delete u.hourlyRate,
        Object.assign(u, {
          staffId: e,
          payrollId: String(i.payrollId).trim().slice(0, 40),
          ...w,
        }),
        _(i.hourlyRate) != null && (u.hourlyRate = _(i.hourlyRate)));
      let o = { ...Wt(n) };
      for (let m of [
        "contractHours",
        "daysPerWeek",
        "entitlementHours",
        "holidayDayHours",
        "carryOverHours",
        "holidayBasis",
      ])
        delete o[m];
      Object.assign(o, { staffId: e, ...w });
      for (let m of ["contractHours", "carryOverHours"])
        _(i[m]) != null && (o[m] = _(i[m]));
      i.holidayBasis && (o.holidayBasis = i.holidayBasis);
      let v = D().writeBatch(D().db);
      (v.set(E("payInfo", e), u),
        v.set(E("contracts", e), o),
        await v.commit(),
        d({ ok: !0, text: "Saved." }));
    } catch (w) {
      d({ ok: !1, text: Z(w) });
    }
    f(!1);
  }
  return r("div", {
    class: "tws-payset",
    "data-testid": "team-payset",
    children: [
      r("h4", { children: "Pay and holiday" }),
      r("div", {
        class: "tws-form",
        children: [
          r("label", {
            class: "field",
            children: [
              r("span", { children: "Payroll ID" }),
              r("input", {
                type: "text",
                maxLength: 40,
                name: "payrollId",
                value: i.payrollId,
                onInput: c("payrollId"),
              }),
            ],
          }),
          r("label", {
            class: "field",
            children: [
              r("span", { children: "Hourly rate (\\xA3)" }),
              r("input", {
                type: "number",
                step: "0.01",
                min: "0",
                max: "500",
                inputMode: "decimal",
                name: "hourlyRate",
                value: i.hourlyRate,
                onInput: c("hourlyRate"),
              }),
            ],
          }),
          r("label", {
            class: "field",
            children: [
              r("span", { children: "Contracted hours a week" }),
              r("input", {
                type: "number",
                step: "0.5",
                min: "0",
                max: "80",
                placeholder: "Irregular",
                name: "contractHours",
                value: i.contractHours,
                onInput: c("contractHours"),
              }),
            ],
          }),
          r("label", {
            class: "field",
            children: [
              r("span", { children: "Holiday" }),
              r("select", {
                name: "holidayBasis",
                value: i.holidayBasis,
                onChange: c("holidayBasis"),
                children: [
                  r("option", {
                    value: "",
                    children: "Automatic (contract = 5.6 weeks, otherwise builds up)",
                  }),
                  r("option", {
                    value: "accrual",
                    children: "Builds up from hours worked",
                  }),
                  r("option", {
                    value: "entitlement",
                    children: "5.6 weeks of contracted hours",
                  }),
                ],
              }),
            ],
          }),
          r("label", {
            class: "field",
            children: [
              r("span", { children: "Carried over (hours)" }),
              r("input", {
                type: "number",
                step: "0.5",
                min: "-500",
                max: "500",
                name: "carryOverHours",
                value: i.carryOverHours,
                onInput: c("carryOverHours"),
              }),
            ],
          }),
        ],
      }),
      s
        ? r("p", {
            class: s.ok ? "okbox" : "err",
            role: "status",
            children: s.text,
          })
        : null,
      r("div", {
        class: "actions",
        children: r("button", {
          class: "btn sm",
          disabled: h,
          onClick: b,
          children: h ? "Saving\\u2026" : "Save",
        }),
      }),
    ],
  });
}
function jr() {''')

# 6. CSS: open panel full width (one column while someone is open), buttons keep their size.
rep('''.tws-teamli{flex-wrap:wrap}
.tws-teamslot{flex:1 0 100%;min-width:0}''',
    '''.tws-teamli{flex-wrap:wrap;align-items:center;align-content:flex-start}
.tws-teamli>.btn{flex:none;align-self:center;height:auto}
.tws-teamslot{flex:1 0 100%;min-width:0;width:100%}
.peoplelist{align-items:start}
.peoplelist>li.tws-teamli:has(.tws-teamslot){grid-column:1/-1}
.peoplelist:has(.tws-teamslot){grid-template-columns:1fr}
.tws-personpanel>.tws-payset{grid-column:1/-1}
.tws-payset{display:grid;gap:.6rem;padding:.75rem;border-radius:10px;border:1px solid var(--line,#e6e5df)}
.tws-payset h4{margin:0;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted,#5d6058)}
.tws-payset .actions{margin:0}
.tws-payset .okbox,.tws-payset .err{margin:0}''')

# 7. One person open at a time: opening a name closes any other open one.
rep('''function Jt() {
  (Zr(),''', '''function TwOneOpen(e) {
  let t = e.target && e.target.closest && e.target.closest(".tws-namebtn");
  if (!t || t.getAttribute("aria-expanded") === "true") return;
  document
    .querySelectorAll('.tws-namebtn[aria-expanded="true"]')
    .forEach((n) => {
      n !== t && n.click();
    });
}
function Jt() {
  (window.__twsOneOpen ||
    ((window.__twsOneOpen = 1),
    document.addEventListener("click", TwOneOpen, !0)),
    Zr(),''')

open(dst, 'w', encoding='utf-8').write(s)
print('ok')

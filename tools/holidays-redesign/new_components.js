function twWeekStart(e) {
  let t = new Date(`${e}T12:00:00Z`);
  return (
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)),
    t.toISOString().slice(0, 10)
  );
}
function twMoney(e) {
  return (
    "\xA3" +
    (Number(e) || 0).toLocaleString("en-GB", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
function twDays(e, t) {
  if (!t || !(t > 0)) return "";
  let o = Math.round((e / t) * 10) / 10;
  return `${o} day${o === 1 ? "" : "s"}`;
}
function TwRing({ value: e, max: t, center: o, label: a, sub: r, tone: s }) {
  let i = 52,
    c = 2 * Math.PI * i,
    p = t > 0 ? Math.max(0, Math.min(1, e / t)) : 0;
  return n("figure", {
    class: `tws-ring ${s || ""}`,
    children: [
      n("svg", {
        viewBox: "0 0 120 120",
        "aria-hidden": "true",
        focusable: "false",
        children: [
          n("circle", { class: "tws-ring-track", cx: 60, cy: 60, r: i }),
          p > 0
            ? n("circle", {
                class: "tws-ring-fill",
                cx: 60,
                cy: 60,
                r: i,
                "stroke-dasharray": `${c * p} ${c}`,
                transform: "rotate(-90 60 60)",
              })
            : null,
        ],
      }),
      n("div", {
        class: "tws-ring-mid",
        children: [
          n("b", { children: o }),
          a ? n("span", { children: a }) : null,
        ],
      }),
      r ? n("figcaption", { children: r }) : null,
    ],
  });
}
function TwHolRings({ hol: p }) {
  let e = p.entitlement,
    t = F(p.taken + p.booked),
    o = p.dayHoursGuess ? 0 : p.dayHours,
    a = p.remaining < 0;
  return n("div", {
    class: "tws-rings",
    children: [
      n(TwRing, {
        value: a ? e : p.remaining,
        max: e,
        tone: a ? "over" : "left",
        center: a ? B(-p.remaining) : B(p.remaining),
        label: a ? "over" : "left",
        sub:
          e > 0
            ? [`of ${B(e)}`, o && !a ? n("br", {}) : null, o && !a ? twDays(p.remaining, o) : null]
            : p.basis === "entitlement"
              ? "No allowance set"
              : "None built up yet",
      }),
      n(TwRing, {
        value: t,
        max: e > 0 ? e : 0,
        tone: "used",
        center: B(t),
        label: "used",
        sub: `${B(p.taken)} taken \xB7 ${B(p.booked)} booked`,
      }),
    ],
  });
}
function twPay({ settings: e, contract: t, rate: o, shifts: a, timeOff: r, staffId: s, period: i }) {
  let c = Jt({
      person: { id: s, name: "" },
      period: i,
      shifts: a,
      timeOff: r,
      requests: [],
      contract: t,
      history: a.filter((d) => d.date < i.start),
    }),
    p = Ee(c.rostered, c.contracted),
    _ = Math.max(0, c.rostered - p),
    d = Number(P.withDefaults(e).overtimeMultiplier) || 1;
  return {
    hours: c.rostered,
    shifts: c.shifts,
    holiday: c.holiday,
    holidayDays: c.holidayDays,
    overtime: p,
    rate: typeof o == "number" ? o : null,
    gross: typeof o == "number" ? F(o * (_ + p * d + c.holiday)) : null,
  };
}
function twMyData(e, t) {
  let o = oe(),
    a = P.holidayYear(t, o),
    r = P.upcomingCutoff(t, o),
    s = [a.start, r.start, twWeekStart(o)].sort()[0],
    i = Ce.includes(de()) || e === ye().uid,
    c = O(
      () =>
        e &&
        w().query(
          T("shifts"),
          w().where("staffId", "==", e),
          w().where("published", "==", !0),
          w().where("date", ">=", P.addDays(s, -84)),
        ),
      [e, s],
    ),
    p = O(
      () => e && w().query(T("timeOff"), w().where("staffId", "==", e)),
      [e],
    ),
    _ = he(() => e && z("contracts", e), [e]),
    d = he(() => (e && i ? z("payInfo", e) : null), [e, i]);
  return { today: o, year: a, period: r, shifts: c, timeOff: p, contract: _, payInfo: d, canRate: i };
}
function twCalc(e, t, o) {
  let a = e.shifts.docs || [],
    r = e.timeOff.docs || [],
    s = e.contract.doc || null,
    i = !e.shifts.error && !e.timeOff.error && !e.contract.error,
    c = i
      ? it({ settings: t, contract: s, shifts: a, timeOff: r, staffId: o, today: e.today })
      : null,
    p = e.payInfo.doc && typeof e.payInfo.doc.hourlyRate == "number" ? e.payInfo.doc.hourlyRate : null,
    _ = !e.shifts.error && !e.timeOff.error
      ? twPay({ settings: t, contract: s, rate: p, shifts: a, timeOff: r, staffId: o, period: e.period })
      : null,
    d = twWeekStart(e.today),
    m = P.addDays(d, 6),
    v = a.filter((y) => y.staffId === o && y.published && y.date >= d && y.date <= m);
  return {
    hol: c,
    pay: _,
    week: e.shifts.error ? null : { start: d, end: m, hours: F(v.reduce((y, u) => y + xe(u), 0)), shifts: v.length },
    contractHours: s && typeof s.contractHours == "number" && s.contractHours > 0 ? s.contractHours : null,
  };
}
function twLoading(e) {
  return [e.shifts, e.timeOff].some((t) => t.docs == null && !t.error) || e.contract.doc === void 0 || (e.canRate && e.payInfo.doc === void 0 && !e.payInfo.error);
}
function TwHolCard({ settings: e }) {
  let t = ye().uid,
    o = twMyData(t, e);
  if (twLoading(o)) return n("p", { class: "muted", children: "Loading\u2026" });
  let a = twCalc(o, e, t);
  return a.hol
    ? n("section", {
        class: "card tws-holcard",
        "aria-label": "Your holiday",
        children: [
          n("h2", { children: "Your holiday" }),
          n(TwHolRings, { hol: a.hol }),
        ],
      })
    : n("p", { class: "err", children: "Couldn\u2019t load your holiday." });
}
function TwPerson({ staffId: e }) {
  let t = he(() => z("payroll", "settings"), []),
    o = P.withDefaults(t.doc || {}),
    a = twMyData(e, o);
  if (t.doc === void 0 || twLoading(a))
    return n("p", { class: "muted tws-person-load", children: "Loading\u2026" });
  let r = twCalc(a, o, e),
    s = P.daysBetween(a.today, a.period.payDate);
  return n("div", {
    class: "tws-personpanel",
    children: [
      n("div", {
        class: "tws-tile",
        children: [
          n("h4", { children: "Holiday" }),
          r.hol
            ? n(TwRing, {
                value: r.hol.remaining < 0 ? r.hol.entitlement : r.hol.remaining,
                max: r.hol.entitlement,
                tone: r.hol.remaining < 0 ? "over" : "left",
                center: B(Math.abs(r.hol.remaining)),
                label: r.hol.remaining < 0 ? "over" : "left",
                sub: r.hol.entitlement > 0 ? `of ${B(r.hol.entitlement)} \xB7 ${B(F(r.hol.taken + r.hol.booked))} used` : "None built up yet",
              })
            : n("p", { class: "muted", children: "Can\u2019t see this" }),
        ],
      }),
      n("div", {
        class: "tws-tile",
        children: [
          n("h4", { children: "Next pay day" }),
          n("p", {
            class: "tws-big",
            children: M(a.period.payDate, { weekday: "short", day: "numeric", month: "short" }),
          }),
          n("p", { class: "tws-sub", children: s <= 0 ? "today" : `in ${s} day${s === 1 ? "" : "s"}` }),
          r.pay
            ? [
                r.pay.gross != null
                  ? n("p", { class: "tws-amt", children: [twMoney(r.pay.gross), n("span", { children: " gross estimate" })] })
                  : null,
                n("p", {
                  class: "tws-sub",
                  children: [B(r.pay.hours), " on the rota", r.pay.holiday ? ` + ${B(r.pay.holiday)} holiday` : "", a.canRate && r.pay.rate == null ? " \xB7 no pay rate set" : ""],
                }),
              ]
            : null,
        ],
      }),
      n("div", {
        class: "tws-tile",
        children: [
          n("h4", { children: "This week" }),
          r.week
            ? [
                n("p", { class: "tws-big", children: B(r.week.hours) }),
                n("p", {
                  class: "tws-sub",
                  children: [
                    `${r.week.shifts} shift${r.week.shifts === 1 ? "" : "s"}`,
                    r.contractHours ? ` \xB7 ${B(r.contractHours)} contracted` : "",
                  ],
                }),
              ]
            : n("p", { class: "muted", children: "Can\u2019t see this" }),
        ],
      }),
    ],
  });
}

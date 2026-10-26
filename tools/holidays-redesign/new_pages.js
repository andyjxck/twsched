function Zn() {
  let e = de(),
    t = he(() => z("payroll", "settings"), []);
  if (t.doc === void 0 || t.error) return null;
  if (!t.doc)
    return Ce.includes(e)
      ? n("section", {
          class: "card tws-home",
          children: [
            n("h2", { children: "Pay day" }),
            n("p", {
              children: [
                "Not set up yet. ",
                n("a", { href: "#/payroll", children: "Set the pay periods" }),
              ],
            }),
          ],
        })
      : null;
  let o = P.withDefaults(t.doc);
  return e === "payroll" ? n(TwPayDate, { settings: o, role: e }) : n(TwPayCard, { settings: o, role: e });
}
function TwPayHead({ role: e }) {
  return n("div", {
    class: "row between",
    children: [
      n("h2", { children: "Next pay day" }),
      ["owner", "payroll"].includes(e)
        ? n("a", { class: "tiny", href: "#/payroll", children: "Payroll" })
        : null,
    ],
  });
}
function TwPayWhen({ period: r, today: a }) {
  let s = P.daysBetween(a, r.payDate),
    i = Math.max(1, P.daysBetween(r.start, r.end) + 1),
    c = Math.max(0, Math.min(i, P.daysBetween(r.start, a) + 1));
  return n("div", {
    class: "tws-paywhen",
    children: [
      n("p", {
        class: "tws-paydate",
        children: [
          M(r.payDate, { weekday: "long", day: "numeric", month: "long" }),
          n("span", { class: "tws-pill", children: s <= 0 ? "today" : `in ${s} day${s === 1 ? "" : "s"}` }),
        ],
      }),
      n("div", {
        class: "tws-bar",
        role: "progressbar",
        "aria-label": "Pay period progress",
        "aria-valuemin": 0,
        "aria-valuemax": i,
        "aria-valuenow": c,
        "aria-valuetext": `Day ${c} of ${i}`,
        children: n("span", { style: `width:${Math.round((c / i) * 100)}%` }),
      }),
      n("p", { class: "tws-sub", children: `${ce(r.start, r.end)} \xB7 day ${c} of ${i}` }),
    ],
  });
}
function TwPayDate({ settings: e, role: t }) {
  let o = oe(),
    a = P.upcomingCutoff(e, o);
  return n("section", {
    class: "card tws-home tws-paycard",
    children: [n(TwPayHead, { role: t }), n(TwPayWhen, { period: a, today: o })],
  });
}
function TwPayCard({ settings: e, role: t }) {
  let o = ye().uid,
    a = twMyData(o, e);
  if (twLoading(a))
    return n("section", {
      class: "card tws-home tws-paycard",
      children: [n(TwPayHead, { role: t }), n(TwPayWhen, { period: a.period, today: a.today })],
    });
  let r = twCalc(a, e, o),
    s = r.pay;
  return n("section", {
    class: "card tws-home tws-paycard",
    children: [
      n(TwPayHead, { role: t }),
      n("div", {
        class: "tws-payhero",
        children: [
          n("div", {
            class: "tws-payamt",
            children: [
              n("span", { class: "tws-label", children: "Gross estimate" }),
              n("b", { children: s && s.gross != null ? twMoney(s.gross) : "\u2014" }),
              s && s.gross == null ? n("span", { class: "tws-sub", children: "No pay rate set yet" }) : null,
            ],
          }),
          n(TwPayWhen, { period: a.period, today: a.today }),
        ],
      }),
      s
        ? n("ul", {
            class: "tws-stats",
            children: [
              n("li", { children: [n("b", { children: B(s.hours) }), n("span", { children: `${s.shifts} shift${s.shifts === 1 ? "" : "s"} this period` })] }),
              s.holiday ? n("li", { children: [n("b", { children: B(s.holiday) }), n("span", { children: "holiday pay" })] }) : null,
              r.hol ? n("li", { children: [n("b", { children: B(r.hol.remaining) }), n("a", { href: "#/holidays", children: "holiday left" })] }) : null,
            ],
          })
        : null,
    ],
  });
}
function Hx() {
  let e = de(),
    t = he(() => z("payroll", "settings"), []);
  if (t.error) return n("p", { class: "err", children: W(t.error) });
  if (t.doc === void 0)
    return n("p", { class: "muted", children: "Loading\u2026" });
  let s = P.withDefaults(t.doc || {});
  return n("div", {
    class: "stack tws-holidays",
    children: [
      e !== "payroll"
        ? n(TwHolCard, { settings: s })
        : n("p", {
            children: ["Team balances are in ", n("a", { href: "#/payroll", children: "Payroll" }), "."],
          }),
    ],
  });
}
function Jn() {
  let e = he(() => z("payroll", "settings"), []);
  return e.doc === void 0 || e.error || de() === "payroll"
    ? null
    : n(TwHolCard, { settings: P.withDefaults(e.doc || {}) });
}

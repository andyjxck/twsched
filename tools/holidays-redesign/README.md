# Holidays redesign (26 Oct 2026)

The live app has no complete source, so these changes were made as patches on the built files
from commit 79ca6cd (index-tws2610c.js, payroll/payroll-tws2610b.js):

- `patch_payroll.py`: run on a prettier-formatted copy of payroll-tws2610b.js, then minified with esbuild
  into payroll/payroll-tws2610h.js. Adds the holiday progress rings, the Home pay card with a gross
  estimate, the Team person panel (holiday, next pay day, this week's hours), removes the left accent
  bars and the unneeded hint text.
- `patch_main.py`: run on index-tws2610c.js to make index-tws2610i.js. Moves the Ask for holiday /
  Mark unavailable buttons from Inbox to Holidays, makes team names clickable for managers and owners,
  and removes unneeded hint text. Manager restrictions from dc20da4/79ca6cd are untouched.

The gross estimate uses the same sum as the payroll export: rate x (ordinary + overtime x multiplier + holiday hours).

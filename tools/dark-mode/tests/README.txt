Local-only checks for the dark theme (fake people, local emulators, all other network blocked).
Setup used: copy public/ to /tmp/twsdark/web, add the original index.html as before.html, and in the copy of
the main bundle point Firebase at the emulators (projectId demo-twsdark, auth 127.0.0.1:9771,
Firestore host 127.0.0.1:8771). Start emulators with firebase.json here, serve web/ on 127.0.0.1:8871, run seed.py, then:
  shots.py      behaviour: device default, no flash, saved choice, keyboard, other tabs, all roles, mobile
  audit.py      text contrast + leftover light surfaces on every menu page (W=390 for mobile)
  dialogs.py    same audit with dialogs open
  lightdiff.py  light theme pixel-identical to the original index.html
Nothing here touches production.

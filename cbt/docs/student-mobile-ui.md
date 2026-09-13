# Participant mobile UI

The participant experience keeps the same forest-green and white theme as the administrator and teacher portals, including explicitly selected dark mode. The new CSS is scoped to participant view IDs / `data-student-screen`, and is loaded after the shared atomic components.

- Login: readable labels, 16px inputs to avoid iOS focus zoom, named PIN visibility control.
- Home: actual schedule/available/completed counts, cards based on server availability, completed filter, home/exams/help navigation. A blocked exam leads to support; an unavailable or completed exam cannot start.
- Exam: server-owned timer remains unchanged; answered count and progress reflect the local answer state, while the separate save status retains server acknowledgement feedback. Question options support keyboard arrows, Enter and Space. Previous/next controls reflect question boundaries. The native question-map disclosure remains operable by keyboard and touch.
- Result: the score ring uses the server result on the existing 0–100 scale; missing results show a dash, and terminated exams retain their warning/support flow. A failed silent submission does not display an unconfirmed score or a success message.
- Responsive layout: mobile bottom navigation appears only on the participant home; the active exam has its own navigation and no app-navigation distraction. CSS includes `viewport-fit=cover`, safe-area insets and reduced-motion support. No native-app or PWA installation requirement is introduced.

## Validation

29 PHP regression tests pass; changed JavaScript passes `node --check`. Chromium browser checks at 375px, 390px and 1440px exercise real UI functions with fixture exam data: schedule counts, completed filtering, disabled completed/unavailable exams, start/support actions, safe rendering of exam names, empty schedules, answer progress, keyboard selection and focus, navigation boundaries, score/missing-score/terminated states and removal of participant styling when entering the admin view. All four participant screens in both themes pass document-overflow checks (24 combinations).

Screenshots of home, exam and result were inspected. Mobile emulation is not a real Safari/iOS test; the native iPhone keyboard, safe-area dimensions and Safari-specific exam security/fullscreen behavior still require device acceptance testing. Authentication, exam timing and answer persistence were not exercised against a live server in this UI review.

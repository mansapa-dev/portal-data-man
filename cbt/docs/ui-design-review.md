# CBT: white-default design and heuristic review

## Atomic Design implementation

- Atoms: `ui-theme.css` provides semantic color pairs, spacing steps (4/8/12/16/24/32), 44px primary touch controls, status badges, focus indicators and readable text sizes.
- Molecules: title + description + refresh action; visibly labelled status filter; ticket metadata; note input and action group.
- Organisms: ticket cards and ticket collection share components between admin and teacher. Status semantics stay visible as text, not color alone.
- Templates: bounded content width, responsive ticket columns with a 380px preferred minimum, single column on phones. A single ticket retains a reasonable column width on desktop.
- Pages: existing admin, teacher and student pages retain their workflows. CBT defaults to white independently of OS appearance and old AGEN/shared theme preferences. Explicit CBT dark selection persists under `mansapa-cbt-theme-v2`.

## Heuristic evaluation (implementation review, not a user study)

| Finding | Severity | Change |
| --- | --- | --- |
| Light header with dark-theme foreground makes ticket guidance unreadable | High | Header, card, metadata and status use paired theme tokens in both modes |
| OS appearance unexpectedly sets the initial CBT theme | Medium | White default, explicit toggle, CBT-specific preference |
| Small 9–10px ticket labels and actions impede scanning | Medium | 12px metadata, 14px request text, 44px action targets |
| Status selector lacks a persistent label | Medium | Visible “Status tiket” label; live summary for feedback |
| Equal visual density obscures the handling sequence | Medium | Identity/status → metadata → request → note → actions with consistent spacing |
| Wide panels and long descriptions compete with actions | Medium | Bounded reading width, non-shrinking refresh control, adaptive card grid |

## Verification

Run `node cbt/tests/frontend/theme.cjs`, `php cbt/tests/run.php`, and `php cbt/scripts/lint.php`.
Browser fixtures use illustrative data only; inspect ticket page at desktop and mobile widths, in white and explicitly selected dark modes. Force OS dark during the white-default check. Live API and real-role workflow testing are separate from this visual review.

## References

- Atomic Design: https://atomicdesign.bradfrost.com/chapter-2/
- WCAG text contrast: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum

Text targets at least 4.5:1 contrast; this review is not a claim of whole-product WCAG conformance.

## Whole-CBT review (12 September 2026)

`atomic-components.css` composes the shared theme tokens into reusable atoms (`ui-control`, `ui-label`, `ui-button`), filter/header molecules, table/form/session organisms, and responsive admin/teacher/student templates. The layer is screen-only: official print layouts retain their typography and dimensions.

| Area | Heuristic finding | Implemented change |
| --- | --- | --- |
| Overview | Metrics compete with operational actions | Common metric density, bounded grids and consistent action sizing |
| Exam schedules | Filters and table controls differ in sizing | Shared field atoms, label associations and table spacing |
| Follow-up exams | Dense schedule/form controls | Same field rhythm, mobile form stacking, readable status badges |
| Question catalog/detail | Template/download actions compete with creation | Secondary styling for imports/templates; consistent catalog and form controls |
| Participants/PIN | Dense filters and compact labels | Readable labelled controls, keyboard names for searches, responsive filters |
| Results/reports | Letterhead editing displaces the primary results task | Native expandable print settings, retaining export field IDs and values |
| Participant cards | Inconsistent filter/print controls | Common input/action atoms; unchanged print stylesheet |
| Teacher assignments | Search/action presentation differs | Common search, action, table and assignment-modal styles |
| Staff accounts | Upload/template actions visually overpower creation | Secondary utilities and consistent account form/table |
| Violations | Dense filters and status text | Shared filter spacing, semantic colors, readable table density |
| System settings | Controls depart from other pages | Shared labels, actions and section spacing |
| Live sessions | Participant progress metadata too small | Shared session cards, 12px metadata, action/filter sizing |
| Support tickets | Mixed theme surfaces and cramped request cards | Paired theme tokens, bounded card widths, clear status/filter hierarchy |
| Teacher overview/results/live | Independent visual defaults | Shared metrics, panels, result controls, session and table organisms |
| Login and participant portal | Field hierarchy differs from admin | Same field/label/button atoms and readable instructions |
| Active exam | Reading area and navigation compete | Wider readable question area, bounded navigation column, single column on mobile |
| Completion/review | Inconsistent actions and close targets | Same action atoms, 44px named dialog-close controls |
| All static forms/modals | Many labels lack an explicit association | `for` associations for adjacent fields; search accessible names |

### Validation scope

- Compared IDs and inline event handlers in 33 templates against their pre-change versions: no removals or handler changes.
- PHP regression suite: 29 passing; theme regression checks passing; PHP lint passing.
- Browser review covers all static admin tabs, participant states and modal templates at 390px and 1440px in both themes. Dynamic authenticated records need a separate operational acceptance check with real roles; this is not a claim of complete accessibility compliance or a moderated usability study.

Final static browser audit: 70 page/theme combinations at an emulated 390px viewport and 70 at 1440px; zero reported document/control overflows, missing names on visible `ui-control` elements, or hardcoded white backgrounds on inspected dark-theme surfaces. Three missing control names found in the first pass were corrected. Bank-soal desktop and report desktop/mobile screenshots were inspected. The table itself intentionally scrolls horizontally on small screens.

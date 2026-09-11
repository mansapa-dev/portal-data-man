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

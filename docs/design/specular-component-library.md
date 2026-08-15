# Specular component library inventory

Status: planning registry
Catalog baseline: [NameThatUI Web, 44 entries](https://namethatui.com/?platform=web), captured 2026-08-15
Machine-readable source: [`specular-component-library-inventory.json`](specular-component-library-inventory.json)

## Purpose

This registry gives every NameThatUI web pattern an explicit place in Specular before component implementation begins. Inventory does not equal adoption: the library keeps useful shared names while preventing unrelated trends from entering the product simply because a catalog contains them.

The four tiers are:

- **Foundation (7):** cross-component rule implemented once.
- **Core (15):** approved initial Specular component or product pattern.
- **Conditional (15):** named recipe retained until a concrete requirement exists.
- **Excluded (7):** intentionally outside the current product model or doctrine.

## Full 44-pattern register

| # | NameThatUI pattern | Tier | Specular library entry | Product decision |
|---:|---|---|---|---|
| 1 | [Steps](https://namethatui.com/web/steps) | Conditional | `Steps` | Only a real staged flow; not tabs, breadcrumbs, or percent progress. |
| 2 | [Avatar Group](https://namethatui.com/web/avatar-group) | Excluded | — | No collaboration or social-presence model. |
| 3 | [Multi-select](https://namethatui.com/web/multi-select) | Conditional | `MultiSelect` | Future bounded metadata/bulk selection only. |
| 4 | [Scrollspy](https://namethatui.com/web/scrollspy) | Conditional | `ScrollspyNavigation` | Potential long snapshot/help navigation. |
| 5 | [Inline Alert vs. Callout vs. Banner](https://namethatui.com/web/alert-callout-banner) | Core | `InlineAlert`, `Callout`, `Banner` | Distinguish task errors, authored notes, and workspace-wide conditions. |
| 6 | [Sign-in Form](https://namethatui.com/web/sign-in-form) | Core | `SignInBoundary` | ChatGPT handoff only; no invented credential form. |
| 7 | [Pagination](https://namethatui.com/web/pagination) | Conditional | `Pagination` | Only for addressable pages of a bounded collection. |
| 8 | [Date Picker](https://namethatui.com/web/date-picker) | Conditional | `DatePicker` | No current need; native first. |
| 9 | [Parallax Scrolling](https://namethatui.com/web/parallax) | Excluded | — | Decorative motion conflicts with concentration. |
| 10 | [Carousel](https://namethatui.com/web/carousel) | Excluded | — | No slide/media requirement; do not hide core content. |
| 11 | [Site Header vs. Navigation Bar](https://namethatui.com/web/header-navbar) | Core | `AppHeader`, `PrimaryNavigation` | Preserve landmark and navigation distinction. |
| 12 | [Card](https://namethatui.com/web/card) | Conditional | `Card` | Bounded object preview only; no card-everything aesthetic. |
| 13 | [Resize Handle](https://namethatui.com/web/resize-handle) | Foundation | `ResizableTextareaPolicy` | Vertical and bounded where useful. |
| 14 | [Hamburger Menu](https://namethatui.com/web/hamburger-menu) | Conditional | `NavigationDrawer` | Only if mobile navigation outgrows visible actions. |
| 15 | [Bento Grid](https://namethatui.com/web/bento-grid) | Excluded | — | Conflicts with document-first and anti-vibe-coded direction. |
| 16 | [Masonry Layout](https://namethatui.com/web/masonry) | Excluded | — | Inappropriate visual/reading order. |
| 17 | [Easing](https://namethatui.com/web/easing) | Foundation | `MotionTokens` | Restrained shared curves and reduced-motion equivalents. |
| 18 | [Spring Animation](https://namethatui.com/web/spring) | Conditional | `SpringMotionRecipe` | Spatial continuity only, never ambient bounce. |
| 19 | [Text Scramble](https://namethatui.com/web/text-scramble) | Excluded | — | Conflicts with legibility and authorship trust. |
| 20 | [Lightbox](https://namethatui.com/web/lightbox) | Conditional | `Lightbox` | Future source/image preview only. |
| 21 | [Marquee](https://namethatui.com/web/marquee) | Excluded | — | Continuous promotional motion is incompatible. |
| 22 | [Form Field](https://namethatui.com/web/form-field) | Core | `Field`, `TextField`, `Textarea` | Visible labels and linked help/error text. |
| 23 | [Truncation](https://namethatui.com/web/truncation) | Foundation | `TruncateText` | Metadata only; never canonical writing. |
| 24 | [Drag & Drop](https://namethatui.com/web/drag-and-drop) | Conditional | `DragDrop` | Requires keyboard alternative and durable order. |
| 25 | [Divider vs. Separator vs. Rule](https://namethatui.com/web/divider) | Foundation | `ThematicRule`, `Separator`, `DecorativeBorder` | Semantics follow purpose. |
| 26 | [Progress Ring vs. Spinner vs. Progress Bar](https://namethatui.com/web/progress-indicators) | Conditional | `ProgressBar`, `ProgressRing` | No determinate use yet; `Spinner` remains core through Skeleton vs. Spinner. |
| 27 | [The Three Dots](https://namethatui.com/web/three-dots) | Core | `OverflowMenu` | Secondary commands; not navigation or truncation. |
| 28 | [Toast](https://namethatui.com/web/toast) | Core | `ToastRegion`, `Toast` | Transient nonessential outcomes only. |
| 29 | [Modal Dialog vs. Drawer vs. Sheet](https://namethatui.com/web/dialog-drawer-sheet) | Core | `Dialog`, `AlertDialog`, `Drawer`, `Sheet` | Shared modality and focus contract. |
| 30 | [Popover vs. Dropdown Menu vs. Tooltip](https://namethatui.com/web/popover-dropdown-tooltip) | Core | `Popover`, `Menu`, `Tooltip` | Choose from content and behavior, not appearance. |
| 31 | [Scrim](https://namethatui.com/web/scrim) | Foundation | `Scrim` | One backdrop and layering contract. |
| 32 | [Skeleton vs. Spinner](https://namethatui.com/web/skeleton-spinner) | Core | `Skeleton`, `Spinner` | Loading is distinct from empty and error. |
| 33 | [Combobox](https://namethatui.com/web/combobox) | Conditional | `Combobox` | Future source/document/connection search. |
| 34 | [Command Palette](https://namethatui.com/web/command-palette) | Conditional | `CommandPalette` | Later expert accelerator, never sole access. |
| 35 | [Accordion](https://namethatui.com/web/accordion) | Core | `Disclosure`, `Accordion` | Optional explanation; primary actions stay visible. |
| 36 | [Tabs](https://namethatui.com/web/tabs) | Core | `Tabs` | Peer views only. |
| 37 | [Badge vs. Chip vs. Pill vs. Tag](https://namethatui.com/web/badge-chip-pill) | Core | `Badge`, `Chip`, `Tag` | No generic decorative `Pill`. |
| 38 | [Breadcrumbs](https://namethatui.com/web/breadcrumbs) | Conditional | `Breadcrumbs` | Only if a real nested hierarchy appears. |
| 39 | [Sticky vs. Fixed](https://namethatui.com/web/sticky-fixed) | Foundation | `StickyRegion`, `FixedRegionPolicy` | Fixed requires collision and safe-area evidence. |
| 40 | [Focus Ring](https://namethatui.com/web/focus-ring-web) | Foundation | `FocusRing` | One high-contrast keyboard-focus contract. |
| 41 | [Empty State](https://namethatui.com/web/empty-state) | Core | `EmptyState` | Distinguish first use, no results, loading, and error. |
| 42 | [Hover Card](https://namethatui.com/web/hover-card) | Conditional | `HoverCard` | Only with equivalent focus and touch paths. |
| 43 | [Switch vs. Checkbox vs. Radio](https://namethatui.com/web/switch-checkbox-radio) | Core | `Switch`, `Checkbox`, `RadioGroup` | Immediate, independent/deferred, and one-of-many choices stay distinct. |
| 44 | [Toggle Group](https://namethatui.com/web/toggle-group) | Core | `ToggleGroup` | Small persistent peer selection; not navigation or commands. |

## Initial Storybook scope

The first library increment should implement stories only for the foundations and core patterns exercised by current Specular surfaces:

1. focus, motion, fixed/sticky, divider, scrim, truncation, and textarea-resize foundations;
2. buttons and icon buttons already specified by the interface doctrine;
3. fields and selection controls;
4. toast, inline alert, callout, banner, and actionable update notice;
5. dialog, alert dialog, drawer, sheet, popover, menu, tooltip, and overflow menu;
6. loading, progress, and empty states;
7. header/navigation, tabs, disclosure, tags/chips, and toggle group;
8. the product-specific `SignInBoundary`.

Conditional entries stay as documented recipes until a product requirement and owner greenlight promote them. Excluded entries remain machine-readable so future contributors do not repeatedly reconsider them without new evidence.

## Governance

- This inventory is planning-only and does not authorize component implementation.
- Every promotion from conditional or excluded requires a concrete product use, doctrine check, and owner decision.
- The future reciprocal UI surface manifest should reference these IDs rather than inventing parallel names.
- NameThatUI supplies vocabulary and pattern distinctions, not Specular's visual styling.
- The catalog changes over time; refresh the source count and diff new entries deliberately rather than silently adopting them.

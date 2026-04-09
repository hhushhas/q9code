# Q9 Code UI and Theme Guidance

This document describes the live design and theming model used by the Q9 Code web app, with the current source of truth in:

- `apps/web/src/index.css`
- `apps/web/src/lib/theme.ts`
- `apps/web/src/hooks/useTheme.ts`
- `apps/web/src/components/settings/SettingsPanels.tsx`
- `apps/web/src/components/ui/*`
- `apps/web/src/routes/__root.tsx`
- `apps/web/src/components/WebSocketConnectionSurface.tsx`

This app does not have a single visual theme. It supports:

- stock light
- stock dark
- custom Hasan Signature dark
- custom Hasan Signature light

The design system is intentionally semantic. Most UI should be authored against shared tokens like `background`, `foreground`, `card`, `border`, `muted`, `primary`, and `ring`, then let the active theme change the presentation.

## Theme Model

### Supported theme options

Theme selection comes from `THEME_OPTIONS` in `apps/web/src/lib/theme.ts`.

| Theme value             | User-facing meaning          | Resolved mode     | Root classes applied             |
| ----------------------- | ---------------------------- | ----------------- | -------------------------------- |
| `system`                | Follow OS/browser preference | `light` or `dark` | `dark` only when system is dark  |
| `light`                 | Stock light theme            | `light`           | none                             |
| `dark`                  | Stock dark theme             | `dark`            | `dark`                           |
| `hasan-signature`       | Custom Hasan dark theme      | `dark`            | `dark` + `theme-hasan-signature` |
| `hasan-signature-light` | Custom Hasan light theme     | `light`           | `theme-hasan-signature-light`    |

### How theme application works

- `apps/web/src/hooks/useTheme.ts` is the runtime authority for applying theme state.
- The selected theme is stored in `localStorage` under `q9code:theme`.
- The resolved light/dark mode is represented by the `dark` class on `document.documentElement`.
- Custom visual variants are represented by root classes:
  - `theme-hasan-signature`
  - `theme-hasan-signature-light`
- Theme changes temporarily add `no-transitions` to suppress cross-theme animation noise.

### Important architectural distinction

- Stock themes are the baseline token system.
- Custom themes are not separate component trees. They override the same semantic tokens and some shared shell/component styling.
- Non-CSS renderers usually only care about resolved light/dark.
  - Diff highlighting uses `resolveDiffThemeName(theme)` from `apps/web/src/lib/diffRendering.ts`.
  - VS Code file/folder icons resolve against `"light"` or `"dark"` in `apps/web/src/vscode-icons.ts`.
- That means custom themes should still remain legible and coherent when secondary systems reuse stock light/dark assets.

## Universal Rules

These rules apply across every theme, including future custom themes.

### 1. Build against semantic tokens, not hard-coded colors

Prefer classes and variables such as:

- `bg-background`
- `bg-card`
- `bg-popover`
- `text-foreground`
- `text-muted-foreground`
- `border-border`
- `bg-secondary`
- `bg-accent`
- `text-primary-foreground`
- `ring-ring`

Avoid introducing literal hex colors in components unless the styling is truly theme-specific and intentionally scoped.

### 2. Use shared primitives before inventing new surfaces

The component library in `apps/web/src/components/ui/*` already encodes cross-theme behavior for:

- buttons
- cards
- inputs
- dialogs
- menus
- popovers
- sheets
- toasts

These primitives use semantic tokens, `dark:` variants, and `data-slot` hooks that custom themes can target safely.

### 3. Preserve predictable interaction patterns

Across all themes:

- hover states should clarify affordance, not radically restyle layout
- focus states must remain visible and use `ring-ring` or theme-aware outlines
- selected and active states should still read clearly in both light and dark contexts
- disabled states should reduce emphasis without collapsing contrast too far

### 4. Keep layout logic theme-agnostic

Theme should not change core information architecture. Across all variants:

- spacing
- panel hierarchy
- responsive behavior
- scroll behavior
- sticky regions
- loading/error/recovery flows

should stay structurally consistent unless a theme-specific shell treatment explicitly calls for a visual-only enhancement.

### 5. Typography should stay semantic

Global typography tokens come from `apps/web/src/index.css`:

- `--font-body`
- `--font-sans`
- `--font-mono`
- `--font-display`

Use semantic class intent instead of theme-specific assumptions:

- body copy should follow body or sans defaults
- code and terminal-adjacent content should use the mono stack
- display moments can use `.font-display` or `[data-display]`

Do not assume the body font is always mono. That is only true in the Hasan variants.

## Stock Theme Constraints And Expectations

These apply when the active theme is `light`, `dark`, or `system`.

### Visual character

- Stock light and dark are the default product themes.
- They are cleaner and more neutral than the Hasan custom variants.
- They rely on semantic token inversion rather than bespoke texture or editorial framing.

### Token behavior

Stock theme tokens are defined on `:root` in `apps/web/src/index.css`, with dark-mode overrides under `@variant dark`.

Key baseline expectations:

- light mode starts with white/light surfaces and dark neutral text
- dark mode flips to near-black surfaces and light neutral text
- `primary` remains a cool violet-blue accent in stock themes
- subtle elevation often comes from soft shadows plus borders
- `dark:` variants are valid and expected in shared components

### Component expectations

In stock themes it is acceptable and expected for shared primitives to use:

- soft shadows like `shadow-xs/5`, `shadow-lg/5`
- `dark:` overrides for inner strokes and hover fills
- translucent neutrals such as `bg-accent/50`, `dark:bg-input/32`

If a component looks correct only because of a stock `dark:` override and breaks in light mode, it is not ready.

### What not to do

- Do not tune stock components around Hasan pink/red assumptions.
- Do not remove shadows globally just because Hasan variants suppress them.
- Do not assume headings use `font-display`; stock theme keeps typography more restrained by default.

## Custom Theme Guidance

These rules apply to `theme-hasan-signature` and `theme-hasan-signature-light`.

### What makes Hasan variants different

The Hasan themes are a custom visual layer on top of the same app structure. They change:

- font stacks
- radius
- color palette
- background atmosphere
- shell treatments
- some component chrome choices

They do not change the app’s structural layout model.

### Shared Hasan theme characteristics

Both Hasan variants:

- switch body typography to JetBrains Mono
- use `Space Grotesk` as the display face
- reduce default radius to `0.45rem`
- remove a lot of stock surface shadowing
- restyle shell surfaces through `.theme-shell-*` classes
- rely more on borders, texture, and tonal separation than soft elevation

### Hasan dark expectations

`theme-hasan-signature` is the darker editorial/archive variant:

- near-black background
- warm pink/red primary accent
- monochrome dark cards and borders
- subtle atmospheric radial + linear background
- display typography feels more expressive
- shadows are largely suppressed in favor of crisp borders

### Hasan light expectations

`theme-hasan-signature-light` is not stock light with a pink accent. It is its own warm paper-like variant:

- cream/off-white background
- dark ink foreground
- rose/red accent
- warmer borders and muted surfaces
- similar editorial typography and reduced-shadow treatment

### Theme-specific hooks already in use

Custom Hasan rules in `apps/web/src/index.css` intentionally target:

- root classes:
  - `:root.theme-hasan-signature`
  - `:root.theme-hasan-signature-light`
- shell helpers:
  - `.theme-shell-glow-error`
  - `.theme-shell-glow-warning`
  - `.theme-shell-gradient`
  - `.theme-shell-card`
  - `.theme-shell-chip`
- primitive hooks:
  - `[data-slot="button"]`
  - `[data-slot="card"]`
  - `[data-slot="card-frame"]`
  - `[data-slot="input-control"]`
  - `[data-slot="select-trigger"]`
  - `[data-slot="select-button"]`

When extending shared primitives, prefer stable `data-slot` hooks over brittle descendant selectors.

### What not to do in custom themes

- Do not fork component markup just for Hasan styling.
- Do not hard-code Hasan colors inside component files unless the element is intentionally a Hasan-only art direction layer.
- Do not assume all custom themes will be dark. `hasan-signature-light` already proves that custom theme and resolved light/dark are different concepts.

## Practical Implementation Guidance

### Use these tokens as your default vocabulary

For most new UI, start with:

- surfaces: `bg-background`, `bg-card`, `bg-popover`, `bg-secondary`, `bg-muted`
- text: `text-foreground`, `text-card-foreground`, `text-popover-foreground`, `text-muted-foreground`
- borders: `border-border`, `border-input`
- emphasis: `bg-primary`, `text-primary-foreground`, `bg-accent`, `text-accent-foreground`
- feedback: `text-destructive-foreground`, `bg-destructive`, `bg-warning`, `bg-success`, `bg-info`
- focus: `ring-ring`, `focus-visible:ring-*`, `focus-visible:ring-offset-background`

If these tokens are not enough, add a semantic token first before adding literal colors in component code.

### Prefer root-theme composition over component branching

Good:

- author one component using semantic tokens
- let stock dark mode respond through `dark:`
- let custom themes override tokens or stable hooks at the root

Avoid:

- `if (theme === "hasan-signature")` inside UI components for basic styling
- duplicating JSX just to swap colors
- assuming `.dark` means “Hasan dark”

### Use `dark:` only for light/dark polarity, not brand identity

`dark:` is correct when behavior should change with resolved light/dark mode, for example:

- shadow direction
- dark-specific fill opacity
- inverted border treatment
- stock dark readability tuning

`dark:` is not enough when a custom theme needs different art direction. In those cases, use semantic tokens or root theme classes.

### Respect existing stable hooks

The CSS already depends on:

- `data-slot` attributes from shared UI primitives
- `.theme-shell-*` helper classes for full-screen shells and recovery states
- `.font-display`, `.label-micro`, `.label-small`, `.label-tiny`
- `status-dot`, `status-dot-active`, `status-dot-blocked`, `status-dot-idle`

If you replace these hooks, update the theme CSS with the component change.

### Think about non-CSS theme consumers

If the feature includes:

- syntax or diff highlighting
- file or folder icons
- terminal styling
- canvas rendering

check whether that system consumes `resolvedTheme` (`"light"` or `"dark"`) instead of custom classes. The custom theme still needs to coexist with those stock-mode assets.

### Avoid fragile surface styling

In this codebase, good surfaces usually come from combinations like:

- `border border-border bg-card text-card-foreground`
- `bg-background text-foreground`
- `bg-popover text-popover-foreground`

Avoid relying on:

- raw black/white alpha values as the only contrast mechanism
- bespoke one-off shadows that only look right in one theme
- text colors like `text-white` or `text-black` on reusable components

### Full-screen shells and empty states

Error, loading, and reconnect shells already use `.theme-shell-*` classes in:

- `apps/web/src/routes/__root.tsx`
- `apps/web/src/components/WebSocketConnectionSurface.tsx`

If you build another full-screen or modal shell, reuse that pattern instead of inventing a separate theme vocabulary.

## Cross-Theme Review Checklist

Before calling a UI task done, check the screen in:

1. stock light
2. stock dark
3. Hasan Signature
4. Hasan Signature Light

Look for these failure modes:

- hard-coded text or background colors that disappear in one theme
- shadows that look muddy or too strong in Hasan variants
- borders that vanish against warm light surfaces
- focus rings with low contrast
- display typography leaking into routine body copy
- `dark:` styling that fixes stock dark but breaks custom light
- shell backgrounds or overlays that double-stack awkwardly
- code, diff, or icon rendering that clashes with the active theme

If a design intentionally leans into one theme, it still must remain readable and non-broken in the others.

## Working Rules For Contributors

- Treat `apps/web/src/index.css` as the canonical theme contract.
- Treat `apps/web/src/lib/theme.ts` as the canonical list of supported theme values and classes.
- Treat `apps/web/src/hooks/useTheme.ts` as the canonical DOM application behavior.
- Prefer editing shared tokens, shared primitives, or root theme overrides before introducing screen-local hacks.
- When adding a new theme-aware pattern, document the stable class or `data-slot` hook in this file.
  - back-to-top button becomes slightly smaller
- On very wide screens:
  - blog posts gain a two-column layout with TOC sidebar
- The rest of the site remains intentionally simple and single-column.

## What Makes It Distinct

- It feels like a personal archive instead of a mainstream portfolio.
- The design is carried by typography, borders, and spacing rather than decoration.
- Accent usage is disciplined and rare enough to feel meaningful.
- The system is small on purpose, which makes it easy to maintain.

## Notes

- `src/components/ThemeSwitcher.astro` suggests a future multi-theme system, but it is not currently part of the rendered layout.
- The live site should be treated as a single-theme archive system unless that component is intentionally wired in later.

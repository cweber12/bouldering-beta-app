# components/

Shared React components used across pages.

## Shared layout and control system

- `ToolPageShell` keeps the core tool routes inside the viewport and prevents page-level scrolling.
- `ToolRouteHeader` standardizes route titles, subtitles, and action placement.
- Shared control primitives in `app/globals.css` (`ui-control`, `ui-control-primary`, `ui-input`, `ui-popover`, and feedback banner classes) keep buttons, inputs, menus, and notices visually consistent across routes.

## `shared/`

### `NavBar`

Sticky top navigation bar with tabs: Home, Upload, Match, Docs.

```tsx
import NavBar from "@/components/shared/NavBar";

// Used in app/layout.tsx — rendered on every page.
<NavBar />
```

- `"use client"` — uses `usePathname()` for active tab highlighting.
- Active tab: `border-b-2 border-zinc-200` + `aria-current="page"`.
- Matching rule: exact match for `/`; prefix match for other tabs.

### `InfoDropdown`

Accessible accordion using native `<details>/<summary>`. No JavaScript state.

```tsx
import InfoDropdown from "@/components/shared/InfoDropdown";

<InfoDropdown title="How does this work?" defaultOpen>
  <p>Explanation here.</p>
</InfoDropdown>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Summary text shown in the header row. |
| `children` | `ReactNode` | — | Body content shown when expanded. |
| `defaultOpen` | `boolean` | `false` | Whether the accordion starts expanded. |

- Pure server component — no `"use client"`.
- Chevron SVG rotates 180° using `group-open:rotate-180` Tailwind class on the `<details>` group.

### `LoadingGate`

Gates child content until OpenCV is ready.

Located at `components/shared/LoadingGate.tsx`. Used on the Upload and Match pages to prevent hooks from running before runtimes are initialised.

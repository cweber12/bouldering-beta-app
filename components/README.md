# components/

Shared React components used across pages.

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

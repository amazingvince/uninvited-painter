# End-to-End Game Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the complete local and online player journeys without changing the game rules or diluting the existing gallery identity.

**Architecture:** Keep `shared/engine.ts` and the online Durable Object authoritative. Improve the experience through small presentation helpers, reusable UI primitives, focused screen changes, and explicit recovery/action state; share code only where local and online behavior is genuinely identical. Each journey stage gets a browser check at a phone viewport before the next stage begins.

**Tech Stack:** React 19, TypeScript 5.8, Vite 7, Vitest 3, Cloudflare Workers and Durable Objects, CSS, Codex in-app Browser

## Global Constraints

- Preserve the warm-paper, black-ink, restrained-red editorial gallery identity.
- Give pass-one-phone and online multiplayer equal attention.
- Do not add scoring rules, roles, round types, decks, or other game systems.
- Small additions may only close an observed feedback, recovery, accessibility, or progression gap.
- Keep the deterministic reducer authoritative for phase changes, scoring, turn order, and legal events.
- Keep the Durable Object authoritative for online private data, ballots, clocks, connectivity, and validation.
- Optional AI, publishing, and sharing work may degrade; they may never block official play.
- Do not add a production dependency for this pass.
- Preserve private-card DOM gating: secret role and word content must remain unmounted until the holder reveals it.
- Use the in-app Browser first for rendered QA at 390×844, a short 400×710 viewport, and desktop.

## File Structure

### New files

- `src/components/ActionNotice.tsx` — one reusable, accessible status line for copy, share, publish, save, and retry outcomes.
- `src/components/ConfirmSheet.tsx` — focused confirmation sheet for destructive or official actions.
- `src/components/HoldPeek.tsx` — pointer and keyboard hold control for temporarily showing the shared wall.
- `src/components/SettingSelect.tsx` — labelled native select that retains the catalogue visual treatment.
- `src/lib/actionResult.ts` — action result types and clipboard/share/download helpers.
- `src/lib/settingsOptions.ts` — typed setting options and advanced-settings summary.
- `test/action-result.test.ts` — deterministic action-helper tests with injected browser adapters.
- `test/labels.test.ts` — drawing and progress label tests.
- `test/settings-options.test.ts` — setting option, label, and advanced-summary tests.
- `test/storage.test.ts` — saved-game and last-room recovery tests.

### Main modified files

- `src/theme.css` — responsive screen anatomy, touch targets, settings disclosure, notices, confirmations, reduced motion, and compact-height rules.
- `src/components/ui.tsx` — shared button semantics, timer semantics, and action-target classes.
- `src/App.tsx` — safe local restart and truthful room-check failures.
- `src/lib/storage.ts` — validate and expire stale last-room shortcuts.
- `src/lib/share.ts` — observable share/download outcomes and cancellation handling.
- `src/game/onlineClient.ts` — explicit connection state and bounded reconnect presentation.
- `src/screens/JoinCode.tsx` — real text-input path alongside the on-screen letter grid.
- `src/screens/DeckSettings.tsx` — core settings first, advanced settings disclosed.
- `src/screens/HostLobby.tsx` — accessible setting selects and visible copy/share feedback.
- `src/screens/Roster.tsx` — correct disabled semantics and usable reorder/remove targets.
- `src/screens/DrawTurn.tsx` — clearer status, accessible canvas description, and compact-height composition.
- `src/components/CanvasBoard.tsx` — labelled canvas and lost-pointer recovery.
- `src/screens/Vote.tsx` — selected-state semantics and ballot confirmation clarity.
- `src/screens/Guess.tsx` — explicit one-guess confirmation; Enter no longer bypasses it.
- `src/screens/Disconnect.tsx` — clearer reconnect, seat-hold, and host action language.
- `src/screens/CriticVerdict.tsx` — explicit AI busy/unavailable semantics.
- `src/screens/RenditionReveal.tsx` — explicit loading/error semantics and image retry.
- `src/screens/Reveal.tsx` — stronger official-result hierarchy and observable save outcome.
- `src/screens/Final.tsx` — separate publish, copy, share, and save actions.
- `src/screens/ArchivePage.tsx` — distinguish missing archives from temporary load failures.
- `src/flows/LocalFlow.tsx` — safe hold-to-peek and shared action state wiring.
- `src/flows/OnlineFlow.tsx` — connection/recovery presentation and shared action state wiring.
- `design/catalogue-full-flows.html` — keep the approved visual catalogue aligned with the polished screens.

---

### Task 1: Responsive shell and shared interaction primitives

**Files:**
- Modify: `src/theme.css:6-143,217-265,643-821`
- Modify: `src/components/ui.tsx:5-88`
- Create: `src/components/ActionNotice.tsx`

**Interfaces:**
- Produces: `ActionNotice({ message, tone?, id? })`
- Produces: `.screen-scroll`, `.action-footer`, `.tap-target`, `.action-notice`, and `.visually-hidden`
- Consumes: existing `Screen`, `Btn`, `ClockChip`, and CSS color tokens

- [ ] **Step 1: Capture the responsive failure before editing**

Use the in-app Browser on `http://127.0.0.1:4173/`, create a five-player local roster, open **The collection**, and capture:

```text
390×844: top of settings and bottom action
400×710: top of settings and bottom action
```

Record whether the scrollable region can reach every setting without the footer covering a control. The current short view shows a partially covered settings row and no visual separation between scrolling content and the fixed action.

- [ ] **Step 2: Add the shared layout and touch tokens**

Add these responsibilities to `src/theme.css`, preserving the existing palette:

```css
:root {
  --tap-target: 44px;
  --screen-gutter: 20px;
  --action-shadow: 0 -10px 24px rgba(18, 18, 18, 0.08);
}

.screen-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-gutter: stable;
}

.action-footer {
  flex: none;
  position: relative;
  z-index: 2;
  padding: 14px var(--screen-gutter)
    calc(24px + env(safe-area-inset-bottom));
  border-top: 3px solid currentColor;
  background: inherit;
  box-shadow: var(--action-shadow);
}

.tap-target {
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

@media (max-height: 760px) {
  .header { padding-block: 10px; }
  .footer, .action-footer {
    padding-top: 10px;
    padding-bottom: calc(14px + env(safe-area-inset-bottom));
  }
}
```

Keep `.grow` as a layout primitive, but migrate screens touched by later tasks from `grow scroll` to `screen-scroll`.

- [ ] **Step 3: Tighten shared control semantics**

Update `Btn` and `BackLink` in `src/components/ui.tsx`:

```tsx
export function Btn({
  variant = "ink",
  type = "button",
  onClick,
  children,
  disabled,
  split,
  style,
  ariaLabel,
}: {
  variant?: "red" | "ink" | "outline" | "disabled";
  type?: "button" | "submit";
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  split?: boolean;
  style?: CSSProperties;
  ariaLabel?: string;
}) {
  const off = disabled || variant === "disabled";
  return (
    <button
      type={type}
      className={`btn btn--${off ? "disabled" : variant}${split ? " btn--split" : ""}`}
      onClick={onClick}
      disabled={off}
      style={style}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}
```

Make `BackLink` use `tap-target` and give `ClockChip` `role="timer"` plus an accessible label such as `59 seconds left`; do not add `aria-live` to a 250 ms clock.

- [ ] **Step 4: Add the reusable action notice**

Create `src/components/ActionNotice.tsx`:

```tsx
export type NoticeTone = "neutral" | "success" | "error";

export function ActionNotice({
  message,
  tone = "neutral",
  id,
}: {
  message: string | null;
  tone?: NoticeTone;
  id?: string;
}) {
  if (!message) return null;
  return (
    <div
      id={id}
      className={`action-notice action-notice--${tone}`}
      role={tone === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      {message}
    </div>
  );
}
```

Style it as a compact catalogue caption with a non-color status marker.

- [ ] **Step 5: Verify the foundation**

Run:

```bash
npm run build
```

Expected: TypeScript and Vite build pass. Recheck **The collection** at 390×844 and 400×710. Expected: the content scrolls independently, the action footer remains reachable, and no control is covered.

- [ ] **Step 6: Commit**

```bash
git add src/theme.css src/components/ui.tsx src/components/ActionNotice.tsx
git commit -m "Polish the responsive screen foundation"
```

### Task 2: Safe entry, resume, and room-code recovery

**Files:**
- Create: `src/components/ConfirmSheet.tsx`
- Modify: `src/lib/storage.ts:1-105`
- Modify: `src/App.tsx:45-196`
- Modify: `src/screens/Entrance.tsx:5-83`
- Modify: `src/screens/OnlineEntry.tsx:6-78`
- Modify: `src/screens/JoinCode.tsx:1-74`
- Modify: `src/flows/OnlineFlow.tsx:70-190`
- Test: `test/storage.test.ts`
- Test: `test/engine.test.ts`

**Interfaces:**
- Keeps: `loadLastRoom(): LastRoom | null`, but validates the stored shape and code
- Produces: `clearLastRoom(): void`
- Produces: `ConfirmSheet({ title, body, confirmLabel, cancelLabel, tone, onConfirm, onCancel })`
- Consumes: `normalizeRoomCode` and `isValidRoomCode`

- [ ] **Step 1: Write the failing last-room tests**

Create `test/storage.test.ts` with an in-memory `localStorage` shim:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLastRoom,
  loadLastRoom,
  saveLastRoom,
} from "../src/lib/storage";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("last room recovery", () => {
  it("returns a structurally valid room shortcut", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    saveLastRoom("ABCD");
    expect(loadLastRoom()).toEqual({
      code: "ABCD",
      at: 1_000,
    });
  });

  it("normalizes valid codes and clears malformed shortcuts", () => {
    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: "abcd", at: 1_000 }),
    );
    expect(loadLastRoom()).toEqual({ code: "ABCD", at: 1_000 });

    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: "BAD!", at: 1_000 }),
    );
    expect(loadLastRoom()).toBeNull();
    expect(values.has("painter.lastRoom.v1")).toBe(false);

    values.set(
      "painter.lastRoom.v1",
      JSON.stringify({ code: "ABCD", at: "yesterday" }),
    );
    expect(loadLastRoom()).toBeNull();
  });

  it("removes the shortcut explicitly", () => {
    values.set("painter.lastRoom.v1", "{}");
    clearLastRoom();
    expect(values.has("painter.lastRoom.v1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
npx vitest run test/storage.test.ts
```

Expected: FAIL because `clearLastRoom` and the time-aware `loadLastRoom` contract do not exist.

- [ ] **Step 3: Implement validated last-room recovery**

In `src/lib/storage.ts`, import `normalizeRoomCode` and `isValidRoomCode`, then implement:

```ts
export function clearLastRoom(): void {
  try {
    localStorage.removeItem(LAST_ROOM);
  } catch {
    // Storage is optional.
  }
}

export function loadLastRoom(): LastRoom | null {
  const saved = read<LastRoom>(LAST_ROOM);
  const code = normalizeRoomCode(saved?.code ?? "");
  if (
    !saved ||
    !isValidRoomCode(code) ||
    !Number.isFinite(saved.at)
  ) {
    clearLastRoom();
    return null;
  }
  return { code, at: saved.at };
}
```

Do not expire this shortcut from `saved.at`: that timestamp records when this
browser joined, not when the last player left, so applying `ROOM_TTL_MS` locally
would hide rooms that are still active. Validate liveness with the room endpoint
instead.

- [ ] **Step 4: Add the restart confirmation**

Create `ConfirmSheet.tsx` as an `overlay` containing a `role="dialog"` panel. Focus the cancel button when mounted, close on Escape, and expose separate cancel/confirm buttons:

```tsx
export function ConfirmSheet({
  title,
  body,
  confirmLabel,
  cancelLabel = "Keep playing",
  tone = "danger",
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="overlay confirm-overlay">
      <section role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h2 id="confirm-title" className="shout">{title}</h2>
        <p className="body-copy">{body}</p>
        <div className="btn-stack">
          <Btn variant={tone === "danger" ? "red" : "ink"} onClick={onConfirm}>
            {confirmLabel}
          </Btn>
          <button ref={cancelRef} className="btn btn--outline" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
```

Define `ConfirmSheetProps` with `tone?: "danger" | "neutral"` and the callback
types shown in the interface list. Restore focus to the element that opened the
sheet when it closes.

In `App.tsx`, clicking **Pass one phone** while an active saved game exists opens:

```text
Title: Start a new game?
Body: Your current round is saved. Starting over replaces it.
Confirm: Start over
Cancel: Resume saved game
```

Only `onConfirm` calls `clearLocalGame()`.

- [ ] **Step 5: Make room checks truthful**

Update `enterCode` so only a successful response navigates:

```ts
if (res.status === 404) {
  setJoinError("No room with those letters. Check with whoever invited you.");
  return;
}
if (!res.ok) {
  setJoinError("The gallery could not check that room. Try again.");
  return;
}
navigate(`/r/${code}`);
```

When **Play online** opens, probe the stored last room once:

```text
200 → keep the Rejoin shortcut
404 → clearLastRoom() and remove the shortcut
other failure → keep the shortcut and label it “Could not verify — tap to retry”
```

The server is the only source that knows when the last player left. Do not
convert the room's 15-minute empty-room lifetime into a client-side age check.

When `OnlineFlow` reaches a confirmed gone/closed room, call `clearLastRoom()` before rendering the expired-room state.

- [ ] **Step 6: Add a real input path to the room-code screen**

Keep the designed code cells and on-screen keys, but add a labelled input:

```tsx
<input
  className="visually-hidden"
  aria-label="Room code"
  autoCapitalize="characters"
  autoComplete="one-time-code"
  autoCorrect="off"
  spellCheck={false}
  value={code}
  onChange={(event) => setCode(normalizeRoomCode(event.target.value))}
  onKeyDown={(event) => {
    if (event.key === "Enter" && code.length === 4 && !checking) {
      onEnter(code);
    }
  }}
/>
```

Make the code-cell group focus the input when tapped. Use `role="alert"` for lookup errors. This enables typing, paste, switch input, and screen readers without removing the visual keyboard.

- [ ] **Step 7: Run focused and full tests**

Run:

```bash
npx vitest run test/storage.test.ts test/engine.test.ts
npm test
npm run build
```

Expected: all tests and build pass.

- [ ] **Step 8: Browser-check recovery**

At 390×844 verify:

```text
active local save → Pass one phone → confirmation → cancel preserves save
active local save → confirmation → Start over opens retained roster/settings
Play online → Join a room → paste a four-letter code → Enter room
stored room returning 404 → no stale Rejoin card
HTTP room-check failure → stays on code screen with retryable error
```

- [ ] **Step 9: Commit**

```bash
git add src/components/ConfirmSheet.tsx src/lib/storage.ts src/App.tsx src/screens/Entrance.tsx src/screens/OnlineEntry.tsx src/screens/JoinCode.tsx src/flows/OnlineFlow.tsx test/storage.test.ts src/theme.css
git commit -m "Make entry and recovery paths deliberate"
```

### Task 3: Settings hierarchy and accessible host controls

**Files:**
- Create: `src/lib/settingsOptions.ts`
- Create: `src/components/SettingSelect.tsx`
- Modify: `src/screens/DeckSettings.tsx:29-217`
- Modify: `src/screens/HostLobby.tsx:11-270`
- Modify: `src/components/AiSettings.tsx:4-85`
- Modify: `src/theme.css`
- Test: `test/settings-options.test.ts`

**Interfaces:**
- Produces: `SETTING_OPTIONS`
- Produces: `advancedSettingsSummary(settings: Settings, mode: "local" | "online"): string`
- Produces: `SettingSelect<T extends string | number>({ label, value, options, onChange, disabled? })`
- Consumes: `Settings`, `DeckId`, `AiTone`, `PenMode`, `Presence`, `QmMode`

- [ ] **Step 1: Write the failing settings tests**

Create `test/settings-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createRoom } from "../shared/engine";
import {
  SETTING_OPTIONS,
  advancedSettingsSummary,
} from "../src/lib/settingsOptions";

describe("settings presentation", () => {
  const defaults = createRoom({
    code: "",
    mode: "local",
    hostId: "",
  }).settings;

  it("offers every legal setting value once", () => {
    expect(SETTING_OPTIONS.passes.map((option) => option.value)).toEqual([1, 2, 3]);
    expect(SETTING_OPTIONS.pen.map((option) => option.value)).toEqual(["line", "free"]);
    expect(SETTING_OPTIONS.clock.map((option) => option.value)).toEqual([0, 60, 90]);
    expect(SETTING_OPTIONS.tone.map((option) => option.value)).toEqual([
      "witty",
      "savage",
      "absurd",
    ]);
  });

  it("summarizes only non-default advanced choices", () => {
    expect(advancedSettingsSummary(defaults, "local")).toBe("Standard rules");
    expect(
      advancedSettingsSummary(
        { ...defaults, penMode: "free", inkLimit: 60, aiDetective: true },
        "local",
      ),
    ).toBe("Free ink · short ink · detective on");
  });

  it("includes online-only clock and presence choices online", () => {
    expect(
      advancedSettingsSummary(
        { ...defaults, strokeClock: 60, presence: "relaxed" },
        "online",
      ),
    ).toContain("60s clock");
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
npx vitest run test/settings-options.test.ts
```

Expected: FAIL because `settingsOptions.ts` does not exist.

- [ ] **Step 3: Implement typed options and summary**

Create `src/lib/settingsOptions.ts`:

```ts
import type { Settings } from "../../shared/types";

export interface SettingOption<T extends string | number> {
  value: T;
  label: string;
}

export const SETTING_OPTIONS = {
  passes: [
    { value: 1, label: "1 pass" },
    { value: 2, label: "2 passes" },
    { value: 3, label: "3 passes" },
  ],
  pen: [
    { value: "line", label: "One line" },
    { value: "free", label: "Free ink" },
  ],
  ink: [
    { value: 0, label: "Unlimited" },
    { value: 120, label: "Long" },
    { value: 60, label: "Short" },
  ],
  clock: [
    { value: 0, label: "Off" },
    { value: 60, label: "60 seconds" },
    { value: 90, label: "90 seconds" },
  ],
  presence: [
    { value: "strict", label: "Pause 30s" },
    { value: "relaxed", label: "Wait for them" },
  ],
  qm: [
    { value: "rotate", label: "Rotate" },
    { value: "off", label: "Auto word" },
  ],
  tone: [
    { value: "witty", label: "Witty" },
    { value: "savage", label: "Savage" },
    { value: "absurd", label: "Absurd" },
  ],
} as const;
```

Implement `advancedSettingsSummary` from explicit comparisons with the engine defaults; do not infer defaults from label positions.

- [ ] **Step 4: Build the native select component**

Create `src/components/SettingSelect.tsx`:

```tsx
import { useId } from "react";
import type { SettingOption } from "../lib/settingsOptions";

export function SettingSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly SettingOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <label className="setting-select" htmlFor={id}>
      <span className="kicker">{label}</span>
      <select
        id={id}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => {
          const next = options.find(
            (option) => String(option.value) === event.target.value,
          );
          if (next) onChange(next.value);
        }}
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
```

Style the select as catalogue text with a real disclosure indicator; do not disguise it as plain text.

- [ ] **Step 5: Recompose local settings**

In `DeckSettings.tsx`:

- Keep deck, length, and passes above the fold.
- Move pen, ink, question master, and `AiSettings` into:

```tsx
<details className="settings-disclosure">
  <summary>
    <span className="shout">Advanced rules</span>
    <span className="small u-muted">
      {advancedSettingsSummary(settings, "local")}
    </span>
  </summary>
  <div className="settings-disclosure__body">
    {/* pen, ink, question master, AI */}
  </div>
</details>
```

- Disable **Open the round** when the house deck has fewer than `HOUSE_MIN_WORDS`, and label it `House deck needs N more`.
- Keep the footer outside the scroll region.

- [ ] **Step 6: Replace host cycling controls**

Remove `cycleDeck`, `cycleLength`, and the other tap-to-cycle functions from `HostLobby.tsx`. Use `SettingSelect` so a host can inspect and choose an exact value. Keep deck, length, and passes visible; put pen, ink, clock, presence, question master, and AI controls in **Advanced rules**.

Non-host players see the same labelled values as text, not disabled selects.

- [ ] **Step 7: Run tests and browser QA**

Run:

```bash
npx vitest run test/settings-options.test.ts
npm test
npm run build
```

Browser checks:

```text
local 390×844: core settings and Open the round are visible
local 400×710: Advanced rules opens and every control scrolls above the footer
online host: exact values can be selected without cycling through intermediates
online guest: settings are readable but not interactive
house deck under minimum: action explains the exact remaining count
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/settingsOptions.ts src/components/SettingSelect.tsx src/screens/DeckSettings.tsx src/screens/HostLobby.tsx src/components/AiSettings.tsx src/theme.css test/settings-options.test.ts
git commit -m "Clarify local and online game settings"
```

### Task 4: Private hand-offs, drawing feedback, and canvas resilience

**Files:**
- Create: `src/components/HoldPeek.tsx`
- Modify: `src/components/HoldToReveal.tsx:32-98`
- Modify: `src/components/CanvasBoard.tsx:78-265`
- Modify: `src/lib/labels.ts:1-60`
- Modify: `src/screens/DrawTurn.tsx:14-321`
- Modify: `src/screens/Spectate.tsx:41-121`
- Modify: `src/flows/LocalFlow.tsx:401-515`
- Modify: `src/theme.css`
- Test: `test/labels.test.ts`

**Interfaces:**
- Produces: `HoldPeek({ children, revealed, onRevealChange, label })`
- Extends: `CanvasBoardProps` with `ariaLabel: string`
- Produces: `drawingCanvasLabel({ actor, strokeNo, strokeTotal, live }): string`
- Consumes: existing `HoldToReveal`, `ClockChip`, and stroke reducer events

- [ ] **Step 1: Write the failing canvas-label tests**

Create `test/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { drawingCanvasLabel } from "../src/lib/labels";

describe("drawing canvas labels", () => {
  it("describes the active artist and progress", () => {
    expect(
      drawingCanvasLabel({
        actor: "Maya",
        strokeNo: 4,
        strokeTotal: 10,
        live: true,
      }),
    ).toBe("Live drawing canvas. Maya is drawing, stroke 4 of 10.");
  });

  it("describes a player's own canvas without leaking a word", () => {
    expect(
      drawingCanvasLabel({
        actor: "Your",
        strokeNo: 2,
        strokeTotal: 10,
        live: false,
      }),
    ).toBe("Drawing canvas. Your stroke, 2 of 10.");
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run:

```bash
npx vitest run test/labels.test.ts
```

Expected: FAIL because `drawingCanvasLabel` does not exist.

- [ ] **Step 3: Implement the shared canvas label**

Add to `src/lib/labels.ts`:

```ts
export function drawingCanvasLabel({
  actor,
  strokeNo,
  strokeTotal,
  live,
}: {
  actor: string;
  strokeNo: number;
  strokeTotal: number;
  live: boolean;
}): string {
  return live
    ? `Live drawing canvas. ${actor} is drawing, stroke ${strokeNo} of ${strokeTotal}.`
    : `Drawing canvas. ${actor} stroke, ${strokeNo} of ${strokeTotal}.`;
}
```

- [ ] **Step 4: Add keyboard-capable hold-to-peek**

Create `HoldPeek.tsx` using the same pointer/key release discipline as private cards:

```tsx
export function HoldPeek({
  label,
  children,
  onRevealChange,
}: {
  label: string;
  children: ReactNode;
  onRevealChange: (revealed: boolean) => void;
}) {
  const release = () => onRevealChange(false);
  return (
    <button
      type="button"
      className="hold-peek tap-target"
      aria-label={label}
      onPointerDown={() => onRevealChange(true)}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          onRevealChange(true);
        }
      }}
      onKeyUp={release}
      onBlur={release}
    >
      {children}
    </button>
  );
}
```

Replace the two pointer-only `span` controls in `LocalFlow` with `HoldPeek`.

- [ ] **Step 5: Label the canvas and recover lost pointers**

Add a required `ariaLabel` prop to `CanvasBoard`. Render:

```tsx
<div
  className="board"
  ref={boardRef}
  role={drawing ? "application" : "img"}
  aria-label={ariaLabel}
>
```

Listen for `lostpointercapture`; if it belongs to the active pointer, call `finish()` once. Ensure cleanup removes the listener.

Pass labels through `drawingCanvasLabel`:

```text
DrawTurn: "Drawing canvas. Your stroke, 4 of 10."
Spectate: "Live drawing canvas. Maya is drawing, stroke 4 of 10."
Vote: "Finished drawing. Select an artist below to highlight their lines."
Reveal: "Finished round 2 drawing."
```

- [ ] **Step 6: Improve drawing status hierarchy**

In `DrawTurn.tsx`:

- Add `aria-live="polite"` only to the instruction/status sentence, not the timer.
- Keep the word/category in the header, but expose the fake-artist state as `Category · Animals · word unknown`.
- When paused, place a visible `Paused — waiting for a seat` banner above controls.
- Make the grace state read `Stroke ready · commits in N` rather than `Keeping in N`.
- Keep Undo and Commit as distinct 44 px targets.
- Use `.screen-scroll` for compact-height layouts while preserving canvas priority.

- [ ] **Step 7: Verify drawing in both modes**

Run:

```bash
npx vitest run test/labels.test.ts
npm test
npm run build
```

Browser checks:

```text
private card content absent before hold
keyboard Space reveals and keyup hides a private card
local wall peek works with pointer and keyboard without sticking open
line mode: mis-tap → instruction → valid line → undo → redraw → commit
free mode: multiple segments → undo last → ink meter → End turn
online spectator sees live line and current/next/done turn chips
short viewport keeps the canvas and required action reachable
```

- [ ] **Step 8: Commit**

```bash
git add src/components/HoldPeek.tsx src/components/HoldToReveal.tsx src/components/CanvasBoard.tsx src/lib/labels.ts src/screens/DrawTurn.tsx src/screens/Spectate.tsx src/flows/LocalFlow.tsx src/theme.css test/labels.test.ts
git commit -m "Polish private handoffs and drawing feedback"
```

### Task 5: Online connection and presence recovery

**Files:**
- Modify: `src/game/onlineClient.ts:12-251`
- Modify: `src/screens/Disconnect.tsx:9-129`
- Modify: `src/flows/OnlineFlow.tsx:70-190,650-816`
- Modify: `src/screens/JoinerSetup.tsx:8-119`
- Modify: `src/screens/HostLobby.tsx`
- Test: `test/engine.test.ts`

**Interfaces:**
- Extends: `OnlineRoom` with `connectionState: "checking" | "connecting" | "connected" | "reconnecting" | "gone"`
- Extends: `OnlineRoom` with `reconnectAttempt: number`
- Consumes: existing queued authoritative actions and 30-second seat holds

- [ ] **Step 1: Add presence recovery tests**

Extend the existing `describe("disconnects")` block in `test/engine.test.ts`. It
already provides `dealtRound()` and `apply()`:

```ts
it("tracks multiple held seats and releases only the returning seat", () => {
  let state = dealtRound();
  state = apply(state, {
    type: "SET_CONNECTED",
    playerId: "p3",
    connected: false,
    now: 1_000,
  });
  state = apply(state, {
    type: "SET_CONNECTED",
    playerId: "p4",
    connected: false,
    now: 2_000,
  });
  expect(Object.keys(state.holds).sort()).toEqual(["p3", "p4"]);

  state = apply(state, {
    type: "SET_CONNECTED",
    playerId: "p3",
    connected: true,
    now: 5_000,
  });
  expect(state.holds.p3).toBeUndefined();
  expect(state.holds.p4).toBe(32_000);
  expect(state.round!.droppedIds).toEqual([]);
});
```

Keep the existing `dropping the fake artist is refused — the round must be
voided instead` test unchanged; it is the scoring/privacy invariant the new
confirmation copy explains.

- [ ] **Step 2: Run the focused tests**

Run:

```bash
npx vitest run test/engine.test.ts
```

Expected: PASS, documenting the invariants the UI must explain.

- [ ] **Step 3: Expose explicit client connection state**

In `onlineClient.ts`, track:

```ts
type ConnectionState =
  | "checking"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "gone";

const [connectionState, setConnectionState] =
  useState<ConnectionState>("checking");
const [reconnectAttempt, setReconnectAttempt] = useState(0);
```

State transitions:

```text
initial room probe → checking
probe accepted, socket not open → connecting
socket open → connected, attempt 0
unexpected socket close → reconnecting, attempt +1
confirmed 404 or closed-room error → gone
```

Keep outbox behavior unchanged. Never report queued input as accepted before the server broadcasts it.

- [ ] **Step 4: Make reconnect and holds action-oriented**

Update `ReconnectingBanner` to accept `attempt`:

```text
attempts 1–3: Connection lost · reconnecting…
attempts 4+: Still reconnecting · your seat and locked actions are being held
```

Add `role="status"` and `aria-live="polite"`.

In `DisconnectOverlay`:

- Change **Carry on without Maya** to **Drop Maya and continue**.
- Add `aria-describedby` pointing to the consequence note.
- If the held player is the fake artist, state before the action: `Dropping the fake voids this round and deals fresh cards.`
- If multiple seats are held, show `and N more seats held` instead of silently displaying only the first.

- [ ] **Step 5: Make join and lobby connection state truthful**

`JoinerSetup` should say:

```text
Checking room…
Connecting…
Connected
Reconnecting — your name is still here
Room closed
```

Disable **I'm ready** unless `connectionState === "connected"`.

Host lobby player rows must use both text and symbol for `live`, `seat held`, and `away`; color alone is insufficient.

- [ ] **Step 6: Verify online recovery**

Run:

```bash
npm test
npm run build
```

Browser flow with separate seat tabs:

```text
host + four players join
close one player tab during dealing → seat-hold overlay
reopen before 30s → seat restored and game resumes
close current drawer → host sees explicit drop consequence
drop a real artist → schedule continues without phantom turn
drop fake artist → round voids and re-deals
stop/restart local Worker → reconnect banner → same seat restores
```

- [ ] **Step 7: Commit**

```bash
git add src/game/onlineClient.ts src/screens/Disconnect.tsx src/flows/OnlineFlow.tsx src/screens/JoinerSetup.tsx src/screens/HostLobby.tsx test/engine.test.ts
git commit -m "Make online recovery states explicit"
```

### Task 6: Deliberate ballots, guessing, and reveal pacing

**Files:**
- Modify: `src/screens/Vote.tsx:11-142`
- Modify: `src/screens/Guess.tsx:10-118`
- Modify: `src/screens/Tally.tsx:8-86`
- Modify: `src/screens/CriticVerdict.tsx:14-252`
- Modify: `src/screens/RenditionReveal.tsx:11-145`
- Modify: `src/screens/Reveal.tsx:82-267`
- Modify: `src/lib/revealSequence.ts:13-64`
- Modify: `src/theme.css`
- Test: `test/ai-state.test.ts`
- Test: `test/engine.test.ts`

**Interfaces:**
- Consumes: `ConfirmSheet`
- Keeps: `useRevealSequence` public interface unchanged
- Consumes: existing AI branch statuses and official reducer outcomes

- [ ] **Step 1: Add outcome and AI degradation coverage**

In `test/engine.test.ts`, add this helper beside the voting tests and then the
immutability case:

```ts
function caughtGuessingRound(): RoomState {
  let state = drawAll(dealtRound());
  for (const voter of ["p1", "p2", "p3", "p4", "p5", "p6"]) {
    state = apply(state, {
      type: "CAST_VOTE",
      voterId: voter,
      targetId: voter === "p1" ? "p2" : "p1",
      now: 1_000,
    });
  }
  return state;
}

it("a submitted guess is immutable once the outcome is set", () => {
  const revealed = apply(caughtGuessingRound(), {
    type: "SUBMIT_GUESS",
    playerId: "p1",
    text: "penguin",
    matched: true,
  });
  expect(
    reduce(revealed, {
      type: "SUBMIT_GUESS",
      playerId: "p1",
      text: "otter",
      matched: false,
    }),
  ).toEqual({ ok: false, error: "Not guessing" });
});
```

In `test/ai-state.test.ts`, use its existing `votingRoom`, `apply`, and
`JOB_ID` helpers:

```ts
it("failed critic and ready rendition settle independently", () => {
  const pending = apply(
    votingRoom({ aiCritic: true, aiDetective: true }),
    { type: "START_ROUND_AI", roundNo: 1, jobId: JOB_ID },
  );
  const failedCritic = apply(pending, {
    type: "FAIL_ROUND_CRITIC",
    roundNo: 1,
    jobId: JOB_ID,
  });
  const readyRendition = apply(failedCritic, {
    type: "RESOLVE_ROUND_RENDITION",
    roundNo: 1,
    jobId: JOB_ID,
    renditionId: JOB_ID,
  });
  expect(readyRendition.round!.ai).toMatchObject({
    criticStatus: "unavailable",
    renditionStatus: "ready",
  });
});
```

Use existing test fixtures and exact stable reducer errors.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run test/engine.test.ts test/ai-state.test.ts
```

Expected: PASS.

- [ ] **Step 3: Improve ballot semantics**

In `Vote.tsx`:

- Add `aria-pressed={selected}` to eligible candidate buttons.
- Give the finished drawing button `aria-label`.
- Add a polite status line: `Selected Maya. Review the highlighted lines, then lock the ballot.`
- Keep the existing two-step choose → lock pattern.
- After locking online, the waiting screen must say `Ballot sealed · N of M in` and never expose the target.

- [ ] **Step 4: Confirm the one official guess**

In `Guess.tsx`, clicking the submit button or pressing Enter opens `ConfirmSheet`:

```text
Title: Submit “PENGUIN”?
Body: This is the fake artist’s only guess. It cannot be changed.
Confirm: Submit one guess
Cancel: Keep thinking
```

Do not call `onSubmit` until confirmation. Keep the countdown visible behind the sheet and allow timeout to win if it expires.

Guard duplicate activation locally:

```ts
const [submitted, setSubmitted] = useState(false);
const submit = () => {
  if (submitted) return;
  setSubmitted(true);
  onSubmit(text.trim());
};
```

- [ ] **Step 5: Make tally and AI motion respectful**

- Add `aria-label`/`aria-valuenow` to tally bars.
- Under `prefers-reduced-motion`, render tally widths immediately and remove transitions.
- Add `aria-busy={status === "pending"}` to Luna and rendition pending containers.
- Add a **Try image again** control when a ready rendition URL fails to decode; retry resets `imageFailed` and increments a local retry key without restarting AI.
- Keep **Skip her — the attribution** and **Skip ahead — standings** visible while pending.

- [ ] **Step 6: Strengthen official-result hierarchy**

In `Reveal.tsx`:

- Keep the official word/outcome above the AI comparison.
- Label the score block `Official score`.
- Change AI comparison kicker to `Luna's non-scoring opinion`.
- Put save status through `ActionNotice`; do not leave a failed save silent.
- On compact screens, official outcome and next action must appear before optional save.

- [ ] **Step 7: Verify reveal branches**

Run:

```bash
npm test
npm run build
```

Browser checks for local and online:

```text
vote selected → highlighted lines → Lock in Maya → sealed wait
guess Enter → confirmation, not immediate submission
guess confirmation cancel → input retained and timer continues
survived → official result → standings
caught and correct → official result → standings
caught and wrong → official result → standings
critic pending → skip → attribution → late-result chip
critic unavailable + rendition ready → both screens remain coherent
rendition image load failure → retry or skip; standings always reachable
reduced motion → no stagger/tally/count-up delay blocks content
```

- [ ] **Step 8: Commit**

```bash
git add src/screens/Vote.tsx src/screens/Guess.tsx src/screens/Tally.tsx src/screens/CriticVerdict.tsx src/screens/RenditionReveal.tsx src/screens/Reveal.tsx src/lib/revealSequence.ts src/theme.css test/engine.test.ts test/ai-state.test.ts
git commit -m "Make ballots and reveal states deliberate"
```

### Task 7: Observable copy, share, publish, and archive actions

**Files:**
- Create: `src/lib/actionResult.ts`
- Modify: `src/lib/share.ts:138-173`
- Modify: `src/screens/HostLobby.tsx:73-160`
- Modify: `src/screens/Reveal.tsx`
- Modify: `src/screens/Final.tsx:15-213`
- Modify: `src/screens/ArchivePage.tsx:23-110`
- Test: `test/action-result.test.ts`
- Test: `test/archives.test.ts`

**Interfaces:**
- Produces: `type ActionResult = "done" | "cancelled" | "unavailable" | "failed"`
- Produces: `copyText(text, clipboard?): Promise<ActionResult>`
- Produces: `shareLink(data, share?): Promise<ActionResult>`
- Changes: `shareOrDownload(blob, filename): Promise<ActionResult>`
- Consumes: `ActionNotice`

- [ ] **Step 1: Write failing action-helper tests**

Create `test/action-result.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { copyText, shareLink } from "../src/lib/actionResult";

describe("browser action results", () => {
  it("reports copied text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    await expect(copyText("room", { writeText })).resolves.toBe("done");
    expect(writeText).toHaveBeenCalledWith("room");
  });

  it("reports an unavailable clipboard", async () => {
    await expect(copyText("room", undefined)).resolves.toBe("unavailable");
  });

  it("distinguishes share cancellation from failure", async () => {
    const cancelled = vi.fn().mockRejectedValue(
      new DOMException("cancelled", "AbortError"),
    );
    await expect(shareLink({ title: "Game", url: "/r/ABCD" }, cancelled))
      .resolves.toBe("cancelled");

    const failed = vi.fn().mockRejectedValue(new Error("blocked"));
    await expect(shareLink({ title: "Game", url: "/r/ABCD" }, failed))
      .resolves.toBe("failed");
  });
});
```

- [ ] **Step 2: Run the helper tests to verify failure**

Run:

```bash
npx vitest run test/action-result.test.ts
```

Expected: FAIL because the helper module does not exist.

- [ ] **Step 3: Implement explicit action results**

Create `src/lib/actionResult.ts` with injected adapters:

```ts
export type ActionResult =
  | "done"
  | "cancelled"
  | "unavailable"
  | "failed";

export async function copyText(
  text: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined =
    navigator.clipboard,
): Promise<ActionResult> {
  if (!clipboard) return "unavailable";
  try {
    await clipboard.writeText(text);
    return "done";
  } catch {
    return "failed";
  }
}

export async function shareLink(
  data: ShareData,
  share: Navigator["share"] | undefined = navigator.share?.bind(navigator),
): Promise<ActionResult> {
  if (!share) return "unavailable";
  try {
    await share(data);
    return "done";
  } catch (error) {
    return error instanceof DOMException && error.name === "AbortError"
      ? "cancelled"
      : "failed";
  }
}
```

Update `shareOrDownload` to return an `ActionResult`. A cancelled native share returns `cancelled`; it must not unexpectedly trigger a download. A missing share capability still downloads and returns `done`.

- [ ] **Step 4: Add host-lobby feedback**

Replace silent `copy` and `shareSheet` catches with action results and `ActionNotice`:

```text
Room link copied
Spectator link copied
Sharing cancelled
Sharing is not available — copy the link instead
Could not copy — select the visible URL
```

Hide **Share sheet** when `navigator.share` is unavailable; keep the visible URL and copy button.

- [ ] **Step 5: Separate final publishing from sharing**

`Final.publish()` should only publish. After success render:

```text
Published
[Copy archive link]
[Share archive]
visible archive URL
```

Do not automatically open the operating-system share sheet. Use `ActionNotice` for copy/share/save outcomes. Keep **Same crowd, again** the primary action.

- [ ] **Step 6: Distinguish archive missing from temporary failure**

Change `ArchivePage` status:

```ts
type ArchiveLoadStatus = "loading" | "ok" | "missing" | "error";
```

Behavior:

```text
404 → missing, explain one-year retention, entrance action
other non-2xx or fetch failure before first load → error, Retry + entrance actions
poll failure after a successful load → keep existing archive visible and retry quietly
```

Do not describe a server/network failure as a missing archive.

- [ ] **Step 7: Run tests and browser QA**

Run:

```bash
npx vitest run test/action-result.test.ts test/archives.test.ts
npm test
npm run build
```

Browser checks:

```text
host Copy link → visible success
host Copy spectator link → distinct success
cancel Share sheet → no download and no error
publish success → URL visible; copy/share are separate
publish failure → finished game remains; retry works
save drawing/contact sheet → completion or actionable failure
archive 404 → missing
archive 500/offline → temporary error with Retry
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/actionResult.ts src/lib/share.ts src/screens/HostLobby.tsx src/screens/Reveal.tsx src/screens/Final.tsx src/screens/ArchivePage.tsx src/components/ActionNotice.tsx test/action-result.test.ts test/archives.test.ts
git commit -m "Make sharing and archive actions observable"
```

### Task 8: Roster, standings, and final visual consistency

**Files:**
- Modify: `src/screens/Roster.tsx:50-135`
- Modify: `src/screens/HouseWords.tsx:34-91`
- Modify: `src/screens/Standings.tsx:8-73`
- Modify: `src/screens/Final.tsx`
- Modify: `src/screens/ArchivePage.tsx`
- Modify: `src/theme.css`
- Modify: `design/catalogue-full-flows.html`

**Interfaces:**
- Consumes: shared `.tap-target`, `.screen-scroll`, `.action-footer`, and notice components
- Produces no new game-state interface

- [ ] **Step 1: Fix small-action semantics**

In `Roster.tsx`:

```tsx
<button
  className="tap-target roster-action"
  disabled={i === 0}
  aria-label={`Move ${p.name} up`}
  onClick={() => move(p.id, -1)}
>
  ↑
</button>
```

Use real `disabled` attributes for first/last reorder actions, make remove a 44 px target, and connect roster errors to the input with `aria-describedby`.

In `HouseWords.tsx`, make add/remove buttons 44 px targets and announce pot count changes with a polite status.

- [ ] **Step 2: Clarify rankings and ties**

In `Standings.tsx` and `Final.tsx`:

- Compute tied rank display without changing the existing stable score order.
- Mark the leader/winner with text (`Leader`, `Winner`), not red alone.
- Keep player color swatches and score columns aligned.
- Add an accessible label to every archive drawing action, including word and round.

Use competition ranks:

```ts
const rankFor = (player: Player): number =>
  ranked.findIndex((candidate) => candidate.score === player.score) + 1;

const rank = rankFor(player);
```

Do not invent a tie-breaker.

- [ ] **Step 3: Consolidate touched inline styles**

Move repeated action rows, settings rows, score rows, archive labels, and compact headers into named CSS classes. Do not refactor untouched screen-specific art direction.

Delete superseded declarations and confirm no duplicate reduced-motion block contradicts the final behavior.

- [ ] **Step 4: Update the visual catalogue**

Update only the affected panels in `design/catalogue-full-flows.html`:

```text
A1 entry with resume/start-over protection
A2 roster with proper disabled actions
A3 core + Advanced rules settings
C1 ballot selected/locked treatment
C3 guess confirmation
C6 separate publish/copy/share actions
D2 host lobby with select controls and action notice
D6 reconnect/seat-hold consequence copy
```

Keep the catalogue notes truthful about actual behavior.

- [ ] **Step 5: Run static and rendered checks**

Run:

```bash
git diff --check
npm test
npm run build
```

Browser-check the affected screens at 390×844, 400×710, and desktop. Expected: no clipped content, accidental wrapping, undersized controls, color-only status, or mismatched catalogue copy.

- [ ] **Step 6: Commit**

```bash
git add src/screens/Roster.tsx src/screens/HouseWords.tsx src/screens/Standings.tsx src/screens/Final.tsx src/screens/ArchivePage.tsx src/theme.css design/catalogue-full-flows.html
git commit -m "Finish the game-wide visual consistency pass"
```

### Task 9: Complete end-to-end verification

**Files:**
- Modify if findings require it: files already named in Tasks 1–8
- Modify: `README.md` only if final behavior differs from current user-facing documentation
- Verify: `docs/superpowers/specs/2026-07-25-end-to-end-game-polish-design.md`

**Interfaces:**
- Consumes: all previous tasks
- Produces: a verified local and online player journey with a final findings ledger

- [ ] **Step 1: Run the complete automated gate**

Run:

```bash
git diff --check
npm test
npm run build
```

Expected:

```text
all Vitest files pass
application and Worker TypeScript pass
Vite production build passes
no tracked generated artifact changes
```

- [ ] **Step 2: Complete a local game**

Use the in-app Browser at 390×844:

```text
entry
five-player roster
settings
question master
all private cards
all drawing turns for one-pass test room
all secret ballots
guess branch when caught
critic pending/skip or disabled path
official reveal
rendition pending/skip or disabled path
standings
close exhibition
publish/save fallback
same crowd again
```

Collect page identity, meaningful DOM, console logs, one interaction proof per stage, and screenshots for entry, settings, drawing, ballot, official reveal, and final.

- [ ] **Step 3: Complete an online game**

Run the Vite app and local Worker. Use separate tabs with `?seat=2`, `?seat=3`, `?seat=4`, and `?seat=5`:

```text
host creates room
four players join
spectator opens /w/CODE
host changes settings and locks room
cards dealt privately
live drawing observed in other tabs
ballots remain sealed
disconnect/reconnect exercised once
official reveal and standings visible to all
host advances and closes the game
same crowd again preserves settings
```

Verify no model-visible or spectator DOM contains a private word before official reveal.

- [ ] **Step 4: Check responsive and accessibility states**

At 400×710 and desktop:

```text
entry
populated roster
local settings with Advanced rules open
host lobby with 12-player-length names
drawing with timer and ink meter
vote with enlarged drawing
long Luna title/review
rendition image failure
12-player standings
seven-round archive
confirmation and error overlays
```

Keyboard-only path:

```text
entry → roster → settings
hold-to-reveal with Space
hold-to-peek with Space
join-code paste and Enter
ballot select and lock
guess confirmation cancel/confirm
overlay Escape closes only cancellable sheets
```

Check `prefers-reduced-motion`, visible focus, `role="status"`/`role="alert"` output, and relevant browser console warnings/errors.

- [ ] **Step 5: Write and clear the final findings ledger**

Before completion, record each issue in this shape:

```text
Journey stage | viewport/state | player-visible problem | fix | evidence
```

Fix every in-scope issue that would receive a design or game-night usability comment. Any remaining item must name a concrete blocker and explain why it is outside the approved pass.

- [ ] **Step 6: Re-run the gate after final fixes**

Run:

```bash
git diff --check
npm test
npm run build
git status --short
```

Expected: all checks pass and the status contains only intentional polish changes.

- [ ] **Step 7: Close verification cleanly**

If browser QA found a defect, return to the task that owns that journey stage,
add a focused regression test where possible, repeat that task's verification,
and commit the exact files there. If no defect remains, do not create an empty
“verification” commit.

Finish with:

```bash
git status --short
git log --oneline -10
```

Expected: only intentional files remain, every implementation task has a
focused commit, and the final gate ran against the exact checked-in behavior.

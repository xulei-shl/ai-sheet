# Auto-Scroll-to-Bottom in Chat Message List

## Context

The current auto-scroll in `MessageList.tsx` is broken for three reasons:
1. **Wrong ref target**: `containerRef` is on an inner div that does NOT scroll. The actual scrollable container is the parent `overflow-auto` div in `AgentChatPanel.tsx`.
2. **Smooth scroll flooding**: Every `agent_delta` creates a new `messages` array reference, firing `useEffect([messages])` with `behavior: 'smooth'` — causing competing animation queue buildup and jank.
3. **No fallback**: If the user scrolls up during streaming, there's no way to jump back to the bottom.

## Approach: Lift scroll logic to AgentChatPanel

Move the scroll ref, auto-scroll effect, and floating button to `AgentChatPanel.tsx` where the actual scroll container lives. MessageList becomes a pure rendering component.

## Changes

### 1. `AgentChatPanel.tsx` — Add scroll state, effect, and floating button

- Add `useRef`, `useCallback` to React import; add `ArrowDown` to lucide import
- Add state: `scrollContainerRef`, `isNearBottom` (state), `isNearBottomRef` (ref mirror for effect reads without stale closures)
- Add `handleScroll` callback: checks if within 80px of bottom, updates both ref and state
- Add auto-scroll effect on `[messages, agentStreamingRequestId]`:
  - During streaming (`agentStreamingRequestId !== null`): use `behavior: 'instant'` to avoid animation queue buildup
  - Not streaming (e.g. new user message): use `behavior: 'smooth'`
  - Respect `prefers-reduced-motion`: always use `'instant'`
  - Guard with `isNearBottomRef.current` — skip if user scrolled up
- Add clear-messages reset effect: when `messages.length === 0`, reset `isNearBottom` to `true`
- Attach `ref={scrollContainerRef}`, `onScroll={handleScroll}`, `className="relative ..."` to the scroll container div
- Add floating "scroll to bottom" button inside the scroll container:
  - Position: `absolute bottom-3 right-3 z-10`
  - Visible only when `!isNearBottom`
  - Circular (`rounded-full`), with shadow and border
  - On click: smooth scroll to bottom + update state
  - Styled with `var(--surface)`, `var(--border)`, `var(--muted)`

### 2. `MessageList.tsx` — Remove broken scroll logic

- Remove `useEffect`, `useRef` from imports (keep `useState`)
- Remove `containerRef` and `userInteractingRef` declarations
- Remove both scroll-related `useEffect`s (scroll listener + auto-scroll)
- Remove `ref={containerRef}` from the container div
- Keep `agentStreamingRequestId` in the store subscription (still needed for `isWaitingForResponse`)

## Verification

1. Open the Agent chat panel and send a message
2. During streaming: the view should auto-follow the latest content smoothly (no jank)
3. Scroll up during streaming: auto-scroll stops, floating arrow button appears
4. Click the floating button: scrolls smoothly to the bottom, button disappears
5. After streaming ends while at bottom: no floating button visible
6. Clear conversation: floating button should not appear on empty state

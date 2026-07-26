# End-to-End Game Polish Design

**Date:** 2026-07-25  
**Status:** Approved for implementation planning

## Context

The Uninvited Painter is already a complete, visually distinctive party game.
It supports pass-one-phone local play and room-based online play through the
same deterministic game engine. Its established art direction is an editorial
gallery system built from warm paper, black ink, a restrained red accent,
heavy display type, and deliberate high-contrast reveal states.

This pass will polish the game as one continuous player journey. It will give
local and online play equal attention, retain the existing identity and rules,
and permit small additions when they close a concrete usability, feedback,
recovery, or accessibility gap.

## Goals

- Make both modes understandable and dependable from entry through replay.
- Remove confusing transitions, stranded states, accidental round-advancing
  actions, and visually unfinished responsive states.
- Make local and online play feel like two delivery methods for the same game.
- Tighten the visual and interaction systems without diluting the current art
  direction.
- Improve code boundaries when doing so directly supports player experience,
  consistency, testability, or reliability.
- Ensure optional AI and publishing features degrade without blocking the
  human game.

## Non-goals

- A new visual identity or broad redesign.
- New scoring rules, roles, round types, decks, or other game systems.
- Replacing the shared deterministic reducer or the server-authoritative
  online model.
- Unrelated architecture refactors.
- Making Luna or the generated rendition part of official scoring.

## Product principles

1. **The table stays central.** The interface should explain and coordinate the
   game without drawing attention away from the people playing it.
2. **Private moments are unmistakable.** Hand-offs, role cards, secret words,
   and sealed votes must resist accidental disclosure.
3. **Progress is always legible.** A player should understand whose turn it is,
   what is expected, what is locked, and what happens next.
4. **Drama stays brisk.** Dealing and reveal sequences may create suspense, but
   repeated play should not become laborious.
5. **The human game always wins.** Networking, AI, publishing, and sharing may
   fail or run late without blocking official play.
6. **Parity does not mean false sameness.** Shared stages should use consistent
   language and hierarchy, while local hand-offs and online connection states
   retain the controls their contexts require.

## Player journey

### Entry and recovery

- Make local and online choices immediately understandable.
- Preserve clear access to rules without interrupting an active game.
- Clarify resume and rejoin behavior before the player commits to it.
- Give room creation, room lookup, invalid codes, missing rooms, offline
  conditions, and stale saved state concise explanations and immediate
  recovery actions.

### Setup

- Make roster creation, ordering, validation, and progression easy on a phone.
- Make room sharing and joining legible to both hosts and guests.
- Give deck, pass, round, pen, timer, away-player, question-master, and AI
  settings clear hierarchy and truthful descriptions.
- Keep common choices prominent and progressively disclose advanced options.
- Preserve useful settings and roster continuity when replaying.

### Private information

- Make hand-off instructions and ownership unambiguous.
- Preserve hold-to-reveal behavior and keep private content out of view until
  the intended player actively reveals it.
- Keep real-artist and fake-artist cards structurally consistent enough to
  avoid leaking a role at a distance.
- Protect question-master and round-start transitions from accidental advance.

### Drawing

- Give the canvas visual and touch priority.
- Make current drawer, pass, stroke, timer, and ink-budget status readable
  without competing with the drawing.
- Provide immediate touch, completion, timeout, observer, and waiting feedback.
- Keep local hand-offs and online turn ownership clear.
- Handle disconnect, away-player, pause, and resumed-turn states without
  creating ambiguity about whose action is required.

### Voting and guessing

- Make selectable, selected, locked, waiting, and complete ballot states
  distinct.
- Explain sealed votes and ties without exposing information early.
- Protect irreversible vote and guess actions from accidental submission.
- Make the fake artist's final guess tense but mechanically obvious, including
  deadline and timeout behavior.

### Reveal and AI exhibition

- Keep the sequence understandable: Luna's ornamental verdict, official
  attribution and scoring, optional original/rendition comparison, then
  standings.
- Make official results visually dominant over AI output.
- Make critic and rendition pending, success, partial-success, timeout, and
  failure states feel intentional.
- Never let AI work delay voting, scoring, advancing, replaying, or leaving.
- Keep reveal pacing dramatic on first viewing and reasonable over repeated
  rounds.

### Standings and replay

- Make the round result, awarded points, totals, leader, and final winner easy
  to distinguish.
- Keep publishing, sharing, and archive outcomes clear without overshadowing
  replay.
- Preserve the roster and settings when starting again.
- Provide an unambiguous route back home.

## Visual and interaction system

### Visual language

- Retain warm paper, black ink, restrained red, heavy display type, square
  geometry, and high-contrast private/reveal states.
- Consolidate typography, spacing, borders, colors, elevation, and responsive
  measurements into shared tokens.
- Remove accidental inconsistencies while preserving deliberate exceptions for
  secrecy, the drawing canvas, and reveal drama.

### Screen anatomy

- Standardize the mobile screen around a status/header region, primary content
  region, and bottom action region.
- Account for device safe areas, compact heights, software keyboards, and
  enlarged text.
- Let secrecy, canvas space, or reveal choreography break the standard anatomy
  only when the exception improves the game.

### Interaction language

- Standardize primary, secondary, destructive, disabled, pressed, loading,
  selected, locked, and completed states.
- Give every important action immediate visible feedback.
- Match confirmation strength to consequence: routine reversible actions stay
  fast, while leaving, discarding, publishing, or advancing an official state
  receives appropriate protection.
- Use motion to clarify transitions and results, and honor reduced-motion
  preferences.

### Accessibility

- Maintain usable contrast and avoid color-only status communication.
- Use touch targets approximately 44 CSS pixels or larger for primary controls.
- Provide visible focus, semantic labels, logical focus movement, and sensible
  keyboard behavior.
- Keep essential content readable on compact screens and with enlarged text.
- Ensure drawing and time-limited states expose equivalent textual status.

## Architecture and boundaries

- The shared reducer remains the source of truth for phase changes, scoring,
  turn order, and legal game events.
- The Durable Object remains authoritative for online rooms, private data,
  ballots, clocks, connectivity, and event validation.
- UI components may derive display state but may not reproduce scoring or
  authorization rules.
- Local and online flows should share labels, phase-specific presentation
  helpers, and components only when their behavior and privacy boundaries are
  genuinely the same.
- Local persistence should remain recoverable and version-tolerant. Invalid or
  stale state should fail into a usable entry path rather than a blank or
  broken game.
- Refactors should remove duplication, stale branches, inconsistent labels, or
  oversized responsibilities only when encountered in the approved journey.

## Error and degradation model

Every recoverable failure should answer three questions in plain language:
what happened, whether game state is safe, and what the player can do next.

- Room creation and joining failures stay on the current entry step with retry
  or correction available.
- Connection loss distinguishes waiting, reconnecting, seat-held, and expired
  states without pretending the player is still live.
- A missing browser capability uses a supported fallback when available and
  explains the limitation otherwise.
- Sharing and clipboard failures provide a copyable or otherwise actionable
  fallback.
- Publishing failure keeps the finished game and permits retry.
- Critic and rendition branches settle independently. Either may succeed,
  fail, or time out without blocking official results.
- Unexpected client errors should avoid exposing private round information and
  should preserve a safe route home or back into the room.

## Small-addition rule

A new control, state, or behavior belongs in this pass only when it:

1. closes an observed gap in feedback, recovery, accessibility, or progression;
2. does not change the rules or introduce a new game system;
3. can be explained and tested as part of an existing journey stage; and
4. is simpler than leaving the player to infer or work around the problem.

## Validation strategy

### Full-flow browser checks

- Complete a local game from fresh entry through replay.
- Complete an online game across separate host, player, and spectator browser
  sessions.
- Exercise room sharing, joining, sealed voting, reveal, publishing, replay,
  disconnect, reconnect, and away-player behavior.
- Check a representative phone viewport, a compact/short phone viewport, and a
  desktop viewport. Include safe-area, keyboard, and enlarged-text checks where
  the browser permits them.
- Capture key-state screenshots and compare hierarchy, typography, spacing,
  actions, and responsive behavior against the established flow catalogue.
- Review browser console errors and warnings throughout the exercised paths.

### Optional and failure states

- Exercise critic and rendition pending, success, partial-success, timeout, and
  failure independently.
- Exercise invalid and missing room codes, network loss, host absence, stale
  local persistence, abandoned actions, publishing failure, and share fallback.
- Confirm that optional failures never block voting, scoring, advancing,
  replaying, or leaving.

### Automated checks

- Add focused reducer, protocol, persistence, or recovery tests for behavior
  changed by the pass.
- Add focused component or browser coverage when visual state alone cannot
  prove a consequential interaction.
- Run the complete test suite, application and Worker type checks, production
  build, and existing project quality gates before completion.

## Acceptance criteria

The pass is complete when:

- local and online games can each be completed from entry through replay;
- every phase makes the current actor, required action, progress, and next
  transition understandable;
- private information is not exposed by idle, hand-off, observer, reconnect,
  or error states;
- no exercised path produces a stranded state, relevant console error, or
  accidental official action;
- AI, publishing, sharing, connection, and persistence failures have actionable
  degradation paths;
- primary controls are accessible and usable on compact mobile screens;
- the visual system is consistent without flattening intentional dramatic
  states;
- automated tests and production builds pass; and
- any remaining limitation is documented as intentional and outside this
  pass, rather than silently left unfinished.

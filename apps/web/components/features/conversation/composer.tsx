'use client'

// UI clone plan Đợt 2 Phase K — real values from example-2's own `#send-form`/
// `#text-input` CSS (read in full for this pass): floating rounded card
// (22px radius, same radius language as the message bubble), textarea on
// its own full-width row on top, actions row below — not the old side-by-side
// layout. Auto-grows with content (`scrollHeight`, capped ~10 lines via
// `max-height`), no border/outline in any state (their own real choice,
// "border input là ko cần thiết cho input chat").
//
// `large` (Đợt 8) — matches example-2's real `.fh-conversation-empty
// #send-form`/`#text-input` rules (centered welcome composer: less bottom
// margin since it's vertically centered instead of bottom-docked, bigger
// font, ~3-line starting height) instead of always rendering the normal
// bottom-docked size regardless of whether the conversation has started.
//
// Đợt 9 — the Stop button (interruptSession/dsh-agent cancel) was removed
// on request ("bỏ nút dừng trong khung chat"); Phase J/Đợt 2's own earlier
// note called it a deliberate keep since example-2 has no equivalent at
// all — that was true then, but the user now wants it gone regardless.
//
// Đợt 20 — re-added, now split into 2 real dsh-agent capabilities instead
// of 1 (user request: "tham khảo logic ... dsh hay claude", matching
// Claude Code's own stop-then-resume feel): "Dừng" calls /session-interrupt
// with `keepInbox: true` (dsh-agent's own CancelOptions — "aborts only the
// turn and preserves pending items") and flips to a "Tiếp tục" button;
// "Huỷ bỏ task" calls the same route without it (the original hard cancel,
// also clears queued/steering work — nothing left to offer continuing).
// dsh-session's own TurnEndReasonMap documents there is no "paused mid-turn,
// resume the exact request" primitive ("no step-only abort that keeps the
// turn running"), so "Tiếp tục" is implemented honestly as sending a plain
// follow-up message through the SAME `send` mutation as a normal Send —
// transparent in the chat log (a real "Tiếp tục" bubble appears), not a
// hidden resume the user can't see happened.
//
// Merged with a parallel branch (2026-09-19, a colleague's own independent
// Stop-button work) that landed the same day: kept this branch's 3-state
// Dừng/Tiếp tục/Huỷ bỏ task flow (more deliberate — those 2 only ever
// appear after Dừng is pressed, not alongside it) and its
// latestTurnStartSeq workaround for the confirmed real dsh-agent-loop bug
// where a cancelled turn never gets a `turn/end` — but adopted their
// `RunStatus` addition (live "thinking…"/tool-name/elapsed-time row,
// `runningState()` in conversation.tsx), which this branch didn't have.
// `RunStatus` is fed the workaround-corrected `running`, not the raw
// `run.running`, or its own elapsed-time display would get stuck exactly
// the same way the button would have.
//
// Đợt 17 — the "/" skill picker (user request: "khi chat / ko hiện ra các
// option skill"). Ported from example-2's real SkillMenu.tsx/slashQuery —
// SettingsDialog/SkillsDialog's own copy already promised this ("Gõ /tên
// trong ô chat để dùng") but nothing in the composer ever implemented it.
// No backend work needed: `@deepseek-ai/dsh-tool-skill`'s own README
// documents a real, already-mounted feature — "Users can invoke a skill
// with /name" (a whitespace-bounded token anywhere in a user message) — this
// is purely the missing autocomplete UI on top of an already-working
// backend gesture. Reuses the SAME `['skills']` react-query cache
// skills-dialog.tsx already populates/invalidates, instead of porting
// example-2's own separate skillsApi.ts pub/sub cache — this app already
// has one shared cache mechanism, no need for a second.
import { useEffect, useRef, useState } from 'react'
import { Ban, Square } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { interruptSession, listSkills, sendMessage, type SkillSummary } from '../../../lib/api'
import { useChatStore } from '../../../lib/store'
import { latestTurnStartSeq, runningState } from './conversation'
import { RunStatus } from './run-status'
import { useLocale } from '../../../lib/i18n/locale'
import { Button } from '../../primitives/button'

// The menu is open only while the whole composer text is still the bare
// command token — matches example-2's own real slashQuery exactly (same
// regex, same "whole-message" restriction on when the MENU shows; the
// backend gesture itself scans the whole sent message, not just this).
function slashQuery(text: string): string | undefined {
  return /^\/([a-z0-9-]*)$/.exec(text)?.[1]
}

function SkillMenu({
  items, activeIndex, onChoose, onHover,
}: { items: SkillSummary[]; activeIndex: number; onChoose: (name: string) => void; onHover: (index: number) => void }) {
  const { t } = useLocale()
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const child = listRef.current?.children[activeIndex]
    if (child instanceof HTMLElement) child.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  return (
    <div ref={listRef} role="listbox" className="absolute inset-x-0 bottom-full z-20 mb-1.5 max-h-[280px] overflow-y-auto rounded-xl border border-border bg-bg p-1 shadow-fh-lv2">
      {items.map((item, index) => (
        <button
          key={item.name}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // Keep focus in the textarea so typing continues after a click.
          onMouseDown={(event) => { event.preventDefault() }}
          onMouseEnter={() => { onHover(index) }}
          onClick={() => { onChoose(item.name) }}
          className={`flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 ease-fh ${index === activeIndex ? 'bg-bg-hover' : ''}`}
        >
          <span className="flex items-center gap-1.5 text-[0.9em] font-semibold text-fg">
            /{item.name}
            {item.source === 'user-dsh' ? (
              <span className="rounded-full bg-surface px-1.5 py-0.5 text-[0.7em] font-medium text-muted">{t('skills.mineBadge')}</span>
            ) : null}
          </span>
          <span className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[0.8em] text-muted">{item.description}</span>
        </button>
      ))}
    </div>
  )
}

export function Composer({ sessionId, large = false }: { sessionId: string; large?: boolean }) {
  const { t } = useLocale()
  const composerText = useChatStore(state => state.composerText)
  const setComposerText = useChatStore(state => state.setComposerText)
  const events = useChatStore(state => state.events)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const skills = useQuery({ queryKey: ['skills'], queryFn: listSkills })
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuDismissedFor, setMenuDismissedFor] = useState<string | undefined>(undefined)
  // True right after a soft "Dừng" (keepInbox) succeeds, until either a new
  // turn starts or the user sends something — see the file header comment.
  // Not derived from `events`: turn/end's reason can't tell a soft stop
  // apart from a hard "Huỷ bỏ task" (both are `{kind:'aborted', reason:
  // {kind:'user'}}` — dsh-session's own TurnEndReasonMap), so which button
  // was pressed has to be tracked client-side.
  const [softStopped, setSoftStopped] = useState(false)
  // Workaround for a real, confirmed upstream bug (see latestTurnStartSeq's
  // own comment in conversation.tsx): a cancelled turn never actually gets
  // a `turn/end` event, so `run.running` alone would show "running" forever
  // after Dừng/Huỷ bỏ task — both the button AND RunStatus's elapsed-time
  // indicator would show "still running" forever. Tracks which turn
  // (`turn/start`'s own seq) we last asked to stop; `running` below only
  // trusts the raw event derivation once a DIFFERENT (newer) turn/start
  // proves the agent genuinely moved on.
  const [stoppedTurnStartSeq, setStoppedTurnStartSeq] = useState<number | undefined>(undefined)
  const run = runningState(events)
  const running = run.running && latestTurnStartSeq(events) !== stoppedTurnStartSeq

  useEffect(() => { setSoftStopped(false); setStoppedTurnStartSeq(undefined) }, [sessionId])
  useEffect(() => { if (running) setSoftStopped(false) }, [running])

  const send = useMutation({
    mutationFn: (text: string) => sendMessage(sessionId, text),
    onSuccess: () => { setComposerText(''); setSoftStopped(false) },
  })
  const stop = useMutation({
    mutationFn: () => interruptSession(sessionId, { keepInbox: true }),
    onSuccess: () => { setSoftStopped(true); setStoppedTurnStartSeq(latestTurnStartSeq(events)) },
  })
  const cancelTask = useMutation({
    mutationFn: () => interruptSession(sessionId),
    onSuccess: () => { setStoppedTurnStartSeq(latestTurnStartSeq(events)) },
  })

  const slash = slashQuery(composerText)
  const menuItems = slash === undefined || menuDismissedFor === composerText
    ? []
    // Real gap found via a live skill list: dsh-tool-skill has a genuine
    // `userInvocable: false` category (model-only skills, e.g. this repo's
    // own sql-to-insights) that the `/name` gesture can never trigger —
    // listing them here would be a picker entry that silently does nothing.
    : (skills.data?.skills ?? []).filter(skill => skill.invocation.userInvocable && skill.name.includes(slash))
  const activeMenuIndex = Math.min(menuIndex, Math.max(menuItems.length - 1, 0))

  function chooseSkill(name: string): void {
    setComposerText(`/${name} `)
    setMenuIndex(0)
    textareaRef.current?.focus()
  }

  const submit = (): void => {
    const text = composerText.trim()
    if (text === '' || send.isPending) return
    send.mutate(text)
  }

  // Auto-grow: reset to 'auto' first or scrollHeight only ever grows, never
  // shrinks back when text is deleted. Clearing the inline height entirely
  // when empty (rather than writing a 0/auto-derived px value) lets the
  // CSS `min-height` below be the one source of truth for the empty floor.
  useEffect(() => {
    const el = textareaRef.current
    if (el === null) return
    if (composerText === '') { el.style.height = ''; return }
    el.style.height = 'auto'
    el.style.height = `${String(el.scrollHeight)}px`
  }, [composerText])

  return (
    <div className={`relative mx-4 flex flex-col gap-2 rounded-[22px] border border-border bg-bg shadow-fh-md ${large ? 'p-5' : 'mb-4 p-4'}`}>
      {menuItems.length > 0 ? (
        <SkillMenu items={menuItems} activeIndex={activeMenuIndex} onChoose={chooseSkill} onHover={setMenuIndex} />
      ) : null}
      <textarea
        ref={textareaRef}
        rows={1}
        className={`max-h-[15em] resize-none border-none bg-transparent p-0 text-fg outline-none placeholder:text-muted ${large ? 'min-h-[4.5em] text-[1.05em]' : 'min-h-[1.5em]'}`}
        placeholder={t('conversation.placeholder')}
        value={composerText}
        onChange={(event) => {
          setComposerText(event.target.value)
          setMenuIndex(0)
        }}
        onKeyDown={(event) => {
          if (menuItems.length > 0 && !event.nativeEvent.isComposing) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : -1
              setMenuIndex((activeMenuIndex + step + menuItems.length) % menuItems.length)
              return
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              chooseSkill(menuItems[activeMenuIndex].name)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setMenuDismissedFor(composerText)
              return
            }
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center gap-2">
        {/* RunStatus gets `running` (the bug-workaround-corrected value),
            not the raw `run.running` — otherwise its elapsed-time indicator
            would ALSO get stuck "still running" forever after Dừng/Huỷ bỏ
            task, same reason the button logic below doesn't trust
            `run.running` directly either. */}
        <RunStatus run={{ ...run, running }} />
        <div className="ml-auto flex items-center gap-2">
          {running ? (
            // Running: ONLY the Stop button — no Send, no Cancel task yet
            // (matches the requested flow exactly: those 2 only appear AFTER
            // Dừng is pressed, not alongside it).
            <Button variant="outline" disabled={stop.isPending} onClick={() => { stop.mutate() }}>
              <Square size={13} fill="currentColor" />
              {t('conversation.stop')}
            </Button>
          ) : softStopped ? (
            <>
              <Button variant="outline" disabled={cancelTask.isPending} onClick={() => { cancelTask.mutate() }}>
                <Ban size={14} />
                {t('conversation.cancelTask')}
              </Button>
              <Button variant="primary" disabled={send.isPending} onClick={() => { send.mutate(t('conversation.continue')) }}>
                {t('conversation.continue')}
              </Button>
            </>
          ) : (
            <Button variant="primary" disabled={send.isPending} onClick={submit}>
              {t('conversation.send')}
            </Button>
          )}
        </div>
      </div>
      {send.isError ? <p className="text-xs text-error">{(send.error as Error).message}</p> : null}
      {stop.isError ? <p className="text-xs text-error">{(stop.error as Error).message}</p> : null}
      {cancelTask.isError ? <p className="text-xs text-error">{(cancelTask.error as Error).message}</p> : null}
    </div>
  )
}

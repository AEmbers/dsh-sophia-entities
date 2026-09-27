import type { CSSProperties } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentTeamClientMemberStatus } from 'dsh-sophia-entities/types'
import { useAvatarImage } from './avatar-image.ts'
import { memberArtUrl } from './dag/artwork.ts'
import type { TeamSidebarProps } from './slots.ts'
import { memberHue } from './team-formatters.ts'
import { presenceDotState, presenceLabel } from './TeamPresenceDot.tsx'
import { TeamStateDot } from './TeamStateDot.tsx'
import css from './sidebar.module.css'

/**
 * Sidebar Member avatar reusing the conversation identity language: the
 * member OC portrait when matched (falling back to deterministic hue and
 * handle initial on image error or missing artwork), with the presence
 * indicator overlaid at the bottom-right so one glyph carries identity and state.
 */
export function TeamMemberAvatar({ status, t }: {
  readonly status: AgentTeamClientMemberStatus
  readonly t: TeamSidebarProps['t']
}) {
  const label = presenceLabel(status, t)
  const state = presenceDotState(status.presence)
  const artUrl = memberArtUrl(status.member.handle.replace(/^@/, ''), status.member.description)
  const avatar = useAvatarImage(artUrl ?? undefined)
  const hasArt = avatar.src !== undefined

  return (
    <Tooltip label={label} delayMs={300}>
      <span
        className={css.agentAvatar}
        data-has-art={hasArt ? 'true' : undefined}
        style={hasArt ? undefined : ({ '--team-avatar-hue': memberHue(status.member.memberId) } as CSSProperties)}
        role="img"
        aria-label={label}
      >
        {hasArt ? (
          <img
            className={css.agentArt}
            src={avatar.src}
            alt=""
            aria-hidden="true"
            onError={avatar.failed}
          />
        ) : (
          status.member.handle.replace('@', '').slice(0, 1).toUpperCase()
        )}
        <span className={css.agentAvatarBadge} aria-hidden="true">
          <TeamStateDot state={state} />
        </span>
      </span>
    </Tooltip>
  )
}

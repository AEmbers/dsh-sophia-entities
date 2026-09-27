// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { AgentTeamClientMemberStatus } from 'dsh-sophia-entities/types'
import { TeamMemberAvatar } from '../src/client/TeamMemberAvatar.tsx'

afterEach(cleanup)

function mockStatus(handle: string, description: string, memberId = 'member:1'): AgentTeamClientMemberStatus {
  return {
    availability: 'active',
    presence: 'available',
    workspaceIds: [],
    member: {
      memberId: memberId as any,
      sessionId: 'session:1' as any,
      workspaceId: 'workspace:1' as any,
      handle,
      description,
      presetId: 'default',
      state: 'enabled',
    },
  }
}

const mockT = ((key: string) => key) as any

describe('TeamMemberAvatar', () => {
  it('renders OC portrait image when member role or handle matches artwork', () => {
    const status = mockStatus('星仪主事', '前端开发工程师')
    const { container } = render(<TeamMemberAvatar status={status} t={mockT} />)
    const avatar = container.querySelector('[role="img"]')!
    expect(avatar.getAttribute('data-has-art')).toBe('true')
    const img = avatar.querySelector('img')
    expect(img).not.toBeNull()
    expect(img?.getAttribute('src')).toBe('/plugins/dsh-sophia-entities/sophia-assets/frontend-engineer.webp')
  })

  it('renders initial letter with hue background when no artwork matches', () => {
    const status = mockStatus('custom-bot', 'some unmatched description')
    const { container } = render(<TeamMemberAvatar status={status} t={mockT} />)
    const avatar = container.querySelector('[role="img"]')!
    expect(avatar.getAttribute('data-has-art')).toBeNull()
    expect(avatar.querySelector('img')).toBeNull()
    expect(avatar.textContent).toContain('C')
  })

  it('falls back to initial letter when image load fails', () => {
    const status = mockStatus('@钦天监监正', 'CEO-Agent，全局总控')
    const { container } = render(<TeamMemberAvatar status={status} t={mockT} />)
    const avatar = container.querySelector('[role="img"]')!
    expect(avatar.getAttribute('data-has-art')).toBe('true')
    const img = avatar.querySelector('img')!
    expect(img).not.toBeNull()

    // Trigger onError
    fireEvent.error(img)

    // Falls back to initial character
    expect(avatar.getAttribute('data-has-art')).toBeNull()
    expect(avatar.querySelector('img')).toBeNull()
    expect(avatar.textContent).toContain('钦')
  })
})

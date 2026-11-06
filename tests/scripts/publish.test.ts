import { describe, expect, it } from 'vitest'
import { BUMP_FILES } from '../../scripts/release/preflight.mjs'
import {
  buildArtifacts, checkAssets, commitMessage, manifestSteps, publishSteps, requiredAssets, uploadSteps,
} from '../../scripts/release/publish.mjs'

const input = {
  version: '0.2.0', sha: 'abc123', stageDir: '/tmp/stage', notesFile: 'release-notes/0.2.0.md',
  needsCommit: true, needsPush: true,
}
const line = (step: { cmd: string, args: string[] }) => [step.cmd, ...step.args].join(' ')

describe('publish order', () => {
  it('commits, pushes, creates a draft, then uploads - and publishes last', () => {
    const steps = [...uploadSteps(input), ...manifestSteps(input), ...publishSteps(input)]
    expect(steps.map(step => step.id)).toEqual(['stage', 'commit', 'push', 'draft', 'upload', 'upload-manifest', 'publish'])
  })

  it('creates the release as a draft on the pushed commit and publishes it as latest', () => {
    const [draft] = uploadSteps(input).filter(step => step.id === 'draft')
    expect(line(draft!)).toContain('--draft')
    expect(line(draft!)).toContain('--target abc123')
    expect(line(draft!)).toContain('--notes-file release-notes/0.2.0.md')
    expect(line(draft!)).toContain('--repo jaylouiz/kan-do')
    expect(line(publishSteps(input)[0]!)).toBe('gh release edit v0.2.0 --repo jaylouiz/kan-do --draft=false --latest')
  })

  it('uploads exactly the versioned bundle, signature and dmg before the manifest', () => {
    const upload = uploadSteps(input).find(step => step.id === 'upload')!
    expect(upload.args).toEqual(expect.arrayContaining([
      '/tmp/stage/kan-do_0.2.0_aarch64.app.tar.gz',
      '/tmp/stage/kan-do_0.2.0_aarch64.app.tar.gz.sig',
      '/tmp/stage/kan-do_0.2.0_aarch64.dmg',
    ]))
    expect(manifestSteps(input)[0]!.args).toContain('/tmp/stage/latest.json')
  })

  it('attaches the draft to the pushed tag in CI instead of targeting a commit', () => {
    const [draft] = uploadSteps({ ...input, needsCommit: false, needsPush: false, verifyTag: true }).filter(step => step.id === 'draft')
    expect(line(draft!)).toContain('--draft --verify-tag')
    expect(line(draft!)).not.toContain('--target')
  })

  it('skips commit and push on a re-run where the bump is already on origin', () => {
    const ids = uploadSteps({ ...input, needsCommit: false, needsPush: false }).map(step => step.id)
    expect(ids).toEqual(['draft', 'upload'])
  })

  it('uses the conventional release commit message', () => {
    const commit = uploadSteps(input).find(step => step.id === 'commit')!
    expect(commit.args).toEqual(['commit', '-m', commitMessage('0.2.0')])
    expect(commitMessage('0.2.0')).toBe('chore(release): v0.2.0')
  })

  it('stages exactly the bumped files, both lockfiles included', () => {
    const stage = uploadSteps(input).find(step => step.id === 'stage')!
    expect(stage.args.slice(1)).toEqual(BUMP_FILES)
  })
})

describe('asset verification', () => {
  const names = requiredAssets('0.2.0')
  const uploaded = names.map((name, index) => ({ id: index + 1, name, state: 'uploaded', size: 100 }))

  it('requires bundle, signature, dmg and latest.json', () => {
    expect(names).toEqual([
      'kan-do_0.2.0_aarch64.app.tar.gz',
      'kan-do_0.2.0_aarch64.app.tar.gz.sig',
      'kan-do_0.2.0_aarch64.dmg',
      'latest.json',
    ])
  })

  it('passes when every asset is uploaded and non-empty, and returns the ids', () => {
    const result = checkAssets(uploaded, names)
    expect(result.ok).toBe(true)
    expect(result.ids['kan-do_0.2.0_aarch64.app.tar.gz']).toBe(1)
  })

  it('aborts when an expected asset is missing', () => {
    const result = checkAssets(uploaded.filter(asset => asset.name !== 'latest.json'), names)
    expect(result.ok).toBe(false)
    expect(result.problems).toEqual(['latest.json is not on the release'])
  })

  it('aborts on a half-uploaded or empty asset', () => {
    const starter = uploaded.map(asset => asset.name === 'latest.json' ? { ...asset, state: 'starter' } : asset)
    expect(checkAssets(starter, names).problems[0]).toContain('"starter"')
    const empty = uploaded.map(asset => asset.name.endsWith('.dmg') ? { ...asset, size: 0 } : asset)
    expect(checkAssets(empty, names).problems[0]).toContain('size 0')
  })

  it('maps the build output to the artifacts the script collects', () => {
    expect(buildArtifacts('0.2.0')).toEqual({
      bundle: 'macos/kan-do.app.tar.gz',
      signature: 'macos/kan-do.app.tar.gz.sig',
      dmg: 'dmg/kan-do_0.2.0_aarch64.dmg',
    })
  })
})

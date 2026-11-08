/**
 * Repository-selecting variables git exports to hooks and to `rebase --exec` (`git rev-parse --local-env-vars`).
 * While one is set, `cwd` and `git -C` are ignored, so a temp-dir `git init` acts on the calling repo (#41).
 */
export const LOCAL_GIT_ENV_VARS = [
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CONFIG',
  'GIT_CONFIG_PARAMETERS',
  'GIT_CONFIG_COUNT',
  'GIT_OBJECT_DIRECTORY',
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_IMPLICIT_WORK_TREE',
  'GIT_GRAFT_FILE',
  'GIT_INDEX_FILE',
  'GIT_NO_REPLACE_OBJECTS',
  'GIT_REPLACE_REF_BASE',
  'GIT_PREFIX',
  'GIT_SHALLOW_FILE',
  'GIT_COMMON_DIR',
] as const

/** Deletes the local git variables from `env` in place (default: `process.env`) and returns it. */
export function scrubLocalGitEnv<T extends Record<string, string | undefined>>(env: T = process.env as unknown as T): T {
  for (const name of LOCAL_GIT_ENV_VARS) Reflect.deleteProperty(env, name)
  return env
}

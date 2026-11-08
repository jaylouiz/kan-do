import { scrubLocalGitEnv } from '../helpers/gitEnv'

// Every test that runs git in a temp dir must act on that dir, whatever invoked Vitest (kd#41).
scrubLocalGitEnv()

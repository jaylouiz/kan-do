import { beforeEach } from 'vitest'
import { clearAllLiveSeconds } from '~/lib/liveTime'

// The collected timer seconds (#286) are module state: a test that ends with a running timer must not leak them
beforeEach(() => {
  clearAllLiveSeconds()
})

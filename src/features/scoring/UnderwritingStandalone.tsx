'use client'

import { useState } from 'react'
import { createDisbursementServer } from '../disbursement/disbursementServer.ts'
import { SEED_LOANS } from '../disbursement/seedLoans.ts'
import { UnderwritingWorkbench } from './UnderwritingWorkbench.tsx'

/** Standalone client island for the /underwriting route: its own in-memory server. */
export function UnderwritingStandalone() {
  const [server] = useState(() => createDisbursementServer(SEED_LOANS))
  return <UnderwritingWorkbench server={server} />
}

import { AmountAndProof } from './utils';
import { WORKER_POOL } from './worker-pool';

export async function runProofGenerationWorker(
  leaves: string[],
  walletAddressToFinalDataMap: Record<string, AmountAndProof>,
  account: string,
): Promise<string[]> {
  return WORKER_POOL.addTask({
    leaves,
    leaf: walletAddressToFinalDataMap[account.toLowerCase()].proofs[0],
  });
}

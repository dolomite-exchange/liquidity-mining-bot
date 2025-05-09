import { Integer } from '@dolomite-exchange/dolomite-margin';
import { defaultAbiCoder, keccak256 } from 'ethers/lib/utils';
import { MerkleTree } from 'merkletreejs';

export interface MerkleRootAndProofs {
  merkleRoot: string;
  walletAddressToProofsMap: Record<string, AmountAndProof>; // wallet ==> proofs + amounts
}

export interface AmountAndProof {
  amount: string;
  proofs: string[];
}

export async function calculateMerkleRootAndProofs(
  userToAmounts: Record<string, Integer>,
): Promise<MerkleRootAndProofs> {
  const walletAddressToFinalDataMap: Record<string, AmountAndProof> = {};
  const leaves: string[] = [];
  const userAccounts = Object.keys(userToAmounts);
  userAccounts.forEach(account => {
    const userAmount = userToAmounts[account];
    const leaf = keccak256(
      defaultAbiCoder.encode(
        ['address', 'uint256'],
        [account, userAmount.toFixed(0)],
      ),
    );
    walletAddressToFinalDataMap[account.toLowerCase()] = {
      amount: userAmount.toFixed(0),
      proofs: [leaf], // this will get overwritten once the tree is created
    };
    leaves.push(leaf);
  });

  const tree = new MerkleTree(leaves, keccak256, { sort: true });

  // Update proofs for final data
  userAccounts.forEach(account => {
    walletAddressToFinalDataMap[account.toLowerCase()].proofs
      = tree.getHexProof(walletAddressToFinalDataMap[account].proofs[0]);
  });

  return { merkleRoot: tree.getHexRoot(), walletAddressToProofsMap: walletAddressToFinalDataMap };
}

import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';
import { ChainId } from '../src/lib/chain-id';
import { writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndProofs } from './lib/utils';

const AIRDROP_AMOUNT = ethers.utils.parseEther(`${100_000_000}`);

function readJson(network: ChainId): any {
  return JSON.parse(
    readFileSync(path.join(process.cwd(), 'scripts/output/minerals-transformations', `minerals-${network}.json`)).toString(),
  );
}

async function calculateOptionsAirdrop() {
  const arbitrumFile = readJson(ChainId.ArbitrumOne);
  const mantleFile = readJson(ChainId.Mantle);
  const xLayerFile = readJson(ChainId.XLayer);

  let totalMinerals = ethers.BigNumber.from(0);
  const userToAmountMap = {};
  for (const key in arbitrumFile) {
    totalMinerals = totalMinerals.add(arbitrumFile[key]);
    if (!userToAmountMap[key]) {
      userToAmountMap[key] = arbitrumFile[key];
    }
  }

  for (const key in mantleFile) {
    totalMinerals = totalMinerals.add(mantleFile[key]);
    const amount = ethers.BigNumber.from(mantleFile[key]);
    if (!userToAmountMap[key]) {
      userToAmountMap[key] = amount.toString();
    } else {
      userToAmountMap[key] = amount.add(userToAmountMap[key]).toString();
    }
  }
  for (const key in xLayerFile) {
    totalMinerals = totalMinerals.add(xLayerFile[key]);
    const amount = ethers.BigNumber.from(xLayerFile[key]);
    if (!userToAmountMap[key]) {
      userToAmountMap[key] = amount.toString();
    } else {
      userToAmountMap[key] = amount.add(userToAmountMap[key]).toString();
    }
  }

  let totalAmount = INTEGERS.ZERO;
  for (const key in userToAmountMap) {
    userToAmountMap[key] = new BigNumber(AIRDROP_AMOUNT.mul(userToAmountMap[key]).div(totalMinerals).toString())
    totalAmount = totalAmount.plus(userToAmountMap[key]);
  }

  const {
    merkleRoot,
    walletAddressToLeavesMap,
  } = calculateMerkleRootAndProofs(userToAmountMap);

  const finalResults: any[] = [];
  for (const wallet in walletAddressToLeavesMap) {
    finalResults.push([
      wallet,
      walletAddressToLeavesMap[wallet].amount,
      walletAddressToLeavesMap[wallet].proofs,
    ]);
  }

  const jsonResult = {
    merkleRoot,
    mineralsTotal: totalMinerals.toString(),
    airdropAmount: totalAmount.toString(),
    data: finalResults,
  };

  writeOutputFile(`options-airdrop.json`, jsonResult);
}

calculateOptionsAirdrop()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });

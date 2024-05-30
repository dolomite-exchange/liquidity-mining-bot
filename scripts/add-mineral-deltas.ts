import { BigNumber, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import '../src/lib/env'
import { MineralOutputFile, UserMineralAllocationForFile } from './lib/config-helper';
import { writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndProofs } from './lib/rewards';

const DELTA_NUMBER = '9999';

function toInteger(amount: BigNumber): BigNumber {
  return amount.times(INTEGERS.INTEREST_RATE_BASE);
}

async function start() {
  const walletToDeltasMap: Record<string, BigNumber> = {
    // ['0x9aebea73d2af4cd33557f491545d8be97874021e'.toLowerCase()]: toInteger(new BigNumber(5000)),
    ['0x0000000000000000000000000000000000000000'.toLowerCase()]: INTEGERS.ZERO,
    ['0x0000000000000000000000000000000000000001'.toLowerCase()]: INTEGERS.ZERO,
    ['0x28c08da0fd81815a216ca1b57d10b9326b2d4fa3'.toLowerCase()]: toInteger(new BigNumber(5000)),
  };
  const totalAmount = Object.keys(walletToDeltasMap).reduce((acc, key) => {
    return acc.plus(walletToDeltasMap[key])
  }, INTEGERS.ZERO);

  const merkleTree = calculateMerkleRootAndProofs(walletToDeltasMap);
  const outputData: MineralOutputFile = {
    users: Object.keys(merkleTree.walletAddressToLeavesMap).reduce((memo, user) => {
      memo[user] = {
        ...merkleTree.walletAddressToLeavesMap[user],
        multiplier: '1.0',
      };
      return memo;
    }, {} as Record<string, UserMineralAllocationForFile>),
    metadata: {
      epoch: parseInt(DELTA_NUMBER, 10),
      merkleRoot: merkleTree.merkleRoot,
      startTimestamp: 0,
      startBlockNumber: 0,
      endTimestamp: 0,
      endBlockNumber: 0,
      marketIds: [],
      marketNames: [],
      totalAmount: totalAmount.toFixed(),
      totalUsers: Object.keys(walletToDeltasMap).length,
    },
  };
  console.log(`Created delta for ${DELTA_NUMBER}!`);

  const outputFileName = `delta-${process.env.NETWORK_ID}-${DELTA_NUMBER}.json`;
  writeOutputFile(outputFileName, outputData);
}

start()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error(`Found error while starting: ${error.toString()}`, error);
    process.exit(1);
  });

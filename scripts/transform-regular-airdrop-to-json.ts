import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { readOutputFile, writeOutputFile } from './lib/file-helpers';
import { calculateMerkleRootAndProofs } from './lib/utils';

const LEVEL_FILE = 'data/all-level-data.json';
const SMART_CONTRACT_USERS_FILE = 'airdrop-results/smart-contract-users-all.json';
const SPECIAL_RECIPIENTS_FILE = 'airdrop-results/special-recipients.json';
const FILE = 'airdrop-results/regular-airdrop-data-all_networks-1x_supply-0_5x_borrow_1x_level-additional_level_amounts-binary_500k_cap.json';

interface FinalUserResult {
  amount: string;
  proofs: string[];
  isSmartContract: boolean;
  level: number;
}

interface SpecialRecipient {
  wallet: string;
  amount: string;
}

async function transformRegularAirdropToJson() {
  const addressToLevelMap = JSON.parse(readOutputFile(LEVEL_FILE)!) as Record<string, number>;
  const specialRecipients = JSON.parse(readOutputFile(SPECIAL_RECIPIENTS_FILE)!) as SpecialRecipient[];
  const addressToIsSmartContractMap = JSON.parse(readOutputFile(SMART_CONTRACT_USERS_FILE)!).users as Record<string, boolean>;
  let totalDoloDistributed = INTEGERS.ZERO;
  const addressToAmountMap = Object.entries(JSON.parse(readOutputFile(FILE)!).users).reduce((memo, accountAndAmount) => {
    const account = accountAndAmount[0];
    memo[account] = new BigNumber(accountAndAmount[1] as string);
    totalDoloDistributed = totalDoloDistributed.plus(memo[account]);
    return memo;
  }, {} as Record<string, Integer>);
  specialRecipients.forEach(recipient =>  {
    if (addressToAmountMap[recipient.wallet.toLowerCase()]) {
      throw new Error('Collision!');
    }

    const amount = new BigNumber(recipient.amount);
    addressToAmountMap[recipient.wallet.toLowerCase()] = amount;
    totalDoloDistributed = totalDoloDistributed.plus(amount);
  });

  const proofData = await calculateMerkleRootAndProofs(addressToAmountMap);

  const finalUserResult = Object.keys(proofData.walletAddressToProofsMap).reduce((memo, user) => {
    memo[user] = {
      ...proofData.walletAddressToProofsMap[user],
      isSmartContract: addressToIsSmartContractMap[user] ?? false,
      level: addressToLevelMap[user] ?? 0,
    };
    return memo;
  }, {} as Record<string, FinalUserResult>);

  const finalResult = {
    users: finalUserResult,
    metadata: {
      totalDoloDistributed: totalDoloDistributed.toFixed(),
      totalUsers: Object.keys(finalUserResult).length,
      merkleRoot: proofData.merkleRoot,
    },
  };
  const finalResultForDatabase = Object.entries(finalUserResult).map(([key, value]) => {
    return [key, value.amount, value.proofs, value.isSmartContract, value.level];
  })
  writeOutputFile(`airdrop-results/regular-airdrop-FINAL.json`, finalResult);
  writeOutputFile(`airdrop-results/regular-airdrop-FINAL-FOR-DATABASE.json`, finalResultForDatabase);
}

transformRegularAirdropToJson()
  .then(() => {
    console.log('Finished executing script!');
  })
  .catch(error => {
    console.error('Caught error while starting:', error);
    process.exit(1);
  });

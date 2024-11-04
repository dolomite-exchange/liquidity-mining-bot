import { fetchPendleUserBalanceSnapshotBatch } from './fetcher';

async function main(marketId: number = 17, block: number = 220_943_848) {
  const res = (await fetchPendleUserBalanceSnapshotBatch(marketId, [block]))[0];

  Object.keys(res).forEach(user => {
    if (!res[user].eq(0)) {
      console.log(user, res[user].toString());
    }
  });
}

main().catch(console.error);

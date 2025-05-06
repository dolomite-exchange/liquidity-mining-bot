import { BigNumber, Integer, INTEGERS } from '@dolomite-exchange/dolomite-margin';
import { readOutputFile, writeOutputFile } from './lib/file-helpers';

interface BoycoPosition {
  account_address: string;
  market_id: string;
  token_1_ids: string[];
  token_1_amounts: string[];
  amount_deposited: string;
}

const VE_DOLO_P_ADDRESS = '1-0x460f8d9c78b1bde7da137ce75315bd15d34a369b';

const MARKET_HASHES_MAP = {
  // Dolomite Markets
  '0x1e0a98a276ba873cfa427e247c7d0e438f604a54fcb36481063e1220af021faf': 'USDC',
  '0xa588ad19850cf2a111c3c727033da8e557abc94de70fce2d2b2f2f78140f15e5': 'USDe',
  '0x092c0c4d8d124fc29364e8cd8417198c4bbe335e3f6c4b1f79215a3457b4831a': 'sUSDe',
  '0xbe5cd829fcb3cdfe8224ad72fc3379198d38da26131c5b7ab6664c8f56a9730d': 'NECT',
  '0x42a09eccabf1080c40a24522e9e8adbee5a0ad907188c9b6e50ba26ba332eac3': 'SBTC',
  '0xd10bdc88272e0958baa62a4ae2bfce1d8feed639a93e03c0aa5cec7adfbdf2c3': 'uniBTC',
  '0xb1d5ccc4388fe639f8d949061bc2de95ecb1efb11c5ceb93bdb71caab58c8aa3': 'SolvBTC',
  '0x2a3a73ba927ec6bbf0e2e12e21a32e274a295389ce9d6ae2b32435d12c597c2c': 'solvBTC.bbn',
  '0xff917303af9337534eece4b88948d609980b66ca0b41875da782aec4858cade5': 'pumpBTC.bera',
  '0xb27f671bc0dd8773a25136253acd72150dd59e50e44dc8439e9dc5c84c2b19f6': 'STONE',
  '0x258ac521d801d5112a484ad1b82e6fd2efc24aba29e5cd3d56db83f4a173dc90': 'beraETH',
  '0x5bac1cacdd36b3d95a7f9880a264f8481ab56d3d1a53993de084c6fa5febcc15': 'ylstETH',
  '0x0194c329e2b9712802c37d3f17502bcefce2e128933f24f4fe847dfc7e5e8965': 'ylBTCLST',
  '0x6306bfce6bff30ec4efcea193253c43e057f1474007d0d2a5a0c2938bd6a9b81': 'ylpumpBTC.bera',
  '0xc6887dddd833a3d585c7941cd31b0f8ff3ec5903d49cd5e7ac450b46532d3e79': 'stBTC',
  '0x86a5077c6a9190cde78ec75b8888c46ed0a3d1289054127a955a2af544633cf3': 'USDa',
  '0x2dd74f8f8a8d7f27b2a82a6edce57b201f9b4a3c4780934caf99363115e48be6': 'sUSDa',
  '0xc90525132d909f992363102ebd6298d95b1f312acdb9421fd1f7ac0c0dd78d3f': 'rswETH',
  '0x415f935bbb9bf1bdc1f49f2ca763d5b2406efbf9cc949836880dd5bbd054db95': 'rsETH',
  // Infrared Markets
  '0x9778047cb8f3740866882a97a186dff42743bebb3ad8010edbf637ab0e37751f': 'HONEY (Dolomite)',
  '0x9c7bd5b59ebcb9a9e6787b9b174a98a69e27fa5a4fe98270b461a1b9b1b1aa3e': 'USDT (Dolomite)',
  '0x0a7565b14941c6a3dde083fb7a857e27e12c55fa34f709c37586ec585dbe7f3f': 'wETH (Dolomite)',
  '0xa6905c68ad66ea9ce966aa1662e1417df08be333ab8ec04507e0f0301d3a78e9': 'wBTC (Dolomite)',
};

async function filterBoycoPositions() {
  const file = readOutputFile('royco/boyco_positions.json')!;
  const data = JSON.parse(file) as any[];

  const filtered = data.filter(d => MARKET_HASHES_MAP[d.market_id]) as BoycoPosition[];
  writeOutputFile('royco/dolomite_boyco_positions.json', filtered);

  const totalByHash = {} as Record<string, Integer>;
  let total = INTEGERS.ZERO;
  const concreteBeraEthDepositor = '0x3451e9e21dc9705ccaeb0e61971862897818be23';
  filtered.forEach(f => {
    const index = f.token_1_ids.indexOf(VE_DOLO_P_ADDRESS);
    if (index === -1) {
      throw new Error('Could not find VE_DOLO_P');
    }
    if (!totalByHash[f.market_id]) {
      totalByHash[f.market_id] = INTEGERS.ZERO;
    }

    const amount = new BigNumber(f.token_1_amounts[index]);
    if (f.account_address.toLowerCase() === concreteBeraEthDepositor.toLowerCase()) {
      console.log('concreteBeraEthDepositor amount:', amount.toFixed());
    }

    totalByHash[f.market_id] = totalByHash[f.market_id].plus(amount);
    total = total.plus(amount);
  });

  const totalByHashFormatted = {};
  Object.keys(totalByHash).forEach(hash => {
    const amount = totalByHash[hash].div(INTEGERS.INTEREST_RATE_BASE).toFormat(18);
    totalByHashFormatted[hash] = `${amount} ${MARKET_HASHES_MAP[hash]}`;
  });
  const stats = {
    participants: filtered.length,
    totalByHash: totalByHashFormatted,
    totalVeDolo: total.div(INTEGERS.INTEREST_RATE_BASE).toFormat(18),
  }
  console.log('misc stats:', stats);
}

filterBoycoPositions()
  .then(() => {
    console.error('Finished filtering...');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Error filtering...', e);
    process.exit(-1);
  })

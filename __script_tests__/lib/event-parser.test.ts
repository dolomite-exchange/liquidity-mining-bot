import { BigNumber } from '@dolomite-exchange/dolomite-margin';
import { parseDeposits, parseLiquidations, parseTrades, parseTransfers } from '../../scripts/lib/event-parser';
import { AccountToSubAccountToMarketToBalanceChangeMap } from '../../scripts/lib/rewards';
import { ApiDeposit, ApiLiquidation, ApiTrade, ApiTransfer, ApiWithdrawal } from '../../src/lib/api-types';

const address1 = '0x44f6ccf0d09ef0d4991eb74d8c26d77a52a1ba9e';
const address2 = '0x668035c440606da01e788991bfbba5c0d24133ab';
const subAccount1 = '3';
const subAccount2 = '6';

describe('event-parser', () => {
  describe('parseDeposit', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};
      const deposits: ApiDeposit[] = [
        {
          id: '0xd66778a4d3b9fc6fd6d84a5049763e0b3b2912c16d19c3d6bd46da01f8524119-24',
          serialId: 95108,
          timestamp: 1696057612,
          effectiveUser: address1,
          marginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          marketId: 0,
          amountDeltaPar: new BigNumber('0.04'),
        },
      ];
      parseDeposits(accountToAssetToEventsMap, deposits);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('0.04'));
    });
  });

  describe('parseWithdraw', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};
      const withdrawals: ApiWithdrawal[] = [
        {
          id: '0x4d5d9d8a6c6f9e9b1f3f3f8a0b3a9d1d2a0f8a7d1b8a0a5b5a4c5a3b2a1a0a9a8-12',
          serialId: 95109,
          timestamp: 1696057612,
          effectiveUser: address1,
          marginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          marketId: 0,
          amountDeltaPar: new BigNumber('-5'),
        },
      ];
      parseDeposits(accountToAssetToEventsMap, withdrawals);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('-5'));
    });
  });

  describe('parseTransfer', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};
      const transfers: ApiTransfer[] = [
        {
          id: '0xb44e6204445c71f5f508360c946d54f722a1efba9174ddcc1815321bd30f3985-25',
          serialId: 93141,
          timestamp: 1695506230,
          fromEffectiveUser: address1,
          toEffectiveUser: address2,
          fromMarginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          toMarginAccount: {
            user: address2,
            accountNumber: subAccount1,
          },
          marketId: 2,
          fromAmountDeltaPar: new BigNumber('-19'),
          toAmountDeltaPar: new BigNumber('19'),
        },
      ];
      parseTransfers(accountToAssetToEventsMap, transfers);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('-19'));
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['2']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('19'));
    });

    it('should not skip if fromEffectiveUser equals toEffectiveUser', async () => {
      const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};
      const transfers: ApiTransfer[] = [
        {
          id: '0xb44e6204445c71f5f508360c946d54f722a1efba9174ddcc1815321bd30f3985-25',
          serialId: 93141,
          timestamp: 1695506230,
          fromEffectiveUser: address1,
          toEffectiveUser: address1,
          fromMarginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          toMarginAccount: {
            user: address1,
            accountNumber: subAccount2,
          },
          marketId: 2,
          fromAmountDeltaPar: new BigNumber('-19'),
          toAmountDeltaPar: new BigNumber('19'),
        },
      ];
      parseTransfers(accountToAssetToEventsMap, transfers);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('-19'));
      expect(accountToAssetToEventsMap[address1]?.[subAccount2]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount2]?.['2']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('19'));
    });
  })

  describe('parseTrade', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};
      const trades: ApiTrade[] = [
        {
          id: '0xd2ddf2db086817f6385e44a5eb78aa6a1794c04c8728705fe83a871d6650d94a-8',
          serialId: 96397,
          timestamp: 1696333775,
          takerEffectiveUser: address1,
          takerMarginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          takerMarketId: 2,
          takerInputTokenDeltaPar: new BigNumber('-21'),
          takerOutputTokenDeltaPar: new BigNumber('0.1'),
          makerEffectiveUser: address2,
          makerMarginAccount: {
            user: address2,
            accountNumber: subAccount1,
          },
          makerMarketId: 0,
        },
      ];
      parseTrades(accountToAssetToEventsMap, trades);

      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('-21'));
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('0.1'));

      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['0']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['0']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('-0.1'));
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['2']?.[0].amountDeltaPar)
        .toEqual(new BigNumber('21'));
    });

    it('should only update taker if maker effective user is null', async () => {
      const accountToAssetToEventsMap = {};
      const trades: ApiTrade[] = [
        {
          id: '0xd1c898a3648ba625aee902f2e271944155eb911544695bb9dcefee49f67341a3-23',
          serialId: 92632,
          timestamp: 1695259177,
          takerEffectiveUser: address1,
          takerMarginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          takerMarketId: 14,
          takerInputTokenDeltaPar: new BigNumber('-0.018'),
          takerOutputTokenDeltaPar: new BigNumber('0.02'),
          makerEffectiveUser: undefined,
          makerMarginAccount: undefined,
          makerMarketId: 0,
        },
      ];
      parseTrades(accountToAssetToEventsMap, trades);
      expect(accountToAssetToEventsMap[address1][subAccount1]['0'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address1][subAccount1]['14'].length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]).toBeUndefined();
    });
  })

  describe('parseLiquidation', () => {
    it('should work normally', async () => {
      const accountToAssetToEventsMap: AccountToSubAccountToMarketToBalanceChangeMap = {};
      const liquidations: ApiLiquidation[] = [
        {
          id: '0xfb787b3126a0879f083d79b38c64144188da8732902c07836acbacb0de6c0cc1-17',
          serialId: 89497,
          timestamp: 1694424325,
          solidEffectiveUser: address1,
          solidMarginAccount: {
            user: address1,
            accountNumber: subAccount1,
          },
          liquidEffectiveUser: address2,
          liquidMarginAccount: {
            user: address2,
            accountNumber: subAccount1,
          },
          heldMarketId: 0,
          borrowedMarketId: 2,
          solidHeldTokenAmountDeltaPar: new BigNumber('0.4'),
          liquidHeldTokenAmountDeltaPar: new BigNumber('-0.4'),
          solidBorrowedTokenAmountDeltaPar: new BigNumber('-612'),
          liquidBorrowedTokenAmountDeltaPar: new BigNumber('607'),
        },
      ];
      parseLiquidations(accountToAssetToEventsMap, liquidations);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['0']?.length).toEqual(1);
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['2']?.length).toEqual(1);

      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['0']?.[0]?.amountDeltaPar)
        .toEqual(new BigNumber('0.4'));
      expect(accountToAssetToEventsMap[address1]?.[subAccount1]?.['2']?.[0]?.amountDeltaPar)
        .toEqual(new BigNumber('-612'));
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['0']?.[0]?.amountDeltaPar)
        .toEqual(new BigNumber('-0.4'));
      expect(accountToAssetToEventsMap[address2]?.[subAccount1]?.['2']?.[0]?.amountDeltaPar)
        .toEqual(new BigNumber('607'));
    });
  })
});

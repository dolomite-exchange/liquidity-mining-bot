import { Decimal } from '@dolomite-exchange/dolomite-margin';
import { ethers } from 'ethers';

type Market = {
  address: string;
  deployedBlock: number;
};

type LiquidLocker = {
  address: string;
  receiptToken: string;
  lpToken: string;
  deployedBlock: number;
};

export type YTInterestData = {
  index: ethers.BigNumber;
  accrue: ethers.BigNumber;
};

export interface PoolConfiguration {
  SY: string;
  YT: string;
  LPs: Market[];
  decimals: number;
  liquidLockers: LiquidLocker[];
}

export type UserRecord = Record<string, ethers.BigNumber>;
export type UserRecordWithDecimal = Record<string, Decimal>;

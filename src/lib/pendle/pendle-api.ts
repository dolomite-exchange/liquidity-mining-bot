import sleep from '@dolomite-exchange/zap-sdk/dist/__tests__/helpers/sleep';
import { ADDRESS_ZERO } from '@dolomite-exchange/zap-sdk/dist/src/lib/Constants';
import axios from 'axios';

const SLEEP_DURATION_BETWEEN_QUERIES = 1_000;

export class PendleAPI {
  static async queryAllTokens(tokens: string[]): Promise<string[]> {
    const allResults = await Promise.all(
      tokens.map(async (token) => {
        if (token === ADDRESS_ZERO) {
          return Promise.resolve([]);
        } else {
          const result = this.query(token);
          await sleep(SLEEP_DURATION_BETWEEN_QUERIES);
          return result;
        }
      })
    );
    const allUniqueUsers = new Set<string>(allResults.flat());
    return Array.from(allUniqueUsers);
  }

  static async query(token: string): Promise<string[]> {
    const resp = await axios.get(
      `https://api-v2.pendle.finance/core/v1/statistics/get-distinct-user-from-token?token=${token.toLowerCase()}&size=100000`
    );
    return resp.data.users;
  }
}

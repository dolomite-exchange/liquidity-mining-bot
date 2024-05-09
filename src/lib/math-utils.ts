import { Integer } from '@dolomite-exchange/dolomite-margin';

export function getPartial(amount: Integer, numerator: Integer, denominator: Integer): Integer {
  return amount.times(numerator).dividedToIntegerBy(denominator);
}

export function getPartialRoundUp(target: Integer, numerator: Integer, denominator: Integer): Integer {
  return target.times(numerator).minus(1).dividedToIntegerBy(denominator).plus(1);
}

export function getPartialRoundHalfUp(target: Integer, numerator: Integer, denominator: Integer): Integer {
  return target.times(numerator).plus(denominator.dividedToIntegerBy(2)).dividedToIntegerBy(denominator);
}

export function owedWeiToHeldWei(
  owedWei: Integer,
  owedPrice: Integer,
  heldPrice: Integer,
): Integer {
  return getPartial(owedWei, owedPrice, heldPrice);
}

export function heldWeiToOwedWei(
  heldWei: Integer,
  heldPrice: Integer,
  owedPrice: Integer,
): Integer {
  return getPartialRoundUp(heldWei, heldPrice, owedPrice);
}

import { ICharacter } from './Character';
import { IWeapon } from './Weapon';
import { ITarget } from './Target';
import { Contracts } from './Contracts';
import { Nft } from './Nft';
import { IShield } from './Shield';
import {CartEntry} from '@/components/smart/VariantChoiceModal.vue';

export type StakeType = 'skill' | 'skill2' | 'lp' | 'lp2' | 'king' | 'skill90' | 'skill180' | 'king90' | 'king180';
export const allStakeTypes: StakeType[] = ['skill', 'skill2', 'lp', 'lp2', 'king', 'skill90', 'skill180', 'king90', 'king180'];
export type NftStakeType = 'cbkLandT1' | 'cbkLandT2' | 'cbkLandT3';
export const allNftStakeTypes: NftStakeType[] = ['cbkLandT1', 'cbkLandT2', 'cbkLandT3'];


export function isStakeType(stakeType: string): stakeType is StakeType {
  return allStakeTypes.includes(stakeType as StakeType);
}

export function isNftStakeType(stakeType: string): stakeType is NftStakeType {
  return allNftStakeTypes.includes(stakeType as NftStakeType);
}

export interface IWeb3EventSubscription {
  unsubscribe(): void;
}

export interface IStakeState {
  ownBalance: string;
  stakedBalance: string;
  remainingCapacityForDeposit: string | null;
  remainingCapacityForWithdraw: string;
  contractBalance: string;
  currentRewardEarned: string;
  rewardMinimumStakeTime: number;
  rewardDistributionTimeLeft: number;
  unlockTimeLeft: number;
}

export interface IStakeOverviewState {
  rewardRate: string;
  rewardsDuration: number;
  totalSupply: string;
  minimumStakeTime: number;
  rewardDistributionTimeLeft: number;
}

export interface IRaidState {
  index: string;
  expectedFinishTime: string;
  raiderCount: string;
  playerPower: string;
  bossPower: string;
  bossTrait: string;
  status: string;
  joinSkill: string;
  staminaCost: string;
  durabilityCost: string;
  xpReward: string;
  accountPower: string;

  //isOwnedCharacterRaidingById: Record<number, boolean>; // ?
}
export interface IPartnerProject {
  id: string;
  name: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenSupply: string;
  tokensClaimed: string;
  tokenPrice: string;
  isActive: boolean;
}

export interface ISpecialWeaponEvent {
  name: string;
  weaponElement: string;
  endTime: string;
  supply: string;
  orderedCount: string;
  ordered: boolean;
  forged: boolean;
}

export interface IItemPrices {
  itemWeaponRenamePrice: string;
  itemCharacterRenamePrice: string;
  itemCharacterTraitChangeFirePrice: string;
  itemCharacterTraitChangeEarthPrice: string;
  itemCharacterTraitChangeWaterPrice: string;
  itemCharacterTraitChangeLightningPrice: string;
  itemWeaponCosmeticGrayscalePrice: string;
  itemWeaponCosmeticContrastPrice: string;
  itemWeaponCosmeticSepiaPrice: string;
  itemWeaponCosmeticInvertPrice: string;
  itemWeaponCosmeticBlurPrice: string;
  itemWeaponCosmeticFireGlowPrice: string;
  itemWeaponCosmeticEarthGlowPrice: string;
  itemWeaponCosmeticLightningGlowPrice: string;
  itemWeaponCosmeticWaterGlowPrice: string;
  itemWeaponCosmeticRainbowGlowPrice: string;
  itemWeaponCosmeticDarkGlowPrice: string;
  itemWeaponCosmeticGhostPrice: string;
  itemWeaponCosmeticPoliceLightsPrice: string;
  itemWeaponCosmeticNeonBorderPrice: string;
  itemWeaponCosmeticRotatingNeonBorderPrice: string;
  itemWeaponCosmeticDiamondBorderPrice: string;
  itemWeaponCosmeticGoldBorderPrice: string;
  itemWeaponCosmeticSilverBorderPrice: string;
  itemWeaponCosmeticBronzeBorderPrice: string;
  itemCharacterCosmeticGrayscalePrice: string;
  itemCharacterCosmeticContrastPrice: string;
  itemCharacterCosmeticSepiaPrice: string;
  itemCharacterCosmeticInvertPrice: string;
  itemCharacterCosmeticBlurPrice: string;
  itemCharacterCosmeticFireGlowPrice: string;
  itemCharacterCosmeticEarthGlowPrice: string;
  itemCharacterCosmeticLightningGlowPrice: string;
  itemCharacterCosmeticWaterGlowPrice: string;
  itemCharacterCosmeticRainbowGlowPrice: string;
  itemCharacterCosmeticDarkGlowPrice: string;
  itemCharacterCosmeticGhostPrice: string;
  itemCharacterCosmeticPoliceLightsPrice: string;
  itemCharacterCosmeticNeonBorderPrice: string;
  itemCharacterCosmeticDiamondBorderPrice: string;
  itemCharacterCosmeticGoldBorderPrice: string;
  itemCharacterCosmeticSilverBorderPrice: string;
  itemCharacterCosmeticBronzeBorderPrice: string;
}

export interface IState {
  contracts: () => Contracts;
  eventSubscriptions: () => IWeb3EventSubscription[];
  accounts: string[];
  defaultAccount: string | null;
  currentNetworkId: number | null;
  skillPriceInUsd: number;

  fightGasOffset: string;
  fightBaseline: string;

  skillBalance: string;
  skillRewards: string;
  maxRewardsClaimTax: string;
  rewardsClaimTax: string;
  xpRewards: Record<string, string>;
  inGameOnlyFunds: string;
  directStakeBonusPercent: number;
  ownedCharacterIds: number[];
  ownedGarrisonCharacterIds: number[];
  ownedWeaponIds: number[];
  ownedShieldIds: number[];
  ownedTrinketIds: number[];
  ownedJunkIds: number[];
  ownedKeyLootboxIds: number[];
  maxStamina: number;
  ownedDust: string[];
  cartEntries: CartEntry[];
  currentChainSupportsMerchandise: boolean;
  currentChainSupportsPvP: boolean;
  currentChainSupportsQuests: boolean;

  currentCharacterId: number | null;
  characters: Record<number, ICharacter>;
  garrisonCharacters: Record<number, ICharacter>;
  characterStaminas: Record<number, number>;
  characterPowers: Record<number, number>;
  characterIsInArena: Record<number, boolean>;
  characterRenames: Record<number, string>;
  characterCosmetics: Record<number, string>;

  currentWeaponId: number | null;
  weapons: Record<number, IWeapon>;
  weaponDurabilities: Record<number, number>;
  weaponRenames: Record<number, string>;
  weaponCosmetics: Record<number, string>;
  maxDurability: number;
  targetsByCharacterIdAndWeaponId: Record<number, Record<number, ITarget>>;

  currentNftType: string | null;
  currentNftId: number | null;

  staking: Record<StakeType | NftStakeType, IStakeState>;
  stakeOverviews: Record<StakeType | NftStakeType, IStakeOverviewState>;

  raid: IRaidState;

  waxBridgeWithdrawableBnb: string;
  waxBridgeRemainingWithdrawableBnbDuringPeriod: string;
  waxBridgeTimeUntilLimitExpires: number;

  isInCombat: boolean;
  isCharacterViewExpanded: boolean;

  shields: Record<number, IShield>;
  currentShieldId: number | null;
  trinkets: Record<number, Nft>;
  junk: Record<number, Nft>;
  keyboxes: Record<number, Nft>;

  nfts: Record<string, Record<number | string, Nft>>;

  partnerProjects: Record<number, IPartnerProject>;
  partnerProjectMultipliers: Record<number, string>;
  partnerProjectRatios: Record<number, string>;
  payoutCurrencyId: string;
  defaultSlippage: string;

  activeSpecialWeaponEventsIds: number[];
  inactiveSpecialWeaponEventsIds: number[];
  specialWeaponEvents: Record<number, ISpecialWeaponEvent>;
  specialWeaponEventId: string;
  shardsSupply: Record<number, number>;

  itemPrices: IItemPrices;
}

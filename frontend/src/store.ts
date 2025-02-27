import Vue from 'vue';
import Vuex from 'vuex';
import Web3 from 'web3';
import _, {isUndefined, values} from 'lodash';
import {bnMinimum, currentChainSupportsMerchandise, currentChainSupportsPvP, currentChainSupportsQuests, gasUsedToBnb, toBN} from './utils/common';

import {getConfigValue, setUpContracts} from './contracts';

import {
  characterFromContract,
  junkFromContract,
  partnerProjectFromContract,
  raidFromContract,
  shieldFromContract,
  targetFromContract,
  trinketFromContract,
  weaponFromContract
} from './contract-models';

import {
  CharacterPower,
  Contract,
  Contracts,
  IPartnerProject,
  IRaidState,
  isNftStakeType,
  isStakeType,
  IStakeOverviewState,
  IStakeState,
  IState,
  IWeb3EventSubscription,
  NftStakeType,
  StakeType
} from './interfaces';
import {getCharacterNameFromSeed} from './character-name';
import {approveFee, approveFeeFromAnyContract, approveFeeFromAnyContractSimple, getFeeInSkillFromUsd} from './contract-call-utils';

import {burningManager as featureFlagBurningManager, raid as featureFlagRaid, stakeOnly as featureFlagStakeOnly} from './feature-flags';
import {ERC20, IERC20, IERC721, INftStakingRewards, IStakingRewards} from '../../build/abi-interfaces';
import {stakeTypeThatCanHaveUnclaimedRewardsStakedTo} from './stake-types';
import {Nft, NftTransfer, TransferedNft} from './interfaces/Nft';
import {getWeaponNameFromSeed} from '@/weapon-name';
import axios from 'axios';
import {abi as ierc20Abi} from '../../build/contracts/IERC20.json';
import {abi as erc20Abi} from '../../build/contracts/ERC20.json';
import {abi as priceOracleAbi} from '../../build/contracts/IPriceOracle.json';
import {CartEntry} from '@/components/smart/VariantChoiceModal.vue';
import {Quest, Rarity, ReputationLevelRequirements, RequirementType, RewardType, TierChances, WeeklyReward} from '@/views/Quests.vue';
import {abi as erc721Abi} from '../../build/contracts/IERC721.json';
import BigNumber from 'bignumber.js';

const transakAPIURL = process.env.VUE_APP_TRANSAK_API_URL || 'https://staging-global.transak.com';
const transakAPIKey = process.env.VUE_APP_TRANSAK_API_KEY || '90167697-74a7-45f3-89da-c24d32b9606c';

const defaultCallOptions = (state: IState) => ({ from: state.defaultAccount });

interface SetEventSubscriptionsPayload {
  eventSubscriptions: () => IWeb3EventSubscription[];
}

type StakingRewardsAlias = Contract<IStakingRewards> | null;
type NftStakingRewardsAlias = Contract<INftStakingRewards> | null;

interface StakingContracts {
  StakingRewards: NftStakingRewardsAlias | StakingRewardsAlias,
  StakingToken: Contract<IERC20> | Contract<IERC721> | null,
  RewardToken: Contracts['SkillToken'],
}

function getStakingContracts(contracts: Contracts, stakeType: StakeType | NftStakeType): StakingContracts {
  if(isNftStakeType(stakeType)) {
    return {
      StakingRewards: contracts.nftStaking[stakeType]?.StakingRewards || null,
      StakingToken: contracts.nftStaking[stakeType]?.StakingToken || null,
      RewardToken: contracts.SkillToken
    };
  }
  return {
    StakingRewards: contracts.staking[stakeType]?.StakingRewards || null,
    StakingToken: contracts.staking[stakeType]?.StakingToken || null,
    RewardToken: contracts.SkillToken
  };
}

type WaxBridgeDetailsPayload = Pick<
IState, 'waxBridgeWithdrawableBnb' | 'waxBridgeRemainingWithdrawableBnbDuringPeriod' | 'waxBridgeTimeUntilLimitExpires'
>;

const defaultStakeState: IStakeState = {
  ownBalance: '0',
  stakedBalance: '0',
  remainingCapacityForDeposit: '0',
  remainingCapacityForWithdraw: '0',
  contractBalance: '0',
  currentRewardEarned: '0',
  rewardMinimumStakeTime: 0,
  rewardDistributionTimeLeft: 0,
  unlockTimeLeft: 0,
};

const defaultStakeOverviewState: IStakeOverviewState = {
  rewardRate: '0',
  rewardsDuration: 0,
  totalSupply: '0',
  minimumStakeTime: 0,
  rewardDistributionTimeLeft: 0
};

export function createStore(web3: Web3) {
  return new Vuex.Store<IState>({
    state: {
      contracts: null!,
      eventSubscriptions: () => [],

      accounts: [],
      defaultAccount: null,
      currentNetworkId: null,
      skillPriceInUsd: 0,

      fightGasOffset: '0',
      fightBaseline: '0',

      skillBalance: '0',
      skillRewards: '0',
      maxRewardsClaimTax: '0',
      rewardsClaimTax: '0',
      xpRewards: {},
      inGameOnlyFunds: '0',
      directStakeBonusPercent: 10,
      ownedCharacterIds: [],
      ownedGarrisonCharacterIds: [],
      ownedWeaponIds: [],
      ownedShieldIds: [],
      ownedTrinketIds: [],
      ownedJunkIds: [],
      ownedKeyLootboxIds: [],
      maxStamina: 0,
      currentCharacterId: null,
      ownedDust: [],
      cartEntries: [],
      currentChainSupportsMerchandise: false,
      currentChainSupportsPvP: false,
      currentChainSupportsQuests: false,

      characters: {},
      garrisonCharacters: {},
      characterStaminas: {},
      characterPowers: {},
      characterIsInArena: {},
      characterRenames: {},
      characterCosmetics: {},
      weapons: {},
      currentWeaponId: null,
      currentNftType: null,
      currentNftId: null,
      weaponDurabilities: {},
      weaponRenames: {},
      maxDurability: 0,
      isInCombat: false,
      weaponCosmetics: {},
      isCharacterViewExpanded: localStorage.getItem('isCharacterViewExpanded') ? localStorage.getItem('isCharacterViewExpanded') === 'true' : true,

      targetsByCharacterIdAndWeaponId: {},

      shields: {},
      trinkets: {},
      junk: {},
      keyboxes: {},
      currentShieldId: null,
      nfts: {},

      staking: {
        skill: { ...defaultStakeState },
        skill2: { ...defaultStakeState },
        lp: { ...defaultStakeState },
        lp2: { ...defaultStakeState },
        king: { ...defaultStakeState },
        king90: { ...defaultStakeState },
        king180: { ...defaultStakeState },
        skill90: { ...defaultStakeState },
        skill180: { ...defaultStakeState },
        cbkLandT1: { ...defaultStakeState },
        cbkLandT2: { ...defaultStakeState },
        cbkLandT3: { ...defaultStakeState }
      },
      stakeOverviews: {
        skill: { ...defaultStakeOverviewState },
        skill2: { ...defaultStakeOverviewState },
        lp: { ...defaultStakeOverviewState },
        lp2: { ...defaultStakeOverviewState },
        king: { ...defaultStakeOverviewState },
        king90: { ...defaultStakeOverviewState },
        king180: { ...defaultStakeOverviewState },
        skill90: { ...defaultStakeOverviewState },
        skill180: { ...defaultStakeOverviewState },
        cbkLandT1: { ...defaultStakeOverviewState },
        cbkLandT2: { ...defaultStakeOverviewState },
        cbkLandT3: { ...defaultStakeOverviewState }
      },

      raid: {
        index: '0',
        expectedFinishTime: '0',
        raiderCount: '0',
        playerPower: '0',
        bossPower: '0',
        bossTrait: '0',
        status: '0',
        joinSkill: '0',
        staminaCost: '0',
        durabilityCost: '0',
        xpReward: '0',
        accountPower: '0',
      },

      waxBridgeWithdrawableBnb: '0',
      waxBridgeRemainingWithdrawableBnbDuringPeriod: '0',
      waxBridgeTimeUntilLimitExpires: 0,

      partnerProjects: {},
      partnerProjectMultipliers: {},
      partnerProjectRatios: {},
      payoutCurrencyId: localStorage.getItem('payoutCurrencyId') || '-1',
      defaultSlippage: '0',

      activeSpecialWeaponEventsIds: [],
      inactiveSpecialWeaponEventsIds: [],
      specialWeaponEvents: {},
      specialWeaponEventId: localStorage.getItem('specialWeaponEventId') || '0',
      shardsSupply: {},

      itemPrices: {
        itemWeaponRenamePrice: '',
        itemCharacterRenamePrice: '',
        itemCharacterTraitChangeEarthPrice: '',
        itemCharacterTraitChangeFirePrice: '',
        itemCharacterTraitChangeLightningPrice: '',
        itemCharacterTraitChangeWaterPrice: '',
        itemWeaponCosmeticGrayscalePrice: '',
        itemWeaponCosmeticContrastPrice: '',
        itemWeaponCosmeticSepiaPrice: '',
        itemWeaponCosmeticInvertPrice: '',
        itemWeaponCosmeticBlurPrice: '',
        itemWeaponCosmeticFireGlowPrice: '',
        itemWeaponCosmeticEarthGlowPrice: '',
        itemWeaponCosmeticLightningGlowPrice: '',
        itemWeaponCosmeticWaterGlowPrice: '',
        itemWeaponCosmeticRainbowGlowPrice: '',
        itemWeaponCosmeticDarkGlowPrice: '',
        itemWeaponCosmeticGhostPrice: '',
        itemWeaponCosmeticPoliceLightsPrice: '',
        itemWeaponCosmeticNeonBorderPrice: '',
        itemWeaponCosmeticRotatingNeonBorderPrice: '',
        itemWeaponCosmeticDiamondBorderPrice: '',
        itemWeaponCosmeticGoldBorderPrice: '',
        itemWeaponCosmeticSilverBorderPrice: '',
        itemWeaponCosmeticBronzeBorderPrice: '',
        itemCharacterCosmeticGrayscalePrice: '',
        itemCharacterCosmeticContrastPrice: '',
        itemCharacterCosmeticSepiaPrice: '',
        itemCharacterCosmeticInvertPrice: '',
        itemCharacterCosmeticBlurPrice: '',
        itemCharacterCosmeticFireGlowPrice: '',
        itemCharacterCosmeticEarthGlowPrice: '',
        itemCharacterCosmeticLightningGlowPrice: '',
        itemCharacterCosmeticWaterGlowPrice: '',
        itemCharacterCosmeticRainbowGlowPrice: '',
        itemCharacterCosmeticDarkGlowPrice: '',
        itemCharacterCosmeticGhostPrice: '',
        itemCharacterCosmeticPoliceLightsPrice: '',
        itemCharacterCosmeticNeonBorderPrice: '',
        itemCharacterCosmeticDiamondBorderPrice: '',
        itemCharacterCosmeticGoldBorderPrice: '',
        itemCharacterCosmeticSilverBorderPrice: '',
        itemCharacterCosmeticBronzeBorderPrice: '',
      },

    },

    getters: {
      contracts(state: IState) {
        // our root component prevents the app from being active if contracts
        // are not set up, so we never need to worry about it being null anywhere else
        return _.isFunction(state.contracts) ? state.contracts() : null!;
      },

      availableStakeTypes(state: IState) {
        return Object.keys(state.contracts().staking).filter(isStakeType);
      },

      availableNftStakeTypes(state: IState) {
        return Object.keys(state.contracts().nftStaking).filter(isNftStakeType);
      },

      hasStakedBalance(state) {
        if(!state.contracts) return false;

        const staking = state.contracts().staking;
        for(const stakeType of Object.keys(staking).filter(isStakeType)) {
          if(state.staking[stakeType].stakedBalance !== '0') {
            return true;
          }
        }
        return false;
      },

      stakedSkillBalanceThatCanBeSpent(state) {
        return state.staking[stakeTypeThatCanHaveUnclaimedRewardsStakedTo].stakedBalance;
      },

      getTargetsByCharacterIdAndWeaponId(state: IState) {
        return (characterId: number, weaponId: number) => {
          const targetsByWeaponId = state.targetsByCharacterIdAndWeaponId[characterId];
          if (!targetsByWeaponId) return [];

          return targetsByWeaponId[weaponId] ?? [];
        };
      },

      getCharacterName(state: IState) {
        return (characterId: number) => {
          if(state.characterRenames[characterId] !== undefined){
            return state.characterRenames[characterId];
          }
          return getCharacterNameFromSeed(characterId);
        };
      },

      getCharacterStamina(state: IState) {
        return (characterId: number) => {
          return state.characterStaminas[characterId];
        };
      },

      getCharacterPower(state: IState) {
        return (characterId: number) => {
          return state.characterPowers[characterId];
        };
      },

      getCharacterIsInArena(state: IState) {
        return (characterId: number) => {
          return state.characterIsInArena[characterId];
        };
      },

      getCharacterRename(state: IState) {
        return (characterId: number) => {
          return state.characterRenames[characterId];
        };
      },

      getCharacterCosmetic(state: IState) {
        return (characterId: number) => {
          return state.characterCosmetics[characterId];
        };
      },

      getCharacterUnclaimedXp(state: IState) {
        return (characterId: number) => {
          return state.xpRewards[characterId];
        };
      },

      getWeaponDurability(state: IState) {
        return (weaponId: number) => {
          return state.weaponDurabilities[weaponId];
        };
      },
      getWeaponRename(state: IState) {
        return (weaponId: number) => {
          return state.weaponRenames[weaponId];
        };
      },
      getWeaponName(state: IState) {
        return (weaponId: number, stars: number) => {
          if(state.weaponRenames[weaponId] !== undefined) {
            return state.weaponRenames[weaponId];
          }

          return getWeaponNameFromSeed(weaponId, stars);
        };
      },
      getWeaponCosmetic(state: IState) {
        return (weaponId: number) => {
          if(state.weaponCosmetics[weaponId] !== undefined) {
            return state.weaponCosmetics[weaponId];
          }

          return 0;
        };
      },
      getExchangeUrl() {
        return getConfigValue('exchangeUrl');
      },
      getExchangeTransakUrl() {
        const currencyNetwork = getConfigValue('currencyNetwork') || 'BSC';
        const currencyDefault = getConfigValue('currency') || 'BNB';
        const currencyList = getConfigValue('currencyTransak') || 'BNB,BUSD';

        const urlCC = 'defaultCryptoCurrency=' + currencyDefault;
        const urlNetwork = 'network=' + currencyNetwork;
        const urlCCL = 'cryptoCurrencyList=' + currencyList;

        return transakAPIURL + '/?apiKey=' + transakAPIKey + '&' + urlCC + '&' + urlNetwork + '&' + urlCCL;
      },
      ownCharacters(state, getters) {
        return getters.charactersWithIds(state.ownedCharacterIds);
      },

      ownGarrisonCharacters(state, getters) {
        return getters.garrisonCharactersWithIds(state.ownedGarrisonCharacterIds);
      },

      charactersWithIds(state) {
        return (characterIds: (string | number)[]) => {
          const characters = characterIds.map((id) => state.characters[+id]);
          if (characters.some((w) => w === null)) return [];
          return characters.filter(Boolean);
        };
      },

      garrisonCharactersWithIds(state) {
        return (characterIds: (string | number)[]) => {
          const characters = characterIds.map((id) => state.garrisonCharacters[+id]);
          if (characters.some((w) => w === null)) return [];
          return characters.filter(Boolean);
        };
      },

      getPowerfulDust(state) {
        return () => {
          const dust = state.ownedDust[2];
          return dust;
        };
      },

      getLesserDust(state) {
        return () => {
          const dust = state.ownedDust[0];
          return dust;
        };
      },

      getGreaterDust(state) {
        return () => {
          const dust = state.ownedDust[1];
          return dust;
        };
      },

      getCartEntries(state) {
        return state.cartEntries;
      },

      getCurrentChainSupportsMerchandise(state) {
        return state.currentChainSupportsMerchandise;
      },

      getCurrentChainSupportsPvP(state) {
        return state.currentChainSupportsPvP;
      },

      getCurrentChainSupportsQuests(state) {
        return state.currentChainSupportsQuests;
      },

      ownWeapons(state, getters) {
        return getters.weaponsWithIds(state.ownedWeaponIds);
      },

      weaponsWithIds(state) {
        return (weaponIds: (string | number)[]) => {
          const weapons = weaponIds.map(id => state.weapons[+id]);
          if (weapons.some((w) => w === null)) return [];
          return weapons;
        };
      },

      shieldsWithIds(state) {
        return (shieldIds: (string | number)[]) => {
          const shields = shieldIds.map(id => {
            const shieldNft = state.shields[+id] as Nft;
            if(!shieldNft) {
              return;
            }
            shieldNft.type = 'shield';
            return shieldNft;
          });
          if (shields.some((s) => s === null)) return [];
          return shields;
        };
      },

      nftsCount(state) {
        let count = 0;
        // add count of various nft types here
        count += state.ownedShieldIds.length;
        count += state.ownedTrinketIds.length;
        count += state.ownedJunkIds.length;
        count += state.ownedKeyLootboxIds.length;
        return count;
      },

      nftsWithIdType(state) {
        return (nftIdTypes: { type: string, id: string | number }[]) => {
          const nfts = nftIdTypes.map((idType) => {
            const nft = state.nfts[idType.type] && state.nfts[idType.type][+(idType.id)];
            if(!nft) {
              return;
            }
            nft.type = idType.type;
            nft.id = idType.id;
            return nft;
          });

          if (nfts.some((t) => t === null)) return [];
          return nfts;
        };
      },

      currentWeapon(state) {
        if (state.currentWeaponId === null) return null;

        return state.weapons[state.currentWeaponId];
      },

      currentCharacter(state) {
        if (state.currentCharacterId === null) return null;

        return state.characters[state.currentCharacterId];
      },

      currentCharacterStamina(state) {
        return state.currentCharacterId === null ? 0 : state.characterStaminas[state.currentCharacterId];
      },

      timeUntilCurrentCharacterHasMaxStamina(state, getters) {
        return getters.timeUntilCharacterHasMaxStamina(state.currentCharacterId);
      },

      timeUntilCharacterHasMaxStamina(state, getters) {
        return (id: number) => {
          const currentStamina = getters.getCharacterStamina(id);

          if (!currentStamina && currentStamina !== 0) {
            return '';
          }

          const date = new Date();

          if (state.maxStamina !== currentStamina) {
            date.setTime(date.getTime() + ((state.maxStamina - currentStamina) * (5 * 60000)));
          }

          return(`${
            (date.getMonth()+1).toString().padStart(2, '0')}/${
            date.getDate().toString().padStart(2, '0')}/${
            date.getFullYear().toString().padStart(4, '0')} ${
            date.getHours().toString().padStart(2, '0')}:${
            date.getMinutes().toString().padStart(2, '0')}:${
            date.getSeconds().toString().padStart(2, '0')}`
          );
        };
      },

      timeUntilWeaponHasMaxDurability(state, getters) {
        return (id: number) => {
          const currentDurability = getters.getWeaponDurability(id);
          if (currentDurability === null || currentDurability === undefined) {
            return '';
          }
          const date = new Date();

          if (state.maxDurability !== currentDurability) {
            date.setTime(date.getTime() + ((state.maxDurability - currentDurability) * (50 * 60000)));
          }

          return(`${
            (date.getMonth()+1).toString().padStart(2, '0')}/${
            date.getDate().toString().padStart(2, '0')}/${
            date.getFullYear().toString().padStart(4, '0')} ${
            date.getHours().toString().padStart(2, '0')}:${
            date.getMinutes().toString().padStart(2, '0')}:${
            date.getSeconds().toString().padStart(2, '0')}`
          );
        };
      },

      allStaminas(state) {
        return state.characterStaminas;
      },

      maxRewardsClaimTaxAsFactorBN(state) {
        return toBN(state.maxRewardsClaimTax).dividedBy(toBN(2).exponentiatedBy(64));
      },

      rewardsClaimTaxAsFactorBN(state) {
        return toBN(state.rewardsClaimTax).dividedBy(toBN(2).exponentiatedBy(64));
      },

      stakeState(state) {
        return (stakeType: StakeType): IStakeState => state.staking[stakeType];
      },

      getRaidState(state): IRaidState {
        return state.raid;
      },

      fightGasOffset(state) {
        return state.fightGasOffset;
      },

      fightBaseline(state) {
        return state.fightBaseline;
      },

      getIsInCombat(state: IState): boolean {
        return state.isInCombat;
      },

      getIsCharacterViewExpanded(state: IState): boolean {
        return state.isCharacterViewExpanded;
      },

      waxBridgeAmountOfBnbThatCanBeWithdrawnDuringPeriod(state): string {
        return bnMinimum(state.waxBridgeWithdrawableBnb, state.waxBridgeRemainingWithdrawableBnbDuringPeriod).toString();
      },

      getPartnerProjects(state): IPartnerProject[] {
        return values(state.partnerProjects);
      }
    },

    mutations: {
      setNetworkId(state, payload) {
        state.currentNetworkId = payload;
      },

      setAccounts(state: IState, payload) {
        state.accounts = payload.accounts;

        if (payload.accounts.length > 0) {
          state.defaultAccount = payload.accounts[0];
        }
        else {
          state.defaultAccount = null;
        }
      },

      setSkillPriceInUsd(state, payload) {
        state.skillPriceInUsd = payload;
      },

      setContracts(state: IState, payload) {
        state.contracts = payload;
      },

      setEventSubscriptions(state: IState, payload: SetEventSubscriptionsPayload) {
        state.eventSubscriptions = payload.eventSubscriptions;
      },

      updateSkillBalance(state: IState, { skillBalance }) {
        state.skillBalance = skillBalance;
      },

      updateDustBalance(state: IState, { dustBalance }) {
        state.ownedDust = dustBalance;
      },

      updateShardsSupply(state: IState, { eventId, shardsSupply }) {
        Vue.set(state.shardsSupply, eventId, shardsSupply);
      },

      updateSkillRewards(state: IState, { skillRewards }: { skillRewards: string }) {
        state.skillRewards = skillRewards;
      },

      updateRewardsClaimTax(
        state,
        { maxRewardsClaimTax, rewardsClaimTax }: { maxRewardsClaimTax: string, rewardsClaimTax: string }
      ) {
        state.maxRewardsClaimTax = maxRewardsClaimTax;
        state.rewardsClaimTax = rewardsClaimTax;
      },

      updateXpRewards(state: IState, { xpRewards }: { xpRewards: { [characterId: string]: string } }) {
        for(const charaId in xpRewards) {
          Vue.set(state.xpRewards, charaId, xpRewards[charaId]);
        }
      },

      updateInGameOnlyFunds(state, { inGameOnlyFunds }: Pick<IState, 'inGameOnlyFunds'>) {
        state.inGameOnlyFunds = inGameOnlyFunds;
      },

      updateFightGasOffset(state: IState, { fightGasOffset }: { fightGasOffset: string }) {
        state.fightGasOffset = fightGasOffset;
      },

      updateFightBaseline(state: IState, { fightBaseline }: { fightBaseline: string }) {
        state.fightBaseline = fightBaseline;
      },

      updateUserDetails(state: IState, payload) {
        const keysToAllow = ['ownedCharacterIds', 'ownedGarrisonCharacterIds', 'ownedWeaponIds', 'maxStamina', 'maxDurability',
          'ownedShieldIds', 'ownedTrinketIds', 'ownedJunkIds', 'ownedKeyLootboxIds'];
        for (const key of keysToAllow) {
          if (Object.hasOwnProperty.call(payload, key)) {
            Vue.set(state, key, payload[key]);
          }
        }

        if (state.ownedCharacterIds.length > 0 &&
          (
            !state.currentCharacterId ||
            !state.ownedCharacterIds.includes(state.currentCharacterId)
          )
        ) {
          state.currentCharacterId = state.ownedCharacterIds[0];
        }
        else if (state.ownedCharacterIds.length === 0) {
          state.currentCharacterId = null;
        }
      },

      setCurrentCharacter(state: IState, characterId: number) {
        state.currentCharacterId = characterId;
      },

      setIsInCombat(state: IState, isInCombat: boolean) {
        state.isInCombat = isInCombat;
      },

      setIsCharacterViewExpanded(state: IState, isExpanded: boolean) {
        state.isCharacterViewExpanded = isExpanded;
        localStorage.setItem('isCharacterViewExpanded', isExpanded ? 'true' : 'false');
      },

      addNewOwnedCharacterId(state: IState, characterId: number) {
        if (!state.ownedCharacterIds.includes(characterId)) {
          state.ownedCharacterIds.push(characterId);
        }
      },

      addNewOwnedGarrisonCharacterId(state: IState, characterId: number) {
        if (!state.ownedGarrisonCharacterIds.includes(characterId)) {
          state.ownedGarrisonCharacterIds.push(characterId);
        }
      },

      addNewOwnedWeaponId(state: IState, weaponId: number) {
        if (!state.ownedWeaponIds.includes(weaponId)) {
          state.ownedWeaponIds.push(weaponId);
        }
      },

      addNewOwnedShieldId(state: IState, shieldId: number) {
        if (!state.ownedShieldIds.includes(shieldId)) {
          state.ownedShieldIds.push(shieldId);
        }
      },

      addCartEntry(state: IState, cartEntry: CartEntry) {
        const duplicatedEntry = state.cartEntries.find(entry => entry.variant.id === cartEntry.variant.id);
        if (duplicatedEntry) {
          const entryIndex = state.cartEntries.indexOf(duplicatedEntry);
          state.cartEntries.splice(entryIndex, 1);
        }
        state.cartEntries.push(cartEntry);
      },

      removeCartEntry(state: IState, cartEntry: CartEntry) {
        state.cartEntries.splice(state.cartEntries.indexOf(cartEntry), 1);
      },

      clearCartEntries(state: IState) {
        state.cartEntries = [];
      },

      updateCurrentChainSupportsMerchandise(state: IState) {
        state.currentChainSupportsMerchandise = currentChainSupportsMerchandise();
      },

      updateCurrentChainSupportsPvP(state: IState) {
        state.currentChainSupportsPvP = currentChainSupportsPvP();
      },

      updateCurrentChainSupportsQuests(state: IState) {
        state.currentChainSupportsQuests = currentChainSupportsQuests();
      },

      updateCharacter(state: IState, { characterId, character }) {
        Vue.set(state.characters, characterId, character);
      },

      updateGarrisonCharacter(state: IState, { characterId, character }) {
        Vue.set(state.garrisonCharacters, characterId, character);
      },

      updateShield(state: IState, { shieldId, shield }) {
        Vue.set(state.shields, shieldId, shield);
        if(!state.nfts.shield) {
          Vue.set(state.nfts, 'shield', {});
        }
        Vue.set(state.nfts.shield, shieldId, shield);
      },

      updateTrinket(state: IState, { trinketId, trinket }) {
        Vue.set(state.trinkets, trinketId, trinket);
        if(!state.nfts.trinket) {
          Vue.set(state.nfts, 'trinket', {});
        }
        Vue.set(state.nfts.trinket, trinketId, trinket);
      },

      updateJunk(state: IState, { junkId, junk }) {
        Vue.set(state.junk, junkId, junk);
        if(!state.nfts.junk) {
          Vue.set(state.nfts, 'junk', {});
        }
        Vue.set(state.nfts.junk, junkId, junk);
      },

      updateKeyLootbox(state: IState, { keyLootboxId, keybox }) {
        Vue.set(state.keyboxes, keyLootboxId, keybox);
        if(!state.nfts.keybox) {
          Vue.set(state.nfts, 'keybox', {});
        }
        Vue.set(state.nfts.keybox, keyLootboxId, keybox);
      },

      updateWeapon(state: IState, { weaponId, weapon }) {
        Vue.set(state.weapons, weaponId, weapon);
      },

      setCurrentWeapon(state: IState, weaponId: number) {
        state.currentWeaponId = weaponId;
      },

      updateWeaponDurability(state: IState, { weaponId, durability }) {
        Vue.set(state.weaponDurabilities, weaponId, durability);
      },
      updateWeaponRename(state: IState, { weaponId, renameString }) {
        if(renameString !== undefined){
          Vue.set(state.weaponRenames, weaponId, renameString);
        }
      },
      updateWeaponCosmetic(state: IState, { weaponId, weaponCosmetic }) {
        Vue.set(state.weaponCosmetics, weaponId, weaponCosmetic);
      },
      updateCharacterStamina(state: IState, { characterId, stamina }) {
        Vue.set(state.characterStaminas, characterId, stamina);
      },
      updateCharacterPower(state: IState, { characterId, power }) {
        Vue.set(state.characterPowers, characterId, +power);
      },
      updateCharacterInArena(state: IState, { characterId, isCharacterInArena }) {
        Vue.set(state.characterIsInArena, characterId, isCharacterInArena);
      },
      updateCharacterRename(state: IState, { characterId, renameString }) {
        if(renameString !== undefined){
          Vue.set(state.characterRenames, characterId, renameString);
        }
      },
      updateCharacterCosmetic(state: IState, { characterId, characterCosmetic }) {
        Vue.set(state.characterCosmetics, characterId, characterCosmetic);
      },
      updateTargets(state: IState, { characterId, weaponId, targets }) {
        if (!state.targetsByCharacterIdAndWeaponId[characterId]) {
          Vue.set(state.targetsByCharacterIdAndWeaponId, characterId, {});
        }

        Vue.set(state.targetsByCharacterIdAndWeaponId[characterId], weaponId, targets);
      },

      updateStakeData(state: IState, { stakeType, ...payload }: { stakeType: StakeType } & IStakeState) {
        Vue.set(state.staking, stakeType, payload);
      },

      updateStakeOverviewDataPartial(state, payload: { stakeType: StakeType } & IStakeOverviewState) {
        const { stakeType, ...data } = payload;
        Vue.set(state.stakeOverviews, stakeType, data);
      },

      updateRaidState(state: IState, payload: { raidState: IRaidState }) {
        state.raid.index = payload.raidState.index;
        state.raid.expectedFinishTime = payload.raidState.expectedFinishTime;
        state.raid.raiderCount = payload.raidState.raiderCount;
        state.raid.playerPower = payload.raidState.playerPower;
        state.raid.bossPower = payload.raidState.bossPower;
        state.raid.bossTrait = payload.raidState.bossTrait;
        state.raid.status = payload.raidState.status;
        state.raid.joinSkill = payload.raidState.joinSkill;
        state.raid.staminaCost = payload.raidState.staminaCost;
        state.raid.durabilityCost = payload.raidState.durabilityCost;
        state.raid.xpReward = payload.raidState.xpReward;
        state.raid.accountPower = payload.raidState.accountPower;
      },

      updateWaxBridgeDetails(state, payload: WaxBridgeDetailsPayload) {
        state.waxBridgeWithdrawableBnb = payload.waxBridgeWithdrawableBnb;
        state.waxBridgeRemainingWithdrawableBnbDuringPeriod = payload.waxBridgeRemainingWithdrawableBnbDuringPeriod;
        state.waxBridgeTimeUntilLimitExpires = payload.waxBridgeTimeUntilLimitExpires;
      },

      setCurrentNft(state: IState, payload: {type: string, id: number} ) {
        state.currentNftType = payload.type;
        state.currentNftId = payload.id;
      },

      updatePartnerProjectsState(state: IState, { partnerProjectId, partnerProject }) {
        Vue.set(state.partnerProjects, partnerProjectId, partnerProject);
      },

      updateDefaultSlippage(state: IState, slippage) {
        state.defaultSlippage = slippage;
      },

      updatePartnerProjectMultiplier(state: IState, { partnerProjectId, multiplier }) {
        Vue.set(state.partnerProjectMultipliers, partnerProjectId, multiplier);
      },

      updatePartnerProjectRatio(state: IState, { partnerProjectId, ratio }) {
        Vue.set(state.partnerProjectRatios, partnerProjectId, ratio);
      },

      updatePayoutCurrencyId(state: IState, newPayoutCurrencyId) {
        localStorage.setItem('payoutCurrencyId', newPayoutCurrencyId);
        state.payoutCurrencyId = newPayoutCurrencyId;
      },

      updateItemPrices(state: IState, {itemPrice, id}) {
        switch(id){
        case '1': {
          state.itemPrices.itemWeaponRenamePrice = itemPrice;
          break;
        }
        case '2':{
          state.itemPrices.itemCharacterRenamePrice = itemPrice;
          break;
        }
        case '3':{
          state.itemPrices.itemCharacterTraitChangeFirePrice = itemPrice;
          break;
        }
        case '4':{
          state.itemPrices.itemCharacterTraitChangeEarthPrice = itemPrice;
          break;
        }
        case '5':{
          state.itemPrices.itemCharacterTraitChangeWaterPrice = itemPrice;
          break;
        }
        case '6':{
          state.itemPrices.itemCharacterTraitChangeLightningPrice = itemPrice;
          break;
        }

        }
      },

      updateWeaponCosmeticPrices(state: IState, {itemPrice, id}){
        switch(id){
        case '1':{
          state.itemPrices.itemWeaponCosmeticGrayscalePrice = itemPrice;
          break;
        }
        case '2':{
          state.itemPrices.itemWeaponCosmeticContrastPrice = itemPrice;
          break;
        }
        case '3':{
          state.itemPrices.itemWeaponCosmeticSepiaPrice = itemPrice;
          break;
        }
        case '4':{
          state.itemPrices.itemWeaponCosmeticInvertPrice = itemPrice;
          break;
        }
        case '5':{
          state.itemPrices.itemWeaponCosmeticBlurPrice = itemPrice;
          break;
        }
        case '6':{
          state.itemPrices.itemWeaponCosmeticFireGlowPrice = itemPrice;
          break;
        }
        case '7':{
          state.itemPrices.itemWeaponCosmeticEarthGlowPrice = itemPrice;
          break;
        }
        case '8':{
          state.itemPrices.itemWeaponCosmeticLightningGlowPrice = itemPrice;
          break;
        }
        case '9':{
          state.itemPrices.itemWeaponCosmeticWaterGlowPrice = itemPrice;
          break;
        }
        case '10':{
          state.itemPrices.itemWeaponCosmeticRainbowGlowPrice = itemPrice;
          break;
        }
        case '11':{
          state.itemPrices.itemWeaponCosmeticDarkGlowPrice = itemPrice;
          break;
        }
        case '12':{
          state.itemPrices.itemWeaponCosmeticGhostPrice = itemPrice;
          break;
        }
        case '13':{
          state.itemPrices.itemWeaponCosmeticPoliceLightsPrice = itemPrice;
          break;
        }
        case '14':{
          state.itemPrices.itemWeaponCosmeticNeonBorderPrice = itemPrice;
          break;
        }
        case '15':{
          state.itemPrices.itemWeaponCosmeticRotatingNeonBorderPrice = itemPrice;
          break;
        }
        case '16':{
          state.itemPrices.itemWeaponCosmeticDiamondBorderPrice = itemPrice;
          break;
        }
        case '17':{
          state.itemPrices.itemWeaponCosmeticGoldBorderPrice = itemPrice;
          break;
        }
        case '18':{
          state.itemPrices.itemWeaponCosmeticSilverBorderPrice = itemPrice;
          break;
        }
        case '19':{
          state.itemPrices.itemWeaponCosmeticBronzeBorderPrice = itemPrice;
        }
        }
      },

      updateCharacterCosmeticPrices(state: IState, {itemPrice, id}){
        switch(id){
        case '1':{
          state.itemPrices.itemCharacterCosmeticGrayscalePrice = itemPrice;
          break;
        }
        case '2':{
          state.itemPrices.itemCharacterCosmeticContrastPrice = itemPrice;
          break;
        }
        case '3':{
          state.itemPrices.itemCharacterCosmeticSepiaPrice = itemPrice;
          break;
        }
        case '4':{
          state.itemPrices.itemCharacterCosmeticInvertPrice = itemPrice;
          break;
        }
        case '5':{
          state.itemPrices.itemCharacterCosmeticBlurPrice = itemPrice;
          break;
        }
        case '6':{
          state.itemPrices.itemCharacterCosmeticFireGlowPrice = itemPrice;
          break;
        }
        case '7':{
          state.itemPrices.itemCharacterCosmeticEarthGlowPrice = itemPrice;
          break;
        }
        case '8':{
          state.itemPrices.itemCharacterCosmeticLightningGlowPrice = itemPrice;
          break;
        }
        case '9':{
          state.itemPrices.itemCharacterCosmeticWaterGlowPrice = itemPrice;
          break;
        }
        case '10':{
          state.itemPrices.itemCharacterCosmeticRainbowGlowPrice = itemPrice;
          break;
        }
        case '11':{
          state.itemPrices.itemCharacterCosmeticDarkGlowPrice = itemPrice;
          break;
        }
        case '12':{
          state.itemPrices.itemCharacterCosmeticGhostPrice = itemPrice;
          break;
        }
        case '13':{
          state.itemPrices.itemCharacterCosmeticPoliceLightsPrice = itemPrice;
          break;
        }
        case '14':{
          state.itemPrices.itemCharacterCosmeticNeonBorderPrice = itemPrice;
          break;
        }
        case '15':{
          state.itemPrices.itemCharacterCosmeticDiamondBorderPrice = itemPrice;
          break;
        }
        case '16':{
          state.itemPrices.itemCharacterCosmeticGoldBorderPrice = itemPrice;
          break;
        }
        case '17':{
          state.itemPrices.itemCharacterCosmeticSilverBorderPrice = itemPrice;
          break;
        }
        case '18':{
          state.itemPrices.itemCharacterCosmeticBronzeBorderPrice = itemPrice;
          break;
        }
        }
      },

      updateSpecialWeaponEventsInfo(state: IState, {eventId, eventInfo}) {
        Vue.set(state.specialWeaponEvents, eventId, eventInfo);
      },

      updateActiveSpecialWeaponEventsIds(state: IState, eventsIds) {
        Vue.set(state, 'activeSpecialWeaponEventsIds', eventsIds);
        if(!eventsIds.find((id: { toString: () => string; }) => id.toString() === state.specialWeaponEventId)) {
          state.specialWeaponEventId = '0';
        }
      },

      updateInactiveSpecialWeaponEventsIds(state: IState, eventsIds) {
        Vue.set(state, 'inactiveSpecialWeaponEventsIds', eventsIds);
      },

      updateSpecialWeaponEventId(state: IState, newSpecialWeaponEventId) {
        localStorage.setItem('specialWeaponEventId', newSpecialWeaponEventId.toString());
        state.specialWeaponEventId = newSpecialWeaponEventId.toString();
      },

      updateForgingStatus(state: IState, { eventId, ordered, forged }) {
        Vue.set(state.specialWeaponEvents[eventId], 'ordered', ordered);
        Vue.set(state.specialWeaponEvents[eventId], 'forged', forged);
      },

      updateEventTotalOrderedCount(state: IState, { eventId, orderedCount }) {
        Vue.set(state.specialWeaponEvents[eventId], 'orderedCount', orderedCount);
      },
    },

    actions: {
      async initialize({ dispatch }) {
        await dispatch('setUpContracts');
        await dispatch('setUpContractEvents');

        await dispatch('pollAccountsAndNetwork');
        await dispatch('pollSkillPriceInUsd');

        await dispatch('setupCharacterStaminas');
        await dispatch('setupCharacterRenames');
        await dispatch('setupCharacterCosmetics');

        await dispatch('setupWeaponDurabilities');
        await dispatch('setupWeaponRenames');
        await dispatch('setupWeaponCosmetics');

        await dispatch('fetchSpecialWeaponEvents');
      },

      async pollAccountsAndNetwork({ state, dispatch, commit }) {
        let refreshUserDetails = false;
        const networkId = await web3.eth.net.getId();

        if(state.currentNetworkId !== networkId) {
          commit('setNetworkId', networkId);
          refreshUserDetails = true;
        }

        const accounts = await web3.eth.requestAccounts();

        if (!_.isEqual(state.accounts, accounts)) {
          commit('setAccounts', { accounts });
          refreshUserDetails = true;
        }

        if(refreshUserDetails) {
          await Promise.all([
            dispatch('setUpContractEvents'),
            dispatch('fetchUserDetails')
          ]);
        }
      },

      async pollSkillPriceInUsd({ state, commit }) {
        const fetchPriceData = async () => {
          const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=cryptoblades,binancecoin&vs_currencies=usd');
          const skillPriceInUsd = response.data?.cryptoblades.usd;
          if (state.skillPriceInUsd !== skillPriceInUsd) {
            commit('setSkillPriceInUsd', skillPriceInUsd);
          }
        };
        await fetchPriceData();
        setInterval(async () => {
          await fetchPriceData();
        }, 30000);
      },



      setUpContractEvents({ state, dispatch, commit }) {
        state.eventSubscriptions().forEach(sub => sub.unsubscribe());

        const emptySubsPayload: SetEventSubscriptionsPayload = { eventSubscriptions: () => [] };
        commit('setEventSubscriptions', emptySubsPayload);

        if(!state.defaultAccount) return;

        const subscriptions: IWeb3EventSubscription[] = [];

        if (!featureFlagStakeOnly) {
          subscriptions.push(
            state.contracts().Characters!.events.NewCharacter(
              { filter: { minter: state.defaultAccount } },
              async (err: Error, data: any) => {
                if (err) {
                  console.error(err, data);
                  return;
                }

                const characterId = data.returnValues.character;

                commit('addNewOwnedCharacterId', characterId);

                await Promise.all([
                  dispatch('fetchCharacter', { characterId }),
                  dispatch('fetchSkillBalance'),
                  dispatch('fetchFightRewardSkill'),
                  dispatch('fetchFightRewardXp'),
                  dispatch('fetchDustBalance')
                ]);
              })
          );

          subscriptions.push(
            state.contracts().Garrison!.events.CharacterReceived(
              { filter: { minter: state.defaultAccount } },
              async (err: Error, data: any) => {
                if (err) {
                  console.error(err, data);
                  return;
                }

                const characterId = data.returnValues.character;

                commit('addNewOwnedGarrisonCharacterId', characterId);
                //Events.$emit('garrison:characterReceived', { id: characterId });

                await Promise.all([
                  dispatch('fetchCharacter', { characterId, inGarrison: true }),
                  dispatch('fetchSkillBalance'),
                  dispatch('fetchFightRewardSkill'),
                  dispatch('fetchFightRewardXp'),
                  dispatch('fetchGarrisonCharactersXp'),
                  dispatch('fetchDustBalance')
                ]);
              })
          );

          subscriptions.push(
            state.contracts().Weapons!.events.NewWeapon({ filter: { minter: state.defaultAccount } }, async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              const weaponId = data.returnValues.weapon;

              commit('addNewOwnedWeaponId', weaponId);

              await Promise.all([
                dispatch('fetchWeapon', weaponId),
                dispatch('fetchSkillBalance'),
              ]);
            })
          );

          subscriptions.push(
            state.contracts().Shields!.events.NewShield({ filter: { minter: state.defaultAccount } }, async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              const shieldId = data.returnValues.shield;

              commit('addNewOwnedShieldId', shieldId);

              await Promise.all([
                dispatch('fetchShield', shieldId),
                dispatch('fetchSkillBalance'),
                dispatch('fetchDustBalance')
              ]);
            })
          );

          subscriptions.push(
            state.contracts().CryptoBlades!.events.FightOutcome({ filter: { owner: state.defaultAccount } }, async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              await Promise.all([
                dispatch('fetchCharacter', { characterId: data.returnValues.character }),
                dispatch('fetchSkillBalance')
              ]);
            })
          );

          subscriptions.push(
            state.contracts().CryptoBlades!.events.InGameOnlyFundsGiven({ filter: { to: state.defaultAccount } }, async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              await Promise.all([
                dispatch('fetchInGameOnlyFunds')
              ]);
            })
          );

          const { NFTMarket } = state.contracts();

          if(NFTMarket) {
            subscriptions.push(
              NFTMarket.events.PurchasedListing({ filter: { seller: state.defaultAccount } }, async (err: Error, data: any) => {
                if (err) {
                  console.error(err, data);
                  return;
                }

                await dispatch('fetchSkillBalance');
              })
            );
          }

        }

        function setupStakingEvents(stakeType: StakeType, StakingRewards: StakingRewardsAlias | NftStakingRewardsAlias) {
          if(!StakingRewards) return;

          subscriptions.push(
            StakingRewards.events.RewardPaid({ filter: { user: state.defaultAccount } }, async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              await dispatch('fetchStakeDetails', { stakeType });
            })
          );

          subscriptions.push(
            StakingRewards.events.RewardAdded(async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              await dispatch('fetchStakeDetails', { stakeType });
            })
          );

          subscriptions.push(
            StakingRewards.events.RewardsDurationUpdated(async (err: Error, data: any) => {
              if (err) {
                console.error(err, data);
                return;
              }

              await dispatch('fetchStakeDetails', { stakeType });
            })
          );
        }

        const staking = state.contracts().staking;
        for(const stakeType of Object.keys(staking).filter(isStakeType)) {
          const stakingEntry = staking[stakeType]!;

          setupStakingEvents(stakeType, stakingEntry.StakingRewards);
        }

        const payload: SetEventSubscriptionsPayload = { eventSubscriptions: () => subscriptions };
        commit('setEventSubscriptions', payload);
      },

      async setUpContracts({ commit }) {
        const contracts = await setUpContracts(web3);
        commit('setContracts', () => contracts);
      },

      async fetchUserDetails({ dispatch }) {
        const promises = [dispatch('fetchSkillBalance'), dispatch('fetchWaxBridgeDetails'), dispatch('fetchDustBalance'), dispatch('fetchShardsSupply')];

        if (!featureFlagStakeOnly) {
          promises.push(dispatch('fetchUserGameDetails'));
        }

        await Promise.all([promises]);
      },

      async fetchUserGameDetails({ state, dispatch, commit }) {
        if(featureFlagStakeOnly) return;
        const [
          ownedCharacterIds,
          ownedGarrisonCharacterIds,
          ownedWeaponIds,
          ownedShieldIds,
          ownedTrinketIds,
          ownedJunkIds,
          ownedKeyLootboxIds,
          maxStamina,
          maxDurability,
        ] = await Promise.all([
          dispatch('getAccountCharacters'),
          dispatch('getAccountGarrisonCharacters'),
          dispatch('getAccountWeapons'),
          state.contracts().Shields!.methods.getOwned().call(defaultCallOptions(state)),
          state.contracts().RaidTrinket!.methods.getOwned().call(defaultCallOptions(state)) || [],
          state.contracts().Junk!.methods.getOwned().call(defaultCallOptions(state)) || [],
          state.contracts().KeyLootbox!.methods.getOwned().call(defaultCallOptions(state)) || [],
          state.contracts().Characters!.methods.maxStamina().call(defaultCallOptions(state)),
          state.contracts().Weapons!.methods.maxDurability().call(defaultCallOptions(state)),
        ]);

        commit('updateUserDetails', {
          ownedCharacterIds: Array.from(ownedCharacterIds),
          ownedGarrisonCharacterIds: Array.from(ownedGarrisonCharacterIds),
          ownedWeaponIds: Array.from(ownedWeaponIds),
          ownedShieldIds: Array.from(ownedShieldIds),
          ownedTrinketIds: Array.from(ownedTrinketIds),
          ownedJunkIds: Array.from(ownedJunkIds),
          ownedKeyLootboxIds: Array.from(ownedKeyLootboxIds),
          maxStamina: parseInt(maxStamina, 10),
          maxDurability: parseInt(maxDurability, 10),
        });

        await Promise.all([
          dispatch('fetchCharacters', ownedCharacterIds),
          dispatch('fetchGarrisonCharacters', ownedGarrisonCharacterIds),
          dispatch('fetchWeapons', ownedWeaponIds),
          dispatch('fetchShields', ownedShieldIds),
          dispatch('fetchTrinkets', ownedTrinketIds),
          dispatch('fetchJunks', ownedJunkIds),
          dispatch('fetchKeyLootboxes', ownedKeyLootboxIds),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchFightRewardXp'),
          dispatch('fetchGarrisonCharactersXp'),
          dispatch('fetchFightGasOffset'),
          dispatch('fetchFightBaseline'),
        ]);
      },

      async updateWeaponIds({ dispatch, commit }) {
        if(featureFlagStakeOnly) return;

        const ownedWeaponIds = await dispatch('getAccountWeapons');
        commit('updateUserDetails', {
          ownedWeaponIds: Array.from(ownedWeaponIds)
        });
        await dispatch('fetchWeapons', ownedWeaponIds);
      },

      async updateCharacterIds({ dispatch, commit }) {
        if(featureFlagStakeOnly) return;

        const ownedCharacterIds = await dispatch('getAccountCharacters');
        const ownedGarrisonCharacterIds = await dispatch('getAccountGarrisonCharacters');
        commit('updateUserDetails', {
          ownedCharacterIds: Array.from(ownedCharacterIds),
          ownedGarrisonCharacterIds: Array.from(ownedGarrisonCharacterIds)
        });
        await dispatch('fetchCharacters', ownedCharacterIds);
        await dispatch('fetchGarrisonCharacters', ownedGarrisonCharacterIds);
      },

      async updateShieldIds({ state, dispatch, commit }) {
        if(featureFlagStakeOnly) return;

        const ownedShieldIds = await state.contracts().Shields!.methods.getOwned().call(defaultCallOptions(state));
        commit('updateUserDetails', {
          ownedShieldIds: Array.from(ownedShieldIds)
        });
        await dispatch('fetchShields', ownedShieldIds);
      },

      async updateTrinketIds({ state, dispatch, commit }) {
        if(featureFlagStakeOnly || !state.defaultAccount) return;

        const ownedTrinketIds = await state.contracts().RaidTrinket!.methods.getOwned().call(defaultCallOptions(state));
        commit('updateUserDetails', {
          ownedTrinketIds: Array.from(ownedTrinketIds)
        });
        await dispatch('fetchTrinkets', ownedTrinketIds);
      },

      async updateJunkIds({ state, dispatch, commit }) {
        if(featureFlagStakeOnly || !state.defaultAccount) return;

        const ownedJunkIds = await state.contracts().Junk!.methods.getOwned().call(defaultCallOptions(state));
        commit('updateUserDetails', {
          ownedJunkIds: Array.from(ownedJunkIds)
        });
        await dispatch('fetchJunks', ownedJunkIds);
      },

      async updateKeyLootboxIds({ state, dispatch, commit }) {
        if(featureFlagStakeOnly || !state.defaultAccount) return;

        const ownedKeyLootboxIds = await state.contracts().KeyLootbox!.methods.getOwned().call(defaultCallOptions(state));
        commit('updateUserDetails', {
          ownedKeyLootboxIds: Array.from(ownedKeyLootboxIds)
        });
        await dispatch('fetchKeyLootboxes', ownedKeyLootboxIds);
      },

      async fetchSkillBalance({ state, commit, dispatch }) {
        const { defaultAccount } = state;
        if(!defaultAccount) return;

        await Promise.all([
          (async () => {
            const skillBalance = await state.contracts().SkillToken.methods
              .balanceOf(defaultAccount)
              .call(defaultCallOptions(state));

            if(state.skillBalance !== skillBalance) {
              commit('updateSkillBalance', { skillBalance });
            }
          })(),
          dispatch('fetchInGameOnlyFunds'),
          dispatch('fetchStakeDetails', { stakeType: stakeTypeThatCanHaveUnclaimedRewardsStakedTo })
        ]);
      },

      async fetchDustBalance({ state, commit }) {
        const { defaultAccount } = state;
        if(!defaultAccount) return;

        await Promise.all([
          (async () => {
            const dustBalance = await state.contracts().Weapons!.methods
              .getDustSupplies(defaultAccount)
              .call(defaultCallOptions(state));
            commit('updateDustBalance', { dustBalance });
          })(),
        ]);
      },

      async fetchShardsSupply({ state, commit }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        const eventCount = +await SpecialWeaponsManager.methods.eventCount().call(defaultCallOptions(state));
        for(let i = 1; i <= eventCount; i++) {
          const eventShardsSupply = await SpecialWeaponsManager.methods.getUserSpecialShardsSupply(state.defaultAccount, i).call(defaultCallOptions(state));
          commit('updateShardsSupply', { eventId: i, shardsSupply: +eventShardsSupply });
        }
      },

      async fetchSoulBalance({ state }) {
        const { BurningManager } = state.contracts();
        if(!BurningManager || !state.defaultAccount) return;
        return await BurningManager.methods.userVars(state.defaultAccount, 1).call(defaultCallOptions(state));
      },

      async fetchInGameOnlyFunds({ state, commit }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades || !state.defaultAccount) return;

        const inGameOnlyFunds = await CryptoBlades.methods
          .inGameOnlyFunds(state.defaultAccount)
          .call(defaultCallOptions(state));

        const payload: Pick<IState, 'inGameOnlyFunds'> = { inGameOnlyFunds };
        commit('updateInGameOnlyFunds', payload);
      },

      async addMoreSkill({ state, dispatch }, skillToAdd: string) {
        if(featureFlagStakeOnly) return;

        await state.contracts().CryptoBlades!.methods.recoverSkill(skillToAdd).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchSkillBalance');
      },

      async fetchCharacters({ dispatch }, characterIds: (string | number)[]) {
        await Promise.all(characterIds.map(id => dispatch('fetchCharacter', { characterId: id })));
      },

      async fetchGarrisonCharacters({ dispatch }, garrisonCharacterIds: (string | number)[]) {
        await Promise.all(garrisonCharacterIds.map(id => dispatch('fetchCharacter', { characterId: id, inGarrison: true })));
      },

      async fetchCharacter({ state, commit, dispatch }, { characterId, inGarrison = false }: { characterId: string | number, inGarrison: boolean}) {
        const { Characters } = state.contracts();
        if(!Characters) return;

        await Promise.all([
          (async () => {
            const character = characterFromContract(
              characterId,
              await Characters.methods.get('' + characterId).call(defaultCallOptions(state))
            );
            await dispatch('fetchCharacterPower', characterId);
            await dispatch('getIsCharacterInArena', characterId);

            if(!inGarrison) {
              commit('updateCharacter', { characterId, character });
            }
            else {
              commit('updateGarrisonCharacter', { characterId, character });
            }
          })(),
        ]);
      },

      async fetchCharacterPower( {state, commit}, characterId) {
        const { Characters } = state.contracts();
        if(!Characters || !state.defaultAccount) return;
        if(!featureFlagBurningManager) {
          const level = await Characters.methods.getLevel(characterId).call(defaultCallOptions(state));
          const power = CharacterPower(+level);
          commit('updateCharacterPower', { characterId, power });
        }
        else {
          const power = await Characters.methods.getTotalPower(characterId).call(defaultCallOptions(state));
          commit('updateCharacterPower', { characterId, power });
        }
      },

      async fetchWeapons({ dispatch }, weaponIds: (string | number)[]) {
        await Promise.all(weaponIds.map(id => dispatch('fetchWeapon', id)));
      },

      async fetchWeapon({ state, commit, dispatch }, weaponId: string | number) {
        const { Weapons } = state.contracts();
        if(!Weapons) return;

        await Promise.all([
          (async () => {
            const weapon = weaponFromContract(
              weaponId,
              await Weapons.methods.get('' + weaponId).call(defaultCallOptions(state))
            );

            commit('updateWeapon', { weaponId, weapon });
          })(),
        ]);
        dispatch('fetchWeaponDurability', weaponId);
      },

      async fetchShields({ dispatch }, shieldIds: (string | number)[]) {
        await Promise.all(shieldIds.map(id => dispatch('fetchShield', id)));
      },

      async fetchShield({ state, commit }, shieldId: string | number) {
        const { Shields } = state.contracts();
        if(!Shields) return;

        await Promise.all([
          (async () => {
            const shield = shieldFromContract(
              shieldId,
              await Shields.methods.get('' + shieldId).call(defaultCallOptions(state))
            );

            commit('updateShield', { shieldId, shield });
          })(),
        ]);
      },

      async fetchTrinkets({ dispatch }, trinketIds: (string | number)[]) {
        await Promise.all(trinketIds.map(id => dispatch('fetchTrinket', id)));
      },

      async fetchTrinket({ state, commit }, trinketId: string | number) {
        const { RaidTrinket } = state.contracts();
        if(!RaidTrinket) return;

        await Promise.all([
          (async () => {
            const trinket = trinketFromContract(
              trinketId,
              await RaidTrinket.methods.get('' + trinketId).call(defaultCallOptions(state))
            );

            commit('updateTrinket', { trinketId, trinket });
          })(),
        ]);
      },

      async fetchJunks({ dispatch }, junkIds: (string | number)[]) {
        await Promise.all(junkIds.map(id => dispatch('fetchJunk', id)));
      },

      async fetchJunk({ state, commit }, junkId: string | number) {
        const { Junk } = state.contracts();
        if(!Junk) return;

        await Promise.all([
          (async () => {
            const junk = junkFromContract(
              junkId,
              await Junk.methods.get('' + junkId).call(defaultCallOptions(state))
            );

            commit('updateJunk', { junkId, junk });
          })(),
        ]);
      },

      async fetchKeyLootboxes({ commit }, keyLootboxesIds: (string | number)[]) {
        keyLootboxesIds.forEach(id => {
          const keybox: Nft = { id, type: 'keybox' };
          commit('updateKeyLootbox', { keyLootboxId: id, keybox });
        });
      },

      async setupWeaponDurabilities({ dispatch }) {
        const ownedWeaponIds = await dispatch('getAccountWeapons');

        for (const weapId of ownedWeaponIds) {
          dispatch('fetchWeaponDurability', weapId);
        }
      },

      async fetchWeaponDurability({ state, commit }, weaponId: number) {
        if(featureFlagStakeOnly) return;

        const durabilityString = await state.contracts().Weapons!.methods
          .getDurabilityPoints('' + weaponId)
          .call(defaultCallOptions(state));

        const durability = parseInt(durabilityString, 10);
        if (state.weaponDurabilities[weaponId] !== durability) {
          commit('updateWeaponDurability', { weaponId, durability });
        }
      },

      async setupWeaponRenames({ dispatch }) {
        const ownedWeaponIds = await dispatch('getAccountWeapons');

        for (const weapId of ownedWeaponIds) {
          dispatch('fetchWeaponRename', weapId);
        }
      },

      async setupWeaponsWithIdsRenames({ dispatch }, weaponIds: string[]) {
        for (const weapId of weaponIds) {
          dispatch('fetchWeaponRename', weapId);
        }
      },

      async fetchWeaponRename({ state, commit }, weaponId: number) {
        const renameString = await state.contracts().WeaponRenameTagConsumables!.methods
          .getWeaponRename(weaponId)
          .call(defaultCallOptions(state));
        if(renameString !== '' && state.weaponRenames[weaponId] !== renameString){
          commit('updateWeaponRename', { weaponId, renameString });
        }
      },

      async setupWeaponCosmetics({ dispatch }) {
        const ownedWeaponIds = await dispatch('getAccountWeapons');

        for (const weapId of ownedWeaponIds) {
          dispatch('fetchWeaponCosmetic', weapId);
        }
      },

      async setupWeaponsWithIdsCosmetics({ dispatch }, weaponIds: string[]) {
        for (const weapId of weaponIds) {
          dispatch('fetchWeaponCosmetic', weapId);
        }
      },

      async fetchWeaponCosmetic({ state, commit }, weaponId: number) {
        const weaponCosmetic = await state.contracts().WeaponCosmetics!.methods
          .getWeaponCosmetic(weaponId)
          .call(defaultCallOptions(state));
        if(state.weaponCosmetics[weaponId] !== weaponCosmetic){
          commit('updateWeaponCosmetic', { weaponId, weaponCosmetic });
        }
      },

      async setupCharacterStaminas({ dispatch }) {
        const ownedCharacterIds = await dispatch('getAccountCharacters');
        const ownedGarrisonCharacterIds = await dispatch('getAccountGarrisonCharacters');
        ownedCharacterIds.push(...ownedGarrisonCharacterIds);

        for (const charId of ownedCharacterIds) {
          dispatch('fetchCharacterStamina', charId);
        }
      },

      async fetchCharacterStamina({ state, commit }, characterId: number) {
        if(featureFlagStakeOnly) return;

        const staminaString = await state.contracts().Characters!.methods
          .getStaminaPoints('' + characterId)
          .call(defaultCallOptions(state));

        const stamina = parseInt(staminaString, 10);
        if (state.characterStaminas[characterId] !== stamina) {
          commit('updateCharacterStamina', { characterId, stamina });
        }
      },
      async getAccountCharacters({state}) {
        if(!state.defaultAccount) return;
        const numberOfCharacters = parseInt(await state.contracts().Characters!.methods.balanceOf(state.defaultAccount).call(defaultCallOptions(state)), 10);
        const characters = await Promise.all(
          [...Array(numberOfCharacters).keys()].map(async (_, i) =>
            Number(await state.contracts().Characters!.methods.tokenOfOwnerByIndex(state.defaultAccount!, i).call(defaultCallOptions(state))))
        );
        return characters;
      },
      async getAccountGarrisonCharacters({state}) {
        if(!state.defaultAccount) return;
        return (await state.contracts().Garrison!.methods.getUserCharacters().call(defaultCallOptions(state))).map((id) => Number(id));
      },
      async getAccountWeapons({state}) {
        if(!state.defaultAccount) return;
        const numberOfWeapons = parseInt(await state.contracts().Weapons!.methods.balanceOf(state.defaultAccount).call(defaultCallOptions(state)), 10);
        const weapons = await Promise.all(
          [...Array(numberOfWeapons).keys()]
            .map(async (_, i) => Number(await state.contracts().Weapons!.methods.tokenOfOwnerByIndex(state.defaultAccount!, i).call(defaultCallOptions(state))))
        );
        return weapons;
      },
      async setupCharacterRenames({ dispatch }) {
        const ownedCharacterIds = await dispatch('getAccountCharacters');
        const ownedGarrisonCharacterIds = await dispatch('getAccountGarrisonCharacters');
        ownedCharacterIds.push(...ownedGarrisonCharacterIds);

        for (const charId of ownedCharacterIds) {
          dispatch('fetchCharacterRename', charId);
        }
      },
      async setupCharactersWithIdsRenames({ dispatch }, characterIds: string[]) {
        for (const charId of characterIds) {
          dispatch('fetchCharacterRename', charId);
        }
      },
      async fetchCharacterRename({ state, commit }, characterId: number) {
        const renameString = await state.contracts().CharacterRenameTagConsumables!.methods
          .getCharacterRename(characterId)
          .call(defaultCallOptions(state));
        if(renameString !== '' && state.characterRenames[characterId] !== renameString){
          commit('updateCharacterRename', { characterId, renameString });
        }
      },
      async setupCharacterCosmetics({ dispatch }) {
        const ownedCharacterIds = await dispatch('getAccountCharacters');
        const ownedGarrisonCharacterIds = await dispatch('getAccountGarrisonCharacters');
        ownedCharacterIds.push(...ownedGarrisonCharacterIds);

        for (const charId of ownedCharacterIds) {
          dispatch('fetchCharacterCosmetic', charId);
        }
      },
      async setupCharactersWithIdsCosmetics({ dispatch }, characterIds: string[]) {
        for (const charId of characterIds) {
          dispatch('fetchCharacterCosmetic', charId);
        }
      },
      async fetchCharacterCosmetic({ state, commit }, characterId: number) {
        const characterCosmetic = await state.contracts().CharacterCosmetics!.methods
          .getCharacterCosmetic(characterId)
          .call(defaultCallOptions(state));
        if(state.characterCosmetics[characterId] !== characterCosmetic){
          commit('updateCharacterCosmetic', { characterId, characterCosmetic });
        }
      },
      async mintCharacter({ state, dispatch }) {
        if(featureFlagStakeOnly || !state.defaultAccount) return;

        await approveFee(
          state.contracts().CryptoBlades!,
          state.contracts().SkillToken,
          state.defaultAccount,
          state.skillRewards,
          defaultCallOptions(state),
          defaultCallOptions(state),
          cryptoBladesMethods => cryptoBladesMethods.mintCharacterFee(),
          { allowInGameOnlyFunds: false }
        );

        await state.contracts().CryptoBlades!.methods.mintCharacter().send(defaultCallOptions(state));

        await Promise.all([
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchFightRewardXp'),
          dispatch('setupCharacterStaminas')
        ]);
      },

      async mintWeaponN({ state, dispatch }, { num, useStakedSkillOnly, chosenElement, eventId = 0 }:
      { num: any, useStakedSkillOnly?: boolean, chosenElement: any, eventId: any }) {
        const { CryptoBlades, SkillToken, Weapons } = state.contracts();
        if(!CryptoBlades || !SkillToken || !Weapons || !state.defaultAccount) return;
        const chosenElementFee = chosenElement === 100 ? 1 : 2;

        if(useStakedSkillOnly) {
          await CryptoBlades.methods
            .mintWeaponNUsingStakedSkill(num, chosenElement, eventId)
            .send({ from: state.defaultAccount, gas: '5000000' });
        }
        else {
          await approveFee(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            state.skillRewards,
            defaultCallOptions(state),
            defaultCallOptions(state),
            cryptoBladesMethods => cryptoBladesMethods.mintWeaponFee(),
            { feeMultiplier: num * 4 * chosenElementFee, allowInGameOnlyFunds: true }
          );

          await CryptoBlades.methods.mintWeaponN(num, chosenElement, eventId).send({ from: state.defaultAccount, gas: '5000000' });
        }

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('updateWeaponIds'),
          dispatch('setupWeaponDurabilities'),
          dispatch('fetchShardsSupply')
        ]);
      },

      async mintWeapon({ state, dispatch }, { useStakedSkillOnly, chosenElement, eventId = 0 }:
      { useStakedSkillOnly?: boolean, chosenElement: any, eventId: any }) {
        const { CryptoBlades, SkillToken, Weapons } = state.contracts();
        if(!CryptoBlades || !SkillToken || !Weapons || !state.defaultAccount) return;
        const chosenElementFee = chosenElement === 100 ? 1 : 2;

        if(useStakedSkillOnly) {
          await CryptoBlades.methods
            .mintWeaponUsingStakedSkill(chosenElement, eventId)
            .send({ from: state.defaultAccount });
        }
        else {
          await approveFee(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            state.skillRewards,
            defaultCallOptions(state),
            defaultCallOptions(state),
            cryptoBladesMethods => cryptoBladesMethods.mintWeaponFee(),
            { feeMultiplier: chosenElementFee, allowInGameOnlyFunds: true }
          );

          await CryptoBlades.methods.mintWeapon(chosenElement, eventId).send({ from: state.defaultAccount });
        }

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('updateWeaponIds'),
          dispatch('setupWeaponDurabilities'),
          dispatch('fetchShardsSupply')
        ]);
      },

      async reforgeWeapon(
        { state, dispatch },
        { burnWeaponId, reforgeWeaponId, useStakedSkillOnly }: {
          burnWeaponId: any, reforgeWeaponId: any, useStakedSkillOnly?: boolean
        }
      ) {
        const { CryptoBlades, SkillToken, BurningManager } = state.contracts();
        if(!CryptoBlades || !BurningManager || !state.defaultAccount) return;

        if(useStakedSkillOnly) {
          await BurningManager.methods
            .reforgeWeaponUsingStakedSkill(
              reforgeWeaponId,
              burnWeaponId
            )
            .send({
              from: state.defaultAccount,
            });
        }
        else {
          await approveFeeFromAnyContract(
            CryptoBlades,
            BurningManager,
            SkillToken,
            state.defaultAccount,
            state.skillRewards,
            defaultCallOptions(state),
            defaultCallOptions(state),
            burningManagerMethods => burningManagerMethods.reforgeWeaponFee()
          );

          await BurningManager.methods
            .reforgeWeapon(
              reforgeWeaponId,
              burnWeaponId
            )
            .send({
              from: state.defaultAccount,
            });
        }

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('updateWeaponIds'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchFightRewardXp')
        ]);
      },

      async reforgeWeaponWithDust(
        { state, dispatch },
        { reforgeWeaponId, lesserDust, greaterDust, powerfulDust, useStakedSkillOnly }: {
          reforgeWeaponId: any, lesserDust: any, greaterDust: any, powerfulDust: any,
          useStakedSkillOnly?: boolean
        }
      ) {
        const { CryptoBlades, SkillToken, BurningManager } = state.contracts();
        if(!CryptoBlades || !BurningManager || !state.defaultAccount) return;

        if(useStakedSkillOnly) {
          await BurningManager.methods
            .reforgeWeaponWithDustUsingStakedSkill(
              reforgeWeaponId,
              lesserDust,
              greaterDust,
              powerfulDust
            )
            .send({
              from: state.defaultAccount,
            });
        }
        else {
          await approveFeeFromAnyContract(
            CryptoBlades,
            BurningManager,
            SkillToken,
            state.defaultAccount,
            state.skillRewards,
            defaultCallOptions(state),
            defaultCallOptions(state),
            burningManagerMethods => burningManagerMethods.reforgeWeaponWithDustFee()
          );

          await BurningManager.methods
            .reforgeWeaponWithDust(
              reforgeWeaponId,
              lesserDust,
              greaterDust,
              powerfulDust
            )
            .send({
              from: state.defaultAccount,
            });
        }

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('updateWeaponIds'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchFightRewardXp'),
          dispatch('fetchDustBalance')
        ]);
      },

      async burnWeapon({ state, dispatch }, { burnWeaponId, useStakedSkillOnly }: { burnWeaponId: any, useStakedSkillOnly?: boolean }) {
        const { CryptoBlades, SkillToken, BurningManager } = state.contracts();
        if(!CryptoBlades || !BurningManager || !state.defaultAccount) return;

        if(useStakedSkillOnly) {
          await BurningManager.methods
            .burnWeaponsUsingStakedSkill(
              [burnWeaponId]
            )
            .send({
              from: state.defaultAccount,
            });
        }
        else {
          await approveFeeFromAnyContract(
            CryptoBlades,
            BurningManager,
            SkillToken,
            state.defaultAccount,
            state.skillRewards,
            defaultCallOptions(state),
            defaultCallOptions(state),
            burningManagerMethods => burningManagerMethods.burnWeaponFee()
          );

          await BurningManager.methods
            .burnWeapons(
              [burnWeaponId]
            )
            .send({
              from: state.defaultAccount,
            });
        }

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('updateWeaponIds'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchFightRewardXp'),
          dispatch('fetchDustBalance')
        ]);
      },

      async massBurnWeapons({ state, dispatch }, { burnWeaponIds, useStakedSkillOnly }: { burnWeaponIds: any[], useStakedSkillOnly?: boolean }) {
        const { CryptoBlades, SkillToken, BurningManager } = state.contracts();
        if(!CryptoBlades || !BurningManager || !state.defaultAccount) return;

        if(useStakedSkillOnly) {
          await BurningManager.methods
            .burnWeaponsUsingStakedSkill(
              burnWeaponIds
            )
            .send({
              from: state.defaultAccount,
            });
        }
        else {
          await approveFeeFromAnyContract(
            CryptoBlades,
            BurningManager,
            SkillToken,
            state.defaultAccount,
            state.skillRewards,
            defaultCallOptions(state),
            defaultCallOptions(state),
            burningManagerMethods => burningManagerMethods.burnWeaponFee(),
            { feeMultiplier: burnWeaponIds.length }
          );

          await BurningManager.methods
            .burnWeapons(
              burnWeaponIds
            )
            .send({
              from: state.defaultAccount,
            });
        }

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('updateWeaponIds'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchFightRewardXp'),
          dispatch('fetchDustBalance')
        ]);
      },

      async fetchTargets({ state, commit }, { characterId, weaponId }) {
        if(featureFlagStakeOnly) return;

        if(isUndefined(characterId) || isUndefined(weaponId)) {
          commit('updateTargets', { characterId, weaponId, targets: [] });
          return;
        }

        const targets = await state.contracts().CryptoBlades!.methods
          .getTargets(characterId, weaponId)
          .call(defaultCallOptions(state));

        commit('updateTargets', { characterId, weaponId, targets: targets.map(targetFromContract) });
      },

      async doEncounter({ state, dispatch }, { characterId, weaponId, targetString, fightMultiplier }) {
        if(featureFlagStakeOnly) return;

        const res = await state.contracts().CryptoBlades!.methods
          .fight(
            characterId,
            weaponId,
            targetString,
            fightMultiplier
          )
          .send({ from: state.defaultAccount, gas: '300000' });

        await dispatch('fetchTargets', { characterId, weaponId });


        const {
          /*owner,
          character,
          weapon,
          target,*/
          playerRoll,
          enemyRoll,
          xpGain,
          skillGain
        } = res.events.FightOutcome.returnValues;

        const {gasPrice} = await web3.eth.getTransaction(res.transactionHash);

        const bnbGasUsed = gasUsedToBnb(res.gasUsed, gasPrice);

        await dispatch('fetchWeaponDurability', weaponId);

        return {
          isVictory: parseInt(playerRoll, 10) >= parseInt(enemyRoll, 10),
          playerRoll,
          enemyRoll,
          xpGain,
          skillGain,
          bnbGasUsed
        };
      },

      async fetchExpectedPayoutForMonsterPower({ state }, { power, isCalculator = false }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;
        if(isCalculator) {
          return await CryptoBlades.methods.getTokenGainForFight(power, false).call(defaultCallOptions(state));
        }
        return await CryptoBlades.methods.getTokenGainForFight(power, true).call(defaultCallOptions(state));
      },

      async fetchHourlyPowerAverage({ state }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;
        return await CryptoBlades.methods.vars(4).call(defaultCallOptions(state));
      },
      async fetchHourlyPayPerFight({ state }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;
        return await CryptoBlades.methods.vars(5).call(defaultCallOptions(state));
      },
      async fetchHourlyAllowance({ state }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;
        return await CryptoBlades.methods.vars(18).call(defaultCallOptions(state));
      },

      async fetchRemainingTokenClaimAmountPreTax({ state }) {
        if(!_.isFunction(state.contracts)) return;
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;
        return await CryptoBlades.methods.getRemainingTokenClaimAmountPreTax().call(defaultCallOptions(state));
      },

      async fetchStakeOverviewData({ getters, dispatch }) {
        await Promise.all(
          (getters.availableStakeTypes as StakeType[])
            .map(stakeType =>
              dispatch('fetchStakeOverviewDataPartial', { stakeType })
            ),
        );
        await Promise.all(
          (getters.availableNftStakeTypes as NftStakeType[])
            .map(stakeType =>
              dispatch('fetchStakeOverviewDataPartial', { stakeType })
            )
        );
      },

      async fetchStakeOverviewDataPartial({ state, commit }, { stakeType }: { stakeType: StakeType }) {
        const { StakingRewards } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards) return;

        const [
          rewardRate,
          rewardsDuration,
          totalSupply,
          minimumStakeTime,
          rewardDistributionTimeLeft,
        ] = await Promise.all([
          StakingRewards.methods.rewardRate().call(defaultCallOptions(state)),
          StakingRewards.methods.rewardsDuration().call(defaultCallOptions(state)),
          StakingRewards.methods.totalSupply().call(defaultCallOptions(state)),
          StakingRewards.methods.minimumStakeTime().call(defaultCallOptions(state)),
          StakingRewards.methods.getStakeRewardDistributionTimeLeft().call(defaultCallOptions(state)),
        ]);

        const stakeSkillOverviewData: IStakeOverviewState = {
          rewardRate,
          rewardsDuration: parseInt(rewardsDuration, 10),
          totalSupply,
          minimumStakeTime: parseInt(minimumStakeTime, 10),
          rewardDistributionTimeLeft: parseInt(rewardDistributionTimeLeft, 10),
        };
        commit('updateStakeOverviewDataPartial', { stakeType, ...stakeSkillOverviewData });
      },

      async fetchStakeDetails({ state, commit }, { stakeType }: { stakeType: StakeType }) {
        if(!state.defaultAccount) return;

        const { StakingRewards, StakingToken } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards || !StakingToken) return;

        const [
          ownBalance,
          stakedBalance,
          remainingCapacityForDeposit,
          remainingCapacityForWithdraw,
          contractBalance,
          currentRewardEarned,
          rewardMinimumStakeTime,
          rewardDistributionTimeLeft,
          unlockTimeLeft
        ] = await Promise.all([
          StakingToken.methods.balanceOf(state.defaultAccount).call(defaultCallOptions(state)),
          StakingRewards.methods.balanceOf(state.defaultAccount).call(defaultCallOptions(state)),
          Promise.resolve(null as string | null),
          StakingRewards.methods.totalSupply().call(defaultCallOptions(state)),
          StakingToken.methods.balanceOf(StakingRewards.options.address).call(defaultCallOptions(state)),
          StakingRewards.methods.earned(state.defaultAccount).call(defaultCallOptions(state)),
          StakingRewards.methods.minimumStakeTime().call(defaultCallOptions(state)),
          StakingRewards.methods.getStakeRewardDistributionTimeLeft().call(defaultCallOptions(state)),
          StakingRewards.methods.getStakeUnlockTimeLeft().call(defaultCallOptions(state)),
        ]);
        const stakeData: { stakeType: StakeType | NftStakeType } & IStakeState = {
          stakeType,
          ownBalance,
          stakedBalance,
          remainingCapacityForDeposit,
          remainingCapacityForWithdraw,
          contractBalance,
          currentRewardEarned,
          rewardMinimumStakeTime: parseInt(rewardMinimumStakeTime, 10),
          rewardDistributionTimeLeft: parseInt(rewardDistributionTimeLeft, 10),
          unlockTimeLeft: parseInt(unlockTimeLeft, 10)
        };
        commit('updateStakeData', stakeData);
      },

      async stake({ state, dispatch }, { amount, stakeType }: { amount: string, stakeType: StakeType }) {
        const { StakingRewards, StakingToken } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards || !StakingToken || !state.defaultAccount) return;

        await StakingToken.methods.approve(StakingRewards.options.address, amount).send({
          from: state.defaultAccount
        });

        await StakingRewards.methods.stake(amount).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async stakeNfts({ state, dispatch }, { ids, stakeType }: { ids: string[], stakeType: StakeType }) {
        const { StakingRewards, StakingToken } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards || !StakingToken || !state.defaultAccount) return;

        if(ids.length === 1) {
          await StakingToken.methods.approve(StakingRewards.options.address, ids[0]).send({
            from: state.defaultAccount
          });

          await StakingRewards.methods.stake(ids[0]).send({
            from: state.defaultAccount,
          });
        } else {
          await (StakingToken as Contract<IERC721>).methods.setApprovalForAll(StakingRewards.options.address, true).send({
            from: state.defaultAccount
          });

          await (StakingRewards as Contract<INftStakingRewards>).methods.bulkStake(ids).send({
            from: state.defaultAccount,
          });
        }

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async unstakeNfts({ state, dispatch }, { ids, stakeType }: { ids: string[], stakeType: StakeType }) {
        const { StakingRewards, StakingToken } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards || !StakingToken || !state.defaultAccount) return;

        if(ids.length === 1) {
          await StakingRewards.methods.withdraw(ids[0]).send({
            from: state.defaultAccount,
          });
        } else {
          await (StakingRewards as Contract<INftStakingRewards>).methods.bulkWithdraw(ids).send({
            from: state.defaultAccount,
          });
        }

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async unstake({ state, dispatch }, { amount, stakeType }: { amount: string, stakeType: StakeType }) {
        const { StakingRewards } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards || !state.defaultAccount) return;

        await StakingRewards.methods.withdraw(amount).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async unstakeKing({ state, dispatch }, { amount }: { amount: string }) {
        const { KingStakingRewardsUpgradeable } = state.contracts();
        if(!KingStakingRewardsUpgradeable || !state.defaultAccount) return;

        await KingStakingRewardsUpgradeable.methods.withdrawWithoutFee(amount).send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType: 'king' });
      },

      async getStakedIds({ state }, stakeType) {
        const { StakingRewards } = getStakingContracts(state.contracts(), stakeType);
        const CBKLand = state.contracts().CBKLand!;
        if(!StakingRewards || !CBKLand || !state.defaultAccount || !isNftStakeType(stakeType)) return;

        const stakedIds = await (StakingRewards as NftStakingRewardsAlias)?.methods.stakedIdsOf(state.defaultAccount).call({
          from: state.defaultAccount,
        });

        if(!stakedIds) return [];

        const landIdsWithTier = await Promise.all(stakedIds.map(async (landId: string) =>
        {
          const land = await CBKLand.methods.get(landId).call(defaultCallOptions(state));
          return { id: landId, tier: land[0] };
        }));

        return landIdsWithTier;
      },

      async claimKingReward({ state, dispatch }) {
        const { KingStakingRewardsUpgradeable } = state.contracts();
        if(!KingStakingRewardsUpgradeable) return;

        await KingStakingRewardsUpgradeable.methods.getRewardWithoutFee().send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType: 'king' });
      },

      async stakeUnclaimedRewards({ state, dispatch }, { stakeType }: { stakeType: StakeType }) {
        if(stakeType !== stakeTypeThatCanHaveUnclaimedRewardsStakedTo) return;

        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        await CryptoBlades.methods
          .stakeUnclaimedRewards()
          .send(defaultCallOptions(state));

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchStakeDetails', { stakeType }),
          dispatch('fetchFightRewardSkill'),
        ]);
      },

      async claimReward({ state, dispatch }, { stakeType }: { stakeType: StakeType }) {
        const { StakingRewards } = getStakingContracts(state.contracts(), stakeType);
        if(!StakingRewards) return;

        await StakingRewards.methods.getReward().send({
          from: state.defaultAccount,
        });

        await dispatch('fetchStakeDetails', { stakeType });
      },

      async joinRaid({ state, dispatch }, { characterId, weaponId }) {
        const { CryptoBlades, SkillToken, Raid1 } = state.contracts();
        if(!Raid1 || !CryptoBlades || !SkillToken || !state.defaultAccount) {
          return;
        }

        await approveFeeFromAnyContract(
          CryptoBlades,
          Raid1,
          SkillToken,
          state.defaultAccount,
          state.skillRewards,
          defaultCallOptions(state),
          defaultCallOptions(state),
          raidsFunctions => raidsFunctions.getJoinCostInSkill(),
          {},
          true
        );

        await Raid1!.methods
          .joinRaid(characterId, weaponId)
          .send(defaultCallOptions(state));

        await dispatch('fetchSkillBalance');
      },

      async fetchRaidState({ state, commit }) {
        if(featureFlagStakeOnly || !featureFlagRaid) return;

        const Raid1 = state.contracts().Raid1!;

        await Promise.all([
          (async () => {
            const raidState: IRaidState = raidFromContract(
              await Raid1.methods.getRaidData().call(defaultCallOptions(state))
            );

            commit('updateRaidState', { raidState });
          })(),
        ]);
      },

      async fetchRaidRewards({ state }, { startIndex, endIndex }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .getEligibleRewardIndexes(startIndex, endIndex)
          .call(defaultCallOptions(state));
      },

      async fetchRaidingCharacters({ state }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .getParticipatingCharacters()
          .call(defaultCallOptions(state));
      },

      async fetchRaidingWeapons({ state }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .getParticipatingWeapons()
          .call(defaultCallOptions(state));
      },

      async fetchRaidJoinEligibility({ state }, { characterID, weaponID }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .canJoinRaid(characterID, weaponID)
          .call(defaultCallOptions(state));
      },

      async fetchIsRaidStarted({ state }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .isRaidStarted()
          .call(defaultCallOptions(state));
      },

      async fetchHaveEnoughEnergy({ state }, { characterID, weaponID }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .haveEnoughEnergy(characterID, weaponID)
          .call(defaultCallOptions(state));
      },

      async fetchIsCharacterRaiding({ state }, { characterID }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .isCharacterRaiding(characterID)
          .call(defaultCallOptions(state));
      },

      async fetchIsWeaponRaiding({ state }, { weaponID }) {
        const Raid1 = state.contracts().Raid1!;

        return await Raid1.methods
          .isWeaponRaiding(weaponID)
          .call(defaultCallOptions(state));
      },


      async claimRaidRewards({ state, dispatch }, { rewardIndex }) {
        const Raid1 = state.contracts().Raid1!;

        const res = await Raid1!.methods
          .claimReward(rewardIndex)
          .send(defaultCallOptions(state));

        // claimreward does not reward trinket, those are given at raidcompletion by the bot

        if(res.events.RewardedJunk) {
          const junkIds = res.events.RewardedJunk.length ?
            res.events.RewardedJunk.map((x: { returnValues: { tokenID: any; }; }) => x.returnValues.tokenID) :
            [res.events.RewardedJunk.returnValues.tokenID];
          await dispatch('fetchJunks', junkIds);
        }

        if(res.events.RewardedKeyBox) {
          const keyboxIds = res.events.RewardedKeyBox.length ?
            res.events.RewardedKeyBox.map((x: { returnValues: { tokenID: any; }; }) => x.returnValues.tokenID) :
            [res.events.RewardedKeyBox.returnValues.tokenID];
          await dispatch('fetchKeyLootboxes', keyboxIds);
        }

        // there may be other events fired that can be used to obtain the exact loot
        // RewardedWeapon, RewardedJunk, RewardedTrinket, RewardedKeyBox etc
        const rewards = {
          rewardsClaimed: res.events.RewardClaimed?.returnValues,
          weapons: res.events.RewardedWeapon && (res.events.RewardedWeapon.length ?
            res.events.RewardedWeapon.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedWeapon.returnValues]),

          junks: res.events.RewardedJunk && (res.events.RewardedJunk.length ?
            res.events.RewardedJunk.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedJunk.returnValues]),

          keyboxes: res.events.RewardedKeyBox && (res.events.RewardedKeyBox.length ?
            res.events.RewardedKeyBox.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedKeyBox.returnValues]),

          bonusXp: res.events.RewardedXpBonus && (res.events.RewardedXpBonus.length ?
            res.events.RewardedXpBonus.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedXpBonus.returnValues]),

          dustLb: res.events.RewardedDustLB && (res.events.RewardedDustLB.length ?
            res.events.RewardedDustLB.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedDustLB.returnValues]),

          dust4b: res.events.RewardedDust4B && (res.events.RewardedDust4B.length ?
            res.events.RewardedDust4B.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedDust4B.returnValues]),

          dust5b: res.events.RewardedDust5B && (res.events.RewardedDust5B.length ?
            res.events.RewardedDust5B.map((x: { returnValues: any; })=> x.returnValues) :
            [res.events.RewardedDust5B.returnValues]),
        };
        return rewards;
      },

      async fetchIsLandSaleAllowed({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .salesAllowed()
          .call(defaultCallOptions(state));
      },

      async getAllZonesPopulation({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .getAllZonesPopulation()
          .call(defaultCallOptions(state));
      },

      async checkIfChunkAvailable({state}, {tier, chunkId}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .checkIfChunkAvailable(tier, chunkId)
          .call(defaultCallOptions(state));
      },

      async getZoneChunkPopulation({state}, {zoneId}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .getZoneChunkPopulation(zoneId)
          .call(defaultCallOptions(state));
      },

      async purchaseT1CBKLand({state}, {price, currency}) {
        const { CryptoBlades, Blacksmith, SkillToken } = state.contracts();
        if(!CryptoBlades || !Blacksmith || !SkillToken || !state.defaultAccount) return;

        if(currency === 0) {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            price
          );
        } else {
          const tokenAddress = await Blacksmith.methods
            .getCurrency(currency)
            .call(defaultCallOptions(state));

          await new web3.eth.Contract(ierc20Abi as any[], tokenAddress).methods
            .approve(Blacksmith.options.address, price)
            .send({
              from: state.defaultAccount
            });
        }

        return await Blacksmith.methods
          .purchaseT1CBKLand(price, currency)
          .send({
            from: state.defaultAccount
          });
      },

      async purchaseT2CBKLand({state}, {price, chunkId, currency}) {
        const { CryptoBlades, Blacksmith, SkillToken } = state.contracts();
        if(!CryptoBlades || !Blacksmith || !SkillToken || !state.defaultAccount) return;

        if(currency === 0) {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            price
          );
        } else {
          const tokenAddress = await Blacksmith.methods
            .getCurrency(currency)
            .call(defaultCallOptions(state));

          await new web3.eth.Contract(ierc20Abi as any[], tokenAddress).methods
            .approve(Blacksmith.options.address, price)
            .send({
              from: state.defaultAccount
            });
        }

        return await Blacksmith.methods
          .purchaseT2CBKLand(price, chunkId, currency).send({
            from: state.defaultAccount
          });
      },

      async purchaseT3CBKLand({state}, {price, chunkId, currency}) {
        const { CryptoBlades, Blacksmith, SkillToken } = state.contracts();
        if(!CryptoBlades || !Blacksmith || !SkillToken || !state.defaultAccount) return;

        if(currency === 0) {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            price
          );
        } else {
          const tokenAddress = await Blacksmith.methods
            .getCurrency(currency)
            .call(defaultCallOptions(state));

          await new web3.eth.Contract(ierc20Abi as any[], tokenAddress).methods
            .approve(Blacksmith.options.address, price)
            .send({
              from: state.defaultAccount
            });
        }

        return await Blacksmith.methods
          .purchaseT3CBKLand(price, chunkId, currency).send({
            from: state.defaultAccount
          });
      },

      async getCBKLandPrice({state}, {tier, currency}) {
        const Blacksmith = state.contracts().Blacksmith!;

        return await Blacksmith.methods
          .getCBKLandPrice(tier, currency)
          .call(defaultCallOptions(state));
      },

      async getChunkPopulation({state}, {chunkIds}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .getChunkPopulation(chunkIds)
          .call(defaultCallOptions(state));
      },

      async getPurchase({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        if(!state.defaultAccount) return;

        const res = await CBKLandSale.methods
          .getPurchase()
          .call(defaultCallOptions(state));

        const tier = res[0];
        const chunkId = res[1];

        return { tier, chunkId };
      },

      async getAvailableLand({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        const res = await CBKLandSale.methods
          .getAvailableLand()
          .call(defaultCallOptions(state));

        const t1Land = res[0];
        const t2Land = res[1];
        const t3Land = res[2];

        return { t1Land, t2Land, t3Land };
      },

      async getReservedChunksIds({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .getReservedChunksIds()
          .call(defaultCallOptions(state));
      },

      async getPlayerReservedLand({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;
        if (!state.defaultAccount || !CBKLandSale) return;

        return await CBKLandSale.methods
          .getPlayerReservedLand(state.defaultAccount)
          .call(defaultCallOptions(state));
      },

      async getChunksOfReservation({state}, {reservationId}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .getChunksOfReservations(reservationId)
          .call(defaultCallOptions(state));
      },

      async getTakenT3Chunks({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .getTakenT3Chunks()
          .call(defaultCallOptions(state));
      },

      async claimPlayerReservedLand({state}, {reservationId, chunkId, tier}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .claimPlayerReservedLand(reservationId, chunkId, tier)
          .send({
            from: state.defaultAccount
          });
      },

      async reservedSalesAllowed({state}) {
        const CBKLandSale = state.contracts().CBKLandSale!;

        return await CBKLandSale.methods
          .reservedSalesAllowed()
          .call(defaultCallOptions(state));
      },

      async getOwnedLands({state}) {
        const CBKLand = state.contracts().CBKLand!;

        if (!state.defaultAccount || !CBKLand) return;

        const landsIds = await CBKLand.methods
          .getOwned(state.defaultAccount)
          .call(defaultCallOptions(state));

        return await Promise.all(landsIds.map(landId => CBKLand.methods.get(landId).call(defaultCallOptions(state))));
      },

      async getOwnedLandIdsWithTier({state}) {
        const CBKLand = state.contracts().CBKLand!;

        if (!state.defaultAccount || !CBKLand) return;

        const landsIds = await CBKLand.methods
          .getOwned(state.defaultAccount)
          .call(defaultCallOptions(state));

        const landIdsWithTier = await Promise.all(landsIds.map(async (landId: string) =>
        {
          const land = await CBKLand.methods.get(landId).call(defaultCallOptions(state));
          return { id: landId, tier: land[0] };
        }));

        return landIdsWithTier;
      },

      async mintCBKLand({state}, {minter, tier, chunkId, reseller}) {
        const {CBKLand} = state.contracts();

        if (!CBKLand || !state.defaultAccount) return;

        return await CBKLand.methods.mint(minter, tier, chunkId, reseller).send({from: state.defaultAccount});
      },

      async massMintCBKLand({state}, {minter, tier, chunkId, reseller, quantity}) {
        const {CBKLand} = state.contracts();

        if (!CBKLand || !state.defaultAccount) return;

        return await CBKLand.methods.massMint(minter, tier, chunkId, reseller, quantity).send({from: state.defaultAccount});
      },

      async updateChunkId({state}, {id, chunkId}) {
        const {CBKLand} = state.contracts();

        if (!CBKLand || !state.defaultAccount) return;

        return await CBKLand.methods.updateChunkId(id, chunkId).send({from: state.defaultAccount});
      },

      async updateChunkIds({state}, {ids, chunkId}) {
        const {CBKLand} = state.contracts();

        if (!CBKLand || !state.defaultAccount) return;

        return await CBKLand.methods.updateChunkId(ids, chunkId).send({from: state.defaultAccount});
      },

      async incrementDustSupplies({state}, {playerAddress, amountLB, amount4B, amount5B}) {
        const {Weapons} = state.contracts();
        if(!state.defaultAccount || !Weapons) return;

        return await Weapons.methods.incrementDustSupplies(playerAddress, amountLB, amount4B, amount5B).send({from: state.defaultAccount});
      },

      async decrementDustSupplies({state}, {playerAddress, amountLB, amount4B, amount5B}) {
        const {Weapons} = state.contracts();
        if(!state.defaultAccount || !Weapons) return;

        return await Weapons.methods.decrementDustSupplies(playerAddress, amountLB, amount4B, amount5B).send({from: state.defaultAccount});
      },

      async mintGiveawayWeapon({state}, {to, stars, chosenElement}) {
        const {Weapons} = state.contracts();
        if(!state.defaultAccount || !Weapons) return;

        return await Weapons.methods.mintGiveawayWeapon(to, stars, chosenElement).send({from: state.defaultAccount});
      },

      async giveAwaySoul({state}, {user, soulAmount}) {
        const {BurningManager} = state.contracts();
        if(!state.defaultAccount || !BurningManager) return;

        return await BurningManager.methods.giveAwaySoul(user, soulAmount).send({from: state.defaultAccount});
      },

      async fetchAllMarketNftIds({ state }, { nftContractAddr }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns an array of bignumbers (these are nft IDs)
        return await NFTMarket.methods
          .getListingIDs(
            nftContractAddr
          )
          .call(defaultCallOptions(state));
      },

      async fetchNumberOfWeaponListings({ state }, { nftContractAddr, trait, stars }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns an array of bignumbers (these are nft IDs)
        return await NFTMarket.methods
          .getNumberOfWeaponListings(
            nftContractAddr,
            trait,
            stars
          )
          .call(defaultCallOptions(state));
      },

      async fetchNumberOfCharacterListings({ state }, { nftContractAddr, trait, minLevel, maxLevel }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns an array of bignumbers (these are nft IDs)
        return await NFTMarket.methods
          .getNumberOfCharacterListings(
            nftContractAddr,
            trait,
            minLevel,
            maxLevel
          )
          .call(defaultCallOptions(state));
      },

      async fetchNumberOfShieldListings({ state }, { nftContractAddr, trait, stars }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns an array of bignumbers (these are nft IDs)
        //console.log('NOTE: trait '+trait+' and stars '+stars+' ignored until a contract filter exists');
        void trait;
        void stars;
        return await NFTMarket.methods
          .getNumberOfListingsForToken(
            nftContractAddr
            // TODO add contract function and filtering params
          )
          .call(defaultCallOptions(state));
      },

      async fetchAllMarketCharacterNftIdsPage({ state }, { nftContractAddr, limit, pageNumber, trait, minLevel, maxLevel }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        return await NFTMarket.methods
          .getCharacterListingIDsPage(
            nftContractAddr,
            limit,
            pageNumber,
            trait,
            minLevel,
            maxLevel
          )
          .call(defaultCallOptions(state));
      },

      async fetchAllMarketWeaponNftIdsPage({ state }, { nftContractAddr, limit, pageNumber, trait, stars }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        return await NFTMarket.methods
          .getWeaponListingIDsPage(
            nftContractAddr,
            limit,
            pageNumber,
            trait,
            stars
          )
          .call(defaultCallOptions(state));
      },

      async fetchAllMarketShieldNftIdsPage({ state }, { nftContractAddr, limit, pageNumber, trait, stars }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        //console.log('NOTE: trait '+trait+' and stars '+stars+' ignored until a contract filter exists');
        void trait;
        void stars;
        const res = await NFTMarket.methods
          .getListingSlice(
            nftContractAddr,
            pageNumber*limit, // startIndex
            limit // length
          )
          .call(defaultCallOptions(state));
        // returned values are: uint256 returnedCount, uint256[] ids, address[] sellers, uint256[] prices
        // res[1][] refers to ids, which is what we're looking for
        // this slice function returns the full length even if there are no items on that index
        // we must cull the nonexistant items
        const ids = [];
        for(let i = 0; i < res[1].length; i++) {
          if(res[1][i] !== '0' || res[3][i] !== '0') // id and price both 0, it's invalid
            ids.push(res[1][i]);
        }
        return ids;
      },

      async fetchMarketNftIdsBySeller({ state }, { nftContractAddr, sellerAddr }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns an array of bignumbers (these are nft IDs)
        return await NFTMarket.methods
          .getListingIDsBySeller(
            nftContractAddr,
            sellerAddr
          )
          .call(defaultCallOptions(state));
      },

      async fetchMarketNftPrice({ state }, { nftContractAddr, tokenId }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns the listing's price in skill wei
        return await NFTMarket.methods
          .getFinalPrice(
            nftContractAddr,
            tokenId
          )
          .call(defaultCallOptions(state));
      },

      async fetchMarketNftTargetBuyer({ state }, { nftContractAddr, tokenId }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns the listing's target buyer address
        return await NFTMarket.methods
          .getTargetBuyer(
            nftContractAddr,
            tokenId
          )
          .call(defaultCallOptions(state));
      },

      async fetchMarketTax({ state }, { nftContractAddr }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        // returns the tax on the nfts at the address in 64x64 fixed point
        return await NFTMarket.methods
          .tax(
            nftContractAddr
          )
          .call(defaultCallOptions(state));
      },

      async checkMarketItemOwnership({ state }, { nftContractAddr, tokenId }) {
        const { NFTMarket, Weapons, Characters } = state.contracts();
        if(!NFTMarket || !Weapons || !Characters) return;

        const NFTContract: Contract<IERC721> =
          nftContractAddr === Weapons.options.address
            ? Weapons
            : Characters;

        return await NFTContract.methods
          .ownerOf(tokenId)
          .call(defaultCallOptions(state));
      },

      async addMarketListing({ state, dispatch }, { nftContractAddr, tokenId, price, targetBuyer }:
      { nftContractAddr: string, tokenId: string, price: string, targetBuyer: string }) {
        const { CryptoBlades, SkillToken, NFTMarket, Weapons, Characters, Shields } = state.contracts();
        if(!CryptoBlades || !SkillToken || !NFTMarket || !Weapons || !Characters || !Shields || !state.defaultAccount) return;

        const NFTContract: Contract<IERC721> =
          nftContractAddr === Weapons.options.address
            ? Weapons : nftContractAddr === Characters.options.address
              ? Characters : Shields;

        await NFTContract.methods
          .approve(NFTMarket.options.address, tokenId)
          .send(defaultCallOptions(state));

        await approveFeeFromAnyContract(
          CryptoBlades,
          NFTMarket,
          SkillToken,
          state.defaultAccount,
          state.skillRewards,
          defaultCallOptions(state),
          defaultCallOptions(state),
          nftMarketFuctions => nftMarketFuctions.addFee(),
          { allowInGameOnlyFunds: false, allowSkillRewards: false },
        );

        const res = await NFTMarket.methods
          .addListing(nftContractAddr, tokenId, price, targetBuyer)
          .send({
            from: state.defaultAccount,
          });

        if(nftContractAddr === Weapons.options.address)
          await dispatch('updateWeaponIds');
        else if(nftContractAddr === Characters.options.address)
          await dispatch('updateCharacterIds');
        else if(nftContractAddr === Shields.options.address) {
          await dispatch('updateShieldIds');
        }

        const {
          seller,
          nftID
        } = res.events.NewListing.returnValues;

        return { seller, nftID, price } as { seller: string, nftID: string, price: string };
      },

      async changeMarketListingPrice({ state }, { nftContractAddr, tokenId, newPrice }: { nftContractAddr: string, tokenId: string, newPrice: string }) {
        const { CryptoBlades, SkillToken, NFTMarket } = state.contracts();
        if(!CryptoBlades || !SkillToken || !NFTMarket || !state.defaultAccount) return;

        await approveFeeFromAnyContract(
          CryptoBlades,
          NFTMarket,
          SkillToken,
          state.defaultAccount,
          state.skillRewards,
          defaultCallOptions(state),
          defaultCallOptions(state),
          nftMarketFuctions => nftMarketFuctions.changeFee(),
          { allowInGameOnlyFunds: false, allowSkillRewards: false },
        );

        const res = await NFTMarket.methods
          .changeListingPrice(nftContractAddr, tokenId, newPrice)
          .send({
            from: state.defaultAccount,
          });

        const {
          seller,
          nftID
        } = res.events.ListingPriceChange.returnValues;

        return { seller, nftID, newPrice } as { seller: string, nftID: string, newPrice: string };
      },

      async changeMarketListingTargetBuyer({ state }, { nftContractAddr, tokenId, newTargetBuyer }:
      { nftContractAddr: string, tokenId: string, newTargetBuyer: string }) {
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        const res = await NFTMarket.methods
          .changeListingTargetBuyer(nftContractAddr, tokenId, newTargetBuyer)
          .send({
            from: state.defaultAccount,
          });

        const {
          seller,
          nftID
        } = res.events.ListingTargetBuyerChange.returnValues;

        return { seller, nftID, newTargetBuyer } as { seller: string, nftID: string, newTargetBuyer: string };
      },

      async cancelMarketListing({ state, dispatch }, { nftContractAddr, tokenId }: { nftContractAddr: string, tokenId: string }) {
        const { NFTMarket, Weapons, Characters, Shields } = state.contracts();
        if(!NFTMarket || !Weapons || !Characters || !Shields) return;

        const res = await NFTMarket.methods
          .cancelListing(nftContractAddr, tokenId)
          .send({
            from: state.defaultAccount,
          });

        if(nftContractAddr === Weapons.options.address)
          await dispatch('updateWeaponIds');
        else if(nftContractAddr === Characters.options.address)
          await dispatch('updateCharacterIds');
        else if(nftContractAddr === Shields.options.address) {
          await dispatch('updateShieldIds');
        }

        const {
          seller,
          nftID
        } = res.events.CancelledListing.returnValues;

        return { seller, nftID } as { seller: string, nftID: string };
      },

      async purchaseMarketListing({ state, dispatch }, { nftContractAddr, tokenId, maxPrice }: { nftContractAddr: string, tokenId: string, maxPrice: string }) {
        const { SkillToken, NFTMarket, Weapons, Characters, Shields } = state.contracts();
        if(!NFTMarket || !Weapons || !Characters || !Shields) return;

        await SkillToken.methods
          .approve(NFTMarket.options.address, maxPrice)
          .send(defaultCallOptions(state));

        const res = await NFTMarket.methods
          .purchaseListing(nftContractAddr, tokenId, maxPrice)
          .send({
            from: state.defaultAccount,
          });

        if(nftContractAddr === Weapons.options.address)
          await dispatch('updateWeaponIds');
        else if(nftContractAddr === Characters.options.address)
          await dispatch('updateCharacterIds');
        else if(nftContractAddr === Shields.options.address) {
          await dispatch('updateShieldIds');
        }

        const {
          seller,
          nftID,
          price
        } = res.events.PurchasedListing.returnValues;

        return { seller, nftID, price } as { seller: string, nftID: string, price: string };
      },

      async fetchSellerOfNft({ state }, { nftContractAddr, tokenId }: { nftContractAddr: string, tokenId: string }) {
        // getSellerOfNftID
        const { NFTMarket } = state.contracts();
        if(!NFTMarket) return;

        const sellerAddr = await NFTMarket.methods
          .getSellerOfNftID(nftContractAddr, tokenId)
          .call(defaultCallOptions(state));

        return sellerAddr;
      },

      async fetchFightGasOffset({ state, commit }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        const fightGasOffset = await getFeeInSkillFromUsd(
          CryptoBlades,
          defaultCallOptions(state),
          cryptoBladesMethods => cryptoBladesMethods.fightRewardGasOffset()
        );

        commit('updateFightGasOffset', { fightGasOffset });
        return fightGasOffset;
      },

      async fetchFightBaseline({ state, commit }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        const fightBaseline = await getFeeInSkillFromUsd(
          CryptoBlades,
          defaultCallOptions(state),
          cryptoBladesMethods => cryptoBladesMethods.fightRewardBaseline()
        );

        commit('updateFightBaseline', { fightBaseline });
        return fightBaseline;
      },

      async fetchFightRewardSkill({ state, commit, dispatch }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        const [skillRewards] = await Promise.all([
          (async () => {
            const skillRewards = await CryptoBlades.methods
              .getTokenRewards()
              .call(defaultCallOptions(state));

            commit('updateSkillRewards', { skillRewards });

            return skillRewards;
          })(),
          dispatch('fetchRewardsClaimTax')
        ]);

        return skillRewards;
      },

      async fetchRewardsClaimTax({ state, commit }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        const [rewardsClaimTax, maxRewardsClaimTax] = await Promise.all([
          CryptoBlades.methods
            .getOwnRewardsClaimTax()
            .call(defaultCallOptions(state)),
          CryptoBlades.methods
            .REWARDS_CLAIM_TAX_MAX()
            .call(defaultCallOptions(state))
        ]);

        commit('updateRewardsClaimTax', { maxRewardsClaimTax, rewardsClaimTax });
      },

      async fetchFightRewardXp({ state, commit }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        const xps = await CryptoBlades.methods.getXpRewards(state.ownedCharacterIds.map(x => x.toString())).call(defaultCallOptions(state));

        const xpCharaIdPairs = state.ownedCharacterIds.map((charaId, i) => {
          return [charaId, xps[i]];
        });

        commit('updateXpRewards', { xpRewards: _.fromPairs(xpCharaIdPairs) });
        return xpCharaIdPairs;
      },

      async fetchGarrisonCharactersXp({ state, commit }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        const xps = await CryptoBlades.methods.getXpRewards(state.ownedGarrisonCharacterIds.map(x => x.toString())).call(defaultCallOptions(state));

        const xpCharaIdPairs = state.ownedGarrisonCharacterIds.map((charaId, i) => {
          return [charaId, xps[i]];
        });

        commit('updateXpRewards', { xpRewards: _.fromPairs(xpCharaIdPairs) });
      },

      async claimGarrisonXp({ state, dispatch }, characterIds) {
        const { Garrison } = state.contracts();
        if(!Garrison) return;
        await Garrison.methods.claimAllXp(characterIds).send({ from: state.defaultAccount });

        await Promise.all([
          dispatch('fetchGarrisonCharacters', state.ownedGarrisonCharacterIds),
          dispatch('fetchGarrisonCharactersXp')
        ]);
      },

      async purchaseShield({ state, dispatch }) {
        const { CryptoBlades, SkillToken, Blacksmith } = state.contracts();
        if(!CryptoBlades || !Blacksmith || !state.defaultAccount) return;

        await approveFeeFromAnyContractSimple(
          CryptoBlades,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          new BigNumber(web3.utils.toWei('100', 'ether'))
        );

        await Blacksmith.methods.purchaseShield().send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchTotalShieldSupply'),
          dispatch('updateShieldIds'),
        ]);
      },

      async currentSkillPrice({ state }) {
        const { Merchandise } = state.contracts();
        if(!Merchandise || !state.defaultAccount) return;

        const skillOracle = await Merchandise.methods.skillOracle().call(defaultCallOptions(state));
        return await new web3.eth.Contract(priceOracleAbi as any[], skillOracle).methods
          .currentPrice().call(defaultCallOptions(state));
      },

      async createOrder({ state, dispatch }, {orderNumber, payingAmount}) {
        const { CryptoBlades, SkillToken, Merchandise } = state.contracts();
        if(!CryptoBlades || !SkillToken || !Merchandise || !state.defaultAccount) return;

        const skillNeeded = await CryptoBlades.methods
          .getSkillNeededFromUserWallet(state.defaultAccount, payingAmount, true)
          .call(defaultCallOptions(state));

        await approveFeeFromAnyContractSimple(
          CryptoBlades,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          new BigNumber(skillNeeded)
        );

        await Merchandise.methods
          .createOrder(orderNumber, payingAmount)
          .send({
            from: state.defaultAccount
          });

        dispatch('fetchSkillBalance');
      },

      async storeNftsToPartnerVault({state}, {tokenAddress, tokenIds}) {
        const {PartnerVault} = state.contracts();
        if(!PartnerVault || !state.defaultAccount) return;

        const tokenContract = new web3.eth.Contract(erc721Abi as any[], tokenAddress) as Contract<IERC721>;

        const isApprovedForAll = await tokenContract.methods.isApprovedForAll(state.defaultAccount, PartnerVault.options.address)
          .call(defaultCallOptions(state));

        if(tokenIds.length === 1 && !isApprovedForAll) {
          await tokenContract.methods.approve(PartnerVault.options.address, tokenIds[0]).send({
            from: state.defaultAccount
          });
        } else if (!isApprovedForAll) {
          await tokenContract.methods.setApprovalForAll(PartnerVault.options.address, true).send({
            from: state.defaultAccount
          });
        }
        return await PartnerVault.methods.storeNfts(tokenAddress, tokenIds).send({
          from: state.defaultAccount
        });
      },

      async storeCurrencyToPartnerVault({state}, {currencyAddress, amount}) {
        const {PartnerVault} = state.contracts();
        if (!PartnerVault || !state.defaultAccount) return;

        const currencyContract = new web3.eth.Contract(erc20Abi as any[], currencyAddress) as Contract<ERC20>;
        const currencyDecimals = +await currencyContract.methods.decimals().call(defaultCallOptions(state));
        const amountTimesDecimals = web3.utils.toBN(amount * 10 ** currencyDecimals);

        await currencyContract.methods.approve(PartnerVault.options.address, amountTimesDecimals.toString()).send({
          from: state.defaultAccount
        });

        return await PartnerVault.methods.storeCurrency(currencyAddress, amountTimesDecimals.toString()).send({
          from: state.defaultAccount
        });
      },

      async getNftsInPartnerVault({state}, {tokenAddress}){
        const {PartnerVault} = state.contracts();
        if(!PartnerVault || !state.defaultAccount) return;

        const nftsInVault = await PartnerVault.methods.getNftsInVault(tokenAddress).call(defaultCallOptions(state));

        return nftsInVault;
      },

      async getCurrencyBalanceInPartnerVault({state}, {currencyAddress}){
        const {PartnerVault} = state.contracts();
        if(!PartnerVault || !state.defaultAccount) return;

        const currencyContract = new web3.eth.Contract(erc20Abi as any[], currencyAddress) as Contract<ERC20>;
        let currencyBalance = await currencyContract.methods.balanceOf(PartnerVault.options.address).call(defaultCallOptions(state));
        const currencyDecimals = +await currencyContract.methods.decimals().call(defaultCallOptions(state));
        currencyBalance = new BigNumber(currencyBalance).div(new BigNumber(10 ** currencyDecimals)).toFixed();
        const currencySymbol = await currencyContract.methods.symbol().call(defaultCallOptions(state));

        return [currencyBalance, currencySymbol];
      },

      async getQuestDeadline({state}, {questID}){
        const {SimpleQuests} = state.contracts();
        if(!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.questDeadlines(questID).call(defaultCallOptions(state));
      },

      async getQuestSupply({state}, {questID}){
        const {SimpleQuests} = state.contracts();
        if(!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.questSupplies(questID).call(defaultCallOptions(state));
      },

      async getQuestTemplates({state}, {tier}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const questTemplates: Quest[] = [];

        const questTemplatesIds = await SimpleQuests.methods.getQuestTemplates(tier).call(defaultCallOptions(state));

        if(questTemplatesIds.length === 0) return questTemplates;

        for (const questID of questTemplatesIds) {
          const quest = await SimpleQuests.methods.quests(questID).call(defaultCallOptions(state)) as unknown as {
            progress: string | number;
            id: string;
            tier: string;
            requirementType: string;
            requirementRarity: string;
            requirementAmount: string;
            requirementExternalAddress: string;
            rewardType: string;
            rewardRarity: string;
            rewardAmount: string;
            rewardExternalAddress: string;
            reputationAmount: string;
          };
          const emptyAccount = '0x0000000000000000000000000000000000000000';
          if(quest.requirementExternalAddress !== emptyAccount
            && ((quest.requirementType && +quest.requirementType as RequirementType === RequirementType.EXTERNAL)
              || (quest.requirementType && +quest.requirementType as RequirementType === RequirementType.EXTERNAL_HOLD))) {
            const currencyContract = new web3.eth.Contract(erc20Abi as any[], quest.requirementExternalAddress);
            try{
              const currencyDecimals = await currencyContract.methods.decimals().call(defaultCallOptions(state));
              quest.requirementAmount = new BigNumber(quest.requirementAmount).div(new BigNumber(10 ** currencyDecimals)).toFixed();
              quest.progress = new BigNumber(quest.progress).div(new BigNumber(10 ** currencyDecimals)).toFixed();
            } catch {
              // Contract does not support decimals
            }
          }

          if(quest.rewardExternalAddress !== emptyAccount
            && +quest.rewardType as RewardType === RewardType.EXTERNAL) {
            const currencyContract = new web3.eth.Contract(erc20Abi as any[], quest.rewardExternalAddress);
            try{
              const currencyDecimals = await currencyContract.methods.decimals().call(defaultCallOptions(state));
              quest.rewardAmount = new BigNumber(quest.rewardAmount).div(new BigNumber(10 ** currencyDecimals)).toFixed();
            } catch {
              // Contract does not support decimals
            }
          }
          const questTemplate = {
            progress: +quest.progress,
            id: +quest.id,
            tier: +quest.tier as Rarity,
            requirementType: +quest.requirementType as RequirementType,
            requirementRarity: +quest.requirementRarity as Rarity,
            requirementAmount: +quest.requirementAmount,
            requirementExternalAddress: quest.requirementExternalAddress,
            rewardType: +quest.rewardType as RewardType,
            rewardRarity: +quest.rewardRarity as Rarity,
            rewardAmount: +quest.rewardAmount,
            rewardExternalAddress: quest.rewardExternalAddress,
            reputationAmount: +quest.reputationAmount,
          } as Quest;
          questTemplates.push(questTemplate);
        }

        return questTemplates;
      },

      async addQuestTemplate({state}, {questTemplate, isPromo, supply, deadline}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const emptyAccount = '0x0000000000000000000000000000000000000000';

        if (!questTemplate.requirementExternalAddress) {
          questTemplate.requirementExternalAddress = emptyAccount;
        }

        if (!questTemplate.rewardExternalAddress) {
          questTemplate.rewardExternalAddress = emptyAccount;
        }

        let requirementAmount = questTemplate.requirementAmount;

        if(questTemplate.requirementType === RequirementType.EXTERNAL){
          const contract = new web3.eth.Contract(erc20Abi as any[], questTemplate.requirementExternalAddress);
          try {
            const currencyDecimals = await contract.methods.decimals().call(defaultCallOptions(state));
            requirementAmount = web3.utils.toBN(requirementAmount * 10 ** currencyDecimals);
          } catch {
            // Contract does not support decimals
          }
        }

        let rewardAmount = questTemplate.rewardAmount;

        if(questTemplate.rewardType === RewardType.EXTERNAL){
          const contract = new web3.eth.Contract(erc20Abi as any[], questTemplate.rewardExternalAddress);
          try {
            const currencyDecimals = await contract.methods.decimals().call(defaultCallOptions(state));
            rewardAmount = web3.utils.toBN(rewardAmount * 10 ** currencyDecimals);
          } catch {
            // Contract does not support decimals
          }
        }

        let tier = questTemplate.tier;
        if (isPromo) {
          tier += 10;
        }

        return await SimpleQuests.methods.addNewQuestTemplate(tier,
          questTemplate.requirementType, questTemplate.requirementRarity, requirementAmount, questTemplate.requirementExternalAddress,
          questTemplate.rewardType, questTemplate.rewardRarity, rewardAmount, questTemplate.rewardExternalAddress,
          questTemplate.reputationAmount, supply, deadline).send(defaultCallOptions(state));
      },

      async deleteQuest({state}, {tier, questID}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.deleteQuestTemplate(tier, questID).send(defaultCallOptions(state));
      },

      async getCharacterQuestData({ state }, {characterId}) {
        const { SimpleQuests } = state.contracts();
        if(!SimpleQuests || !state.defaultAccount) return;

        const questId = await SimpleQuests.methods.characterQuest(characterId).call(defaultCallOptions(state));


        const quest = await SimpleQuests.methods.quests(questId).call(defaultCallOptions(state)) as unknown as {
          progress: string | number;
          id: string;
          tier: string;
          requirementType: string;
          requirementRarity: string;
          requirementAmount: string;
          requirementExternalAddress: string;
          rewardType: string;
          rewardRarity: string;
          rewardAmount: string;
          rewardExternalAddress: string;
          reputationAmount: string;
        };

        const charQuestDataRaw = await SimpleQuests.methods.getCharacterQuestData(characterId).call(defaultCallOptions(state));
        const emptyAccount = '0x0000000000000000000000000000000000000000';
        quest.progress = +charQuestDataRaw[0];
        if(quest.requirementExternalAddress !== emptyAccount
          && ((quest.requirementType && +quest.requirementType as RequirementType === RequirementType.EXTERNAL)
            || (quest.requirementType && +quest.requirementType as RequirementType === RequirementType.EXTERNAL_HOLD))) {
          const currencyContract = new web3.eth.Contract(erc20Abi as any[], quest.requirementExternalAddress);
          try{
            const currencyDecimals = await currencyContract.methods.decimals().call(defaultCallOptions(state));
            quest.requirementAmount = new BigNumber(quest.requirementAmount).div(new BigNumber(10 ** currencyDecimals)).toFixed();
            quest.progress = new BigNumber(quest.progress).div(new BigNumber(10 ** currencyDecimals)).toFixed();
          } catch {
            // Contract does not support decimals
          }
        }

        if(quest.rewardExternalAddress !== emptyAccount
          && +quest.rewardType as RewardType === RewardType.EXTERNAL) {
          const currencyContract = new web3.eth.Contract(erc20Abi as any[], quest.rewardExternalAddress);
          try{
            const currencyDecimals = await currencyContract.methods.decimals().call(defaultCallOptions(state));
            quest.rewardAmount = new BigNumber(quest.rewardAmount).div(new BigNumber(10 ** currencyDecimals)).toFixed();
          } catch {
            // Contract does not support decimals
          }
        }

        return {
          progress: +quest.progress,
          type: +charQuestDataRaw[1] as RequirementType,
          reputation: +charQuestDataRaw[2],
          id: +quest.id,
          tier: +quest.tier as Rarity,
          requirementType: +quest.requirementType as RequirementType,
          requirementRarity: +quest.requirementRarity as Rarity,
          requirementAmount: +quest.requirementAmount,
          requirementExternalAddress: quest.requirementExternalAddress,
          rewardType: +quest.rewardType as RewardType,
          rewardRarity: +quest.rewardRarity as Rarity,
          rewardAmount: +quest.rewardAmount,
          rewardExternalAddress: quest.rewardExternalAddress,
          reputationAmount: +quest.reputationAmount,
        } as Quest;
      },

      async getCharacterBusyStatus({state}, {characterId}) {
        const { Characters } = state.contracts();
        if(!Characters || !state.defaultAccount) return;

        const NFTVAR_BUSY = await Characters.methods.NFTVAR_BUSY().call(defaultCallOptions(state));

        return await Characters.methods.getNftVar(characterId, NFTVAR_BUSY).call(defaultCallOptions(state));
      },

      async getQuestTierChances({state}, {tier}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const tierChancesRaw = await SimpleQuests.methods.getTierChances(tier).call(defaultCallOptions(state));
        const legendary = 100 - +tierChancesRaw[3];
        const epic = 100 - +tierChancesRaw[2] - legendary;
        const rare = 100 - +tierChancesRaw[1] - epic - legendary;
        const uncommon = 100 - +tierChancesRaw[0] - rare - epic - legendary;
        const common = 100 - uncommon - rare - epic - legendary;
        return {common, uncommon, rare, epic, legendary} as TierChances;
      },

      async setQuestTierChances({state}, {tier, tierChances}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const uncommon = String(100 - tierChances.uncommon - tierChances.rare - tierChances.epic - tierChances.legendary);
        const rare = String(100 - tierChances.rare - tierChances.epic - tierChances.legendary);
        const epic = String(100 - tierChances.epic - tierChances.legendary);
        const legendary = String(100 - tierChances.legendary);

        return await SimpleQuests.methods.setTierChances(tier, [uncommon, rare, epic, legendary]).send(defaultCallOptions(state));
      },

      async setSkipQuestStaminaCost({state}, {staminaCost}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_SKIP_QUEST_STAMINA_COST = await SimpleQuests.methods.VAR_SKIP_QUEST_STAMINA_COST().call(defaultCallOptions(state));

        return await SimpleQuests.methods.setVar(VAR_SKIP_QUEST_STAMINA_COST, staminaCost).send(defaultCallOptions(state));
      },

      async getSkipQuestStaminaCost({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_SKIP_QUEST_STAMINA_COST = await SimpleQuests.methods.VAR_SKIP_QUEST_STAMINA_COST().call(defaultCallOptions(state));

        return await SimpleQuests.methods.vars(VAR_SKIP_QUEST_STAMINA_COST).call(defaultCallOptions(state));
      },

      async getWeeklyCompletionsGoal({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_WEEKLY_COMPLETIONS_GOAL = await SimpleQuests.methods.VAR_WEEKLY_COMPLETIONS_GOAL().call(defaultCallOptions(state));

        return await SimpleQuests.methods.vars(VAR_WEEKLY_COMPLETIONS_GOAL).call(defaultCallOptions(state));
      },

      async setWeeklyCompletionsGoal({state}, {newGoal}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_WEEKLY_COMPLETIONS_GOAL = await SimpleQuests.methods.VAR_WEEKLY_COMPLETIONS_GOAL().call(defaultCallOptions(state));

        return await SimpleQuests.methods.setVar(VAR_WEEKLY_COMPLETIONS_GOAL, newGoal).send(defaultCallOptions(state));
      },

      async addWeeklyReward({state}, {weeklyReward}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const emptyAccount = '0x0000000000000000000000000000000000000000';
        if (weeklyReward.rewardExternalAddress === '') {
          weeklyReward.rewardExternalAddress = emptyAccount;
        }

        const result =await SimpleQuests.methods.addReward(weeklyReward.rewardType,
          weeklyReward.rewardRarity, weeklyReward.rewardAmount,
          weeklyReward.rewardExternalAddress, weeklyReward.reputationAmount)
          .send(defaultCallOptions(state));

        return result.events.RewardAdded.returnValues.rewardID;
      },

      async setWeeklyReward({state}, {rewardID, timestamp}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.setWeeklyReward(rewardID, timestamp).send(defaultCallOptions(state));
      },

      async getWeeklyReward({state}, {timestamp}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const weekInSeconds = 604800;
        const week = Math.floor(timestamp / 1000 / weekInSeconds);

        const rewardID = +await SimpleQuests.methods.weeklyRewards(week).call(defaultCallOptions(state));
        const weeklyRewardRaw = await SimpleQuests.methods.rewards(rewardID).call(defaultCallOptions(state)) as unknown as {
          id: string;
          rewardType: string;
          rewardRarity: string;
          rewardAmount: string;
          rewardExternalAddress: string;
          reputationAmount: string;
        };
        return {
          id: +weeklyRewardRaw.id,
          rewardType: +weeklyRewardRaw.rewardType as RewardType,
          rewardRarity: +weeklyRewardRaw.rewardRarity as Rarity,
          rewardAmount: +weeklyRewardRaw.rewardAmount,
          rewardExternalAddress: weeklyRewardRaw.rewardExternalAddress,
          reputationAmount: +weeklyRewardRaw.reputationAmount,
        } as WeeklyReward;
      },

      async claimWeeklyReward({state, dispatch}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const weekInSeconds = 604800;
        const currentWeek = Math.floor(Date.now() / 1000 / weekInSeconds);

        const rewardID = +await SimpleQuests.methods.weeklyRewards(currentWeek).call(defaultCallOptions(state));

        if(rewardID === 0) {
          return;
        }

        if (!await SimpleQuests.methods.hasRandomWeeklyRewardSeedRequested(rewardID).call(defaultCallOptions(state))) {
          await SimpleQuests.methods.generateRewardWeeklySeed(rewardID).send(defaultCallOptions(state));
        }
        const result = await SimpleQuests.methods.claimWeeklyReward().send(defaultCallOptions(state));

        const questRewards = result.events.WeeklyRewardClaimed.returnValues.rewards;
        await Promise.all([
          dispatch('updateWeaponIds'),
          dispatch('updateShieldIds'),
          dispatch('updateTrinketIds'),
          dispatch('updateJunkIds'),
          dispatch('updateKeyLootboxIds'),
        ]);
        return questRewards;
      },

      async hasClaimedWeeklyReward({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const weekInSeconds = 604800;
        const currentWeek = Math.floor(Date.now() / 1000 / weekInSeconds);

        const rewardID = +await SimpleQuests.methods.weeklyRewards(currentWeek).call(defaultCallOptions(state));

        if(rewardID === 0) {
          return false;
        }

        return await SimpleQuests.methods.weeklyRewardClaimed(state.defaultAccount, currentWeek).call(defaultCallOptions(state));
      },

      async getReputationLevelRequirements({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_REPUTATION_LEVEL_2 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_2().call(defaultCallOptions(state));
        const VAR_REPUTATION_LEVEL_3 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_3().call(defaultCallOptions(state));
        const VAR_REPUTATION_LEVEL_4 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_4().call(defaultCallOptions(state));
        const VAR_REPUTATION_LEVEL_5 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_5().call(defaultCallOptions(state));

        const requirementsRaw = await SimpleQuests.methods.getVars([
          VAR_REPUTATION_LEVEL_2,
          VAR_REPUTATION_LEVEL_3,
          VAR_REPUTATION_LEVEL_4,
          VAR_REPUTATION_LEVEL_5,
        ]).call(defaultCallOptions(state));
        return {
          level2: +requirementsRaw[0],
          level3: +requirementsRaw[1],
          level4: +requirementsRaw[2],
          level5: +requirementsRaw[3]
        } as ReputationLevelRequirements;
      },

      async setReputationLevelRequirements({state}, {requirements}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_REPUTATION_LEVEL_2 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_2().call(defaultCallOptions(state));
        const VAR_REPUTATION_LEVEL_3 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_3().call(defaultCallOptions(state));
        const VAR_REPUTATION_LEVEL_4 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_4().call(defaultCallOptions(state));
        const VAR_REPUTATION_LEVEL_5 = await SimpleQuests.methods.VAR_REPUTATION_LEVEL_5().call(defaultCallOptions(state));

        return await SimpleQuests.methods.setVars([
          VAR_REPUTATION_LEVEL_2,
          VAR_REPUTATION_LEVEL_3,
          VAR_REPUTATION_LEVEL_4,
          VAR_REPUTATION_LEVEL_5,
        ], requirements).send(defaultCallOptions(state));
      },

      async isUsingPromoQuests({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_COMMON_TIER = await SimpleQuests.methods.VAR_COMMON_TIER().call(defaultCallOptions(state));
        const VAR_UNCOMMON_TIER = await SimpleQuests.methods.VAR_UNCOMMON_TIER().call(defaultCallOptions(state));
        const VAR_RARE_TIER = await SimpleQuests.methods.VAR_RARE_TIER().call(defaultCallOptions(state));
        const VAR_EPIC_TIER = await SimpleQuests.methods.VAR_EPIC_TIER().call(defaultCallOptions(state));
        const VAR_LEGENDARY_TIER = await SimpleQuests.methods.VAR_LEGENDARY_TIER().call(defaultCallOptions(state));

        const tiersRaw = await SimpleQuests.methods.getVars([
          VAR_COMMON_TIER,
          VAR_UNCOMMON_TIER,
          VAR_RARE_TIER,
          VAR_EPIC_TIER,
          VAR_LEGENDARY_TIER,
        ]).call(defaultCallOptions(state));

        return !(+tiersRaw[0] === 0 && +tiersRaw[1] === 1 && +tiersRaw[2] === 2 && +tiersRaw[3] === 3 && +tiersRaw[4] === 4);
      },

      async toggleUsePromoQuests({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        const VAR_COMMON_TIER = await SimpleQuests.methods.VAR_COMMON_TIER().call(defaultCallOptions(state));
        const VAR_UNCOMMON_TIER = await SimpleQuests.methods.VAR_UNCOMMON_TIER().call(defaultCallOptions(state));
        const VAR_RARE_TIER = await SimpleQuests.methods.VAR_RARE_TIER().call(defaultCallOptions(state));
        const VAR_EPIC_TIER = await SimpleQuests.methods.VAR_EPIC_TIER().call(defaultCallOptions(state));
        const VAR_LEGENDARY_TIER = await SimpleQuests.methods.VAR_LEGENDARY_TIER().call(defaultCallOptions(state));

        const tiersRaw = await SimpleQuests.methods.getVars([
          VAR_COMMON_TIER,
          VAR_UNCOMMON_TIER,
          VAR_RARE_TIER,
          VAR_EPIC_TIER,
          VAR_LEGENDARY_TIER,
        ]).call(defaultCallOptions(state));

        if(+tiersRaw[0] === 0 && +tiersRaw[1] === 1 && +tiersRaw[2] === 2 && +tiersRaw[3] === 3 && +tiersRaw[4] === 4) {
          return await SimpleQuests.methods.setVars([
            VAR_COMMON_TIER,
            VAR_UNCOMMON_TIER,
            VAR_RARE_TIER,
            VAR_EPIC_TIER,
            VAR_LEGENDARY_TIER,
          ], ['10', '11', '12', '13', '14']).send(defaultCallOptions(state));
        } else {
          return await SimpleQuests.methods.setVars([
            VAR_COMMON_TIER,
            VAR_UNCOMMON_TIER,
            VAR_RARE_TIER,
            VAR_EPIC_TIER,
            VAR_LEGENDARY_TIER,
          ], ['0', '1', '2', '3', '4']).send(defaultCallOptions(state));
        }
      },

      async hasStaminaToSkipQuest({state}, {characterID}) {
        const {SimpleQuests, Characters} = state.contracts();
        if (!SimpleQuests || !Characters || !state.defaultAccount) return;

        const VAR_SKIP_QUEST_STAMINA_COST = await SimpleQuests.methods.VAR_SKIP_QUEST_STAMINA_COST().call(defaultCallOptions(state));
        const staminaPoints = +await Characters.methods.getStaminaPoints(characterID).call(defaultCallOptions(state));
        const staminaCost = +await SimpleQuests.methods.vars(VAR_SKIP_QUEST_STAMINA_COST).call(defaultCallOptions(state));

        return staminaPoints >= staminaCost;
      },

      async hasFreeSkip({state}, {characterID}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.hasFreeSkip(characterID).call(defaultCallOptions(state));
      },

      async nextFreeSkip({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.nextFreeSkip().call(defaultCallOptions(state));
      },

      async nextWeeklyQuestCompletionGoalReset({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.nextWeeklyQuestCompletionGoalReset().call(defaultCallOptions(state));
      },

      async getWeeklyCompletions({state}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        return await SimpleQuests.methods.getWeeklyCompletions(state.defaultAccount).call(defaultCallOptions(state));
      },

      async skipQuest({ state, dispatch }, {characterID}) {
        const { SimpleQuests } = state.contracts();
        if(!SimpleQuests || !state.defaultAccount) return;

        await SimpleQuests.methods.skipQuest(characterID).send(defaultCallOptions(state));
        await dispatch('fetchCharacterStamina', characterID);
      },

      async completeQuest({state, dispatch}, {characterID}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        if (!await SimpleQuests.methods.hasRandomQuestRewardSeedRequested(characterID).call(defaultCallOptions(state))) {
          await SimpleQuests.methods.generateRewardQuestSeed(characterID).send(defaultCallOptions(state));
        }
        const result = await SimpleQuests.methods.completeQuest(characterID).send(defaultCallOptions(state));

        const questRewards = result.events.QuestRewarded.returnValues.rewards;
        await Promise.all([
          dispatch('fetchCharacter', {characterId: characterID}),
          dispatch('updateWeaponIds'),
          dispatch('updateShieldIds'),
          dispatch('updateTrinketIds'),
          dispatch('updateJunkIds'),
          dispatch('updateKeyLootboxIds'),
          dispatch('fetchDustBalance'),
          dispatch('fetchCharacterStamina', characterID),
          dispatch('fetchSoulBalance', characterID),
        ]);
        return questRewards;
      },

      async requestQuest({ state }, {characterID}) {
        const { SimpleQuests } = state.contracts();
        if(!SimpleQuests || !state.defaultAccount) return;

        if (!await SimpleQuests.methods.hasRandomQuestSeedRequested(characterID).call(defaultCallOptions(state))) {
          await SimpleQuests.methods.generateRequestQuestSeed(characterID).send(defaultCallOptions(state));
        }

        return await SimpleQuests.methods.requestQuest(characterID).send(defaultCallOptions(state));
      },

      async submitProgress({state, dispatch}, {characterID, tokenIds}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        await SimpleQuests.methods.submitProgress(characterID, tokenIds).send(defaultCallOptions(state));

        await Promise.all([
          dispatch('updateWeaponIds'),
          dispatch('updateShieldIds'),
          dispatch('updateTrinketIds'),
          dispatch('updateJunkIds'),
          dispatch('updateKeyLootboxIds'),
        ]);
      },

      async submitProgressAmount({state, dispatch}, {characterID, amount}) {
        const {SimpleQuests} = state.contracts();
        if (!SimpleQuests || !state.defaultAccount) return;

        await SimpleQuests.methods.submitProgressAmount(characterID, amount).send(defaultCallOptions(state));
        await Promise.all([
          dispatch('fetchCharacterStamina', characterID),
          dispatch('fetchSoulBalance', characterID),
          dispatch('fetchDustBalance'),
        ]);
      },

      async submitExternalProgress({state}, {characterID, tokenIds, tokenAddress}) {
        const {SimpleQuests, PartnerVault} = state.contracts();
        if (!SimpleQuests || !PartnerVault || !state.defaultAccount) return;

        const tokenContract = new web3.eth.Contract(erc721Abi as any[], tokenAddress) as Contract<IERC721>;

        const isApprovedForAll = await tokenContract.methods.isApprovedForAll(state.defaultAccount, SimpleQuests.options.address)
          .call(defaultCallOptions(state));

        if(tokenIds.length === 1 && !isApprovedForAll) {
          await tokenContract.methods.approve(SimpleQuests.options.address, tokenIds[0]).send({
            from: state.defaultAccount
          });
        } else if (!isApprovedForAll) {
          await tokenContract.methods.setApprovalForAll(SimpleQuests.options.address, true).send({
            from: state.defaultAccount
          });
        }

        return await SimpleQuests.methods.submitProgress(characterID, tokenIds).send(defaultCallOptions(state));
      },

      async submitExternalProgressAmount({state}, {characterID, amount, currencyAddress}) {
        const {SimpleQuests, PartnerVault} = state.contracts();
        if (!SimpleQuests || !PartnerVault || !state.defaultAccount) return;

        const currencyContract = new web3.eth.Contract(erc20Abi as any[], currencyAddress) as Contract<ERC20>;
        const currencyDecimals = +await currencyContract.methods.decimals().call(defaultCallOptions(state));
        const amountTimesDecimals = web3.utils.toBN(amount * 10 ** currencyDecimals);
        await currencyContract.methods.approve(PartnerVault.options.address, amountTimesDecimals.toString()).send({
          from: state.defaultAccount
        });

        return await SimpleQuests.methods.submitProgressAmount(characterID, amountTimesDecimals.toString()).send(defaultCallOptions(state));
      },

      async isExternalCurrency({state}, {currencyAddress}) {
        try{
          const currencyContract = new web3.eth.Contract(erc20Abi as any[], currencyAddress) as Contract<ERC20>;
          await currencyContract.methods.decimals().call(defaultCallOptions(state));
          return true;
        } catch (e) {
          return false;
        }
      },

      async grantRole({state}, {walletAddress, contract, roleMethod}) {
        if (!contract || !state.defaultAccount || !Web3.utils.isAddress(walletAddress)) return;

        const role = await roleMethod().call(defaultCallOptions(state));

        await contract.methods.grantRole(role, walletAddress).send(defaultCallOptions(state));
      },

      async revokeRole({state}, {walletAddress, contract, roleMethod}) {
        if (!contract || !state.defaultAccount || !Web3.utils.isAddress(walletAddress)) return;

        const role = await roleMethod().call(defaultCallOptions(state));

        await contract.methods.revokeRole(role, walletAddress).send(defaultCallOptions(state));
      },

      async userHasAdminAccess({state}, {contract}) {
        if (!contract || !state.defaultAccount) return;

        const adminRole = await contract.methods.GAME_ADMIN().call(defaultCallOptions(state));

        return await contract.methods.hasRole(adminRole, state.defaultAccount).call(defaultCallOptions(state));
      },

      async userHasMinterAccess({state}, {contract}) {
        if (!contract || !contract.methods.MINTER_ROLE || !state.defaultAccount) return;

        const minterRole = await contract.methods.MINTER_ROLE().call(defaultCallOptions(state));

        return await contract.methods.hasRole(minterRole, state.defaultAccount).call(defaultCallOptions(state));
      },

      async userHasAnyAdminAccess({state}) {
        const {SimpleQuests, CBKLand, Weapons, BurningManager} = state.contracts();
        if (!BurningManager || !Weapons || !SimpleQuests || !CBKLand || !state.defaultAccount) return;

        const simpleQuestsAdminRole = await SimpleQuests.methods.GAME_ADMIN().call(defaultCallOptions(state));
        const cbkLandAdminRole = await CBKLand.methods.GAME_ADMIN().call(defaultCallOptions(state));
        const weaponsAdminRole = await Weapons.methods.GAME_ADMIN().call(defaultCallOptions(state));
        const burningManagerAdminRole = await BurningManager.methods.GAME_ADMIN().call(defaultCallOptions(state));

        const promises: Promise<boolean>[] = [
          SimpleQuests.methods.hasRole(simpleQuestsAdminRole, state.defaultAccount).call(defaultCallOptions(state)),
          CBKLand.methods.hasRole(cbkLandAdminRole, state.defaultAccount).call(defaultCallOptions(state)),
          Weapons.methods.hasRole(weaponsAdminRole, state.defaultAccount).call(defaultCallOptions(state)),
          BurningManager.methods.hasRole(burningManagerAdminRole, state.defaultAccount).call(defaultCallOptions(state)),
        ];

        for (const promise of promises) {
          if (await promise) return true;
        }
        return false;
      },

      async userHasAnyMinterAccess({state}) {
        const {Weapons, Characters} = state.contracts();
        if (!Weapons || !Characters || !state.defaultAccount) return;

        const weaponsMinerRole = await Weapons.methods.MINTER_ROLE().call(defaultCallOptions(state));
        const charactersMinerRole = await Characters.methods.MINTER_ROLE().call(defaultCallOptions(state));

        const promises: Promise<boolean>[] = [
          Weapons.methods.hasRole(weaponsMinerRole, state.defaultAccount).call(defaultCallOptions(state)),
          Characters.methods.hasRole(charactersMinerRole, state.defaultAccount).call(defaultCallOptions(state)),
        ];

        for (const promise of promises) {
          if (await promise) return true;
        }
        return false;
      },

      async canUserAfford({ state }, {payingAmount}) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades || !state.defaultAccount) return;

        const unclaimedSkill = await CryptoBlades.methods
          .getTokenRewardsFor(state.defaultAccount)
          .call(defaultCallOptions(state));

        const walletSkill = state.skillBalance;

        const totalSkill = +unclaimedSkill + +walletSkill;

        return totalSkill >= payingAmount;
      },

      async claimTokenRewards({ state, dispatch }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        await CryptoBlades.methods.claimTokenRewards().send({
          from: state.defaultAccount,
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill')
        ]);
      },

      async claimXpRewards({ state, dispatch }) {
        const { CryptoBlades } = state.contracts();
        if(!CryptoBlades) return;

        await CryptoBlades.methods.claimXpRewards().send({
          from: state.defaultAccount,
        });

        await Promise.all([
          dispatch('fetchCharacters', state.ownedCharacterIds),
          dispatch('fetchFightRewardXp')
        ]);
      },

      async fetchWaxBridgeDetails({ state, commit }) {
        const { WaxBridge } = state.contracts();
        if(!WaxBridge || !state.defaultAccount) return;

        const [
          waxBridgeWithdrawableBnb,
          waxBridgeRemainingWithdrawableBnbDuringPeriod,
          waxBridgeTimeUntilLimitExpires
        ] = await Promise.all([
          WaxBridge.methods.withdrawableBnb(state.defaultAccount).call(defaultCallOptions(state)),
          WaxBridge.methods.getRemainingWithdrawableBnbDuringPeriod().call(defaultCallOptions(state)),
          WaxBridge.methods.getTimeUntilLimitExpires().call(defaultCallOptions(state)),
        ]);

        const payload: WaxBridgeDetailsPayload = {
          waxBridgeWithdrawableBnb,
          waxBridgeRemainingWithdrawableBnbDuringPeriod,
          waxBridgeTimeUntilLimitExpires: +waxBridgeTimeUntilLimitExpires
        };
        commit('updateWaxBridgeDetails', payload);
      },

      async withdrawBnbFromWaxBridge({ state, dispatch }) {
        const { WaxBridge } = state.contracts();
        if(!WaxBridge || !state.defaultAccount) return;

        await WaxBridge.methods.withdraw(state.waxBridgeWithdrawableBnb).send(defaultCallOptions(state));

        await dispatch('fetchWaxBridgeDetails');
      },

      async fetchTotalShieldSupply({ state }) {
        const { Shields } = state.contracts();
        if(!Shields || !state.defaultAccount) return;

        return await Shields.methods.totalSupply().call(defaultCallOptions(state));
      },

      async fetchTotalRenameTags({ state }) {
        const { CharacterRenameTagConsumables } = state.contracts();
        //console.log(CharacterRenameTagConsumables+' / '+!state.defaultAccount);
        if(!CharacterRenameTagConsumables || !state.defaultAccount) return;
        return await CharacterRenameTagConsumables.methods.getItemCount().call(defaultCallOptions(state));
      },
      async purchaseRenameTag({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, CharacterRenameTagConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterRenameTagConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterRenameTag(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalRenameTags')
        ]);
      },
      async purchaseRenameTagDeal({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, CharacterRenameTagConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterRenameTagConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterRenameTagDeal(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalRenameTags')
        ]);
      },
      async renameCharacter({ state, dispatch}, {id, name}) {
        const { CryptoBlades, SkillToken, CharacterRenameTagConsumables } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterRenameTagConsumables || !state.defaultAccount) return;

        await CharacterRenameTagConsumables.methods
          .renameCharacter(id, name)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacterRename', id)
        ]);
      },
      async fetchTotalWeaponRenameTags({ state }) {
        const { WeaponRenameTagConsumables } = state.contracts();
        if(!WeaponRenameTagConsumables || !state.defaultAccount) return;
        return await WeaponRenameTagConsumables.methods.getItemCount().call(defaultCallOptions(state));
      },
      async purchaseWeaponRenameTag({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, WeaponRenameTagConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !WeaponRenameTagConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseWeaponRenameTag(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalWeaponRenameTags')
        ]);
      },
      async purchaseWeaponRenameTagDeal({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, WeaponRenameTagConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !WeaponRenameTagConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseWeaponRenameTagDeal(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalRenameTags')
        ]);
      },
      async renameWeapon({ state, dispatch}, {id, name}) {
        const { CryptoBlades, SkillToken, WeaponRenameTagConsumables } = state.contracts();
        if(!CryptoBlades || !SkillToken || !WeaponRenameTagConsumables || !state.defaultAccount) return;

        await WeaponRenameTagConsumables.methods
          .renameWeapon(id, name)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchWeaponRename', id)
        ]);
      },

      async fetchTotalCharacterFireTraitChanges({ state }) {
        const { CharacterFireTraitChangeConsumables } = state.contracts();
        if(!CharacterFireTraitChangeConsumables || !state.defaultAccount) return;
        return await CharacterFireTraitChangeConsumables.methods.getItemCount().call(defaultCallOptions(state));
      },
      async purchaseCharacterFireTraitChange({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, CharacterFireTraitChangeConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterFireTraitChangeConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterFireTraitChange(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalCharacterFireTraitChanges')
        ]);
      },
      async changeCharacterTraitFire({ state, dispatch}, { id }) {
        const { CryptoBlades, SkillToken, CharacterFireTraitChangeConsumables } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterFireTraitChangeConsumables || !state.defaultAccount) return;

        await CharacterFireTraitChangeConsumables.methods
          .changeCharacterTrait(id)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacter', { characterId: id }),
        ]);
      },

      async fetchTotalCharacterEarthTraitChanges({ state }) {
        const { CharacterEarthTraitChangeConsumables } = state.contracts();
        if(!CharacterEarthTraitChangeConsumables || !state.defaultAccount) return;
        return await CharacterEarthTraitChangeConsumables.methods.getItemCount().call(defaultCallOptions(state));
      },
      async purchaseCharacterEarthTraitChange({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, CharacterEarthTraitChangeConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterEarthTraitChangeConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterEarthTraitChange(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalCharacterEarthTraitChanges')
        ]);
      },
      async changeCharacterTraitEarth({ state, dispatch}, { id }) {
        const { CryptoBlades, SkillToken, CharacterEarthTraitChangeConsumables } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterEarthTraitChangeConsumables || !state.defaultAccount) return;

        await CharacterEarthTraitChangeConsumables.methods
          .changeCharacterTrait(id)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacter', { characterId: id }),
        ]);
      },

      async fetchTotalCharacterWaterTraitChanges({ state }) {
        const { CharacterWaterTraitChangeConsumables } = state.contracts();
        if(!CharacterWaterTraitChangeConsumables || !state.defaultAccount) return;
        return await CharacterWaterTraitChangeConsumables.methods.getItemCount().call(defaultCallOptions(state));
      },
      async purchaseCharacterWaterTraitChange({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, CharacterWaterTraitChangeConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterWaterTraitChangeConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterWaterTraitChange(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalCharacterWaterTraitChanges')
        ]);
      },
      async changeCharacterTraitWater({ state, dispatch}, { id }) {
        const { CryptoBlades, SkillToken, CharacterWaterTraitChangeConsumables } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterWaterTraitChangeConsumables || !state.defaultAccount) return;

        await CharacterWaterTraitChangeConsumables.methods
          .changeCharacterTrait(id)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacter', { characterId: id }),
        ]);
      },

      async fetchTotalCharacterLightningTraitChanges({ state }) {
        const { CharacterLightningTraitChangeConsumables } = state.contracts();
        if(!CharacterLightningTraitChangeConsumables || !state.defaultAccount) return;
        return await CharacterLightningTraitChangeConsumables.methods.getItemCount().call(defaultCallOptions(state));
      },
      async purchaseCharacterLightningTraitChange({ state, dispatch }, {price}) {
        const { CryptoBlades, SkillToken, CharacterLightningTraitChangeConsumables, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterLightningTraitChangeConsumables || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(Web3.utils.toWei('' + price))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterLightningTraitChange(Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchTotalCharacterLightningTraitChanges')
        ]);
      },
      async changeCharacterTraitLightning({ state, dispatch}, { id }) {
        const { CryptoBlades, SkillToken, CharacterLightningTraitChangeConsumables } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterLightningTraitChangeConsumables || !state.defaultAccount) return;

        await CharacterLightningTraitChangeConsumables.methods
          .changeCharacterTrait(id)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacter', { characterId: id }),
        ]);
      },
      async fetchOwnedWeaponCosmetics({ state }, {cosmetic}) {
        const { WeaponCosmetics } = state.contracts();
        if(!WeaponCosmetics || !state.defaultAccount) return;
        return await WeaponCosmetics.methods.getCosmeticCount(cosmetic).call(defaultCallOptions(state));
      },
      async purchaseWeaponCosmetic({ state, dispatch }, {cosmetic, price}) {
        const { CryptoBlades, SkillToken, WeaponCosmetics, Blacksmith } = state.contracts();
        if(!CryptoBlades || !WeaponCosmetics || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(web3.utils.toWei('' + price, 'ether'))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseWeaponCosmetic(cosmetic, Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill')
        ]);
      },
      async changeWeaponCosmetic({ state, dispatch}, { id, cosmetic }) {
        const { CryptoBlades, SkillToken, WeaponCosmetics } = state.contracts();
        if(!CryptoBlades || !SkillToken || !WeaponCosmetics || !state.defaultAccount) return;

        await WeaponCosmetics.methods
          .applyCosmetic(id, cosmetic)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchWeaponCosmetic', id)
        ]);
      },
      async removeWeaponCosmetic({ state, dispatch}, { id }) {
        const { CryptoBlades, SkillToken, WeaponCosmetics } = state.contracts();
        if(!CryptoBlades || !SkillToken || !WeaponCosmetics || !state.defaultAccount) return;

        await WeaponCosmetics.methods
          .removeCosmetic(id)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchWeaponCosmetic', id)
        ]);
      },
      async fetchOwnedCharacterCosmetics({ state }, {cosmetic}) {
        const { CharacterCosmetics } = state.contracts();
        if(!CharacterCosmetics || !state.defaultAccount) return;
        return await CharacterCosmetics.methods.getCosmeticCount(cosmetic).call(defaultCallOptions(state));
      },
      async purchaseCharacterCosmetic({ state, dispatch }, {cosmetic, price}) {
        const { CryptoBlades, SkillToken, CharacterCosmetics, Blacksmith } = state.contracts();
        if(!CryptoBlades || !CharacterCosmetics || !Blacksmith || !state.defaultAccount) return;

        try {
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(web3.utils.toWei('' + price, 'ether'))
          );
        } catch(err) {
          console.error(err);
        }

        await Blacksmith.methods.purchaseCharacterCosmetic(cosmetic, Web3.utils.toWei('' + price)).send({
          from: state.defaultAccount,
          gas: '500000'
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill')
        ]);
      },
      async changeCharacterCosmetic({ state, dispatch}, { id, cosmetic }) {
        const { CryptoBlades, SkillToken, CharacterCosmetics } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterCosmetics || !state.defaultAccount) return;

        await CharacterCosmetics.methods
          .applyCosmetic(id, cosmetic)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacterCosmetic', id)
        ]);
      },
      async removeCharacterCosmetic({ state, dispatch}, { id }) {
        const { CryptoBlades, SkillToken, CharacterCosmetics } = state.contracts();
        if(!CryptoBlades || !SkillToken || !CharacterCosmetics || !state.defaultAccount) return;

        await CharacterCosmetics.methods
          .removeCosmetic(id)
          .send({
            from: state.defaultAccount,
            gas: '5000000'
          });

        await Promise.all([
          dispatch('fetchCharacterCosmetic', id)
        ]);
      },
      async fetchPartnerProjects({ state, dispatch }) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const activePartnerProjectIds = await Treasury.methods.getActivePartnerProjectsIds().call(defaultCallOptions(state));
        activePartnerProjectIds.forEach(async (id: string) => {
          await dispatch('fetchPartnerProject', id);
        });

        await dispatch('fetchDefaultSlippage');
      },

      async fetchPartnerProject({ state, commit }, id) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const partnerProject = partnerProjectFromContract(
          await Treasury.methods.getPartnerProject(id).call(defaultCallOptions(state))
        );

        commit('updatePartnerProjectsState', { partnerProjectId: id, partnerProject });
      },

      async fetchDefaultSlippage({ state, commit }) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const slippage = await Treasury.methods.defaultSlippage().call(defaultCallOptions(state));

        commit('updateDefaultSlippage', slippage);
      },

      async getPartnerProjectMultiplier({ state, commit }, id) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const multiplier = await Treasury.methods.getProjectMultiplier(id).call(defaultCallOptions(state));
        commit('updatePartnerProjectMultiplier', { partnerProjectId: id, multiplier });

        return multiplier;
      },

      async getPartnerProjectDistributionTime({ state }, id) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const distributionTime = await Treasury.methods.getProjectDistributionTime(id).call(defaultCallOptions(state));

        return distributionTime;
      },

      async getPartnerProjectClaimedAmount({ state }, id) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const claimedAmount = await Treasury.methods.getProjectClaimedAmount(id).call(defaultCallOptions(state));

        return claimedAmount;
      },

      async getSkillToPartnerRatio({ state, commit }, id) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        const ratio = await Treasury.methods.getSkillToPartnerRatio(id).call(defaultCallOptions(state));
        commit('updatePartnerProjectRatio', { partnerProjectId: id, ratio });

        return ratio;
      },

      async claimPartnerToken({ state, dispatch },
                              { id, skillAmount, currentMultiplier, slippage }:
                              {id: number, skillAmount: string, currentMultiplier: string, slippage: string}) {
        const { Treasury } = state.contracts();
        if(!Treasury || !state.defaultAccount) return;

        await Treasury.methods.claim(id, skillAmount, currentMultiplier, slippage).send({
          from: state.defaultAccount,
        });

        await Promise.all([
          dispatch('fetchSkillBalance'),
          dispatch('fetchFightRewardSkill'),
          dispatch('fetchPartnerProject', id)
        ]);
      },

      async configureMetaMask({ dispatch }) {
        const currentNetwork = await web3.eth.net.getId();
        if(currentNetwork === +getConfigValue('VUE_APP_NETWORK_ID')) return;
        dispatch('configureChainNet', {
          networkId: +getConfigValue('VUE_APP_NETWORK_ID'),
          chainId: getConfigValue('chainId'),
          chainName: getConfigValue('VUE_APP_EXPECTED_NETWORK_NAME'),
          currencyName: getConfigValue('currencyName'),
          currencySymbol: getConfigValue('currencySymbol'),
          currencyDecimals: +getConfigValue('currencyDecimals'),
          rpcUrls: getConfigValue('rpcUrls'),
          blockExplorerUrls: getConfigValue('blockExplorerUrls'),
          skillAddress: getConfigValue('VUE_APP_SKILL_TOKEN_CONTRACT_ADDRESS')
        });
      },
      async configureChainNet(
        { commit },
        { networkId, chainId, chainName, currencyName, currencySymbol, currencyDecimals, rpcUrls, blockExplorerUrls, skillAddress }:
        { networkId: number,
          chainId: string,
          chainName: string,
          currencyName: string,
          currencySymbol: string,
          currencyDecimals: number,
          rpcUrls: string[],
          blockExplorerUrls: string[],
          skillAddress: string,
        })
      {
        commit('setNetworkId', networkId);
        try {
          await (web3.currentProvider as any).request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId }],
          });
        } catch (switchError) {
          try {
            await (web3.currentProvider as any).request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId,
                  chainName,
                  nativeCurrency: {
                    name: currencyName,
                    symbol: currencySymbol,
                    decimals: currencyDecimals,
                  },
                  rpcUrls,
                  blockExplorerUrls,
                },
              ],
            });
          } catch (addError) {
            console.error(addError);
            return;
          }
        }

        try {
          await (web3.currentProvider as any).request({
            method: 'wallet_watchAsset',
            params: {
              type: 'ERC20',
              options: {
                address: skillAddress,
                symbol: 'SKILL',
                decimals: 18,
                image: 'https://app.cryptoblades.io/android-chrome-512x512.png',
              },
            },
          });
        } catch (error) {
          console.error(error);
        }

        window.location.reload();
      },
      async storeItem({ state, dispatch }, { nftContractAddr, tokenId}: { nftContractAddr: string, tokenId: string}) {

        const { NFTStorage, Weapons, Characters, Shields } = state.contracts();
        if(!NFTStorage || !Weapons || !Characters || !Shields || !state.defaultAccount) return;

        const NFTContract: Contract<IERC721> =
          nftContractAddr === Weapons.options.address
            ? Weapons : nftContractAddr === Characters.options.address
              ? Characters : Shields;

        await NFTContract.methods
          .approve(NFTStorage.options.address, tokenId)
          .send(defaultCallOptions(state));
        const res = await NFTStorage.methods
          .storeItem(nftContractAddr, tokenId)
          .send({
            from: state.defaultAccount,
          });

        if(nftContractAddr === Weapons.options.address)
          await dispatch('updateWeaponIds');
        else if(nftContractAddr === Characters.options.address)
          await dispatch('updateCharacterIds');
        else if (nftContractAddr === Shields.options.address)
          await dispatch('updateShieldIds');
        return res;
      },
      async getStorageItemIds({ state }, { nftContractAddr }: { nftContractAddr: string}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage) return;

        const res = await NFTStorage.methods
          .getStorageItemIds(nftContractAddr)
          .call(defaultCallOptions(state));

        return res;
      },
      async getNumberOfStoragedItems({ state }, { nftContractAddr }: { nftContractAddr: string}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage) return;

        const res = await NFTStorage.methods
          .getNumberOfStoragedItems(nftContractAddr)
          .call(defaultCallOptions(state));

        return res;
      },
      async withdrawFromStorage({ state, dispatch }, { nftContractAddr, tokenId}: { nftContractAddr: string, tokenId: number}) {
        const { NFTStorage, Weapons, Characters, Shields } = state.contracts();
        if(!NFTStorage || !Weapons || !Characters || !Shields || !state.defaultAccount) return;

        await NFTStorage.methods
          .withdrawFromStorage(nftContractAddr, tokenId)
          .send({
            from: state.defaultAccount,
          });

        if(nftContractAddr === Weapons.options.address)
          await dispatch('updateWeaponIds');
        else if(nftContractAddr === Characters.options.address)
          await dispatch('updateCharacterIds');
        else if (nftContractAddr === Shields.options.address)
          await dispatch('updateShieldIds');

      },
      async bridgeItem({ state, dispatch }, { nftContractAddr, tokenId, targetChain, bridgeFee }:
      { nftContractAddr: string, tokenId: number, targetChain: string, bridgeFee: string }) {
        const { NFTStorage, CryptoBlades, SkillToken } = state.contracts();
        if (!NFTStorage || !CryptoBlades || !SkillToken || !state.defaultAccount) return;
        await approveFeeFromAnyContractSimple(
          CryptoBlades,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          new BigNumber(bridgeFee)
        );
        await NFTStorage.methods
          .bridgeItem(nftContractAddr, tokenId, targetChain)
          .send({
            from: state.defaultAccount,
          });
        dispatch('fetchSkillBalance');
      },
      async getNFTChainId({state}, {nftContractAddr, tokenId}: { nftContractAddr: string, tokenId: number}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage) return;
        const chainId = await NFTStorage.methods
          .getNFTChainId(nftContractAddr, tokenId)
          .call(defaultCallOptions(state));
        return chainId;
      },
      async getBridgeTransferId({state}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage) return;
        const id = await NFTStorage.methods
          .getBridgeTransfer()
          .call(defaultCallOptions(state));
        return id;
      },
      async getBridgeTransfer({state}, {transferId}: { transferId: string}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage) return;
        const nft = await NFTStorage.methods
          .getBridgeTransfer(transferId)
          .call(defaultCallOptions(state));
        return {
          owner: nft[0],
          nftAddress: nft[1],
          nftId: +nft[2],
          requestBlock: +nft[3],
          lastUpdateBlock: +nft[4],
          chainId: +nft[5],
          status: +nft[6],
        }as NftTransfer;
      },
      async withdrawFromBridge({ state }, {tokenId}: {tokenId: number}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage || !state.defaultAccount) return;
        await NFTStorage.methods
          .withdrawFromBridge(tokenId)
          .send({
            from: state.defaultAccount,
          });
      },
      async cancelBridge({ state }) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage || !state.defaultAccount) return;
        await NFTStorage.methods
          .cancelBridge()
          .send({
            from: state.defaultAccount,
          });
      },
      async getReceivedNFTs({ state }) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage || !state.defaultAccount) return;
        const nftIds = await NFTStorage.methods
          .getReceivedNFTs()
          .call(defaultCallOptions(state));
        return nftIds.map(Number) as number[];
      },
      async getReceivedNFT({ state }, {tokenId}: {tokenId: number}) {
        const { NFTStorage } = state.contracts();
        if(!NFTStorage || !state.defaultAccount) return;
        const nft: string[] = await NFTStorage.methods
          .getReceivedNFT(tokenId)
          .call(defaultCallOptions(state));
        return {
          owner: nft[0],
          nftType: +nft[1],
          sourceChain: +nft[2],
          sourceId: +nft[3],
          status: +nft[4],
          transferInsMeta: nft[5],
        } as TransferedNft;
      },
      async chainEnabled({ state }, { chainId }: { chainId: string }) {
        const { NFTStorage } = state.contracts();
        if (!NFTStorage || !state.defaultAccount) return;
        return await NFTStorage.methods
          .chainBridgeEnabled(chainId)
          .call(defaultCallOptions(state));
      },

      async fetchItemPrices({state, commit}){
        const { Blacksmith } = state.contracts();
        if (!Blacksmith) return;

        try{
          //Fetch the flat prices of Skill Shop Items
          for(let itemIndex = 1; itemIndex <= 6; itemIndex++ ){
            const itemFlatPrices = await Blacksmith.methods
              .getFlatPriceOfItem(itemIndex)
              .call(defaultCallOptions(state));

            commit('updateItemPrices', {itemPrice: itemFlatPrices, id: itemIndex.toString()});
          }

          //Fetch the flat prices of Weapon Cosmetics
          for(let itemIndex = 1; itemIndex <= 19; itemIndex++){
            const itemSeriesFlatPrices = await Blacksmith.methods
              .getFlatPriceOfSeriesItem(7, itemIndex)
              .call(defaultCallOptions(state));

            commit('updateWeaponCosmeticPrices', {itemPrice: itemSeriesFlatPrices, id: itemIndex.toString()});
          }

          //Fetch the flat prices of Character Cosmetics
          for(let itemIndex = 1; itemIndex <= 18; itemIndex++){
            const itemSeriesFlatPrices = await Blacksmith.methods
              .getFlatPriceOfSeriesItem(8, itemIndex)
              .call(defaultCallOptions(state));

            commit('updateCharacterCosmeticPrices', {itemPrice: itemSeriesFlatPrices, id: itemIndex.toString()});
          }


        } catch(err){
          console.log('Blacksmith error');
          console.log(err);
        }
      },
      async transferNFT({ state, dispatch },{nftId, receiverAddress, nftType}: {nftId: number, receiverAddress: string, nftType: string}) {
        const { Characters, Junk, KeyLootbox, RaidTrinket, Shields, Weapons } = state.contracts();
        if (!Characters || !Junk || !KeyLootbox || !RaidTrinket || !Shields || !Weapons || !state.defaultAccount) return;

        if (nftType === 'character') {
          await Characters.methods
            .safeTransferFrom(state.defaultAccount, receiverAddress, nftId)
            .send({
              from: state.defaultAccount,
            });
          await dispatch('updateCharacterIds');
        }
        else if (nftType === 'junk') {
          await Junk.methods
            .safeTransferFrom(state.defaultAccount, receiverAddress, nftId)
            .send({
              from: state.defaultAccount,
            });
          await dispatch('updateJunkIds');
        }
        else if (nftType === 'keybox') {
          await KeyLootbox.methods
            .safeTransferFrom(state.defaultAccount, receiverAddress, nftId)
            .send({
              from: state.defaultAccount,
            });
          await dispatch('updateKeyLootboxIds');
        }
        else if (nftType === 'shield') {
          await Shields.methods
            .safeTransferFrom(state.defaultAccount, receiverAddress, nftId)
            .send({
              from: state.defaultAccount,
            });
          await dispatch('updateShieldIds');
        }
        else if (nftType === 'trinket') {
          await RaidTrinket.methods
            .safeTransferFrom(state.defaultAccount, receiverAddress, nftId)
            .send({
              from: state.defaultAccount,
            });
          await dispatch('updateTrinketIds');
        }
        else if (nftType === 'weapon') {
          await Weapons.methods
            .safeTransferFrom(state.defaultAccount, receiverAddress, nftId)
            .send({
              from: state.defaultAccount,
            });
          await dispatch('updateWeaponIds');
        }
      },

      async restoreFromGarrison({ state, dispatch }, characterId) {
        const { Garrison } = state.contracts();
        if(!Garrison || !state.defaultAccount) return;

        await Garrison.methods.restoreFromGarrison(characterId).send({ from: state.defaultAccount });
        await dispatch('updateCharacterIds');
      },

      async sendToGarrison({ state, dispatch }, characterId) {
        const { Garrison, Characters } = state.contracts();
        if(!Garrison || !Characters || !state.defaultAccount) return;

        await Characters.methods.approve(Garrison.options.address, characterId).send(defaultCallOptions(state));
        await Garrison.methods.sendToGarrison(characterId).send({ from: state.defaultAccount });
        await dispatch('updateCharacterIds');
      },

      async getWeapon({ state }, weaponId) {
        const { Weapons } = state.contracts();
        if (!Weapons || !state.defaultAccount) return;

        const weapon = await Weapons.methods.get(`${weaponId}`).call({ from: state.defaultAccount });

        return weapon;
      },

      async getShield({ state }, shieldId) {
        const { Shields } = state.contracts();
        if (!Shields || !state.defaultAccount) return;

        const shield = await Shields.methods.get(`${shieldId}`).call({ from: state.defaultAccount });

        return shield;
      },

      async getCharacter({ state }, characterId) {
        const { Characters } = state.contracts();
        if (!Characters || !state.defaultAccount) return;

        const character = await Characters.methods.get(`${characterId}`).call({ from: state.defaultAccount });

        return character;
      },

      async getFighterByCharacter({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const fighter = await PvpArena.methods.fighterByCharacter(characterId).call({ from: state.defaultAccount });

        return fighter;
      },

      async getCurrentRankedSeason({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const currentRankedSeason = await PvpArena.methods.currentRankedSeason().call({ from: state.defaultAccount });

        return currentRankedSeason;
      },

      async getSeasonStartedAt({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const seasonStartedAt = await PvpArena.methods.seasonStartedAt().call({ from: state.defaultAccount });

        return seasonStartedAt;
      },

      async getSeasonDuration({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const seasonDuration = await PvpArena.methods.seasonDuration().call({ from: state.defaultAccount });

        return seasonDuration;
      },

      async getCharacterLevel({ state }, characterId) {
        const { Characters } = state.contracts();
        if (!Characters || !state.defaultAccount) return;

        const characterLevel = await Characters.methods.getLevel(characterId).call({ from: state.defaultAccount });

        return characterLevel;
      },

      async getRename({state}, characterId){
        const { CharacterRenameTagConsumables } = state.contracts();

        const characterRename = await CharacterRenameTagConsumables?.methods.getCharacterRename(characterId).call({ from: state.defaultAccount });

        if(characterRename !== '') return characterRename;
        return;
      },

      async getCharacterPower({ state }, characterId) {
        const { Characters } = state.contracts();
        if (!Characters || !state.defaultAccount) return;

        const characterPower = await Characters.methods.getPower(characterId).call({ from: state.defaultAccount });

        return characterPower;
      },

      async getCharacterFullPower({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const characterFullPower = await PvpArena.methods.getCharacterPower(characterId).call({ from: state.defaultAccount });

        return characterFullPower;
      },

      async getRankingPointsByCharacter({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const rankingPointsByCharacter = await PvpArena.methods.rankingPointsByCharacter(characterId).call({ from: state.defaultAccount });

        return rankingPointsByCharacter;
      },

      async getRankingsPoolByTier({ state }, tier) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const rankingsPoolByTier = await PvpArena.methods.rankingsPoolByTier(tier).call({ from: state.defaultAccount });

        return rankingsPoolByTier;
      },

      async getTierTopCharacters({ state }, tier) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const tierTopCharacters = await PvpArena.methods.getTierTopCharacters(tier).call({ from: state.defaultAccount });

        return tierTopCharacters;
      },

      async getArenaTier({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const arenaTier = await PvpArena.methods.getArenaTier(characterId).call({ from: state.defaultAccount });

        return arenaTier;
      },

      async getEntryWager({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const entryWager = await PvpArena.methods.getEntryWager(characterId).call({ from: state.defaultAccount });

        return entryWager;
      },

      async getIsWeaponInArena({ state }, weaponId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const isWeaponInArena = await PvpArena.methods.isWeaponInArena(weaponId).call({ from: state.defaultAccount });

        return isWeaponInArena;
      },

      async getIsShieldInArena({ state }, shieldId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const isShieldInArena = await PvpArena.methods.isShieldInArena(shieldId).call({ from: state.defaultAccount });

        return isShieldInArena;
      },

      async getIsCharacterInArena({ state, commit }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;
        const isCharacterInArena = await PvpArena.methods.isCharacterInArena(characterId).call({ from: state.defaultAccount });
        commit('updateCharacterInArena', { characterId, isCharacterInArena });

        return isCharacterInArena;
      },

      async getIsCharacterUnderAttack({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const isCharacterUnderAttack = await PvpArena.methods.isCharacterUnderAttack(characterId).call({ from: state.defaultAccount });

        return isCharacterUnderAttack;
      },

      async getMatchByFinder({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const matchByFinder = await PvpArena.methods.matchByFinder(characterId).call({ from: state.defaultAccount });

        return matchByFinder;
      },

      async getDuelQueue({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const matchByFinder = await PvpArena.methods.getDuelQueue().call({ from: state.defaultAccount });

        return matchByFinder;
      },

      async getDuelCost({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const matchByFinder = await PvpArena.methods.getDuelCost(characterId).call({ from: state.defaultAccount });

        return matchByFinder;
      },

      async getMatchablePlayerCount({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const matchablePlayerCount = await PvpArena.methods.getMatchablePlayerCount(characterId).call({ from: state.defaultAccount });

        return matchablePlayerCount;
      },

      async getDecisionSeconds({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const decisionSeconds = await PvpArena.methods.decisionSeconds().call({ from: state.defaultAccount });

        return decisionSeconds;
      },

      async getReRollFeePercent({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const reRollFeePercent = await PvpArena.methods.reRollFeePercent().call({ from: state.defaultAccount });

        return reRollFeePercent;
      },

      async getPlayerPrizePoolRewards({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const playerPrizePoolRewards = await PvpArena.methods.getPlayerPrizePoolRewards().call({ from: state.defaultAccount });

        return playerPrizePoolRewards;
      },

      async getDuelOffsetCost({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const duelOffsetCost = await PvpArena.methods.duelOffsetCost().call({ from: state.defaultAccount });

        return duelOffsetCost;
      },

      async enterArena({ state, dispatch }, {characterId, weaponId, shieldId, useShield}) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const res = await PvpArena.methods.enterArena(characterId, weaponId, shieldId, useShield).send({ from: state.defaultAccount });

        await dispatch('getIsCharacterInArena', characterId);

        return res;
      },

      async withdrawFromArena({ state, dispatch }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const res = await PvpArena.methods.withdrawFromArena(characterId).send({ from: state.defaultAccount });

        await dispatch('getIsCharacterInArena', characterId);

        return res;
      },

      async findOpponent({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const res = await PvpArena.methods.findOpponent(characterId).send({ from: state.defaultAccount });

        return res;
      },

      async reRollOpponent({ state }, characterId) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const res = await PvpArena.methods.reRollOpponent(characterId).send({ from: state.defaultAccount });

        return res;
      },

      async prepareDuel({ state }, { characterId, duelOffsetCost }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const res = await PvpArena.methods.prepareDuel(characterId).send({ from: state.defaultAccount, value: duelOffsetCost });

        return res;
      },

      async withdrawRankedRewards({ state }) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        const res = await PvpArena.methods.withdrawRankedRewards().send({ from: state.defaultAccount });

        return res;
      },

      async getPvpContract({state}) {
        const { PvpArena } = state.contracts();
        if (!PvpArena || !state.defaultAccount) return;

        return PvpArena;
      },

      async approvePvpSkillSpending({state}, amount) {
        const { PvpArena, SkillToken } = state.contracts();
        if (!PvpArena || !SkillToken || !state.defaultAccount) return;

        return await approveFeeFromAnyContractSimple(
          PvpArena,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          new BigNumber(`${amount}`)
        );
      },

      async burnCharactersIntoCharacter({ state, dispatch }, {burnIds, targetId}) {
        const { CryptoBlades, BurningManager, SkillToken } = state.contracts();
        if(!CryptoBlades || !BurningManager || !SkillToken || !state.defaultAccount) return;

        const burnCost = await BurningManager.methods.burnCharactersFee(burnIds).call(defaultCallOptions(state));
        await approveFeeFromAnyContractSimple(
          CryptoBlades,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          new BigNumber(burnCost)
        );

        await BurningManager.methods.burnCharactersIntoCharacter(burnIds, targetId).send({ from: state.defaultAccount });
        await Promise.all([
          dispatch('updateCharacterIds'),
          dispatch('fetchSkillBalance')
        ]);
      },

      async burnCharactersIntoSoul({ state, dispatch }, burnIds) {
        const { CryptoBlades, BurningManager, SkillToken } = state.contracts();
        if(!CryptoBlades || !BurningManager || !SkillToken || !state.defaultAccount) return;

        const burnCost = await BurningManager.methods.burnCharactersFee(burnIds).call(defaultCallOptions(state));
        await approveFeeFromAnyContractSimple(
          CryptoBlades,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          new BigNumber(burnCost)
        );

        await BurningManager.methods.burnCharactersIntoSoul(burnIds).send({ from: state.defaultAccount });
        await Promise.all([
          dispatch('updateCharacterIds'),
          dispatch('fetchSkillBalance')
        ]);
      },

      async purchaseBurnCharacter({ state, dispatch }, {charId, maxPrice}) {
        const { NFTMarket, BurningManager, SkillToken, CryptoBlades } = state.contracts();
        if(!CryptoBlades || !BurningManager || !SkillToken || !NFTMarket || !state.defaultAccount) return;

        await approveFeeFromAnyContractSimple(
          CryptoBlades,
          SkillToken,
          state.defaultAccount,
          defaultCallOptions(state),
          defaultCallOptions(state),
          maxPrice
        );

        const burnCost = await BurningManager.methods.burnCharacterFee(charId).call(defaultCallOptions(state));
        await SkillToken.methods.approve(CryptoBlades.options.address, burnCost).send({
          from: state.defaultAccount
        });

        const res = await NFTMarket.methods.purchaseBurnCharacter(charId, maxPrice).send({ from: state.defaultAccount });
        const {
          seller,
          nftID,
          price
        } = res.events.PurchasedListing.returnValues;

        await Promise.all([
          dispatch('fetchSkillBalance')
        ]);

        return { seller, nftID, price } as { seller: string, nftID: string, price: string };
      },

      async upgradeCharacterWithSoul({ state, dispatch }, {charId, soulAmount}) {
        const { BurningManager } = state.contracts();
        if(!BurningManager || !state.defaultAccount) return;

        await BurningManager.methods.upgradeCharacterWithSoul(charId, soulAmount).send({ from: state.defaultAccount });
        await dispatch('fetchCharacterPower', charId);
      },

      async fetchCharactersBurnCost({ state }, burnIds) {
        const { BurningManager } = state.contracts();
        if(!BurningManager || !state.defaultAccount) return;

        return await BurningManager.methods.burnCharactersFee(burnIds).call(defaultCallOptions(state));
      },

      async fetchBurnPowerMultiplier({ state }) {
        const { BurningManager } = state.contracts();
        if(!BurningManager || !state.defaultAccount) return;

        return await BurningManager.methods.vars(2).call(defaultCallOptions(state));
      },

      async fetchSpecialWeaponEvents({ state, dispatch, commit }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        const activeSpecialWeaponEventsIds = await SpecialWeaponsManager.methods.getActiveEventsIds().call(defaultCallOptions(state));
        commit('updateActiveSpecialWeaponEventsIds', activeSpecialWeaponEventsIds);

        const eventCount = await SpecialWeaponsManager.methods.eventCount().call(defaultCallOptions(state));
        const inactiveSpecialWeaponEventsIds = Array.from({length: +eventCount}, (_, i) =>
          (i + 1).toString()).filter(id => !activeSpecialWeaponEventsIds.includes(id));
        commit('updateInactiveSpecialWeaponEventsIds', inactiveSpecialWeaponEventsIds);

        await dispatch('fetchSpecialWeaponEventsInfo', activeSpecialWeaponEventsIds.concat(inactiveSpecialWeaponEventsIds));
        await dispatch('fetchShardsSupply');
      },

      async fetchSpecialWeaponEventsInfo({ state, commit }, eventsIds) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        eventsIds.forEach(async (eventId: string) => {
          const eventInfoRaw = await SpecialWeaponsManager.methods.getEventInfo(eventId).call(defaultCallOptions(state));
          const ordered = +await SpecialWeaponsManager.methods.userOrderOptionForEvent(state.defaultAccount!, eventId).call(defaultCallOptions(state)) > 0;
          const forged = await SpecialWeaponsManager.methods.userForgedAtEvent(state.defaultAccount!, eventId).call(defaultCallOptions(state));
          const eventInfo = {
            name: eventInfoRaw[0],
            weaponElement: eventInfoRaw[1],
            endTime: eventInfoRaw[2],
            supply: eventInfoRaw[3],
            orderedCount: eventInfoRaw[4],
            ordered,
            forged
          };

          commit('updateSpecialWeaponEventsInfo', { eventId, eventInfo });
        });
      },

      async fetchForgeCosts({ state }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        const shardsCostLow = await SpecialWeaponsManager.methods.vars(1).call(defaultCallOptions(state));
        const shardsCostMedium = await SpecialWeaponsManager.methods.vars(2).call(defaultCallOptions(state));
        const shardsCostHigh = await SpecialWeaponsManager.methods.vars(3).call(defaultCallOptions(state));
        const skillCostLow = await SpecialWeaponsManager.methods.getSkillForgeCost(1).call(defaultCallOptions(state));
        const skillCostMedium = await SpecialWeaponsManager.methods.getSkillForgeCost(2).call(defaultCallOptions(state));
        const skillCostHigh = await SpecialWeaponsManager.methods.getSkillForgeCost(3).call(defaultCallOptions(state));

        return [+shardsCostLow, +shardsCostMedium, +shardsCostHigh, +skillCostLow, +skillCostMedium, +skillCostHigh];
      },

      async convertShards({ state, dispatch }, { eventFromId, eventToId, amount }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        await SpecialWeaponsManager.methods.convertShards(eventFromId, eventToId, amount).send({ from: state.defaultAccount });

        await dispatch('fetchShardsSupply');
      },

      async fetchShardsConvertDenominator({ state }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        return +await SpecialWeaponsManager.methods.vars(10).call(defaultCallOptions(state));
      },

      async orderSpecialWeapon({ state, dispatch }, { eventId, orderOption, orderWithSkill }) {
        const { SpecialWeaponsManager, CryptoBlades, SkillToken } = state.contracts();
        if(!SpecialWeaponsManager || !CryptoBlades || !SkillToken || !state.defaultAccount) return;

        if(orderWithSkill) {
          const price = await SpecialWeaponsManager.methods.getSkillForgeCost(orderOption).call(defaultCallOptions(state));
          await approveFeeFromAnyContractSimple(
            CryptoBlades,
            SkillToken,
            state.defaultAccount,
            defaultCallOptions(state),
            defaultCallOptions(state),
            new BigNumber(price)
          );
          await SpecialWeaponsManager.methods.orderSpecialWeaponWithSkill(eventId, orderOption).send({ from: state.defaultAccount });
        }
        else {
          await SpecialWeaponsManager.methods.orderSpecialWeaponWithShards(eventId, orderOption).send({ from: state.defaultAccount });
        }

        await Promise.all([
          dispatch('fetchForgingStatus', eventId),
          dispatch('fetchShardsSupply'),
          dispatch('fetchSkillBalance')
        ]);
      },

      async forgeSpecialWeapon({ state, dispatch }, eventId) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        await SpecialWeaponsManager.methods.forgeSpecialWeapon(eventId).send({ from: state.defaultAccount });

        await Promise.all([
          dispatch('updateWeaponIds'),
          dispatch('fetchForgingStatus', eventId),
        ]);
      },

      async fetchForgingStatus({ state, commit }, eventId) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        const ordered = +await SpecialWeaponsManager.methods.userOrderOptionForEvent(state.defaultAccount!, eventId).call(defaultCallOptions(state)) > 0;
        const forged = await SpecialWeaponsManager.methods.userForgedAtEvent(state.defaultAccount, eventId).call(defaultCallOptions(state));

        commit('updateForgingStatus', { eventId, ordered, forged });
      },

      async fetchEventTotalOrderedCount({ state, commit }, eventId) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        const orderedCount = await SpecialWeaponsManager.methods.getTotalOrderedCount(eventId).call(defaultCallOptions(state));

        commit('updateEventTotalOrderedCount', { eventId, orderedCount });
      },

      async fetchShardsStakingRewards({ state }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        return await SpecialWeaponsManager.methods.getUserShardsRewards(state.defaultAccount).call(defaultCallOptions(state));
      },

      async claimShardsStakingRewards({ state, dispatch }, { eventId, amount }) {
        const { SpecialWeaponsManager } = state.contracts();
        if(!SpecialWeaponsManager || !state.defaultAccount) return;

        await SpecialWeaponsManager.methods.claimShardRewards(eventId, amount).send(defaultCallOptions(state));

        await dispatch('fetchShardsSupply');
      },

      async fetchFreeOpponentRerollTimestamp({ state }, weaponId) {
        const { PvpArena } = state.contracts();
        if(!PvpArena || !state.defaultAccount) return;

        return await PvpArena.methods.specialWeaponRerollTimestamp(weaponId).call(defaultCallOptions(state));
      }
    }
  });
}

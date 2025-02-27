<template>
  <div v-if="characters.length !== 0" class="d-flex flex-wrap quests-container gap-4">
    <div class="d-flex justify-content-between w-100 weekly-progress-container">
      <div class="d-flex flex-column justify-content-between gap-2">
        <span class="quests-title">{{ $t('quests.quest') }}</span>
        <b-button variant="primary" @click="showQuestsListModal = true">
          {{ $t('quests.availableQuests') }}
        </b-button>
        <b-modal v-model="showQuestsListModal" :title="$t('quests.availableQuests')" hide-footer
                 @hide="showQuestsListModal = false; tier = undefined" size="xl">
          <div class="d-flex align-items-center gap-3">
            <b-form-select class="mt-2 mb-2" v-model="tier">
              <b-form-select-option :value="undefined" disabled>
                {{ $t('quests.pleaseSelectQuestTier') }}
              </b-form-select-option>
              <b-form-select-option v-for="rarity in rarities" :key="rarity" :value="rarity">
                {{ $t(`quests.rarityType.${Rarity[rarity]}`) }}
              </b-form-select-option>
            </b-form-select>
          </div>
          <QuestsList v-if="tier !== undefined" :tier="usePromoQuests ? tier + 10 : tier"/>
        </b-modal>
      </div>
      <div v-if="weeklyReward && weeklyReward.id && currentWeeklyCompletions !== undefined && maxWeeklyCompletions"
           class="d-flex flex-column gap-2">
        <div class="d-flex align-items-center gap-2">
          <div class="d-flex flex-column gap-2">
            <div class="d-flex justify-content-between gap-4">
              <span class="text-uppercase weekly-progress">{{ $t('quests.weeklyProgress') }}</span>
              <span v-if="nextWeekResetTime" class="next-reset"><img :src="hourglass" class="hourglass-icon"
                                                                     alt="Hourglass"/> {{
                  $t('quests.resetsIn', {time: nextWeekResetTime})
                }}</span>
            </div>
            <div class="quest-progress w-100">
              <div class="quest-progress-bar" role="progressbar"
                   :style="`width: calc(${currentWeeklyCompletions/maxWeeklyCompletions*100}% - 8px);`"
                   :aria-valuenow="currentWeeklyCompletions"
                   aria-valuemin="0" :aria-valuemax="maxWeeklyCompletions">
              </div>
              <span v-if="currentWeeklyCompletions <= maxWeeklyCompletions"
                    class="quest-progress-value">{{ `${currentWeeklyCompletions} / ${maxWeeklyCompletions}` }}</span>
            </div>
          </div>
          <div class="d-flex justify-content-center align-items-center gap-2 position-relative h-100">
            <span v-if="weeklyClaimed" class="claimed-banner">{{ $t('quests.claimed') }}</span>
            <QuestComponentIcon :questItemType="weeklyReward.rewardType" :rarity="weeklyReward.rewardRarity"
                                :amount="weeklyReward.rewardAmount"
                                :externalAddress="weeklyReward.rewardExternalAddress"/>
            <QuestComponentIcon v-if="weeklyReward.reputationAmount !== 0" :questItemType="QuestItemType.REPUTATION"
                                :amount="weeklyReward.reputationAmount"/>
          </div>
        </div>
        <b-button v-if="!weeklyClaimed" :disabled="isLoading || !canClaimWeeklyReward" variant="primary"
                  @click="claimWeekly">
          {{ $t('quests.claimWeeklyReward') }}
          <Hint v-if="!canClaimWeeklyReward" class="hint" :text="$t('quests.cannotClaimWeeklyTooltip')"/>
        </b-button>
      </div>
    </div>
    <div v-for="character in characters" :key="character.id" class="d-flex w-100">
      <QuestRow :characterId="character.id" :reputationLevelRequirements="reputationLevelRequirements"
                @refresh-quest-data="onRefreshQuestData"/>
    </div>
    <b-modal v-model="showWeeklyClaimedModal" ok-only class="centered-modal" :title="$t('quests.weeklyReward')">
      <div v-if="isLoading">
        <i class="fas fa-spinner fa-spin"/>
        {{ $t('quests.loading') }}
      </div>
      <QuestReward v-else :type="weeklyReward.rewardType" :rarity="weeklyReward.rewardRarity" :rewards="weeklyRewards"
                   :amount="weeklyReward.rewardAmount" :reputationAmount="weeklyReward.reputationAmount"
                   :externalAddress="weeklyReward.rewardExternalAddress"/>
    </b-modal>
  </div>
  <div v-else-if="isLoading">
    <i class="fas fa-spinner fa-spin"/>
    {{ $t('quests.loading') }}
  </div>
  <div v-else class="m-4 font-weight-bold">
    {{ $t('quests.youNeedToHaveAtLeastOneCharacter') }}
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import {mapActions, mapGetters, mapState} from 'vuex';
import {Nft} from '@/interfaces/Nft';
import {Accessors} from 'vue/types/options';
import QuestRow from '@/components/smart/QuestRow.vue';
import QuestComponentIcon from '@/components/smart/QuestComponentIcon.vue';
import QuestReward from '@/components/smart/QuestReward.vue';
import QuestsList from '@/components/smart/QuestsList.vue';
import Hint from '@/components/Hint.vue';
import hourglass from '@/assets/hourglass.png';
import {getTimeRemaining} from '@/utils/common';
import {NftIdType} from '@/components/smart/NftList.vue';

export interface WeeklyReward {
  id: number;
  rewardType: RewardType;
  rewardRarity: Rarity;
  rewardAmount: number;
  rewardExternalAddress?: string;
  reputationAmount: number;
}

export interface Quest {
  progress: number;
  type?: RequirementType;
  reputation: number;
  id: number;
  tier?: Rarity;
  requirementType?: RequirementType;
  requirementRarity?: Rarity;
  requirementAmount: number;
  requirementExternalAddress?: string;
  rewardType?: RewardType;
  rewardRarity?: Rarity;
  rewardAmount: number;
  rewardExternalAddress?: string;
  reputationAmount: number;
  deadline?: number;
  supply?: number;
}

export enum RequirementType {
  NONE,
  WEAPON,
  JUNK,
  DUST,
  TRINKET,
  SHIELD,
  STAMINA,
  SOUL,
  RAID,
  EXTERNAL = 10,
  EXTERNAL_HOLD = 11,
}

export enum RewardType {
  NONE,
  WEAPON,
  JUNK,
  DUST,
  TRINKET,
  SHIELD,
  EXPERIENCE = 9,
  SOUL = 7,
  EXTERNAL = 10,
}

// NOTE: Numbers should represent ItemType in SimpleQuests.sol
export enum QuestItemType {
  NONE,
  WEAPON,
  JUNK,
  DUST,
  TRINKET,
  SHIELD,
  STAMINA,
  SOUL,
  RAID,
  EXPERIENCE,
  EXTERNAL,
  EXTERNAL_HOLD,
  REPUTATION = 99
}

export enum Rarity {
  COMMON, UNCOMMON, RARE, EPIC, LEGENDARY
}

export enum DustRarity {
  LESSER, GREATER, POWERFUL
}

export enum ReputationTier {
  PEASANT, TRADESMAN, NOBLE, KNIGHT, KING
}

export interface ReputationLevelRequirements {
  level2: number;
  level3: number;
  level4: number;
  level5: number;
}

export interface TierChances {
  common: number;
  uncommon: number;
  rare: number;
  epic: number;
  legendary: number;
}

export interface QuestItemsInfo {
  questItems: Record<string, Record<string, any>>;
}

interface StoreMappedActions {
  fetchCharacters(characterIds: (string | number)[]): Promise<void>;

  getCharacterQuestData(payload: { characterId: string | number }): Promise<Quest>;

  getReputationLevelRequirements(): Promise<ReputationLevelRequirements>;

  nextWeeklyQuestCompletionGoalReset(): Promise<string>;

  getWeeklyCompletionsGoal(): Promise<number>;

  getWeeklyCompletions(): Promise<number>;

  getWeeklyReward(payload: { timestamp: number }): Promise<WeeklyReward>;

  hasClaimedWeeklyReward(): Promise<boolean>;

  claimWeeklyReward(): Promise<number[]>;

  isUsingPromoQuests(): Promise<boolean>;
}

interface StoreMappedGetters {
  charactersWithIds(ids: (string | number)[]): Nft[];
}

interface Data {
  weeklyReward?: WeeklyReward;
  characters: Nft[];
  reputationLevelRequirements?: ReputationLevelRequirements;
  weeklyClaimed: boolean;
  showWeeklyClaimedModal: boolean;
  weeklyRewards: NftIdType[];
  isLoading: boolean;
  nextWeekResetTime: string;
  nextWeekResetCheckInterval?: ReturnType<typeof setInterval>;
  maxWeeklyCompletions: number;
  currentWeeklyCompletions: number;
  showQuestsListModal: boolean;
  rarities: Rarity[];
  tier?: Rarity;
  usePromoQuests: boolean;
}

export default Vue.extend({
  components: {QuestRow, QuestComponentIcon, QuestReward, QuestsList, Hint},

  props: {
    showCosmetics: {
      type: Boolean,
      default: true
    },
  },

  data() {
    return {
      weeklyReward: undefined,
      characters: [],
      reputationLevelRequirements: undefined,
      weeklyRewards: [],
      weeklyClaimed: true,
      showWeeklyClaimedModal: false,
      isLoading: false,
      nextWeekResetTime: '',
      maxWeeklyCompletions: 0,
      currentWeeklyCompletions: 0,
      showQuestsListModal: false,
      rarities: [Rarity.COMMON, Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY],
      tier: undefined,
      usePromoQuests: false,
      hourglass,
      QuestItemType,
      Rarity,
    } as Data;
  },

  computed: {
    ...mapState(['ownedCharacterIds']),
    ...mapGetters(['charactersWithIds', 'getCharacterCosmetic']) as Accessors<StoreMappedGetters>,

    canClaimWeeklyReward(): boolean {
      return !!this.weeklyReward && !this.weeklyClaimed && this.weeklyGoalReached;
    },

    weeklyGoalReached(): boolean {
      return this.currentWeeklyCompletions >= this.maxWeeklyCompletions;
    },
  },

  methods: {
    ...mapActions([
      'fetchCharacters',
      'getCharacterQuestData',
      'getReputationLevelRequirements',
      'nextWeeklyQuestCompletionGoalReset',
      'getWeeklyCompletionsGoal',
      'getWeeklyCompletions',
      'getWeeklyReward',
      'hasClaimedWeeklyReward',
      'claimWeeklyReward',
      'isUsingPromoQuests',
    ]) as StoreMappedActions,

    async claimWeekly() {
      if (!this.canClaimWeeklyReward) {
        return;
      }

      try {
        this.isLoading = true;
        const rewards = await this.claimWeeklyReward();
        const rewardType = this.weeklyReward?.rewardType;
        if (!rewardType || rewardType === RewardType.EXPERIENCE || rewardType === RewardType.DUST || rewardType === RewardType.SOUL) {
          this.showWeeklyClaimedModal = true;
          return;
        } else {
          this.weeklyRewards = rewards.map((reward: number) => {
            return {type: QuestItemType[rewardType].toLowerCase(), id: reward} as NftIdType;
          });
          this.weeklyClaimed = true;
          this.showWeeklyClaimedModal = true;
        }
      } finally {
        this.isLoading = false;
      }
    },

    async refreshQuestData() {
      try {
        this.isLoading = true;
        this.usePromoQuests = await this.isUsingPromoQuests();
        this.currentWeeklyCompletions = +await this.getWeeklyCompletions();
        this.maxWeeklyCompletions = +await this.getWeeklyCompletionsGoal();
        this.weeklyReward = await this.getWeeklyReward({timestamp: Date.now()});
        this.weeklyClaimed = await this.hasClaimedWeeklyReward();
        await this.getNextWeekResetTime();
        this.reputationLevelRequirements = await this.getReputationLevelRequirements();
        this.characters = await Promise.all(this.charactersWithIds(this.ownedCharacterIds).filter(Boolean).map(async (character) => {
          character.quest = await this.getCharacterQuestData({characterId: character.id});
          return character;
        }));
      } finally {
        this.isLoading = false;
      }
    },

    async getNextWeekResetTime() {
      const nextWeekResetTimestamp = await this.nextWeeklyQuestCompletionGoalReset();
      if (this.nextWeekResetCheckInterval) {
        clearInterval(this.nextWeekResetCheckInterval);
      }
      this.nextWeekResetCheckInterval = setInterval(() => {
        const {total, days, hours, minutes, seconds} = getTimeRemaining(nextWeekResetTimestamp);
        this.nextWeekResetTime = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        if (total <= 0 && this.nextWeekResetCheckInterval) {
          clearInterval(this.nextWeekResetCheckInterval);
        }
      }, 1000);
    },

    async onRefreshQuestData() {
      await this.refreshQuestData();
    },
  },

  async mounted() {
    await this.refreshQuestData();
  },

  beforeDestroy() {
    if (this.nextWeekResetCheckInterval) {
      clearInterval(this.nextWeekResetCheckInterval);
    }
  },

  watch: {
    async ownedCharacterIds(characterIds) {
      await this.fetchCharacters(characterIds);
      await this.refreshQuestData();
    }
  },
});
</script>

<style scoped lang="scss">
@import '../styles/character-cosmetics.css';

.quests-container {
  background: transparent url("../../src/assets/questsBackground.png") 0 0 no-repeat padding-box;
  padding: 3rem;
}

.quests-title {
  font: normal normal bold 30px/38px Trajan;
  color: #DABE75;
}

.next-reset {
  font: normal normal normal 15px/17px Arial;
  color: #B4B0A7;
}

.hourglass-icon {
  height: 17px;
}

.weekly-progress {
  font: normal normal bold 16px/20px Trajan;
  color: #DABE75;
}

.quest-progress {
  height: 19px;
  background: #070707;
  border: 1px solid #403A2C;
  display: flex;
  align-items: center;
  position: relative;
}

.quest-progress .quest-progress-bar {
  background: #DABE75;
  height: 11px;
  margin: 4px;
}

.quest-progress-value {
  text-align: center;
  font: normal normal normal 10px/11px Arial;
  color: #FFFFFF;
  position: absolute;
  width: 100%;
  font-weight: bold;
  text-shadow: -1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000;
}

.claimed-banner {
  position: absolute;
  text-transform: uppercase;
  transform: rotate(15deg);
  font-weight: bold;
  text-shadow: 0 0 5px #333, 0 0 10px #333, 0 0 15px #333, 0 0 10px #333;
}

@media (max-width: 576px) {
  .quests-container {
    padding: 1rem;
    margin-bottom: 3rem;
  }

  .weekly-progress-container {
    flex-direction: column;
    gap: 2rem;
  }
}
</style>

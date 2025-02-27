<template>
  <b-modal v-if="quest" :visible="showModal" button-size="lg" no-close-on-backdrop scrollable
           :title="$t('quests.turnIn')" size="xl" @close.prevent="resetTokens"
           @cancel.prevent="resetTokens" content-class="modal-footer-margin"
           :ok-title="$t('quests.submit')" :busy="isLoading"
           :ok-disabled="isSubmitDisabled()"
           @ok.prevent="quest.requirementType === RequirementType.DUST
           || quest.requirementType === RequirementType.STAMINA
           || quest.requirementType === RequirementType.SOUL
           || isCurrency ?
            submitAmount() : submit()">
    <div v-if="quest.requirementType === RequirementType.WEAPON" class="d-flex">
      <weapon-grid v-model="selectedToken" :weaponIds="ownedTokens" :ignore="tokensToBurn"
                   showGivenWeaponIds @chooseweapon="addBurnToken"
                   :starsOptions="[quest.requirementRarity + 1]" :canFavorite="false"/>
      <weapon-grid :weaponIds="tokensToBurn" showGivenWeaponIds @chooseweapon="removeBurnToken"
                   :starsOptions="[quest.requirementRarity + 1]" :canFavorite="false"/>
    </div>
    <div v-else-if="quest.requirementType === RequirementType.DUST
      || quest.requirementType === RequirementType.STAMINA
       || quest.requirementType === RequirementType.SOUL"
         class="d-flex align-items-center flex-column">
      <dust-balance-display v-if="quest.requirementType === RequirementType.DUST" class="single-dust-display p-5"
                            :rarities="[quest.requirementRarity]"/>
      <nft-icon v-else-if="quest.requirementType === RequirementType.SOUL" :isDefault="true" :nft="{ type: 'soul' }"/>
      <h2>{{ $t('quests.howMuchToTurnIn') }}</h2>
      <b-form-input type="number" number v-model="amountToBurn" class="w-50" :min="0" :max="maxAmount"/>
      <b-button class="m-3" variant="primary" @click="setRequiredAmount">{{ $t('quests.setRequiredAmount') }}</b-button>
    </div>
    <div v-else-if="quest.requirementType === RequirementType.EXTERNAL
      || quest.requirementType === RequirementType.EXTERNAL_HOLD">
      <div v-if="isCurrency" class="d-flex align-items-center flex-column">
        <h2>{{ $t('quests.howMuchToTurnIn') }}</h2>
        <b-form-input type="number" number v-model="amountToBurn" class="w-50" :min="0" :max="maxAmount"/>
        <b-button class="m-3" variant="primary" @click="setRequiredAmount">{{
            $t('quests.setRequiredAmount')
          }}
        </b-button>
      </div>
      <div v-else class="d-flex align-items-center flex-column">
        <h2>{{ $t('quests.whatIdsToTurnIn') }}</h2>
        <b-form-input v-model="externalsToBurn" class="w-50" :placeholder="$t('admin.identifiers')"/>
      </div>
    </div>
    <div v-else class="d-flex">
      <nft-list v-model="selectedToken" showGivenNftIdTypes :nftIdTypes="ownedNftIdTypes"
                @choosenft="addNftIdType" :starsOptions="[quest.requirementRarity + 1]"
                :typesOptions="[upperFirstChar(RequirementType[quest.requirementType])]"/>
      <nft-list showGivenNftIdTypes :nftIdTypes="nftIdTypesToBurn" @choosenft="removeNftIdType"
                :starsOptions="[quest.requirementRarity + 1]"
                :typesOptions="[upperFirstChar(RequirementType[quest.requirementType])]"/>
    </div>
  </b-modal>
</template>

<script lang="ts">
import Vue from 'vue';
import WeaponGrid from '@/components/smart/WeaponGrid.vue';
import {mapActions, mapGetters, mapState} from 'vuex';
import NftList, {NftIdType} from '@/components/smart/NftList.vue';
import {Quest, Rarity, RequirementType, RewardType} from '@/views/Quests.vue';
import DustBalanceDisplay from '@/components/smart/DustBalanceDisplay.vue';
import NftIcon from '@/components/NftIcon.vue';
import {PropType} from 'vue/types/options';
import {Nft} from '../../interfaces/Nft';

interface StoreMappedActions {
  submitProgress(payload: { characterID: string | number, tokenIds: (string | number)[] }): Promise<void>;

  submitExternalProgress(payload: { characterID: string | number, tokenIds: (string | number)[], tokenAddress: string }): Promise<void>;

  submitProgressAmount(payload: { characterID: string | number, amount: number }): Promise<void>;

  submitExternalProgressAmount(payload: { characterID: string | number, amount: number, currencyAddress: string }): Promise<void>;

  isExternalCurrency(payload: { currencyAddress: string }): Promise<boolean>;

  fetchSoulBalance(): Promise<number>;
}

interface Data {
  quest?: Quest;
  characterId: number | string;
  questProgress: number;
  ownedTokens: string[];
  tokensToBurn: (string | number)[];
  externalsToBurn?: string;
  ownedNftIdTypes: NftIdType[];
  nftIdTypesToBurn: NftIdType[];
  amountToBurn: number;
  selectedToken?: number;
  isCurrency: boolean;
  isLoading: boolean;
  soulBalance: number;
}

export default Vue.extend({
  components: {WeaponGrid, NftList, DustBalanceDisplay, NftIcon},

  props: {
    showModal: {
      type: Boolean,
      default: false,
    },
    character: {
      type: Object as PropType<Nft>,
      required: true,
    },
  },

  data() {
    return {
      quest: undefined,
      characterId: '',
      questProgress: 0,
      ownedTokens: [],
      tokensToBurn: [],
      externalsToBurn: undefined,
      ownedNftIdTypes: [],
      nftIdTypesToBurn: [],
      amountToBurn: 0,
      selectedToken: undefined,
      isCurrency: false,
      isLoading: false,
      soulBalance: 0,
      RequirementType,
      RewardType,
      Rarity,
    } as Data;
  },


  computed: {
    ...mapState(['ownedWeaponIds', 'ownedTrinketIds', 'ownedJunkIds', 'ownedShieldIds']),
    ...mapGetters(['getPowerfulDust', 'getGreaterDust', 'getLesserDust', 'getCharacterStamina']),

    maxAmount(): number {
      if (!this.quest) return 0;
      if (this.quest.requirementType === RequirementType.DUST) {
        if (this.quest.requirementRarity === Rarity.COMMON) {
          return this.getLesserDust();
        } else if (this.quest.requirementRarity === Rarity.UNCOMMON) {
          return this.getGreaterDust();
        } else if (this.quest.requirementRarity === Rarity.RARE) {
          return this.getPowerfulDust();
        } else return 0;
      } else if (this.quest.requirementType === RequirementType.STAMINA) {
        return this.getCharacterStamina(this.characterId);
      } else if (this.quest.requirementType === RequirementType.SOUL) {
        return this.soulBalance;
      } else return 0;
    },
  },

  methods: {
    ...mapActions([
      'submitProgress',
      'submitProgressAmount',
      'submitExternalProgress',
      'submitExternalProgressAmount',
      'fetchSoulBalance',
      'isExternalCurrency',
    ]) as StoreMappedActions,

    upperFirstChar(text: string) {
      return text[0].toUpperCase() + text.slice(1).toLowerCase();
    },

    async isExternalCurrencyAddress() {
      if (!this.quest?.requirementExternalAddress) return false;
      this.isCurrency = await this.isExternalCurrency({currencyAddress: this.quest.requirementExternalAddress});
    },

    setRequiredAmount() {
      if (!this.quest) return;
      const remainingAmount = this.quest.requirementAmount - this.questProgress;
      if (this.quest.requirementType === RequirementType.STAMINA) {
        this.amountToBurn = remainingAmount > this.getCharacterStamina(this.characterId) ? this.getCharacterStamina(this.characterId) : remainingAmount;
      } else if (this.quest.requirementType === RequirementType.SOUL) {
        this.amountToBurn = remainingAmount > this.soulBalance ? this.soulBalance : remainingAmount;
      } else if (this.quest.requirementType === RequirementType.DUST) {
        if (this.quest.requirementRarity === Rarity.COMMON) {
          this.amountToBurn = remainingAmount > this.getLesserDust() ? this.getLesserDust() : remainingAmount;
        } else if (this.quest.requirementRarity === Rarity.UNCOMMON) {
          this.amountToBurn = remainingAmount > this.getGreaterDust() ? this.getGreaterDust() : remainingAmount;
        } else if (this.quest.requirementRarity === Rarity.RARE) {
          this.amountToBurn = remainingAmount > this.getPowerfulDust() ? this.getPowerfulDust() : remainingAmount;
        }
      }
    },

    addBurnToken(id: number) {
      if (!this.quest) return;
      if (this.questProgress + this.tokensToBurn.length >= this.quest.requirementAmount) return;
      this.tokensToBurn.push(id.toString());
      this.ownedTokens = this.ownedTokens.filter(val => !this.tokensToBurn.includes(val.toString()));
      this.selectedToken = undefined;
    },

    removeBurnToken(id: number) {
      this.ownedTokens.push(id.toString());
      this.tokensToBurn = this.tokensToBurn.filter(x => x !== id.toString());
    },

    addNftIdType(nftIdType: NftIdType) {
      if (!this.quest) return;
      if (this.questProgress + this.tokensToBurn.length >= this.quest.requirementAmount) return;
      this.nftIdTypesToBurn.push(nftIdType);
      this.ownedNftIdTypes = this.ownedNftIdTypes.filter(val => !this.nftIdTypesToBurn.some(nftToBurn => nftToBurn.id === val.id));
      this.tokensToBurn = this.nftIdTypesToBurn.map(nftIdType => nftIdType.id);
      this.selectedToken = undefined;
    },

    removeNftIdType(nftIdType: NftIdType) {
      this.ownedNftIdTypes.push(nftIdType);
      this.nftIdTypesToBurn = this.nftIdTypesToBurn.filter(x => x.id !== nftIdType.id);
      this.tokensToBurn = this.nftIdTypesToBurn.map(nftIdType => nftIdType.id);
    },

    async submit() {
      try {
        this.isLoading = true;
        if (this.externalsToBurn && this.quest?.requirementExternalAddress && (this.quest.requirementType === RequirementType.EXTERNAL
          || this.quest.requirementType === RequirementType.EXTERNAL_HOLD)) {
          await this.submitExternalProgress({
            characterID: this.characterId,
            tokenIds: this.externalsToBurn.split(',').map(id => +id),
            tokenAddress: this.quest.requirementExternalAddress,
          });
        } else {
          await this.submitProgress({
            characterID: this.characterId,
            tokenIds: this.tokensToBurn,
          });
        }
      } finally {
        this.resetTokens();
        this.isLoading = false;
      }
    },

    async submitAmount() {
      if (!this.quest) return;
      try {
        this.isLoading = true;
        if (this.quest.requirementExternalAddress
          && (this.quest.requirementType === RequirementType.EXTERNAL || this.quest.requirementType === RequirementType.EXTERNAL_HOLD)) {
          await this.submitExternalProgressAmount({
            characterID: this.characterId,
            amount: this.amountToBurn,
            currencyAddress: this.quest.requirementExternalAddress,
          });
        } else {
          await this.submitProgressAmount({
            characterID: this.characterId,
            amount: this.amountToBurn,
          });
        }
      } finally {
        this.resetTokens();
        this.isLoading = false;
      }
    },

    resetTokens() {
      this.$emit('close-submission-modal');
      this.ownedTokens = [];
      this.ownedNftIdTypes = [];
      this.tokensToBurn = [];
      this.nftIdTypesToBurn = [];
      this.amountToBurn = 0;
    },

    isSubmitDisabled() {
      return !this.quest
        || (this.quest.requirementType === RequirementType.DUST && this.amountToBurn === 0)
        || (this.quest.requirementType === RequirementType.STAMINA && this.amountToBurn === 0)
        || (this.quest.requirementType === RequirementType.SOUL && this.amountToBurn === 0)
        || (this.quest.requirementType === RequirementType.WEAPON && this.tokensToBurn.length === 0)
        || (this.quest.requirementType !== RequirementType.DUST
          && this.quest.requirementType !== RequirementType.WEAPON
          && this.quest.requirementType !== RequirementType.STAMINA
          && this.quest.requirementType !== RequirementType.SOUL
          && this.quest.requirementType !== RequirementType.EXTERNAL
          && this.quest.requirementType !== RequirementType.EXTERNAL_HOLD
          && this.nftIdTypesToBurn.length === 0)
        || ((this.quest.requirementType === RequirementType.EXTERNAL
            || this.quest.requirementType === RequirementType.EXTERNAL_HOLD)
          && !this.externalsToBurn && !this.amountToBurn);
    }
  },

  watch: {
    async showModal(newVal: boolean) {
      if (newVal) {
        this.quest = this.character.quest;
        if (!this.quest) return;
        this.characterId = this.character.id;
        this.questProgress = this.quest.progress;
        if (this.quest.requirementType === RequirementType.WEAPON) {
          this.ownedTokens = this.ownedWeaponIds;
        } else if (this.quest.requirementType === RequirementType.JUNK) {
          this.ownedTokens = this.ownedJunkIds;
          this.ownedJunkIds?.forEach((id: string) => this.ownedNftIdTypes.push({id, type: 'junk'}));
        } else if (this.quest.requirementType === RequirementType.TRINKET) {
          this.ownedTokens = this.ownedTrinketIds;
          this.ownedTrinketIds?.forEach((id: string) => this.ownedNftIdTypes.push({id, type: 'trinket'}));
        } else if (this.quest.requirementType === RequirementType.SHIELD) {
          this.ownedTokens = this.ownedShieldIds;
          this.ownedShieldIds?.forEach((id: string) => this.ownedNftIdTypes.push({id, type: 'shield'}));
        } else if (this.quest.requirementType === RequirementType.SOUL) {
          this.soulBalance = await this.fetchSoulBalance();
        } else if (this.quest.requirementType === RequirementType.EXTERNAL
          || this.quest.requirementType === RequirementType.EXTERNAL_HOLD) {
          await this.isExternalCurrencyAddress();
        }
      }
    }
  }
});
</script>

<style scoped>
.single-dust-display {
  width: 40%;
}

/deep/ .modal-footer-margin {
  margin-bottom: 3rem;
}

@media (max-width: 576px) {
  .single-dust-display {
    width: 100%;
  }
}
</style>

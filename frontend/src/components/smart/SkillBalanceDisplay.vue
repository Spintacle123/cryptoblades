<template>
  <div class="skill-balance-display">
    <div size="sm" class="my-2 my-sm-0 mr-3" variant="primary" v-tooltip="$t('skillBalanceDisplay.buySkillTooltip')" @click="showModal">
      <b-modal size="xl" class="centered-modal " ref="transak-buy" :title="$t('skillBalanceDisplay.buySkillTitle')" ok-only>
      <div class="buy-skill-modal">
        <div class="buy-skill-modal-child">
         <img src="../../assets/apeswapbanana.png" class="img-apeswap"  tagname="buy_skill">
              <b-button variant="primary" class="gtag-link-others" @click="onBuySkill">{{$t('skillBalanceDisplay.buyWithCrypto')}}</b-button>
        </div>
        <div class="buy-skill-modal-child">
              <img src="../../assets/logoTransak.png" class="img-transak"  tagname="buy_skill_test">
              <b-button variant="primary" class="gtag-link-others" @click="onBuyTransak">{{$t('skillBalanceDisplay.buyWithFiat')}}</b-button>
        </div>
      </div>
    </b-modal>
      <!-- <i class="fa fa-plus gtag-link-others" tagname="buy_skill"></i> -->
      <img src="../../assets/addButton.png" class="add-button gtag-link-others"  tagname="buy_skill">
    </div>

    <div class="balance-container">
      <strong class="mr-2 balance-text">{{$t('skillBalanceDisplay.totalBalance')}}</strong>
      <span class="balance"
        v-tooltip="{ content: totalSkillTooltipHtml , trigger: (isMobile() ? 'click' : 'hover') }"
        @mouseover="hover = !isMobile() || true"
        @mouseleave="hover = !isMobile()"
      >{{ formattedTotalSkillBalance }} <b-icon-gift-fill scale="1" v-if="hasInGameSkill" variant="success"/>
      </span>
    </div>

    <div class="bnb-withdraw-container mx-3" v-if="hasBnbAvailableToWithdraw">
      <b-icon-diamond-half scale="1.2"
                           :class="canWithdrawBnb ? 'pointer' : null"
                           :variant="canWithdrawBnb ? 'success' : 'warning'"
                           @click="onWithdrawBNB"
                           v-tooltip.bottom="bnbClaimTooltip" />
    </div>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import Bignumber from 'bignumber.js';
import { Accessors } from 'vue/types/options';
import { mapActions, mapState, mapGetters } from 'vuex';
import { toBN, fromWeiEther } from '../../utils/common';
import { IState } from '@/interfaces';
import { formatDurationFromSeconds } from '@/utils/date-time';
import { BModal } from 'bootstrap-vue';
import i18n from '@/i18n';
import {TranslateResult} from 'vue-i18n';

type StoreMappedState = Pick<IState, 'skillRewards' | 'skillBalance' | 'inGameOnlyFunds' | 'waxBridgeWithdrawableBnb' | 'waxBridgeTimeUntilLimitExpires'>;

interface StoreMappedGetters {
  getExchangeTransakUrl: string;
  getExchangeUrl: string;
  availableBNB: string;
}

interface StoreMappedActions {
  addMoreSkill(skillToAdd: string): Promise<void>;
  withdrawBnbFromWaxBridge(): Promise<void>;
}

export default Vue.extend({
  computed: {
    ...(mapState(['skillRewards', 'skillBalance', 'inGameOnlyFunds', 'waxBridgeWithdrawableBnb',
      'waxBridgeTimeUntilLimitExpires']) as Accessors<StoreMappedState>),
    ...(mapGetters({
      availableBNB: 'waxBridgeAmountOfBnbThatCanBeWithdrawnDuringPeriod',
      getExchangeUrl: 'getExchangeUrl',
      getExchangeTransakUrl: 'getExchangeTransakUrl'
    }) as Accessors<StoreMappedGetters>),

    formattedTotalSkillBalance(): string {
      const skillBalance = fromWeiEther(Bignumber.sum(toBN(this.skillBalance), toBN(this.inGameOnlyFunds), toBN(this.skillRewards)));

      return `${toBN(skillBalance).toFixed(4)} SKILL`;
    },

    formattedSkillBalance(): string {
      const skillBalance = fromWeiEther(this.skillBalance);
      return `${toBN(skillBalance).toFixed(4)} SKILL`;
    },

    hasBnbAvailableToWithdraw(): boolean {
      return toBN(this.waxBridgeWithdrawableBnb).gt(0);
    },

    canWithdrawBnb(): boolean {
      return toBN(this.availableBNB).gt(0);
    },

    formattedBnbThatCanBeWithdrawn(): string {
      return this.formatBnb(this.availableBNB);
    },

    formattedTotalAvailableBnb(): string {
      return this.formatBnb(this.waxBridgeWithdrawableBnb);
    },

    durationUntilLimitPeriodOver(): string {
      return formatDurationFromSeconds(this.waxBridgeTimeUntilLimitExpires);
    },

    bnbClaimTooltip(): TranslateResult {
      if(!this.canWithdrawBnb) {
        return i18n.t('skillBalanceDisplay.reachedPortalLimit', {
          durationUntilLimitPeriodOver : this.durationUntilLimitPeriodOver,
          formattedTotalAvailableBnb : this.formattedTotalAvailableBnb,
        });
      }

      return i18n.t('skillBalanceDisplay.withdrawablePortal', {
        formattedBnbThatCanBeWithdrawn : this.formattedBnbThatCanBeWithdrawn,
        formattedTotalAvailableBnb : this.formattedTotalAvailableBnb,
      });
    },
    formattedInGameOnlyFunds(): string {
      const skillBalance = fromWeiEther(this.inGameOnlyFunds);
      return `${toBN(skillBalance).toFixed(4)} SKILL`;
    },
    totalSkillTooltipHtml() {
      const inGameOnlyFundsBalance = fromWeiEther(this.inGameOnlyFunds);
      const skillRewards = fromWeiEther(this.skillRewards);
      const skillBalance = fromWeiEther(this.skillBalance);

      let html =  toBN(skillBalance).toFixed(4) + ' SKILL';

      if(parseFloat(skillRewards) !== 0){
        html += i18n.t('skillBalanceDisplay.withdrawable') + toBN(skillRewards).toFixed(4) + ' SKILL';
      }

      if(parseFloat(inGameOnlyFundsBalance) !== 0){
        html += i18n.t('skillBalanceDisplay.igo') + toBN(inGameOnlyFundsBalance).toFixed(4) + ' SKILL';
      }

      return html;
    },
    hasInGameSkill(): boolean {
      const inGameOnlyFundsBalance = fromWeiEther(this.inGameOnlyFunds);
      return parseFloat(inGameOnlyFundsBalance) !== 0;
    },
  },

  methods: {
    ...(mapActions(['addMoreSkill', 'withdrawBnbFromWaxBridge']) as StoreMappedActions),

    formatBnb(bnb: string): string {
      const amount = fromWeiEther(bnb);
      return `${toBN(amount).toFixed(4)} BNB`;
    },

    onBuySkill() {
      window.open(this.getExchangeUrl, '_blank');
    },
    onBuyTransak() {
      window.open(this.getExchangeTransakUrl, '_blank');
    },
    async onWithdrawBNB() {
      if(!this.canWithdrawBnb) return;

      await this.withdrawBnbFromWaxBridge();
    },
    showModal() {
      (this.$refs['transak-buy'] as BModal).show();
    }
  },

  components: {
    BModal
  }
});
</script>

<style scoped>
.skill-balance-display {
  display: flex;
  align-items: center;
  font-size: 1.1rem;
}

.balance-container {
  margin-right: 5px;
  color: #b3b0a7;
}

.balance-text {
  color : #BFA765;
}
.add-button {
  width : 30px;
  height: 100%;
}
.add-button:hover {
  cursor: pointer;
}
.buy-skill-modal {
  display: flex;
  justify-content: space-between;
}
.buy-skill-modal-child{
  width: 50%;
  height: 300px;
  align-items: center;
  justify-content: space-between;
  margin: 10%;
  display: flex;
  flex-direction: column;
}
.img-apeswap, .img-transak {
  width:100%;
  max-width: 250px;
  height: auto;
  margin-bottom: 30px;
}
</style>

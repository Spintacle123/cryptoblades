<template>
  <div class="rewardsWrapper">
    <h1>
      {{$t('pvp.rewards')}}
    </h1>
    <p>
      {{$t('pvp.clickToClaim')}}
    </p>
    <ul>
      <li>
        <div class="bulletpoint"></div>
        {{$t('pvp.seasonRewardDistribution')}}
      </li>
      <li>
        <div class="bulletpoint"></div>
        {{$t('pvp.rewardsAccumulate')}}
      </li>
      <li>
        <div class="bulletpoint"></div>
        {{$t('pvp.justClickClaim')}}
      </li>
      <li>
        <div class="bulletpoint"></div>
        {{$t('pvp.yourAvailableSkill', {formattedAvailableSkill})}}
        $SKILL
      </li>
    </ul>
    <pvp-button :buttonText="$t('pvp.claimRewards')" @click="claimRewards" />
  </div>
</template>


<script>
import BN from 'bignumber.js';
import { mapState, mapActions } from 'vuex';
import PvPButton from './PvPButton.vue';

export default {
  components: {
    'pvp-button': PvPButton
  },

  data() {
    return {
      loading: true,
      availableSkill: null,
    };
  },

  computed: {
    ...mapState(['currentCharacterId', 'contracts', 'defaultAccount', 'ownedWeaponIds', 'ownedShieldIds']),

    formattedAvailableSkill() {
      return new BN(this.availableSkill).div(new BN(10).pow(18)).toFixed(2);
    },
  },

  methods: {
    ...mapActions([
      'withdrawRankedRewards',
      'getPlayerPrizePoolRewards'
    ]),

    async claimRewards() {
      this.loading = true;

      try {
        await this.withdrawRankedRewards();

        this.availableSkill = await this.getPlayerPrizePoolRewards();
      } catch (err) {
        console.log('withdraw rewards error: ', err);
      }

      this.loading = false;
    }
  },

  async created() {
    this.availableSkill = await this.getPlayerPrizePoolRewards();

    this.loading = false;
  }
};
</script>

<style scoped lang="scss">
.rewardsWrapper {
  display: flex;
  flex-direction: column;
  font-family: 'Trajan';

  h1 {
    font-size: 1.25rem;
    font-family: 'Trajan';
    color: #cec198;
    padding-top: 0;
    text-transform: uppercase;
  }

  p, li {
    font-family: 'Roboto';
  }

  p {
    margin-bottom: 2rem;
    color: #b4b0a7;
  }

  ul {
    padding-left: 1rem;
    li {
      display: flex;
      margin-bottom: 0.75rem;
      align-items: center;
      vertical-align: middle;
      color: #b4b0a7;
      font-size: 0.875rem;
      line-height: 1.25rem;
      .bulletpoint {
        height: 0.5rem;
        width: 0.5rem;
        margin-right: 0.75rem;
        background-color: #dabe75;
        transform: rotate(45deg);
      }
    }
  }

  button {
    margin-top: 1rem;
    width: 14rem;
    height: 5rem;
    text-transform: uppercase;
  }
}
</style>
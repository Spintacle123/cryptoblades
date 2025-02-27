<template>
  <div class="body main-font">
    <div v-if="ownWeapons.length > 0 && ownCharacters.length > 0">
      <div class="row" v-if="error !== null">
        <div class="col error">{{$t('combat.error')}} {{ error }}</div>
      </div>

      <b-modal id="fightResultsModal" hide-footer hide-header>
        <CombatResults v-if="resultsAvailable" :fightResults="fightResults" />
        <b-button class="mt-3" variant="primary" block @click="$bvModal.hide('fightResultsModal')">Close</b-button>
      </b-modal>

      <div class="row">
        <div class="col">
          <div class="message-box" v-if="!currentCharacter">{{$t('combat.errors.needToSelectChar')}}</div>

          <div class="row">
            <div class="col-12 col-md-2 offset-md-5 text-center">
              <div class="message-box flex-column" v-if="currentCharacter && currentCharacterStamina < staminaPerFight">
                {{$t('combat.needStamina', {staminaPerFight })}}
                <h4>{{$t('combat.costStamina')}}</h4>
                <b-form-select v-model="fightMultiplier" :options='setStaminaSelectorValues()' @change="setFightMultiplier()" class="ml-3"></b-form-select>
              </div>
            </div>
          </div>

          <div class="message-box" v-if="selectedWeaponId && !weaponHasDurability(selectedWeaponId)">{{$t('combat.errors.notEnoughDurability')}}</div>

          <div class="message-box" v-if="timeMinutes === 59 && timeSeconds >= 30">{{$t('combat.errors.lastSeconds')}}</div>
        </div>
      </div>

      <div class="row" v-if="!selectedWeaponId">
        <div class="col-12 text-center">
          <h2>{{ $t('combat.expectedEarnings') }}</h2>
          <h5>
            <CurrencyConverter :skill="expectedSkill" :showValueInUsdOnly="false"/>
            (
            <CurrencyConverter :skill="expectedSkill" :showValueInUsdOnly="true"/>
            )
            <Hint id="expectedSkillHint" :text="$t('combat.forStaminaFight', {stamina: 40})"/>
            <br>{{ $t('combat.averagePower') }}: <b>{{ powerAvg }}</b></h5>
        </div>
      </div>

      <img src="../assets/divider7.png" class="info-divider enemy-divider" />

      <div class="row" v-if="currentCharacterStamina >= staminaPerFight">
        <div class="col">
          <div class="row">
            <div class="col">
              <div class="waiting" v-if="waitingResults" margin="auto">
                <i class="fas fa-spinner fa-spin"></i>
                {{$t('combat.waiting')}}
              </div>
            </div>
          </div>
          <div class="combat-enemy-container">
            <div class="col weapon-selection">
              <div class="header-row">

                <div class="row mb-3 mt-3">
                  <div :class="['col-12', selectedWeaponId ? 'col-md-6 offset-md-3' : 'col-md-2 offset-md-5']">
                    <h4>{{$t('combat.costStamina')}}</h4>
                    <b-form-select v-model="fightMultiplier" :options='setStaminaSelectorValues()' @change="setFightMultiplier()"></b-form-select>
                  </div>
                </div>

                <div class="header-row weapon-header">
                  <b>{{$t('combat.chooseWeapon')}}</b>
                  <Hint
                    :text="$t('combat.chooseWeaponHint')"
                  />
                </div>

                <div v-if="selectedWeaponId" class="weapon-icon-wrapper">
                  <weapon-icon class="weapon-icon" :weapon="selectedWeapon" />
                </div>

                <b-button v-if="selectedWeaponId" variant="primary" class="ml-3" @click="selectedWeaponId = null" id="gtag-link-others" tagname="choose_weapon">
                  {{$t('combat.chooseNewWeapon')}}
                </b-button>
              </div>

              <weapon-grid v-if="!selectedWeaponId" v-model="selectedWeaponId" :checkForDurability="true" />
            </div>
            <div class="row mb-3 enemy-container" v-if="targets.length > 0">
              <div class="col-12 text-center">
                <div class="combat-hints">
                  <span class="fire-icon" /> » <span class="earth-icon" /> » <span class="lightning-icon" /> » <span class="water-icon" /> »
                  <span class="fire-icon" />
                  <Hint
                    :text="$t('combat.elementHint')"
                  />
                </div>
              </div>

              <div class="col-12 col-md-6 col-xl-3 encounter" v-for="(e, i) in targets" :key="i">
                <div class="encounter-container">
                <div class="enemy-character">
                  <div class="encounter-element">
                      <span :class="getCharacterTrait(e.trait).toLowerCase() + '-icon'" />
                    </div>

                    <div class="">
                      <img class="mx-auto enemy-img" :src="getEnemyArt(e.power)" :alt="$t('combat.enemy')" />
                    </div>

                    <div class="encounter-power">
                      {{ e.power }} {{$t('combat.power')}}
                    </div>

                    <div class="xp-gain">
                      +{{getPotentialXp(e)}} {{$t('combat.xp')}}
                    </div>

                    <div class="skill-gain">
                      + ~{{formattedSkill(targetExpectedPayouts[i] * fightMultiplier)}}
                    </div>
                </div>

                <div class="victory-chance">
                  {{ getWinChance(e.power, e.trait) }} {{$t('combat.victory')}}
                </div>
                <big-button
                      class="encounter-button btn-styled"
                      :mainText="$t('combat.fight')"
                      :disabled="(timeMinutes === 59 && timeSeconds >= 30) || waitingResults || !weaponHasDurability(selectedWeaponId) || !charHasStamina()"
                      @click="onClickEncounter(e,i)"
                    />
                <p v-if="isLoadingTargets">{{$t('combat.loading')}}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div></div>
    </div>
    <b-modal class="centered-modal" ref="no-skill-warning-modal" @ok="fightTarget(targetToFight,targetToFightIndex)">
      <template #modal-title>
        <b-icon icon="exclamation-circle" variant="danger"/> WARNING
      </template>
      <span>
        You will not gain any SKILL from this fight, but you will still earn <b> XP </b>! <br>
        Rewards will be filled in <b> {{minutesToNextAllowance}} </b> min. <br>
        There were up to <b> {{lastAllowanceSkill}} </b> distributed during the last allowance.
      </span>
    </b-modal>
    <div class="blank-slate" v-if="ownWeapons.length === 0 || ownCharacters.length === 0">
      <div v-if="ownWeapons.length === 0">{{$t('combat.noWeapons')}}</div>

      <div v-if="ownCharacters.length === 0">{{$t('combat.noCharacters')}}</div>
    </div>
  </div>
</template>

<script>
// import Character from "../components/Character.vue";
import BigButton from '../components/BigButton.vue';
import WeaponGrid from '../components/smart/WeaponGrid.vue';
import {getEnemyArt} from '../enemy-art';
import {CharacterTrait, GetTotalMultiplierForTrait, WeaponElement} from '../interfaces';
import Hint from '../components/Hint.vue';
import CombatResults from '../components/CombatResults.vue';
import {fromWeiEther, toBN} from '../utils/common';
import WeaponIcon from '../components/WeaponIcon.vue';
import {mapActions, mapGetters, mapMutations, mapState} from 'vuex';
import CurrencyConverter from '../components/CurrencyConverter.vue';

export default {
  data() {
    return {
      selectedWeaponId: null,
      error: null,
      waitingResults: false,
      resultsAvailable: false,
      fightResults: null,
      intervalSeconds: null,
      intervalMinutes: null,
      timeSeconds: null,
      timeMinutes: null,
      fightXpGain: 32,
      selectedWeapon: null,
      fightMultiplier: Number(localStorage.getItem('fightMultiplier')),
      staminaPerFight: 40,
      targetExpectedPayouts: new Array(4),
      targetToFight: null,
      targetToFightIndex: null,
      minutesToNextAllowance: null,
      secondsToNextAllowance: null,
      lastAllowanceSkill: null,
      nextAllowanceCounter: null,
      powerAvg: null,
      expectedSkill: null,
    };
  },

  created() {
    this.intervalSeconds = setInterval(() => (this.timeSeconds = new Date().getSeconds()), 5000);
    this.intervalMinutes = setInterval(() => (this.timeMinutes = new Date().getMinutes()), 20000);
    this.updateStaminaPerFight();
    this.counterInterval = setInterval(async () => {
      await this.getExpectedPayout();
    }, 1000);

  },
  beforeDestroy() {
    clearInterval(this.intervalSeconds);
    clearInterval(this.intervalMinutes);
    clearInterval(this.counterInterval);
  },
  computed: {
    ...mapState(['currentCharacterId']),
    ...mapGetters([
      'getTargetsByCharacterIdAndWeaponId',
      'ownCharacters',
      'ownWeapons',
      'currentCharacter',
      'currentCharacterStamina',
      'getWeaponDurability',
      'fightGasOffset',
      'fightBaseline',
      'getCharacterPower'
    ]),

    targets() {
      return this.getTargetsByCharacterIdAndWeaponId(this.currentCharacterId, this.selectedWeaponId);
    },

    isLoadingTargets() {
      return this.targets.length === 0 && this.currentCharacterId && this.selectedWeaponId;
    },

    selections() {
      return [this.currentCharacterId, this.selectedWeaponId];
    },

    updateResults() {
      return [this.fightResults, this.error];
    },
  },

  watch: {
    async selections([characterId, weaponId]) {
      if (!this.ownWeapons.filter(Boolean).find((weapon) => weapon.id === weaponId)) {
        this.selectedWeaponId = null;
      }
      await this.fetchTargets({ characterId, weaponId });
    },

    async targets() {
      await this.getExpectedPayouts();
    },

    async updateResults([fightResults, error]) {
      this.resultsAvailable = fightResults !== null;
      this.waitingResults = fightResults === null && error === null;
      this.setIsInCombat(this.waitingResults);
      if (this.resultsAvailable && error === null) this.$bvModal.show('fightResultsModal');
    },
  },

  methods: {
    ...mapActions(['fetchTargets', 'doEncounter', 'fetchFightRewardSkill', 'fetchFightRewardXp', 'getXPRewardsIfWin', 'fetchExpectedPayoutForMonsterPower',
      'fetchHourlyAllowance', 'fetchHourlyPowerAverage', 'fetchHourlyPayPerFight']),
    ...mapMutations(['setIsInCombat']),
    getEnemyArt,
    weaponHasDurability(id) {
      return this.getWeaponDurability(id) >= this.fightMultiplier;
    },
    charHasStamina(){
      return this.currentCharacterStamina >= this.staminaPerFight;
    },
    getCharacterTrait(trait) {
      return CharacterTrait[trait];
    },
    getWinChance(enemyPower, enemyElement) {
      const characterPower = this.getCharacterPower(this.currentCharacter.id);
      const playerElement = parseInt(this.currentCharacter.trait, 10);
      const selectedWeapon = this.ownWeapons.filter(Boolean).find((weapon) => weapon.id === this.selectedWeaponId);
      this.selectedWeapon = selectedWeapon;
      const weaponElement = parseInt(WeaponElement[selectedWeapon.element], 10);
      const weaponMultiplier = GetTotalMultiplierForTrait(selectedWeapon, playerElement);
      const totalPower = characterPower * weaponMultiplier + selectedWeapon.bonusPower;
      const totalMultiplier = 1 + 0.075 * (weaponElement === playerElement ? 1 : 0) + 0.075 * this.getElementAdvantage(playerElement, enemyElement);
      const playerMin = totalPower * totalMultiplier * 0.9;
      const playerMax = totalPower * totalMultiplier * 1.1;
      const playerRange = playerMax - playerMin;
      const enemyMin = enemyPower * 0.9;
      const enemyMax = enemyPower * 1.1;
      const enemyRange = enemyMax - enemyMin;
      let rollingTotal = 0;
      // shortcut: if it is impossible for one side to win, just say so
      if (playerMin > enemyMax) return this.$t('combat.winChances.veryLikely');
      if (playerMax < enemyMin) this.$t('combat.winChances.unlikely');

      // case 1: player power is higher than enemy power
      if (playerMin >= enemyMin) {
        // case 1: enemy roll is lower than player's minimum
        rollingTotal = (playerMin - enemyMin) / enemyRange;
        // case 2: 1 is not true, and player roll is higher than enemy maximum
        rollingTotal += (1 - rollingTotal) * ((playerMax - enemyMax) / playerRange);
        // case 3: 1 and 2 are not true, both values are in the overlap range. Since values are basically continuous, we assume 50%
        rollingTotal += (1 - rollingTotal) * 0.5;
      } // otherwise, enemy power is higher
      else {
        // case 1: player rolls below enemy minimum
        rollingTotal = (enemyMin - playerMin) / playerRange;
        // case 2: enemy rolls above player maximum
        rollingTotal += (1 - rollingTotal) * ((enemyMax - playerMax) / enemyRange);
        // case 3: 1 and 2 are not true, both values are in the overlap range
        rollingTotal += (1 - rollingTotal) * 0.5;
        //since this is chance the enemy wins, we negate it
        rollingTotal = 1 - rollingTotal;
      }
      if (rollingTotal <= 0.3) return this.$t('combat.winChances.unlikely');
      if (rollingTotal <= 0.5) return this.$t('combat.winChances.possible');
      if (rollingTotal <= 0.7) return this.$t('combat.winChances.likely');
      return this.$t('combat.winChances.veryLikely');
    },
    getElementAdvantage(playerElement, enemyElement) {
      if ((playerElement + 1) % 4 === enemyElement) return 1;
      if ((enemyElement + 1) % 4 === playerElement) return -1;
      return 0;
    },

    async getExpectedPayout() {
      this.powerAvg = await this.fetchHourlyPowerAverage();
      this.expectedSkill = fromWeiEther(await this.fetchHourlyPayPerFight());
    },
    async getHourlyAllowance(){
      const fetchHourlyAllowance = await this.fetchHourlyAllowance();
      this.lastAllowanceSkill = this.formattedSkill(fetchHourlyAllowance);
    },
    async onClickEncounter(targetToFight, targetIndex) {
      if(this.targetExpectedPayouts[targetIndex] === '0'){
        this.targetToFight = targetToFight;
        this.targetToFightIndex = targetIndex;
        await this.getHourlyAllowance();
        this.$refs['no-skill-warning-modal'].show();
      }
      else{
        this.fightTarget(targetToFight, targetIndex);
      }
    },

    async fightTarget(targetToFight, targetIndex){
      if (this.selectedWeaponId === null || this.currentCharacterId === null) {
        return;
      }

      this.waitingResults = true;

      // Force a quick refresh of targets
      await this.fetchTargets({ characterId: this.currentCharacterId, weaponId: this.selectedWeaponId });
      // If the targets list no longer contains the chosen target, return so a new target can be chosen
      if (this.targets[targetIndex].original !== targetToFight.original) {
        this.waitingResults = false;
        return;
      }

      this.fightResults = null;
      this.error = null;
      this.setIsInCombat(this.waitingResults);

      try {
        const results = await this.doEncounter({
          characterId: this.currentCharacterId,
          weaponId: this.selectedWeaponId,
          targetString: targetIndex,
          fightMultiplier: this.fightMultiplier,
        });

        this.fightResults = results;

        await this.fetchFightRewardSkill();
        await this.fetchFightRewardXp();

        this.error = null;
      } catch (e) {
        console.error(e);
        this.error = e.message;
      }
    },

    formattedSkill(skill) {
      const skillBalance = fromWeiEther(skill, 'ether');
      return `${toBN(skillBalance).toFixed(6)} SKILL`;
    },

    getPotentialXp(targetToFight) {
      const characterPower = this.getCharacterPower(this.currentCharacter.id);
      const playerElement = parseInt(this.currentCharacter.trait, 10);
      const selectedWeapon = this.ownWeapons.filter(Boolean).find((weapon) => weapon.id === this.selectedWeaponId);
      const weaponMultiplier = GetTotalMultiplierForTrait(selectedWeapon, playerElement);
      const totalPower = characterPower * weaponMultiplier + selectedWeapon.bonusPower;
      //Formula taken from getXpGainForFight funtion of cryptoblades.sol
      return Math.floor((targetToFight.power / totalPower) * this.fightXpGain) * this.fightMultiplier;
    },

    setFightMultiplier() {
      localStorage.setItem('fightMultiplier', this.fightMultiplier.toString());
      this.updateStaminaPerFight();
    },

    setStaminaSelectorValues() {
      if(this.currentCharacterStamina < 40) {
        return [{ value: this.fightMultiplier, text: this.$t('combat.moreStamina'), disabled: true}];
      }

      const choices = [
        {value: null, text: this.$t('combat.pleaseSelect'), disabled: true},
      ];

      const addChoices = [];

      if(this.currentCharacterStamina >= 200) {
        addChoices.push({ value: 5, text: 200 });
      }

      if(this.currentCharacterStamina >= 160) {
        addChoices.push({ value: 4, text: 160 });
      }

      if(this.currentCharacterStamina >= 120) {
        addChoices.push({ value: 3, text: 120 });
      }

      if(this.currentCharacterStamina >= 80) {
        addChoices.push({ value: 2, text: 80 });
      }

      if(this.currentCharacterStamina >= 40) {
        addChoices.push({ value: 1, text: 40 });
      }

      choices.push(...addChoices.reverse());

      return choices;
    },

    async getExpectedPayouts() {
      if(!this.targets) return;
      const expectedPayouts = new Array(4);
      for(let i = 0; i < this.targets.length; i++) {
        const expectedPayout = await this.fetchExpectedPayoutForMonsterPower({ power: this.targets[i].power });
        expectedPayouts[i] = expectedPayout;
      }
      this.targetExpectedPayouts = expectedPayouts;
    },

    updateStaminaPerFight() {
      this.staminaPerFight = 40 * Number(localStorage.getItem('fightMultiplier'));
    }
  },

  components: {
    BigButton,
    WeaponGrid,
    Hint,
    CombatResults,
    WeaponIcon,
    CurrencyConverter,
  },
};
</script>

<style scoped>
.enemy-character {
  position: relative;
  width: 14em;
  height: 25em;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 115%;
  background-color: #2e2e30cc;
  background-image: url('../assets/cardCharacterFrame.png');
  border: 1px solid #a28d54;
  border-radius: 15px;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  margin-bottom: 10px;
  box-shadow: 0px 6px 8px rgba(0, 0, 0, 0.705), 0px 12px 7px rgba(0, 0, 0, 0.5), 0px 9px 12px rgba(0, 0, 0, 0.1);
}

.encounter img {
  width: 170px;
}

.weapon-header > b {
  font-size: 1.8em;
}

.payout-info {
  margin: auto;
  text-align: center;
  padding-top: 1em;
  font-size: 1.5em;

  display: flex;
  justify-content: center;
  align-items: center;
}

.combat-hints {
  margin: auto;
  text-align: center;
  padding-right: 1em;
  padding-left: 1em;
  padding-bottom: 1em;
  font-size: 2em;

  display: flex;
  justify-content: center;
  align-items: center;
}

.combat-hints .hint {
  margin-left: 10px;
}

.waiting {
  font-size: 2em;
  margin: auto;
  text-align: center;
}

.header-row {
  display: flex;
  align-items: center;
}

.header-row h1 {
  margin-left: 10px;
  margin-bottom: 5px;
}

.header-row .hint {
  font-size: 2em;
}

.message-box {
  display: flex;
  justify-content: center;
  width: 100%;
  font-size: 2em;
}

div.encounter.text-center {
  flex-basis: auto !important;
}

.weapon-icon-wrapper {
  background: rgba(255, 255, 255, 0.1);
  width: 12em;
  height: 12em;
  margin: 0 auto;
}

.encounter-container {
  position: relative;
}

.encounter {
  display: flex;
  justify-content: center;
}

.xp-gain,
.encounter-power,
.skill-gain {
  color: #9e8a57 !important;
}

.xp-gain,
.encounter-power,
.encounter-element,
.victory-chance,
.skill-gain {
  position: absolute;
}

.encounter-element {
  top: 25px;
  font-size: 20px;
}

.encounter-power {
  bottom: 60px;
  font-size: 1.5em;
}

.xp-gain {
  bottom: 40px;
  font-size: 1em;
}

.skill-gain {
  bottom: 20px;
  font-size: 1em;
}

.victory-chance {
  left: 0;
  right: 0;
  text-align: center;
  font-size: 1.5em;
  text-shadow: -1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000;
}

/* Mobile Support Classes*/
.mobile-divider-wrapper {
  width: 100%;
  display: flex;
}

.mobile-divider {
  margin: auto;
}

.combat-enemy-container {
  display: flex;
  margin-bottom: 50px;
}

.enemy-container {
  flex: 3;
}

.enemy-divider {
  margin-top: 30px;
}

.enemy-list {
  display: flex;
  flex-wrap: wrap;
  padding-left: 30px;
  padding-right: 30px;
}

.weapon-selection {
  border-right: 1px solid #9e8a57;
}

.weapon-header {
  justify-content: center;
  margin-bottom: 20px;
  margin-top: 20px;
}

.enemy-energy {
  top: -30px;
  position: relative;
}

h1 {
  font-weight: 900 !important;
  text-align: center;
  font-size: 3vw;
  padding-top: 0px;
}

.encounter-button {
  display: block;
  margin: 0 auto;
  height: 5em;
  width: 13em;
  position: relative;
  top: 3vw;
  margin-top: 2em;
}

.enemy-img {
  position: relative;
  top: -50px;
}

@media (max-width: 1334px) {
  .enemy-list {
    flex-flow: row wrap;
    align-items: center;
  }
  .enemy-list > .enemy-list-child{
     flex-basis: 50%;
  }
  .encounter-button {
    margin-top: 1.35em;
  }
}

/* Needed to asjust image size, not just image column-size and other classes to accommodate that */
@media all and (max-width: 767.98px) {
  .encounter img {
    width: calc(100% - 60px);
  }
  .enemy-list{
    flex-direction:column;
    align-items:center;
  }
  .combat-enemy-container {
    flex-direction: column;
    align-items: center;
  }
  .weapon-selection {
    border-right: none;
  }
  .results-panel {
    width: 100%;
  }
}
.hint.has-tooltip {
  font-size: 1.8rem;
  display: inline-block;
  margin-left: 10px;
}
.dark-bg-text {
  width: 100% !important;
}
.content {
  padding: 0 !important;
}

.encounter-container {
  margin-bottom: 50px;
}
.combat-hints {
  margin-top: 30px;
}
#gtag-link-others {
  margin: 0 auto;
  display: block;
  position: relative;
  margin-top: 20px;
  width: 100%;
}
.ml-3 {
  margin-left: 0px !important;
}
.header-row {
  display: block;
  text-align: center;
}
#expectedSkillHint{
  margin:0;
  font-size: 1em;
}
@media (max-width: 575.98px) {
  .show-reforged {
    width: 100%;
    justify-content: center;
    display: block;
  }
}
</style>

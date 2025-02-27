<template>
  <div>
    <div class="filters row mt-2 pl-2" v-if="showFilters" @change="saveFilters()">
      <div :class="isMarket ? 'col-sm-6 col-md-6 col-lg-2 mb-3' : 'col-sm-5 col-md-5 col-lg-3 mb-3'">
        <strong>{{$t('characterList.level')}}</strong>
        <select class="form-control" v-model="levelFilter">
          <option v-for="x in ['', 1, 11, 21, 31, 41, 51, 61, 71, 81, 91]" :value="x" :key="x">
            {{ x ? `${x} - ${x + 9}` : $t('characterList.sorts.any') }}
          </option>
        </select>
      </div>

      <div :class="isMarket ? 'col-sm-6 col-md-6 col-lg-2 mb-3' : 'col-sm-5 col-md-5 col-lg-3 mb-3'">
        <strong>{{$t('characterList.element')}}</strong>
        <select class="form-control" v-model="elementFilter">
          <option v-for="(x, index) in ['', $t('traits.earth'), $t('traits.fire'), $t('traits.lightning'), $t('traits.water')]"
          :value="['', 'Earth', 'Fire', 'Lightning', 'Water'][index]" :key="x">{{ x || $t('characterList.sorts.any') }}</option>
        </select>
      </div>

      <template v-if="isMarket">
        <div class="col-sm-6 col-md-6 col-lg-2 mb-3">
          <strong>{{$t('characterList.minPrice')}}</strong>
          <input class="form-control" type="number" v-model.trim="minPriceFilter" :min="0" placeholder="Min" />
        </div>
        <div class="col-sm-6 col-md-6 col-lg-2 mb-3">
          <strong>{{$t('characterList.maxPrice')}}</strong>
          <input class="form-control" type="number" v-model.trim="maxPriceFilter" :min="0" placeholder="Max" />
        </div>
        <div class="col-sm-6 col-md-6 col-lg-2 mb-3">
          <strong>{{$t('characterList.sort')}}</strong>
          <select class="form-control" v-model="priceSort">
            <option v-for="x in sorts" :value="x.dir" :key="x.dir">{{ x.name || $t('characterList.sorts.any') }}</option>
          </select>
        </div>
      </template>

      <b-button variant="primary" class="clear-filters-button mb-3" @click="clearFilters" >
          <span>
            {{$t('characterList.clearFilters')}}
          </span>
        </b-button>
    </div>

    <ul class="character-list">
      <li
        class="character"
        :class="[value === c.id ? 'selected' : '', showCosmetics ? 'character-animation-applied-' + getCharacterCosmetic(c.id) : '']"
        v-for="c in filteredCharacters"
        :key="c.id"
        @click="$emit('input', c.id)"
      >
        <div :class="nftDisplay ? 'above-wrapper-nft-display' : 'above-wrapper'" v-if="$slots.above || $scopedSlots.above">
          <slot name="above" :character="c"></slot>
        </div>
        <slot name="sold" :character="c"></slot>
        <nft-options-dropdown v-if="showNftOptions" :nftType="'character'" :nftId="c.id" :options="options"
          :showTransfer="!isMarket && !isGarrison" class="nft-options"/>
        <div class="art" >
          <div class="animation" />
          <CharacterArt :class="[showCosmetics ? 'character-cosmetic-applied-' + getCharacterCosmetic(c.id) : '']"
            :character="c" :isMarket="isMarket" :isGarrison="isGarrison"/>
        </div>
      </li>
    </ul>

    <b-modal class="centered-modal" ref="character-rename-modal"
      @ok="renameCharacterCall">
      <template #modal-title>
        {{$t('characterList.renameCharacter')}}
      </template>
      <b-form-input type="string"
        class="modal-input" v-model="characterRename" :placeholder="$t('characterList.newName')" />
      <span v-if="characterRename !== '' && (characterRename.length < 2 || characterRename.length > 24)">
        {{$t('characterList.renameCharacterLengthWarning')}}
      </span>
      <span v-if="isRenameProfanish">
        {{$t('characterList.renameCharacterProfanityWarning')}}
         <em>{{cleanRename}}</em>
      </span>
    </b-modal>

    <b-modal class="centered-modal" ref="character-change-trait-modal"
      @ok="changeCharacterTraitCall">
      <template #modal-title>
        {{$t('characterList.changeCharacterTrait')}}
      </template>
      <span>
        {{$t('characterList.pickTrait')}}
      </span>
      <select class="form-control" v-model="targetTrait">
        <option v-for="x in availableTraits" :value="x" :key="x">{{ x }}</option>
      </select>
    </b-modal>

    <b-modal class="centered-modal" ref="character-change-skin-modal"
      @ok="changeCharacterSkinCall">
      <template #modal-title>
        {{$t('characterList.changeCharacterSkin')}}
      </template>
      <span >
        {{$t('characterList.pickSkin')}}
      </span>
      <select class="form-control" v-model="targetSkin">
        <option v-for="x in availableSkins" :value="x" :key="x">{{ x }}</option>
      </select>
    </b-modal>
  </div>
</template>

<script>
import { mapActions, mapGetters, mapState } from 'vuex';
import { getCharacterArt } from '../../character-arts-placeholder';
import CharacterArt from '../CharacterArt.vue';
import NftOptionsDropdown from '../NftOptionsDropdown.vue';
import { getCleanName, isProfaneIsh } from '../../rename-censor';
import Events from '@/events';
import i18n from '@/i18n';
import { copyNftUrl } from '@/utils/common';

const sorts = [
  { name: i18n.t('characterList.sorts.any'), dir: '' },
  { name: i18n.t('characterList.sorts.lowToHigh'), dir: 1 },
  { name: i18n.t('characterList.sorts.highToLow'), dir: -1 },
];

export default {
  props: {
    value: {},
    showGivenCharacterIds: {
      type: Boolean,
      default: false
    },
    showFilters: {
      type: Boolean,
      default: false
    },
    characterIds: {
      type: Array,
      default() { return []; }
    },
    showLimit: {
      type: Number,
      default: 0
    },
    isMarket: {
      type: Boolean,
      default: false
    },
    nftDisplay: {
      type: Boolean,
      default: false
    },
    showNftOptions: {
      type: Boolean,
      default: false
    },
    isGarrison: {
      type: Boolean,
      default: false
    }
  },

  data() {
    return {
      levelFilter: '',
      elementFilter: '',
      minPriceFilter:'',
      maxPriceFilter:'',
      priceSort: '',
      sorts,
      haveRename: 0,
      characterRename: '',
      haveChangeTraitFire: 0,
      haveChangeTraitEarth: 0,
      haveChangeTraitWater: 0,
      haveChangeTraitLightning: 0,
      targetTrait: '',
      currentCharacterId: null,
      options: [],
      haveCharacterCosmetic1: 0,
      haveCharacterCosmetic2: 0,
      haveCharacterCosmetics: [0],
      targetSkin: '',
      showCosmetics: true,
      characterCosmeticsNames: [
        'Character Grayscale','Character Contrast',
        'Character Sepia','Character Invert',
        'Character Blur','Character Fire Glow',
        'Character Earth Glow','Character Lightning Glow',
        'Character Water Glow','Character Rainbow Glow',
        'Character Dark Glow','Ghost Character',
        'Character Police Lights','Character Neon Border',
        'Character Diamond Border','Character Gold Border',
        'Character Silver Border','Character Bronze Border',
      ]
    };
  },

  computed: {
    ...mapState(['maxStamina', 'ownedCharacterIds', 'ownedGarrisonCharacterIds']),
    ...mapGetters(['getCharacterName', 'allStaminas', 'charactersWithIds', 'garrisonCharactersWithIds', 'getCharacterCosmetic']),

    characterIdsToDisplay() {
      if(this.showGivenCharacterIds) {
        return this.characterIds;
      }

      return this.isGarrison ? this.ownedGarrisonCharacterIds : this.ownedCharacterIds;
    },

    displayCharacters() {
      return this.isGarrison
        ? this.garrisonCharactersWithIds(this.characterIdsToDisplay).filter(Boolean)
        : this.charactersWithIds(this.characterIdsToDisplay).filter(Boolean);
    },

    filteredCharacters() {
      let items = this.displayCharacters;

      if(this.showFilters) {
        if(this.elementFilter) {
          items = items.filter(x => x.traitName.includes(this.elementFilter));
        }

        if(this.levelFilter) {
          items = items.filter(x => x.level >= this.levelFilter - 1 && x.level <= this.levelFilter + 8);
        }

        if(this.showLimit > 0 && items.length > this.showLimit) {
          items = items.slice(0, this.showLimit);
        }
      }

      return items;
    },

    totalTraitChanges() {
      return +this.haveChangeTraitFire + +this.haveChangeTraitEarth + +this.haveChangeTraitLightning + +this.haveChangeTraitWater;
    },

    totalCosmeticChanges() {
      let count = 0;
      this.haveCharacterCosmetics.forEach(x => count += +x);
      return count;
    },

    isRenameProfanish() {
      return isProfaneIsh(this.characterRename);
    },

    cleanRename() {
      return getCleanName(this.characterRename);
    },

    availableTraits() {
      const availableTraits = [];
      if(this.haveChangeTraitFire > 0) {
        availableTraits.push('Fire');
      }
      if(this.haveChangeTraitEarth > 0) {
        availableTraits.push('Earth');
      }
      if(this.haveChangeTraitWater > 0) {
        availableTraits.push('Water');
      }
      if(this.haveChangeTraitLightning > 0) {
        availableTraits.push('Lightning');
      }

      return availableTraits;
    },

    availableSkins() {
      const availableSkins = [];

      availableSkins.push('No Skin');

      for(let i = 0; i < 18; i++) {
        if(+this.haveCharacterCosmetics[i] > 0) {
          availableSkins.push(this.characterCosmeticsNames[i]);
        }
      }

      return availableSkins;
    }
  },

  watch: {
    async characterIdsToDisplay(characterIds) {
      await this.fetchCharacters(characterIds);
    }
  },

  methods: {
    ...mapActions(['fetchCharacters','fetchTotalRenameTags','renameCharacter','changeCharacterTraitLightning',
      'changeCharacterTraitEarth', 'changeCharacterTraitFire', 'changeCharacterTraitWater',
      'fetchTotalCharacterFireTraitChanges','fetchTotalCharacterEarthTraitChanges',
      'fetchTotalCharacterWaterTraitChanges', 'fetchTotalCharacterLightningTraitChanges',
      'fetchOwnedCharacterCosmetics','changeCharacterCosmetic','removeCharacterCosmetic','restoreFromGarrison', 'sendToGarrison', 'purchaseBurnCharacter']),

    getCharacterArt,

    saveFilters() {
      sessionStorage.setItem('character-levelfilter', this.levelFilter);
      sessionStorage.setItem('character-elementfilter', this.elementFilter);

      if(this.isMarket) {
        sessionStorage.setItem('character-price-order', this.priceSort);
        sessionStorage.setItem('character-price-minfilter', this.minPriceFilter);
        sessionStorage.setItem('character-price-maxfilter', this.maxPriceFilter);
      }
      this.$emit('character-filters-changed');
    },

    clearFilters() {
      sessionStorage.removeItem('character-levelfilter');
      sessionStorage.removeItem('character-elementfilter');
      if(this.isMarket) {
        sessionStorage.removeItem('character-price-order');
        sessionStorage.removeItem('character-price-minfilter');
        sessionStorage.removeItem('character-price-maxfilter');
      }

      this.elementFilter = '';
      this.levelFilter = '';
      this.priceSort = '';
      this.minPriceFilter = '';
      this.maxPriceFilter = '';

      this.$emit('character-filters-changed');
    },

    async loadConsumablesCount() {
      this.haveRename = await this.fetchTotalRenameTags();
      this.haveChangeTraitFire = await this.fetchTotalCharacterFireTraitChanges();
      this.haveChangeTraitEarth = await this.fetchTotalCharacterEarthTraitChanges();
      this.haveChangeTraitWater = await this.fetchTotalCharacterWaterTraitChanges();
      this.haveChangeTraitLightning = await this.fetchTotalCharacterLightningTraitChanges();
      this.updateOptions();
    },

    updateOptions() {
      if(this.isMarket) {
        this.options = [
          {
            name: this.$t('copyLink'),
            amount: 0,
            handler: copyNftUrl,
            hasDefaultOption: true,
            noAmount: true
          }
        ];
      } else if(this.isGarrison) {
        this.options = [
          {
            name: this.$t('characterList.restoreToPlaza'),
            amount: 0,
            handler: this.onRestoreToPlaza,
            hasDefaultOption: true,
            noAmount: true
          },
        ];
      } else {
        this.options = [
          {
            name: this.$t('characterList.rename'),
            amount: this.haveRename,
            handler: this.openRenameCharacter
          },
          {
            name: this.$t('characterList.changeTrait'),
            amount: this.totalTraitChanges,
            handler: this.openChangeTrait
          },
          {
            name: this.$t('characterList.changeSkin'),
            amount: this.totalCosmeticChanges,
            handler: this.openChangeSkin,
            hasDefaultOption: true,
          },
          {
            name: this.$t('characterList.sendToGarrison'),
            amount: 0,
            handler: this.onSendToGarrison,
            hasDefaultOption: true,
            noAmount: true
          },
        ];
      }
    },

    async onRestoreToPlaza(id) {
      if(this.ownedCharacterIds.length < 4) {
        await this.restoreFromGarrison(id);
      } else {
        this.$dialog.notify.error(this.$t('characterList.plazaFull'));
      }
    },

    async onSendToGarrison(id) {
      await this.sendToGarrison(id);
    },

    openRenameCharacter(id) {
      this.currentCharacterId = id;
      (this.$refs['character-rename-modal']).show();
    },
    async renameCharacterCall(bvModalEvt) {
      if(this.characterRename.length < 2 || this.characterRename.length > 24){
        bvModalEvt.preventDefault();
        return;
      }

      await this.renameCharacter({id: this.currentCharacterId, name: this.characterRename.trim()});
      this.haveRename = await this.fetchTotalRenameTags();
      this.updateOptions();
    },

    openChangeTrait(id) {
      this.currentCharacterId = id;
      (this.$refs['character-change-trait-modal']).show();
    },
    async changeCharacterTraitCall(bvModalEvt) {
      if(!this.targetTrait) {
        bvModalEvt.preventDefault();
      }
      switch(this.targetTrait) {
      case 'Fire':
        await this.changeCharacterTraitFire({ id: this.currentCharacterId });
        this.haveChangeTraitFire = await this.fetchTotalCharacterFireTraitChanges();
        break;
      case 'Earth' :
        await this.changeCharacterTraitEarth({ id: this.currentCharacterId });
        this.haveChangeTraitEarth = await this.fetchTotalCharacterEarthTraitChanges();
        break;
      case 'Water':
        await this.changeCharacterTraitWater({ id: this.currentCharacterId });
        this.haveChangeTraitWater = await this.fetchTotalCharacterWaterTraitChanges();
        break;
      case 'Lightning':
        await this.changeCharacterTraitLightning({ id: this.currentCharacterId });
        this.haveChangeTraitLightning = await this.fetchTotalCharacterLightningTraitChanges();
        break;
      }
      this.updateOptions();
    },

    async loadCosmeticsCount() {
      this.haveCharacterCosmetics = [];
      for(let i = 1; i < 21; i++) {
        this.haveCharacterCosmetics.push(await this.fetchOwnedCharacterCosmetics({cosmetic: i}));
      }
      this.updateOptions();
    },

    openChangeSkin(id) {
      this.currentCharacterId = id;
      (this.$refs['character-change-skin-modal']).show();
    },
    async changeCharacterSkinCall() {
      if(!this.currentCharacterId) return;
      // +1 as cosmetics have 1 (not 0) based ids
      const selectedSkinId = this.characterCosmeticsNames.findIndex(x => x === this.targetSkin) + 1;
      if(selectedSkinId === 0) {
        await this.removeCharacterCosmetic({ id: +this.currentCharacterId });
        await this.loadCosmeticsCount();
      } else {
        await this.changeCharacterCosmetic({ id: +this.currentCharacterId, cosmetic: selectedSkinId });
        await this.loadCosmeticsCount();
      }

      this.updateOptions();
    },

    checkStorage() {
      this.showCosmetics = localStorage.getItem('showCosmetics') !== 'false';
    },
  },

  components: {
    CharacterArt,
    NftOptionsDropdown,
  },

  async mounted() {
    this.levelFilter = sessionStorage.getItem('character-levelfilter') || '';
    this.elementFilter = sessionStorage.getItem('character-elementfilter') || '';
    if(this.isMarket) {
      this.priceSort = sessionStorage.getItem('character-price-order') || '';
      this.minPriceFilter = sessionStorage.getItem('character-price-minfilter') || '';
      this.maxPriceFilter = sessionStorage.getItem('character-price-maxfilter') || '';
    }
    this.checkStorage();
    Events.$on('setting:showCosmetics', () => this.checkStorage());

    await this.loadConsumablesCount();
    await this.loadCosmeticsCount();
  },
};
</script>

<style scoped>
@import '../../styles/character-cosmetics.css';
.filters {
   justify-content: center;
   width: 100%;
   max-width: 900px;
   margin: 0 auto;
   align-content: center;
   border-bottom: 0.2px solid rgba(102, 80, 80, 0.1);
   margin-bottom: 20px;
}

.character-list {
  list-style-type: none;
  margin: 0;
  padding: 0;
  display: grid;
  padding: 0.5em;
  grid-template-columns: repeat(auto-fit, 14em);
  gap: 1.5em;
}

.character {
  position: relative;
  width: 14em;
  height: 25em;
  background-position: center;
  background-repeat: no-repeat;
  background-size: 115%;
  background-color: #2e2e30cc;
  background-image: url('../../assets/cardCharacterFrame.png');
  border: 1px solid #a28d54;
  border-radius: 15px;
  padding: 0.5rem;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  overflow: hidden;
}

.character .art {
  width: 100%;
  min-height: 0;
  height: 18rem;
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
}

.valign-middle {
  vertical-align: middle;
}

.character img {
  object-fit: contain;
}

.character.selected {
  box-shadow: 0 0 8px #ffd400;
}

.above-wrapper-nft-display,
.above-wrapper {
  position: absolute;
  top: 270px;
  left: 0;
  right: 0;
  z-index: 100;
  text-shadow: 0 0 5px #333, 0 0 10px #333, 0 0 15px #333, 0 0 10px #333;
}

.above-wrapper-nft-display {
  top: 220px;
}

.clear-filters-button {
  height: fit-content;
  display: flex;
  flex-direction: row;
  align-self: flex-end;
  margin:0 15px;
}

@media (max-width: 576px) {
  .character-list {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  }
  .clear-filters-button {
    width: 100%;
    text-align: center;
    justify-content: center;
  }
}

.sold {
  height: 40px;
  width: 300px;
  background-color: rgb(187, 33, 0);
  transform: rotate(30deg);
  left: -40px;
  position: absolute;
  top: 150px;
  z-index: 100;
}

.sold span {
    text-align: center;
    width: auto;
    color: white;
    display: block;
    font-size: 30px;
    font-weight: bold;
    line-height: 40px;
    text-shadow: 0 0 5px #333, 0 0 10px #333, 0 0 15px #333, 0 0 10px #333;
    text-transform: uppercase;
}

.fix-h24 {
  height: 24px;
}

.nft-options {
  position: absolute;
  right: 0;
  top: 0;
}
</style>

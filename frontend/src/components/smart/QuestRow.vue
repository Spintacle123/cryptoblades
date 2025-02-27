<template>
  <div v-if="character" class="quest-row gap-5"
       :class="character.status !== undefined && (character.status !== NftStatus.AVAILABLE) ? 'busy-quest-row' : ''">
    <QuestCharacter :character="character" :quest="character.quest"
                    :reputationLevelRequirements="reputationLevelRequirements"/>
    <QuestRequirements v-if="character.quest && character.quest.id !== 0" :quest="character.quest"
                       :progress="character.quest.progress" :index="characterId"/>
    <QuestRewards v-if="character.quest && character.quest.id !== 0" :quest="character.quest"/>
    <QuestActions :character="character" :quest="character.quest" :key="character.quest.id"
                  @refresh-quest-data="onRefreshQuestData"/>
  </div>
</template>

<script lang="ts">
import Vue from 'vue';
import {Accessors, PropType} from 'vue/types/options';
import {Rarity, RewardType} from '@/views/Quests.vue';
import QuestCharacter from '@/components/smart/QuestCharacter.vue';
import QuestRequirements from '@/components/smart/QuestRequirements.vue';
import QuestRewards from '@/components/smart/QuestRewards.vue';
import QuestActions from '@/components/smart/QuestActions.vue';
import {Quest, ReputationLevelRequirements} from '../../views/Quests.vue';
import {mapActions, mapGetters} from 'vuex';
import {Nft, NftStatus} from '@/interfaces/Nft';

interface StoreMappedActions {
  getCharacterQuestData(payload: { characterId: string | number }): Promise<Quest>;

  getCharacterBusyStatus(payload: { characterId: string | number }): Promise<number>;
}

interface StoreMappedGetters {
  charactersWithIds(ids: (string | number)[]): Nft[];
}

interface Data {
  isLoading: boolean;
  character?: Nft;
}

export default Vue.extend({
  components: {QuestCharacter, QuestRequirements, QuestActions, QuestRewards},
  props: {
    characterId: {
      type: Number as PropType<number | string>,
      required: true,
    },
    reputationLevelRequirements: {
      type: Object as PropType<ReputationLevelRequirements>,
    },
  },

  data() {
    return {
      isLoading: true,
      character: undefined,
      RewardType,
      Rarity,
      NftStatus,
    } as Data;
  },

  computed: {
    ...mapGetters(['charactersWithIds']) as Accessors<StoreMappedGetters>,
  },

  methods: {
    ...mapActions([
      'getCharacterQuestData',
      'getCharacterBusyStatus',
    ]) as StoreMappedActions,
    async onRefreshQuestData() {
      this.$emit('refresh-quest-data');
      await this.refreshQuestData();
    },

    async refreshQuestData() {
      if (!this.character) return;
      try {
        this.isLoading = true;
        this.character.quest = await this.getCharacterQuestData({characterId: this.characterId});
        this.$forceUpdate();
      } finally {
        this.isLoading = false;
      }
    },
  },


  async mounted() {
    this.character = await this.charactersWithIds([this.characterId]).filter(Boolean)[0];
    this.character.status = +await this.getCharacterBusyStatus({characterId: this.characterId});
    await this.refreshQuestData();
  },

})
;
</script>

<style scoped>
.quest-row {
  display: flex;
  width: 100%;
  background: #141414;
  border: 1px solid #60583E;
  border-radius: 10px;
  align-items: center;
}

.busy-quest-row {
  opacity: 0.5;
  pointer-events: none;
}

@media (max-width: 576px) {
  .quest-row {
    flex-direction: column;
  }
}
</style>

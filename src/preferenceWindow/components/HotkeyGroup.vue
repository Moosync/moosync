<!-- 
  EditText.vue is a part of Moosync.
  
  Copyright 2021-2022 by Sahil Gupte <sahilsachingupte@gmail.com>. All rights reserved.
  Licensed under the GNU General Public License. 
  
  See LICENSE in the project root for license information.
-->

<template>
  <b-container v-if="prefKey" fluid class="w-100">
    <b-row>
      <PreferenceHeader v-if="title" :title="title" :tooltip="tooltip" />
      <b-col cols="auto" class="new-keybind ml-4">
        <div @click="addKeybind">Add Hotkey</div>
      </b-col>
    </b-row>

    <b-row no-gutters class="w-100 mt-2 d-flex keybind-row">
      <b-row no-gutters class="w-100 mb-2">
        <b-col><div>Actions</div></b-col>
        <b-col class="keybind-title"><div>Keybinds</div></b-col>
        <b-col><div></div></b-col>
      </b-row>
      <b-row no-gutters class="w-100 actions-row mt-2" v-for="(defined, index) of definedActions" :key="defined.value">
        <b-col>
          <b-row no-gutters>
            <b-dropdown block :text="getActiveTitle(index)" toggle-class="dropdown-button h-100" class="w-100">
              <b-dropdown-item
                v-for="action in getFilteredDropdownList()"
                :key="action.val"
                @click="setSelectedAction(index, action.key)"
                >{{ action.title }}
              </b-dropdown-item>
            </b-dropdown>
          </b-row>
        </b-col>
        <b-col @click="toggleKeybindListener(index)">
          <div class="key-input" :style="{ color: getKeybindColor(index) }">{{ getKeybind(index) }}</div>
        </b-col>
        <b-col align-self="center" class="d-flex justify-content-end">
          <div class="cross-icon" @click="removeKeybind(index)"><CrossIcon color="#E62017" /></div>
        </b-col>
        <div class="divider"></div>
      </b-row>
    </b-row>
  </b-container>
</template>

<script lang="ts">
import { Component, Prop } from 'vue-facing-decorator'
import { mixins } from 'vue-facing-decorator'
import PreferenceHeader from './PreferenceHeader.vue'
import { ExtensionPreferenceMixin } from '../mixins/extensionPreferenceMixin'
import { HotkeyEvents, HotKeyEventsExtras } from '@/utils/commonConstants'
import CrossIcon from '@/icons/CrossIcon.vue'

@Component({
  components: {
    PreferenceHeader,
    CrossIcon
  }
})
export default class HotkeyGroup extends mixins(ExtensionPreferenceMixin) {
  declare value: HotkeyPair[]

  shouldMergeDefaultValues = false

  get definedActions() {
    return this.value
  }

  getActiveTitle(index: number) {
    if (this.value) {
      this.value[index]?.value
      return HotKeyEventsExtras[this.value[index]?.value ?? 0]?.title
    }
  }

  getHotkeyValue() {
    return Object.values(HotkeyEvents).filter(
      (key) => typeof key === 'number' && this.value?.findIndex((val) => val.value === key) === -1
    ) as HotkeyEvents[]
  }

  getFilteredDropdownList() {
    return this.getHotkeyValue().map((val: HotkeyEvents) => {
      return { title: HotKeyEventsExtras[val].title, key: val }
    })
  }

  getKeybind(index: number) {
    if (this.value) {
      const combo = this.value[index]?.key?.at(0) ?? []
      return combo.length > 0 ? combo.map((val) => this.sanitizeKeys(val)).join(' + ') : 'Unassigned'
    }
  }

  setSelectedAction(index: number, item: HotkeyEvents) {
    this.value?.splice(index, 1, {
      key: this.value[index].key,
      value: item
    })
    this.onInputChange(this.value)
  }

  setSelectedKeybind(index: number, combo: HotkeyPair['key']) {
    this.value?.splice(index, 1, {
      key: combo,
      value: this.value[index].value
    })
    this.onInputChange(this.value)
  }

  private abortController: AbortController | null = null
  private listeningIndex = -1

  private sanitizeKeys(input: string) {
    input = input
      .replace('Key', '')
      .replaceAll('Numpad', 'Numpad ')
      .replaceAll('Subtract', ' -')
      .replaceAll('Minus', '-')
      .replaceAll('Equal', '=')
      .replaceAll('Add', ' +')
      .replaceAll('Multiply', ' *')
      .replaceAll('Divide', ' /')
      .replaceAll('Decimal', ' .')
      .replaceAll('Left', '')
      .replaceAll('Control', 'CTRL')
      .replace(/([a-z])([A-Z])/g, '$1 $2')

    const right = input.indexOf('Right')
    if (right != -1) {
      input = 'Right ' + input.substring(0, right)
    }

    return input
  }

  getKeybindColor(index: number) {
    if (index === this.listeningIndex) {
      return 'var(--accent)'
    }

    return 'var(--textPrimary)'
  }

  toggleKeybindListener(index: number) {
    if (this.abortController) {
      this.stopListeningKeybind()
    } else {
      this.startListeningKeybind(index)
    }
  }

  private keyComboMap: Record<string, boolean> = {}

  stopListeningKeybind(e?: KeyboardEvent | MouseEvent) {
    e?.preventDefault()
    this.abortController?.abort()
    this.abortController = null
    this.listeningIndex = -1
    this.keyComboMap = {}
  }

  startListeningKeybind(index: number) {
    this.abortController = new AbortController()
    this.listeningIndex = index

    document.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        e.preventDefault()
        this.keyComboMap[e.code] = true
        this.setSelectedKeybind(index, [Object.keys(this.keyComboMap)])
      },
      { signal: this.abortController?.signal }
    )

    document.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        e.stopPropagation()
        this.keyComboMap[`Mouse${e.button}`] = true
        this.setSelectedKeybind(index, [Object.keys(this.keyComboMap)])
      },
      { signal: this.abortController?.signal }
    )

    document.addEventListener('mouseup', this.stopListeningKeybind, { signal: this.abortController?.signal })
    document.addEventListener('keyup', this.stopListeningKeybind, { signal: this.abortController?.signal })
  }

  removeKeybind(index: number) {
    this.value?.splice(index, 1)
    this.onInputChange(this.value)
  }

  addKeybind() {
    this.value?.push({
      key: [],
      value: 0
    })
  }

  @Prop()
  title!: string

  @Prop()
  tooltip!: string
}
</script>

<style lang="sass" scoped>
.title
  font-size: 26px

.keybind-row
  text-align: left

.background
  background-color: var(--tertiary)

.actions-row
  margin-right: 15px

.divider
  height: 1px
  width: 100%
  background-color: var(--divider)
  margin-top: 15px
  margin-bottom: 15px

.key-input
  margin-left: 30px
  background-color: var(--tertiary)
  width: fit-content
  padding: 5px 15px 5px 15px
  border-radius: 8px
  transition: 0.2s color ease-in-out

.cross-icon
  width: 15px
  margin-right: 10px

.new-keybind
  font-size: 16px
  color: var(--accent)
  &:hover
    cursor: pointer

.keybind-title
  margin-left: 37px
</style>

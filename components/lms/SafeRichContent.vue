<script setup lang="ts">
import type { SafeRichContent } from '~/shared/contracts/lms'
import { learningRichBlocks, type LearningRichSegment } from '~/utils/learning-rich-content'

const props = defineProps<{ content?: SafeRichContent; label?: string }>()
const blocks = computed(() => learningRichBlocks(props.content))

function segmentClasses(item: LearningRichSegment) {
  return {
    'is-bold': item.bold,
    'is-italic': item.italic,
    'is-underlined': item.underline,
    'is-struck': item.strike,
  }
}
</script>

<template>
  <div v-if="blocks.length" class="safe-rich-content" :aria-label="label">
    <template v-for="(block, blockIndex) in blocks" :key="blockIndex">
      <ol v-if="block.type === 'list' && block.style === 'ordered'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item" :key="partIndex">
            <a v-if="part.link" :href="part.link" target="_blank" rel="noopener noreferrer" :class="segmentClasses(part)">{{ part.text }}</a>
            <span v-else :class="segmentClasses(part)">{{ part.text }}</span>
          </template>
        </li>
      </ol>
      <ul v-else-if="block.type === 'list'">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
          <template v-for="(part, partIndex) in item" :key="partIndex">
            <a v-if="part.link" :href="part.link" target="_blank" rel="noopener noreferrer" :class="segmentClasses(part)">{{ part.text }}</a>
            <span v-else :class="segmentClasses(part)">{{ part.text }}</span>
          </template>
        </li>
      </ul>
      <h3 v-else-if="block.type === 'heading' && block.level === 1">
        <template v-for="(part, partIndex) in block.segments" :key="partIndex">
          <a v-if="part.link" :href="part.link" target="_blank" rel="noopener noreferrer" :class="segmentClasses(part)">{{ part.text }}</a>
          <span v-else :class="segmentClasses(part)">{{ part.text }}</span>
        </template>
      </h3>
      <h4 v-else-if="block.type === 'heading' && block.level === 2">
        <template v-for="(part, partIndex) in block.segments" :key="partIndex">
          <a v-if="part.link" :href="part.link" target="_blank" rel="noopener noreferrer" :class="segmentClasses(part)">{{ part.text }}</a>
          <span v-else :class="segmentClasses(part)">{{ part.text }}</span>
        </template>
      </h4>
      <h5 v-else-if="block.type === 'heading'">
        <template v-for="(part, partIndex) in block.segments" :key="partIndex">
          <a v-if="part.link" :href="part.link" target="_blank" rel="noopener noreferrer" :class="segmentClasses(part)">{{ part.text }}</a>
          <span v-else :class="segmentClasses(part)">{{ part.text }}</span>
        </template>
      </h5>
      <p v-else>
        <template v-if="block.segments.length">
          <template v-for="(part, partIndex) in block.segments" :key="partIndex">
            <a v-if="part.link" :href="part.link" target="_blank" rel="noopener noreferrer" :class="segmentClasses(part)">{{ part.text }}</a>
            <span v-else :class="segmentClasses(part)">{{ part.text }}</span>
          </template>
        </template>
        <br v-else aria-hidden="true">
      </p>
    </template>
  </div>
</template>

<style scoped>
.safe-rich-content{color:#4f675d;font-size:.65rem;line-height:1.65;overflow-wrap:anywhere}.safe-rich-content :is(p,h3,h4,h5,ol,ul){margin:.45rem 0}.safe-rich-content :is(h3,h4,h5){color:#315145;font-weight:800}.safe-rich-content h3{font-size:.9rem}.safe-rich-content h4{font-size:.8rem}.safe-rich-content h5{font-size:.72rem}.safe-rich-content :is(ol,ul){padding-left:1.25rem}.safe-rich-content a{color:#176b4a;text-underline-offset:2px}.is-bold{font-weight:800}.is-italic{font-style:italic}.is-underlined{text-decoration-line:underline}.is-struck{text-decoration-line:line-through}.is-underlined.is-struck{text-decoration-line:underline line-through}
</style>

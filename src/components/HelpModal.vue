<script setup lang="ts">
import { computed, watch, ref } from 'vue'

interface Props {
  open: boolean
  initialDoc?: string
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
defineEmits<Emits>()

// Every docs/concepts/*.md is bundled as text and becomes a tab here.
const files = import.meta.glob('../../docs/concepts/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>
const ORDER = ['overview', 'past', 'present', 'future', 'backup']
const docs: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([path, text]) => [path.split('/').pop()!.replace(/\.md$/, ''), text]),
)
const docKeys = Object.keys(docs).sort((a, b) => {
  const ia = ORDER.indexOf(a)
  const ib = ORDER.indexOf(b)
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
})

const currentDoc = ref(props.initialDoc ?? 'overview')
watch(
  () => [props.open, props.initialDoc],
  () => {
    if (props.open && props.initialDoc && docs[props.initialDoc]) currentDoc.value = props.initialDoc
  },
)

const currentDocContent = computed(() => docs[currentDoc.value] ?? docs['overview'] ?? '')
</script>

<template>
  <div v-if="open" class="modal-overlay" @click="$emit('close')">
    <div class="modal-content" role="dialog" aria-modal="true" aria-label="Help" @click.stop>
      <button class="close-btn" @click="$emit('close')" aria-label="Close">✕</button>

      <div class="modal-body">
        <div class="doc-content">
          <div v-html="formatMarkdown(currentDocContent)" class="markdown"></div>
        </div>

        <div v-if="docKeys.length > 1" class="doc-tabs">
          <button
            v-for="key in docKeys"
            :key="key"
            :class="{ active: currentDoc === key }"
            class="tab-btn"
            @click="currentDoc = key"
          >
            {{ formatTabName(key) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function inline(t: string): string {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

// Small markdown subset: headings, paragraphs, bullet lists, bold/italic/code, rules.
function formatMarkdown(md: string): string {
  const out: string[] = []
  let list = false
  let para: string[] = []
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`)
    para = []
  }
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    const li = /^\s*[-*] (.*)/.exec(line)
    if (!li && list) {
      out.push('</ul>')
      list = false
    }
    if (/^#{1,3} /.test(line)) {
      flush()
      const level = line.indexOf(' ')
      out.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`)
    } else if (li) {
      flush()
      if (!list) out.push('<ul>')
      list = true
      out.push(`<li>${inline(li[1])}</li>`)
    } else if (/^---+$/.test(line)) {
      flush()
      out.push('<hr />')
    } else if (!line.trim()) {
      flush()
    } else {
      para.push(line.trim())
    }
  }
  flush()
  if (list) out.push('</ul>')
  return out.join('')
}

function formatTabName(key: string): string {
  return key
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--backdrop);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 1rem;
}

.modal-content {
  position: relative;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 0.8rem;
  max-width: 50rem;
  max-height: 80vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow);
}

.close-btn {
  position: absolute;
  top: 0.8rem;
  right: 0.8rem;
  z-index: 101;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-muted);
  padding: 0.25rem;
}

.close-btn:hover {
  color: var(--text);
}

.modal-body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  flex: 1;
}

.doc-content {
  flex: 1;
  overflow: auto;
  padding: 1.5rem;
}

.markdown {
  font-size: 0.95rem;
  line-height: 1.6;
}

.markdown :deep(h1) {
  font-size: 1.5rem;
  margin: 0 0 1rem 0;
  color: var(--text);
}

.markdown :deep(h2) {
  font-size: 1.2rem;
  margin: 1rem 0 0.5rem 0;
  color: var(--text);
}

.markdown :deep(p) {
  margin: 0.5rem 0;
  color: var(--text);
}

.markdown :deep(code) {
  background: var(--bg-elev-2);
  padding: 0.2rem 0.4rem;
  border-radius: 0.3rem;
  font-family: ui-monospace, monospace;
  font-size: 0.9em;
}

.markdown :deep(ul) {
  padding-left: 1.25rem;
  margin: 0.5rem 0;
}

.markdown :deep(li) {
  color: var(--text);
  margin: 0.2rem 0;
}

.markdown :deep(hr) {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1rem 0;
}

.doc-tabs {
  display: flex;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  border-top: 1px solid var(--border);
  background: var(--bg-elev-2);
  overflow: auto;
}

.tab-btn {
  padding: 0.5rem 1rem;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 0.4rem;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.85rem;
  white-space: nowrap;
}

.tab-btn:hover {
  color: var(--text);
  border-color: var(--accent-blue);
}

.tab-btn.active {
  background: var(--accent-blue);
  color: white;
  border-color: var(--accent-blue);
}

@media (max-width: 30rem) {
  .modal-overlay {
    padding: 0;
    align-items: stretch;
  }

  .modal-content {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }

  .modal-content {
    max-width: 100%;
    max-height: 100%;
    border-radius: 0;
  }

  .doc-content {
    padding: 1rem;
  }
}
</style>

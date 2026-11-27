<script setup lang="ts">
// Export / Import sheet.
//   Export: a zip file (share sheet / save dialog / download), or the whole data
//           set as JSON on the clipboard (refused above CLIPBOARD_LIMIT_BYTES).
//   Import: a zip or JSON file, or JSON pasted from the clipboard. Both end at
//           the same Merge / Replace confirmation before anything is written.
// Also shows storage health. Opened from Present, the footer and the backup nudge.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { copyText, readClipboardText } from '../../lib/clipboard'
import { fmtDate } from '../../lib/money'
import { noteExported, refreshHealth, storeState } from '../../lib/storage/store'
import { exportAll, formatBytes, useStore } from '../../lib/storage/useStore'
import { CLIPBOARD_LIMIT_BYTES, type ImportBundle, parseImportText, useTracker } from './useTracker'

/** Which half to show: the side menu opens one or the other. */
const props = defineProps<{ section: 'export' | 'import' }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const { records, projections, readImport, applyImport, exportText } = useTracker()

// Size of the clipboard export, worked out when the sheet opens.
const clipSize = ref(exportText().bytes)
const clipTooBig = computed(() => clipSize.value > CLIPBOARD_LIMIT_BYTES)

async function doCopy() {
  msg.value = err.value = ''
  const { text, bytes } = exportText()
  clipSize.value = bytes
  if (bytes > CLIPBOARD_LIMIT_BYTES) {
    err.value = `Your data is ${formatBytes(bytes)}, too big to copy safely. Use the zip file instead.`
    return
  }
  if (await copyText(text)) {
    noteExported()
    msg.value = `Copied ${formatBytes(bytes)} of JSON (${records.value.length} record${records.value.length === 1 ? '' : 's'}). Paste it into a note or message to keep it.`
  } else {
    err.value = 'This browser wouldn’t copy. Use the zip file instead.'
  }
}

// ---- paste
const pasteOpen = ref(false)
const pasteText = ref('')
const pasteBox = ref<HTMLTextAreaElement>()

async function doPaste() {
  msg.value = err.value = ''
  pending.value = null
  const text = await readClipboardText()
  if (text && text.trim()) {
    parsePasted(text)
    return
  }
  // The browser wouldn't hand over the clipboard (or it was empty): paste by hand.
  pasteOpen.value = true
  pasteText.value = ''
  await nextTick()
  pasteBox.value?.focus()
}

function parsePasted(text: string) {
  err.value = ''
  try {
    pending.value = parseImportText(text)
    pasteOpen.value = false
    pasteText.value = ''
  } catch (e) {
    err.value = (e as Error).message
    pasteOpen.value = true
    pasteText.value = text.length > 200_000 ? '' : text
  }
}

const busy = ref(false)
const msg = ref('')
const err = ref('')
const pending = ref<ImportBundle | null>(null)
const fileInput = ref<HTMLInputElement>()

async function doExport() {
  busy.value = true
  msg.value = err.value = ''
  try {
    const r = await exportAll()
    msg.value =
      r === 'cancelled'
        ? ''
        : r === 'shared'
          ? 'Backup ready. If you tapped “Save to Files”, it’s in the Files app.'
          : 'Backup saved.'
  } catch (e) {
    err.value = `Export failed: ${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  msg.value = err.value = ''
  pasteOpen.value = false
  try {
    pending.value = await readImport(file)
  } catch (e2) {
    err.value = (e2 as Error).message
  }
}

async function confirmImport(mode: 'merge' | 'replace') {
  if (!pending.value) return
  busy.value = true
  try {
    await applyImport(pending.value, mode)
    msg.value = `Imported ${pending.value.recordCount} record${pending.value.recordCount === 1 ? '' : 's'}${
      pending.value.projectionCount
        ? `, ${pending.value.projectionCount} projection${pending.value.projectionCount === 1 ? '' : 's'}`
        : ''
    }${pending.value.files.some((f) => f.id === 'template') ? ' and your template' : ''
    }.`
    pending.value = null
    clipSize.value = exportText().bytes
    await refreshHealth()
  } catch (e) {
    err.value = `Import failed: ${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

const h = computed(() => storeState.health)
const { dataLabel } = useStore()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => {
  document.addEventListener('keydown', onKey)
  refreshHealth()
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="panel" role="dialog" aria-modal="true" :aria-label="props.section === 'export' ? 'Export' : 'Import'">
      <header class="head">
        <h2>{{ props.section === 'export' ? 'Export records' : 'Import records' }}</h2>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </header>

      <div class="body">
        <template v-if="props.section === 'export'">
        <p class="muted small">
          Everything is stored only on this device, inside this app. Deleting the app from your Home Screen
          deletes the data too, so export now and then.
        </p>

        <div class="data-actions">
          <button class="btn primary" :disabled="busy" @click="doExport">Zip file</button>
          <button class="btn" :disabled="busy || clipTooBig" @click="doCopy">Copy to clipboard</button>
        </div>
        <p class="muted small hint">
          <template v-if="clipTooBig">
            Your data is {{ formatBytes(clipSize) }}, over the {{ formatBytes(CLIPBOARD_LIMIT_BYTES) }} clipboard
            limit. Use the zip file.
          </template>
          <template v-else>
            The clipboard copy is one JSON text ({{ formatBytes(clipSize) }}) with your projections, template and every
            record. Paste it into a note or message to keep it.
          </template>
        </p>
        </template>

        <template v-else>
        <p class="muted small">
          Bring back records from a zip you exported, a JSON file, or text you copied. You'll choose whether to merge
          or replace before anything changes.
        </p>
        <div class="data-actions">
          <button class="btn" :disabled="busy" @click="fileInput?.click()">Zip or JSON file…</button>
          <button class="btn" :disabled="busy" @click="doPaste">Paste from clipboard</button>
          <input
            ref="fileInput"
            type="file"
            accept=".zip,.json,application/zip,application/json"
            hidden
            @change="onFile"
          />
        </div>

        <div v-if="pasteOpen" class="paste">
          <label class="small" for="paste-box">Paste the exported text here:</label>
          <textarea
            id="paste-box"
            ref="pasteBox"
            v-model="pasteText"
            class="paste-box"
            rows="5"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            placeholder='{ "app": "pocket-master", … }'
          ></textarea>
          <div class="data-actions">
            <button class="btn primary" :disabled="!pasteText.trim()" @click="parsePasted(pasteText)">Read it</button>
            <button class="btn ghost" @click="pasteOpen = false">Cancel</button>
          </div>
        </div>

        <div v-if="pending" class="confirm">
          <p>
            This {{ pending.kind === 'zip' ? 'file' : 'text' }} has <b>{{ pending.recordCount }}</b>
            record{{ pending.recordCount === 1 ? '' : 's' }}
            <template v-if="pending.projectionCount">
              plus {{ pending.projectionCount }} projection{{ pending.projectionCount === 1 ? '' : 's' }}</template
            ><template v-if="pending.files.some((f) => f.id === 'template')"> and a template</template>.
            How should it be added?
          </p>
          <div class="data-actions">
            <button class="btn" :disabled="busy" @click="confirmImport('merge')">Merge</button>
            <button class="btn danger" :disabled="busy" @click="confirmImport('replace')">Replace everything</button>
            <button class="btn ghost" :disabled="busy" @click="pending = null">Cancel</button>
          </div>
          <p class="muted small">
            Merge keeps your current records and adds these (same dates are replaced). Replace deletes what’s here
            first.
          </p>
        </div>

        </template>

        <p v-if="msg" class="ok small" role="status">{{ msg }}</p>
        <p v-if="err" class="err small" role="alert">{{ err }}</p>

        <dl v-if="props.section === 'export'" class="health small">
          <dt>Last export</dt>
          <dd>{{ storeState.lastExport ? fmtDate(storeState.lastExport.slice(0, 10)) : 'never' }}</dd>
          <dt>Files</dt>
          <dd>records/ ({{ records.length }}) · projections/ ({{ projections.length }}) · template.json</dd>
          <dt>Your data</dt>
          <dd>{{ dataLabel }} <span class="muted">(exact)</span></dd>
          <dt>Space allowed</dt>
          <dd>
            <template v-if="storeState.backend !== 'opfs'">Not available: nothing is kept</template>
            <template v-else>about {{ formatBytes(h.quotaBytes) }}, set by the browser</template>
          </dd>
          <dt>Installed app</dt>
          <dd :class="{ warn: !h.installed }">{{ h.installed ? 'Yes' : 'No, opened in a browser tab' }}</dd>
          <dt>Protected from clean-up</dt>
          <dd :class="{ warn: h.persisted === false }">
            {{ h.persisted == null ? 'Unknown' : h.persisted ? 'Yes' : 'No' }}
          </dd>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 95;
  background: var(--backdrop);
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

@media (min-width: 40rem) {
  .backdrop {
    align-items: center;
  }
}

.panel {
  width: min(32rem, 100%);
  max-height: 90dvh;
  overflow-y: auto;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius) var(--radius) 0 0;
  padding-bottom: env(safe-area-inset-bottom);
}

@media (min-width: 40rem) {
  .panel {
    border-radius: var(--radius);
  }
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.5rem 0 1rem;
}

.head h2 {
  margin: 0;
  font-size: 1.2rem;
}

.x {
  width: var(--tap);
  height: var(--tap);
  border: none;
  background: none;
  color: var(--mute);
  font-size: 1.3rem;
}

.body {
  padding: 0 1rem 1rem;
}

h3 {
  margin: 1rem 0 0.4rem;
  font-size: 0.8rem;
  font-family: var(--font-text);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--mute);
}

.hint {
  margin: 0.4rem 0 0;
}

.paste {
  margin-top: 0.75rem;
  display: grid;
  gap: 0.4rem;
}

.paste-box {
  width: 100%;
  min-height: 7rem;
  padding: 0.5rem;
  border: 1px solid var(--line);
  border-radius: 0.5rem;
  background: var(--bg-input);
  color: var(--ink);
  font-family: var(--mono);
  font-size: 16px; /* no iOS zoom */
  resize: vertical;
}

.paste-box:focus {
  outline: none;
  border-color: var(--accent);
}

.data-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.confirm {
  margin-top: 0.75rem;
  padding: 0.75rem;
  border: 1px solid var(--projection);
  border-radius: 0.6rem;
}

.confirm p {
  margin: 0 0 0.6rem;
}

.confirm p.small {
  margin: 0.6rem 0 0;
}

.health {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.3rem 1rem;
  margin: 1rem 0 0;
}

.health dt {
  color: var(--mute);
}

.health dd {
  margin: 0;
}

.warn {
  color: var(--projection);
}

.ok {
  color: var(--pos);
}

.err {
  color: var(--negative);
}
</style>

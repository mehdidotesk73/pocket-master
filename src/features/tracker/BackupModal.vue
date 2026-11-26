<script setup lang="ts">
// Backup sheet: export everything, import a backup (or the prototype's JSON),
// and the storage health details. Opened from the footer and the backup nudge.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fmtDate } from '../../lib/money'
import { refreshHealth, storeState } from '../../lib/storage/store'
import { exportAll, formatBytes } from '../../lib/storage/useStore'
import { type ImportBundle, useTracker } from './useTracker'

const emit = defineEmits<{ (e: 'close'): void }>()
const { records, readImport, applyImport } = useTracker()

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
      pending.value.files.some((f) => f.id === 'projection') ? ', your projection and your template' : ''
    }.`
    pending.value = null
    await refreshHealth()
  } catch (e) {
    err.value = `Import failed: ${(e as Error).message}`
  } finally {
    busy.value = false
  }
}

const h = computed(() => storeState.health)

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
    <div class="panel" role="dialog" aria-modal="true" aria-label="Backup">
      <header class="head">
        <h2>Backup</h2>
        <button class="x" aria-label="Close" @click="emit('close')">✕</button>
      </header>

      <div class="body">
        <p class="muted small">
          Everything is stored only on this device, inside this app. Deleting the app from your Home Screen
          deletes the data too, so back up now and then.
        </p>

        <div class="data-actions">
          <button class="btn primary" :disabled="busy" @click="doExport">Export all</button>
          <button class="btn" :disabled="busy" @click="fileInput?.click()">Import…</button>
          <input
            ref="fileInput"
            type="file"
            accept=".zip,.json,application/zip,application/json"
            hidden
            @change="onFile"
          />
        </div>

        <div v-if="pending" class="confirm">
          <p>
            This file has <b>{{ pending.recordCount }}</b> record{{ pending.recordCount === 1 ? '' : 's' }}
            <template v-if="pending.files.some((f) => f.id === 'projection')"> plus a projection and a template</template>.
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

        <p v-if="msg" class="ok small">{{ msg }}</p>
        <p v-if="err" class="err small">{{ err }}</p>

        <dl class="health small">
          <dt>Last backup</dt>
          <dd>{{ storeState.lastExport ? fmtDate(storeState.lastExport.slice(0, 10)) : 'never' }}</dd>
          <dt>Files</dt>
          <dd>records/ ({{ records.length }} file{{ records.length === 1 ? '' : 's' }}) · projection.json · template.json</dd>
          <dt>Storage</dt>
          <dd>
            {{ storeState.backend === 'opfs' ? 'Files on this device' : 'Not available: nothing is kept' }} ·
            {{ formatBytes(h.usageBytes) }} used
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
